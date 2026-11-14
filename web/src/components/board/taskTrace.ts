import type { Task, TaskEvent, TaskRun } from "@/api";
import type { TraceSpan, TraceSpanStatus } from "@/components/ui/agent-trace";

export type EventTone = "accent" | "success" | "danger" | "warning" | "neutral";

export interface EventCard {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  actor?: string;
  tone: EventTone;
  badge?: string;
  at: number;
  count?: number;
  meta?: Record<string, string>;
}

export interface EventGroup {
  id: string;
  title: string;
  status: EventTone;
  startedAt: number;
  endedAt?: number;
  events: EventCard[];
}

function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function str(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

function num(r: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortErrorLine(raw?: string): string {
  if (!raw) return "";
  const first = raw.split(/\r?\n/)[0]?.trim() ?? "";
  return first.length > 140 ? first.slice(0, 137) + "..." : first;
}

function mapRunStatus(status: string): TraceSpanStatus {
  switch (status) {
    case "running":
      return "running";
    case "failed":
    case "timeout":
    case "canceled":
    case "interrupted":
      return "error";
    case "skipped":
      return "skipped";
    default:
      return "ok";
  }
}

interface ParsedTurnTrace {
  spans: TraceSpan[];
}

/** Extract turn & tool micro-spans from raw dsh/harness JSONL output. */
function parseOutputMicroSpans(
  prefixId: string,
  rawOutput: string,
  windowStartMs: number,
  windowEndMs: number
): ParsedTurnTrace {
  if (!rawOutput.trim()) return { spans: [] };

  const lines = rawOutput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed: Array<{ type: string; turn?: number; model?: string; name?: string; err?: string; tokens?: number }> = [];

  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const type = str(obj, "type") || str(obj, "status");
      if (!type) continue;
      let errMsg = "";
      if (typeof obj.error === "string") {
        errMsg = obj.error;
      } else if (obj.error && typeof obj.error === "object") {
        const eo = asRecord(obj.error);
        const code = str(eo, "code");
        const st = num(eo, "status", "status_code");
        const msg = str(eo, "message", "detail");
        errMsg = [code, st ? String(st) : "", msg].filter(Boolean).join(" · ");
      }
      const usage = asRecord(obj.usage);
      const tokens = num(usage, "total_tokens") ?? ((num(usage, "input_tokens") ?? 0) + (num(usage, "output_tokens") ?? 0) || undefined);
      parsed.push({
        type,
        turn: num(obj, "turn"),
        model: str(obj, "model"),
        name: str(obj, "name", "tool"),
        err: errMsg || undefined,
        tokens,
      });
    } catch {
      // ignore non-JSON lines
    }
  }

  if (parsed.length === 0) return { spans: [] };

  const spanWindow = Math.max(100, windowEndMs - windowStartMs);
  const turns: TraceSpan[] = [];
  let currentTurn: TraceSpan | null = null;
  let stepIndex = 0;

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const pct = i / Math.max(1, parsed.length);
    const estStart = Math.round(windowStartMs + pct * spanWindow);
    const estSlice = Math.max(50, Math.round(spanWindow / Math.max(1, parsed.length)));

    if (item.type === "turn_start") {
      if (currentTurn) turns.push(currentTurn);
      const tNum = item.turn ?? turns.length + 1;
      currentTurn = {
        id: `${prefixId}-turn-${tNum}-${i}`,
        label: `Turn ${tNum}`,
        actor: item.model || undefined,
        status: "ok",
        startedAt: estStart,
        durationMs: estSlice,
        children: [],
      };
      continue;
    }

    if (item.type === "tool_call" || item.type === "tool_use") {
      stepIndex += 1;
      const child: TraceSpan = {
        id: `${prefixId}-tool-${stepIndex}-${i}`,
        label: item.name ? `Tool: ${item.name}` : `Tool #${stepIndex}`,
        status: item.err ? "error" : "ok",
        startedAt: estStart,
        durationMs: estSlice,
        detail: item.err ? shortErrorLine(item.err) : undefined,
      };
      if (currentTurn) {
        currentTurn.children = [...(currentTurn.children ?? []), child];
      } else {
        turns.push(child);
      }
      continue;
    }

    if (item.type === "turn_end" || item.type === "final" || item.type === "error") {
      if (currentTurn) {
        currentTurn.endedAt = Math.min(windowEndMs, estStart + estSlice);
        currentTurn.durationMs = Math.max(50, currentTurn.endedAt - currentTurn.startedAt);
        if (item.tokens) currentTurn.tokens = item.tokens;
        if (item.err) {
          currentTurn.status = "error";
          currentTurn.detail = shortErrorLine(item.err);
          currentTurn.meta = { error: item.err };
        }
        turns.push(currentTurn);
        currentTurn = null;
      } else if (item.err) {
        turns.push({
          id: `${prefixId}-err-${i}`,
          label: item.type === "final" ? "Final error" : "Agent error",
          status: "error",
          startedAt: estStart,
          durationMs: estSlice,
          detail: shortErrorLine(item.err),
          meta: { error: item.err },
        });
      }
    }
  }

  if (currentTurn) {
    currentTurn.endedAt = windowEndMs;
    currentTurn.durationMs = Math.max(50, windowEndMs - currentTurn.startedAt);
    turns.push(currentTurn);
  }

  return { spans: turns };
}

export function traceOrigin(task: Task, events: TaskEvent[], runs: TaskRun[]): number {
  const candidates: number[] = [];
  if (task.created_at) candidates.push(task.created_at * 1000);
  for (const e of events) if (e.created_at) candidates.push(e.created_at * 1000);
  for (const r of runs) if (r.started_at) candidates.push(r.started_at * 1000);
  return candidates.length ? Math.min(...candidates) : Date.now();
}

export function traceSpansFromHistory(
  task: Task,
  events: TaskEvent[],
  runs: TaskRun[],
  nowMs = Date.now()
): { originMs: number; totalDurationMs: number; spans: TraceSpan[] } {
  const sorted = [...events].sort((a, b) => a.id - b.id || a.created_at - b.created_at);
  const spans: TraceSpan[] = [];

  if (runs.length === 0) {
    const originMs = traceOrigin(task, sorted, runs);
    let maxMs = originMs + 1000;
    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      const p = asRecord(ev.payload);
      const start = ev.created_at * 1000;
      const nextStart = sorted[i + 1]?.created_at ? sorted[i + 1].created_at * 1000 : start + 500;
      const dur = Math.max(100, nextStart - start);
      if (start + dur > maxMs) maxMs = start + dur;

      spans.push({
        id: `ev-${ev.id}`,
        label: describeEventKind(ev.kind, p).title,
        detail: describeEventKind(ev.kind, p).subtitle,
        actor: str(p, "actor", "executor") || undefined,
        status: ev.kind === "failed" ? "error" : "ok",
        startedAt: start,
        durationMs: dur,
      });
    }
    return { originMs, totalDurationMs: Math.max(1000, maxMs - originMs), spans };
  }

  // Partition events cleanly into buckets aligned with each run
  const runBuckets: TaskEvent[][] = runs.map(() => []);
  const lifecyclePrefix: TaskEvent[] = [];
  const lifecycleSuffix: TaskEvent[] = [];

  let activeIdx = -1;
  for (const ev of sorted) {
    const p = asRecord(ev.payload);
    if (ev.kind === "claimed" || ev.kind === "started" || ev.kind === "task.dispatched") {
      // Advance run bucket unless current bucket was just initialized by task.moved -> in_progress
      if (
        activeIdx < 0 ||
        runBuckets[activeIdx].some((prev) => prev.kind === "claimed" || prev.kind === "completed" || prev.kind === "failed")
      ) {
        if (activeIdx + 1 < runs.length) activeIdx += 1;
      }
      if (activeIdx >= 0) runBuckets[activeIdx].push(ev);
      continue;
    }
    if (ev.kind === "task.moved" && str(p, "to") === "in_progress") {
      if (activeIdx < 0 || runBuckets[activeIdx].some((prev) => prev.kind === "completed" || prev.kind === "failed")) {
        if (activeIdx + 1 < runs.length) activeIdx += 1;
      }
      if (activeIdx >= 0) runBuckets[activeIdx].push(ev);
      continue;
    }

    if (activeIdx < 0) {
      lifecyclePrefix.push(ev);
    } else if (ev.kind === "approved" || ev.kind === "rejected") {
      lifecycleSuffix.push(ev);
    } else {
      runBuckets[activeIdx].push(ev);
    }
  }

  const originMs = runs[0].started_at ? runs[0].started_at * 1000 : traceOrigin(task, sorted, runs);
  let maxMs = originMs + 1000;

  if (lifecyclePrefix.length > 0) {
    const first = lifecyclePrefix[0];
    spans.push({
      id: `created-${first.id}`,
      label: "Task created",
      actor: str(asRecord(first.payload), "actor") || "board",
      status: "ok",
      startedAt: originMs,
      durationMs: 250,
    });
  }

  runs.forEach((run, idx) => {
    const bucket = runBuckets[idx] ?? [];
    const runStartMs = run.started_at ? run.started_at * 1000 : originMs;
    const rawDurationMs =
      run.duration_ms && run.duration_ms > 0
        ? run.duration_ms
        : run.ended_at && run.ended_at >= run.started_at
          ? Math.max(500, (run.ended_at - run.started_at) * 1000)
          : run.status === "running"
            ? Math.max(500, nowMs - runStartMs)
            : 1000;
    const runEndMs = run.status === "running" ? Math.max(runStartMs + 500, nowMs) : runStartMs + rawDurationMs;
    if (runEndMs > maxMs) maxMs = runEndMs;

    const children: TraceSpan[] = [];
    const claimEv = bucket.find((e) => e.kind === "claimed" || e.kind === "started");
    const wtEv = bucket.find((e) => e.kind === "worktree_ready");
    const dispEv = bucket.find((e) => e.kind === "remote_dispatched");
    const outEvs = bucket.filter((e) => e.kind === "worker_output");
    const endEv = bucket.find((e) => e.kind === "completed" || e.kind === "failed" || e.kind === "timeout" || e.kind === "canceled");

    if (claimEv) {
      const s = claimEv.created_at * 1000;
      const next = wtEv?.created_at ?? dispEv?.created_at ?? claimEv.created_at;
      children.push({
        id: `run-${run.run}-claim`,
        label: "Claim & Lease",
        actor: run.worker_id || undefined,
        status: "ok",
        startedAt: s,
        durationMs: Math.max(120, next * 1000 - s),
      });
    }

    if (wtEv) {
      const wp = asRecord(wtEv.payload);
      const s = wtEv.created_at * 1000;
      const next = dispEv?.created_at ?? wtEv.created_at;
      children.push({
        id: `run-${run.run}-wt`,
        label: "Git Worktree",
        actor: str(wp, "transport") || undefined,
        detail: str(wp, "branch") || undefined,
        status: "ok",
        startedAt: s,
        durationMs: Math.max(150, next * 1000 - s),
        meta: {
          branch: str(wp, "branch") || undefined,
          base_sha: str(wp, "base_sha") ? str(wp, "base_sha").slice(0, 10) : undefined,
          path: str(wp, "path") || undefined,
        },
      });
    }

    const execStartMs = dispEv ? dispEv.created_at * 1000 : runStartMs;
    const micro = parseOutputMicroSpans(`run-${run.run}`, run.output ?? "", execStartMs, runEndMs);
    const totalOutBytes = outEvs.reduce((acc, ev) => acc + str(asRecord(ev.payload), "output", "text", "delta").length, 0);

    if (dispEv || micro.spans.length > 0 || outEvs.length > 0) {
      const dp = dispEv ? asRecord(dispEv.payload) : {};
      children.push({
        id: `run-${run.run}-exec`,
        label: "Worker Execution",
        actor: run.executor || str(dp, "executor") || task.executor || undefined,
        detail: run.model || str(dp, "model") || task.model || undefined,
        status: mapRunStatus(run.status),
        startedAt: execStartMs,
        endedAt: run.status === "running" ? undefined : runEndMs,
        durationMs: Math.max(250, runEndMs - execStartMs),
        tokens: run.usage?.total_tokens,
        costUsd: run.usage?.cost_usd,
        meta: {
          session: run.session_id || str(dp, "session_id") || undefined,
          turns: run.usage?.turns,
          streamed: totalOutBytes > 0 ? `${outEvs.length} chunks (${formatBytesShort(totalOutBytes)})` : undefined,
        },
        children: micro.spans.length > 0 ? micro.spans : undefined,
      });
    }

    if (endEv || run.status !== "running") {
      const endStatus = mapRunStatus(run.status);
      children.push({
        id: `run-${run.run}-end`,
        label: run.status === "failed" ? "Failed" : "Completed",
        detail: run.error ? shortErrorLine(run.error) : run.usage?.turns ? `${run.usage.turns} turn(s)` : undefined,
        status: endStatus,
        startedAt: Math.max(runStartMs, runEndMs - 150),
        durationMs: 150,
        meta: run.error ? { error: run.error } : undefined,
      });
    }

    spans.push({
      id: `run-${run.run}`,
      label: `Run #${run.run}`,
      actor: run.executor || task.executor || undefined,
      detail: run.error ? shortErrorLine(run.error) : run.model || task.model || undefined,
      status: mapRunStatus(run.status),
      startedAt: runStartMs,
      endedAt: run.status === "running" ? undefined : runEndMs,
      durationMs: rawDurationMs,
      tokens: run.usage?.total_tokens,
      costUsd: run.usage?.cost_usd,
      meta: {
        worker: run.worker_id || undefined,
        session: run.session_id || undefined,
        model: run.model || undefined,
        error: run.error || undefined,
      },
      children,
    });
  });

  for (const ev of lifecycleSuffix) {
    const p = asRecord(ev.payload);
    const start = ev.created_at * 1000;
    if (start + 300 > maxMs) maxMs = start + 300;
    const desc = describeEventKind(ev.kind, p);
    spans.push({
      id: `suffix-${ev.id}`,
      label: desc.title,
      detail: desc.subtitle,
      actor: str(p, "actor") || undefined,
      status: ev.kind === "rejected" ? "error" : "ok",
      startedAt: start,
      durationMs: 300,
    });
  }

  return {
    originMs,
    totalDurationMs: Math.max(500, maxMs - originMs),
    spans,
  };
}

function describeEventKind(kind: string, p: Record<string, unknown>): Omit<EventCard, "id" | "kind" | "at"> {
  switch (kind) {
    case "task.created":
      return {
        title: "Task created",
        subtitle: str(p, "title") || undefined,
        actor: str(p, "actor") || "user",
        tone: "accent",
        badge: str(p, "status") || undefined,
      };
    case "task.moved": {
      const from = str(p, "from");
      const to = str(p, "to");
      const tone: EventTone =
        to === "done" || to === "review" ? "success" : to === "failed" ? "danger" : to === "in_progress" ? "accent" : "neutral";
      return {
        title: from && to ? `${from} -> ${to}` : `Moved to ${to || "column"}`,
        actor: str(p, "actor") || undefined,
        tone,
        badge: to || undefined,
      };
    }
    case "task.dep_added":
      return {
        title: "Dependency added",
        subtitle: str(p, "blocked_by") ? `Blocked by ${str(p, "blocked_by")}` : undefined,
        tone: "warning",
      };
    case "comment.added":
      return {
        title: "Comment added",
        actor: str(p, "author") || undefined,
        tone: "neutral",
      };
    case "claimed":
    case "started":
      return {
        title: "Worker claimed task",
        subtitle: [str(p, "executor"), str(p, "model")].filter(Boolean).join(" · ") || undefined,
        actor: str(p, "worker_id", "run_id") || "dispatcher",
        tone: "accent",
        badge: str(p, "run_id") || undefined,
      };
    case "worktree_ready":
      return {
        title: "Git worktree prepared",
        subtitle: str(p, "branch") || str(p, "path") || undefined,
        actor: str(p, "transport") || "git",
        tone: "accent",
        badge: str(p, "base_sha") ? str(p, "base_sha").slice(0, 8) : undefined,
      };
    case "remote_dispatched":
      return {
        title: "Dispatched to node-agent",
        subtitle: [str(p, "executor"), str(p, "model")].filter(Boolean).join(" · ") || undefined,
        actor: str(p, "worker_id") || "node-agent",
        tone: "accent",
        badge: str(p, "session_id") ? str(p, "session_id").slice(0, 14) : undefined,
      };
    case "completed": {
      const ms = num(p, "duration_ms");
      return {
        title: "Run completed",
        subtitle: [str(p, "executor"), ms ? `${(ms / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · ") || undefined,
        actor: str(p, "worker_id") || "worker",
        tone: "success",
        badge: "ok",
      };
    }
    case "failed": {
      const err = shortErrorLine(str(p, "error", "reason", "message"));
      const permanent = p.permanent === true;
      return {
        title: permanent ? "Run failed (non-retryable)" : "Run failed",
        subtitle: err || undefined,
        actor: str(p, "worker_id") || "dispatcher",
        tone: "danger",
        badge: permanent ? "permanent" : "failed",
      };
    }
    case "approved":
      return {
        title: "Approved & completed",
        actor: str(p, "actor") || "reviewer",
        tone: "success",
        badge: p.merged === true ? "merged" : undefined,
      };
    case "rejected":
      return {
        title: "Rejected back to queue",
        subtitle: shortErrorLine(str(p, "feedback")) || undefined,
        actor: str(p, "actor") || "reviewer",
        tone: "warning",
      };
    default:
      return {
        title: kind,
        tone: "neutral",
      };
  }
}

export function parseEventCards(events: TaskEvent[]): EventGroup[] {
  const sorted = [...events].sort((a, b) => a.id - b.id || a.created_at - b.created_at);

  // Coalesce consecutive worker_output bursts into one summary card
  const cards: EventCard[] = [];
  let streamAcc: { count: number; bytes: number; firstAt: number; lastId: number } | null = null;

  const flushStream = () => {
    if (!streamAcc) return;
    cards.push({
      id: `stream-${streamAcc.lastId}`,
      kind: "worker_output",
      title: `Worker streamed ${streamAcc.count} log ${streamAcc.count === 1 ? "chunk" : "chunks"}`,
      subtitle: formatBytesShort(streamAcc.bytes),
      actor: "worker",
      tone: "accent",
      count: streamAcc.count,
      at: streamAcc.firstAt,
    });
    streamAcc = null;
  };

  for (const ev of sorted) {
    const p = asRecord(ev.payload);
    if (ev.kind === "worker_output") {
      const chunk = str(p, "output", "text", "delta");
      if (!streamAcc) {
        streamAcc = { count: 1, bytes: chunk.length, firstAt: ev.created_at, lastId: ev.id };
      } else {
        streamAcc.count += 1;
        streamAcc.bytes += chunk.length;
        streamAcc.lastId = ev.id;
      }
      continue;
    }
    flushStream();
    const desc = describeEventKind(ev.kind, p);
    cards.push({
      id: `ev-${ev.id}`,
      kind: ev.kind,
      at: ev.created_at,
      ...desc,
    });
  }
  flushStream();

  // Group cards chronologically around execution runs
  const groups: EventGroup[] = [];
  let runNo = 0;
  let current: EventGroup | null = null;

  const pushGroup = (g: EventGroup) => {
    const last = g.events[g.events.length - 1];
    g.endedAt = last?.at ?? g.startedAt;
    groups.push(g);
  };

  for (const card of cards) {
    const startsRun =
      card.kind === "claimed" ||
      card.kind === "started" ||
      (card.kind === "task.moved" && card.badge === "in_progress");

    if (startsRun) {
      // If current group just opened via task.moved -> in_progress with no claimed yet, keep same group
      if (current && current.events.length === 1 && current.events[0].kind === "task.moved" && card.kind === "claimed") {
        current.events.push(card);
        current.title = card.subtitle ? `Run #${runNo} · ${card.subtitle}` : `Run #${runNo}`;
        continue;
      }
      if (current) pushGroup(current);
      runNo += 1;
      current = {
        id: `grp-run-${runNo}`,
        title: card.subtitle ? `Run #${runNo} · ${card.subtitle}` : `Run #${runNo}`,
        status: "accent",
        startedAt: card.at,
        events: [card],
      };
      continue;
    }

    if (!current) {
      current = {
        id: `grp-life-${groups.length + 1}`,
        title: "Lifecycle",
        status: card.tone,
        startedAt: card.at,
        events: [card],
      };
      continue;
    }

    current.events.push(card);
    if (card.kind === "completed" || card.kind === "approved") {
      current.status = "success";
      pushGroup(current);
      current = null;
    } else if (card.kind === "failed" || card.kind === "rejected") {
      current.status = card.kind === "failed" ? "danger" : "warning";
      pushGroup(current);
      current = null;
    }
  }

  if (current) pushGroup(current);
  return groups;
}
