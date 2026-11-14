import * as React from "react";
import { fetchWorkerLog, type Task, type TaskRun } from "@/api";
import { ToneBadge } from "@/components/board/AgentStatus";
import { CopyButton } from "@/components/ui/copy-button";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Radio,
  ScrollText,
  Sparkles,
  Terminal,
} from "@/components/ui/icons";
import { EmptyNote } from "@/components/board/taskDetailParts";
import { fmtDateTime, fmtTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export type HarnessEventKind =
  | "turn_start"
  | "turn_end"
  | "thinking"
  | "text"
  | "tool_call"
  | "tool_result"
  | "error"
  | "status"
  | "session"
  | "final"
  | "log";

export interface HarnessLogEvent {
  id: string;
  kind: HarnessEventKind;
  turn?: number;
  model?: string;
  title?: string;
  text?: string;
  name?: string;
  input?: string;
  output?: string;
  isError?: boolean;
  code?: string;
  statusCode?: number;
  source?: string;
  tokens?: number;
  costUsd?: number;
}

function asObj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function asStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
}

function asNum(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function stringifyCompact(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export interface AnsiSegment {
  text: string;
  className?: string;
}

const ANSI_COLORS: Record<string, string> = {
  "31": "text-danger-text",
  "32": "text-success-text",
  "33": "text-warning-text",
  "34": "text-accent-text",
  "35": "text-review-text",
  "36": "text-accent-text",
  "90": "text-ink-4",
};

export function ansiSpans(line: string): AnsiSegment[] {
  // eslint-disable-next-line no-control-regex
  const parts = line.split(/(\x1b\[[0-9;]*m)/g);
  const out: AnsiSegment[] = [];
  let activeClass = "";

  for (const part of parts) {
    if (!part) continue;
    // eslint-disable-next-line no-control-regex
    const match = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (match) {
      const codes = (match[1] || "0").split(";");
      for (const c of codes) {
        if (c === "0" || c === "") activeClass = "";
        else if (c === "1") activeClass = cn(activeClass, "font-semibold");
        else if (ANSI_COLORS[c]) activeClass = ANSI_COLORS[c];
      }
      continue;
    }
    out.push({ text: part, className: activeClass || undefined });
  }
  return out;
}

function unwrapNestedError(raw: string): {
  message: string;
  code?: string;
  statusCode?: number;
  source?: string;
  model?: string;
} {
  let s = raw.trim();
  let message = s;
  let code: string | undefined;
  let statusCode: number | undefined;
  let source: string | undefined;
  let model: string | undefined;

  for (let depth = 0; depth < 4 && s; depth++) {
    const modelMatch = /\[([^/\]]+\/[^\]]+)\]/.exec(s);
    if (modelMatch && !model) {
      const parts = modelMatch[1].split("/");
      model = parts.length >= 2 ? parts.slice(-2).join("/") : modelMatch[1];
    }
    const statusMatch = /\[(\d{3})\]/.exec(s);
    if (statusMatch && !statusCode) {
      statusCode = Number(statusMatch[1]);
    }
    if (!code && /\bQUOTA\b/i.test(s)) code = "QUOTA";

    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start < 0 || end <= start) break;

    const prefixNums = s.slice(0, start).match(/\b([45]\d{2})\b/);
    if (prefixNums && !statusCode) statusCode = Number(prefixNums[1]);

    try {
      const inner = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
      code = asStr(inner, "code", "error_code") || code;
      source = asStr(inner, "source") || source;
      statusCode = asNum(inner, "status", "status_code") ?? statusCode;
      if (inner.error && typeof inner.error === "object") {
        const sub = asObj(inner.error);
        code = asStr(sub, "code", "error_code") || code;
        source = asStr(sub, "source") || source;
        statusCode = asNum(sub, "status", "status_code") ?? statusCode;
        const next = asStr(sub, "message", "detail", "error");
        if (next) {
          s = next;
          message = next;
          continue;
        }
      }
      const next = asStr(inner, "message", "detail", "error", "reason");
      if (next && next !== s) {
        s = next;
        message = next;
        continue;
      }
    } catch {
      break;
    }
    break;
  }
  return { message, code, statusCode, source, model };
}

export function parseHarnessLogEvents(raw: string): { events: HarnessLogEvent[]; structuredCount: number } {
  if (!raw.trim()) return { events: [], structuredCount: 0 };

  const lines = raw.split(/\r?\n/);
  const events: HarnessLogEvent[] = [];
  let structuredCount = 0;

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("HERMES_EVENT:")) {
      const jsonPart = trimmed.slice("HERMES_EVENT:".length).trim();
      try {
        const obj = JSON.parse(jsonPart) as Record<string, unknown>;
        structuredCount += 1;
        events.push({
          id: `he-${idx}`,
          kind: "status",
          title: asStr(obj, "label", "phase") || "event",
          name: asStr(obj, "phase") || undefined,
        });
        return;
      } catch {
        // fall through
      }
    }

    if (trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const typ = asStr(obj, "type") || asStr(obj, "status");
        const phase = asStr(obj, "phase");
        const usageObj = asObj(obj.usage);
        const tokens =
          asNum(usageObj, "total_tokens", "totalTokens") ??
          ((asNum(usageObj, "input_tokens", "prompt_tokens", "inputTokens") ?? 0) +
            (asNum(usageObj, "output_tokens", "completion_tokens", "outputTokens") ?? 0) ||
            undefined);
        const costUsd = asNum(usageObj, "cost_usd", "total_cost_usd") ?? asNum(obj, "cost_usd");

        if (typ === "session") {
          structuredCount += 1;
          events.push({
            id: `h-${idx}`,
            kind: "session",
            title: asStr(obj, "sessionId", "session_id"),
            text: asStr(obj, "cwd") || undefined,
          });
          return;
        }

        if (typ === "turn_start" || (typ === "status" && phase === "turn_start")) {
          structuredCount += 1;
          events.push({
            id: `h-${idx}`,
            kind: "turn_start",
            turn: asNum(obj, "turn"),
            model: asStr(obj, "model") || undefined,
          });
          return;
        }

        if (typ === "status" && (phase === "step_start" || phase === "step_end")) {
          structuredCount += 1;
          if (phase === "step_end") {
            events.push({
              id: `h-${idx}`,
              kind: "status",
              title: `Step ${asNum(obj, "step") ?? 1}`,
              name: phase,
              tokens,
              costUsd,
            });
          }
          return;
        }

        if (typ === "thinking" || typ === "reasoning") {
          structuredCount += 1;
          events.push({
            id: `h-${idx}`,
            kind: "thinking",
            text: asStr(obj, "thinking", "text", "content"),
          });
          return;
        }

        if (typ === "tool_call" || typ === "tool_use") {
          structuredCount += 1;
          events.push({
            id: `h-${idx}`,
            kind: "tool_call",
            name: asStr(obj, "name", "tool") || "tool",
            input: stringifyCompact(obj.input ?? obj.arguments ?? obj.args),
          });
          return;
        }

        if (typ === "tool_result") {
          structuredCount += 1;
          events.push({
            id: `h-${idx}`,
            kind: "tool_result",
            name: asStr(obj, "name", "tool") || undefined,
            output: stringifyCompact(obj.output ?? obj.result ?? obj.content),
            isError: obj.is_error === true || Boolean(obj.error),
          });
          return;
        }

        const reasonObj = asObj(obj.reason);
        const rawErrObj = obj.error ?? reasonObj.error;
        if (rawErrObj) {
          structuredCount += 1;
          const eo = asObj(rawErrObj);
          const rawMsg =
            typeof rawErrObj === "string"
              ? rawErrObj
              : asStr(eo, "message", "detail", "error", "reason") || stringifyCompact(rawErrObj);
          const un = unwrapNestedError(rawMsg);
          events.push({
            id: `h-${idx}`,
            kind: typ === "turn_end" || phase === "turn_end" ? "turn_end" : typ === "final" ? "final" : "error",
            turn: asNum(obj, "turn"),
            isError: true,
            code: asStr(eo, "code", "error_code") || un.code,
            statusCode: un.statusCode ?? asNum(eo, "status", "status_code"),
            source: asStr(eo, "source") || un.source,
            model: un.model,
            text: un.message,
            tokens,
            costUsd,
          });
          return;
        }

        if (typ === "turn_end" || (typ === "status" && phase === "turn_end")) {
          structuredCount += 1;
          events.push({
            id: `h-${idx}`,
            kind: "turn_end",
            turn: asNum(obj, "turn"),
            tokens,
            costUsd,
          });
          return;
        }

        if (typ === "final" || typ === "result") {
          structuredCount += 1;
          const status = asStr(obj, "status");
          const isErr = status === "error" || status === "failed" || obj.is_error === true || obj.ok === false;
          events.push({
            id: `h-${idx}`,
            kind: "final",
            isError: isErr,
            text: asStr(obj, "message", "result", "content", "text", "output"),
            tokens,
            costUsd,
          });
          return;
        }

        if (typ === "text" || typ === "assistant" || typ === "message" || typ === "delta") {
          const text = asStr(obj, "text", "content", "delta", "message");
          if (text) {
            structuredCount += 1;
            events.push({ id: `h-${idx}`, kind: "text", text });
            return;
          }
        }
      } catch {
        // treat malformed JSON line as plain log below
      }
    }

    if (/^(dsh|codex|claude|opencode):\s*(QUOTA|ERROR|FATAL|402|503)\b/i.test(trimmed) || (trimmed.startsWith("dsh:") && trimmed.includes("{"))) {
      structuredCount += 1;
      const un = unwrapNestedError(trimmed);
      events.push({
        id: `e-${idx}`,
        kind: "error",
        isError: true,
        code: un.code,
        statusCode: un.statusCode,
        source: un.source,
        model: un.model,
        text: un.message,
      });
      return;
    }

    events.push({ id: `l-${idx}`, kind: "log", text: rawLine });
  });

  // Merge consecutive plain text deltas & collapse identical consecutive error cards
  const merged: HarnessLogEvent[] = [];
  for (const ev of events) {
    const prev = merged[merged.length - 1];
    if (ev.kind === "text" && prev?.kind === "text") {
      prev.text = `${prev.text ?? ""}\n${ev.text ?? ""}`;
      continue;
    }
    const evIsErr = ev.isError || ev.kind === "error";
    const prevIsErr = prev && (prev.isError || prev.kind === "error");
    if (evIsErr && prevIsErr && ev.text && ev.text === prev.text) {
      continue;
    }
    merged.push({ ...ev });
  }

  return { events: merged, structuredCount };
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded border border-line bg-well px-1 py-0.5 font-mono text-[11px] text-ink"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

/** Zero-dependency safe Markdown & fenced code block renderer. */
export function FormattedProse({ content, className }: { content: string; className?: string }) {
  const blocks = React.useMemo(() => {
    const segments: Array<{ type: "code" | "text"; lang?: string; body: string }> = [];
    const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = fenceRe.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", body: content.slice(lastIndex, match.index) });
      }
      segments.push({ type: "code", lang: match[1] || undefined, body: match[2].replace(/\n$/, "") });
      lastIndex = fenceRe.lastIndex;
    }
    if (lastIndex < content.length) {
      segments.push({ type: "text", body: content.slice(lastIndex) });
    }
    return segments;
  }, [content]);

  return (
    <div className={cn("space-y-2 text-xs leading-relaxed text-ink-2", className)}>
      {blocks.map((blk, i) => {
        if (blk.type === "code") {
          return (
            <div key={i} className="overflow-hidden rounded-[8px] border border-line bg-well/80">
              <div className="flex items-center justify-between border-b border-line/70 px-2.5 py-1 font-mono text-[10px] text-ink-3">
                <span>{blk.lang || "output"}</span>
                <CopyButton value={blk.body} label="Copy snippet" />
              </div>
              <pre className="overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed text-ink">
                {blk.body}
              </pre>
            </div>
          );
        }

        const lines = blk.body.split(/\r?\n/);
        return (
          <div key={i} className="space-y-1">
            {lines.map((line, j) => {
              const t = line.trim();
              if (!t) return null;
              if (t.startsWith("### ")) {
                return (
                  <h4 key={j} className="pt-1 text-xs font-semibold text-ink">
                    {renderInlineMarkdown(t.slice(4))}
                  </h4>
                );
              }
              if (t.startsWith("## ") || t.startsWith("# ")) {
                const body = t.replace(/^#{1,3}\s+/, "");
                return (
                  <h3 key={j} className="pt-1.5 text-[13px] font-semibold text-ink">
                    {renderInlineMarkdown(body)}
                  </h3>
                );
              }
              if (t.startsWith("- ") || t.startsWith("* ")) {
                return (
                  <div key={j} className="flex gap-2 pl-1">
                    <span className="select-none text-ink-4">•</span>
                    <span className="min-w-0 flex-1 break-words">{renderInlineMarkdown(t.slice(2))}</span>
                  </div>
                );
              }
              return (
                <p key={j} className="break-words">
                  {renderInlineMarkdown(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleThinking({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-[7px] border border-line/80 bg-well/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] font-medium text-ink-3 hover:text-ink"
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Thinking
        </span>
        <span className="font-mono text-[10px] text-ink-4">{text.length} chars</span>
      </button>
      {open && (
        <pre className="whitespace-pre-wrap border-t border-line/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-3">
          {text}
        </pre>
      )}
    </div>
  );
}

function CollapsibleToolRow({ ev }: { ev: HarnessLogEvent }) {
  const [open, setOpen] = React.useState(false);
  const payload = ev.kind === "tool_call" ? ev.input : ev.output;
  return (
    <div
      className={cn(
        "rounded-[7px] border px-2.5 py-1.5 text-[11px]",
        ev.isError ? "border-danger/35 bg-danger-tint/40" : "border-line bg-surface"
      )}
    >
      <button
        type="button"
        onClick={() => payload && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
          {payload ? (
            open ? (
              <ChevronDown className="size-3 shrink-0 text-ink-3" />
            ) : (
              <ChevronRight className="size-3 shrink-0 text-ink-3" />
            )
          ) : null}
          <span className={cn("font-medium", ev.isError ? "text-danger-text" : "text-ink")}>
            {ev.kind === "tool_call" ? `tool: ${ev.name}` : ev.name ? `result: ${ev.name}` : "tool result"}
          </span>
        </span>
        <span className="font-mono text-[10px] text-ink-4">
          {ev.kind === "tool_call" ? "call" : ev.isError ? "error" : "ok"}
        </span>
      </button>
      {open && payload && (
        <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-line/70 bg-well/60 p-2 font-mono text-[10.5px] text-ink-2">
          {payload}
        </pre>
      )}
    </div>
  );
}

export function DshLogTimeline({ events, wrap = true }: { events: HarnessLogEvent[]; wrap?: boolean }) {
  return (
    <div className="space-y-2 p-3">
      {events.map((ev) => {
        if (ev.kind === "status") {
          return (
            <div key={ev.id} className="flex items-center gap-2 font-mono text-[10.5px] text-ink-3">
              <span className="size-1.5 rounded-full bg-ink-4" />
              <span>{ev.title}</span>
              {ev.name && <span className="rounded border border-line bg-well px-1 py-0.5 text-[9.5px] text-ink-4">{ev.name}</span>}
              {ev.tokens ? <span className="text-ink-4">· {ev.tokens.toLocaleString()} tok</span> : null}
            </div>
          );
        }

        if (ev.kind === "session") {
          return (
            <div key={ev.id} className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-ink-3">
              <span className="rounded border border-line bg-well px-1.5 py-0.5 text-ink-2">
                session {ev.title}
              </span>
              {ev.text && <span className="truncate text-ink-4">{ev.text}</span>}
            </div>
          );
        }

        if (ev.kind === "turn_start") {
          return (
            <div key={ev.id} className="flex items-center gap-2 pt-0.5 font-mono text-[11px] text-ink-3">
              <span className="rounded border border-line bg-well px-1.5 py-0.5 font-medium text-ink">
                Turn {ev.turn ?? 1}
              </span>
              {ev.model && <span className="truncate text-ink-2">{ev.model}</span>}
              <span className="h-px flex-1 bg-line/70" />
            </div>
          );
        }

        if (ev.kind === "thinking" && ev.text) {
          return <CollapsibleThinking key={ev.id} text={ev.text} />;
        }

        if (ev.kind === "tool_call" || ev.kind === "tool_result") {
          return <CollapsibleToolRow key={ev.id} ev={ev} />;
        }

        if ((ev.kind === "error" || (ev.kind === "turn_end" && ev.isError) || (ev.kind === "final" && ev.isError))) {
          const tags = [ev.code, ev.statusCode ? String(ev.statusCode) : "", ev.source, ev.model].filter(Boolean);
          return (
            <div
              key={ev.id}
              className="flex items-start gap-2 rounded-[8px] border border-danger/35 bg-danger-tint/70 px-3 py-2 text-xs"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger-text" />
              <div className="min-w-0 flex-1 space-y-1">
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <ToneBadge key={t} tone="danger">
                        {t}
                      </ToneBadge>
                    ))}
                  </div>
                )}
                <p className="break-words font-mono text-[11.5px] leading-relaxed text-ink">
                  {ev.text || "Worker error"}
                </p>
              </div>
            </div>
          );
        }

        if (ev.kind === "turn_end" || ev.kind === "final") {
          return (
            <div key={ev.id} className="space-y-1.5">
              {ev.text && <FormattedProse content={ev.text} />}
              {(ev.tokens || ev.costUsd) && (
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-ink-3">
                  {ev.tokens ? (
                    <span className="inline-flex items-center gap-1 rounded border border-line bg-well px-1.5 py-0.5">
                      <Cpu className="size-2.5" />
                      {ev.tokens.toLocaleString()} tok
                    </span>
                  ) : null}
                  {ev.costUsd ? (
                    <span className="inline-flex items-center gap-1 rounded border border-line bg-well px-1.5 py-0.5">
                      <Sparkles className="size-2.5" />
                      ${ev.costUsd.toFixed(4)}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          );
        }

        if (ev.kind === "text" && ev.text) {
          return <FormattedProse key={ev.id} content={ev.text} />;
        }

        return (
          <pre
            key={ev.id}
            className={cn(
              "font-mono text-[11px] leading-relaxed text-ink-2",
              wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre overflow-x-auto"
            )}
          >
            {ansiSpans(ev.text ?? "").map((seg, i) => (
              <span key={i} className={seg.className}>
                {seg.text}
              </span>
            ))}
          </pre>
        );
      })}
    </div>
  );
}

export function WorkerLogPanel({
  taskId,
  running,
  initialText = "",
  compact = false,
  title = "Worker Log",
}: {
  taskId: string;
  running: boolean;
  initialText?: string;
  compact?: boolean;
  title?: string;
}) {
  const [rawText, setRawText] = React.useState(initialText);
  const [follow, setFollow] = React.useState(running);
  const [wrap, setWrap] = React.useState(true);
  const [collapsed, setCollapsed] = React.useState(false);
  const [userMode, setUserMode] = React.useState<"auto" | "structured" | "raw">("auto");
  const offsetRef = React.useRef(0);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setRawText(initialText);
    offsetRef.current = 0;
  }, [taskId]);

  React.useEffect(() => {
    if (!rawText && initialText) {
      setRawText(initialText);
    }
  }, [initialText, rawText]);

  React.useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetchWorkerLog(taskId, offsetRef.current);
        if (cancelled) return;
        if (res.offset < offsetRef.current) {
          // Server truncated log file for a fresh run
          offsetRef.current = res.offset;
          setRawText(res.text || "");
          return;
        }
        if (res.text) {
          if (offsetRef.current === 0) {
            setRawText(res.text);
          } else {
            setRawText((prev) => prev + res.text);
          }
        }
        offsetRef.current = res.offset;
      } catch {
        // transient poll error ignored; next tick retries
      }
    };

    void pull();
    if (!running) {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(() => void pull(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [taskId, running]);

  React.useEffect(() => {
    if (running) setFollow(true);
  }, [running]);

  React.useEffect(() => {
    if (!follow || collapsed || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [rawText, follow, collapsed]);

  const parsed = React.useMemo(() => parseHarnessLogEvents(rawText), [rawText]);
  const mode = userMode === "auto" ? (parsed.structuredCount > 0 ? "structured" : "raw") : userMode;
  const lineCount = React.useMemo(() => (rawText ? rawText.split(/\r?\n/).filter(Boolean).length : 0), [rawText]);

  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--card-shadow)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-well/50 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:text-accent-text"
          >
            {collapsed ? <ChevronRight className="size-3.5 text-ink-3" /> : <ChevronDown className="size-3.5 text-ink-3" />}
            <Terminal className="size-3.5 text-ink-3" />
            <span>{title}</span>
          </button>

          {running ? (
            <span className="inline-flex items-center gap-1 rounded border border-accent/30 bg-accent-tint px-1.5 py-0.5 font-mono text-[10px] text-accent-text">
              <Radio className="size-2.5 animate-pulse" />
              Streaming
            </span>
          ) : rawText ? (
            <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-3">
              {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {parsed.structuredCount > 0 && (
            <div className="mr-1 inline-flex rounded-[6px] border border-line bg-well p-0.5 font-mono text-[10px]">
              <button
                type="button"
                onClick={() => setUserMode("structured")}
                className={cn(
                  "rounded-[4px] px-1.5 py-0.5 transition-colors",
                  mode === "structured" ? "bg-surface text-ink shadow-xs" : "text-ink-3 hover:text-ink"
                )}
              >
                Structured
              </button>
              <button
                type="button"
                onClick={() => setUserMode("raw")}
                className={cn(
                  "rounded-[4px] px-1.5 py-0.5 transition-colors",
                  mode === "raw" ? "bg-surface text-ink shadow-xs" : "text-ink-3 hover:text-ink"
                )}
              >
                Raw
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setFollow((v) => !v)}
            className={cn(
              "rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
              follow ? "border-accent/40 bg-accent-tint text-accent-text" : "border-line bg-surface text-ink-3 hover:text-ink"
            )}
          >
            Follow
          </button>
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            className={cn(
              "rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
              wrap ? "border-line-strong bg-well text-ink" : "border-line bg-surface text-ink-3 hover:text-ink"
            )}
          >
            Wrap
          </button>
          {rawText && <CopyButton value={stripAnsi(rawText)} label="Copy log" />}
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className={cn(
            "overflow-auto bg-canvas/50",
            compact ? "max-h-[260px]" : "max-h-[460px]"
          )}
        >
          {!rawText.trim() ? (
            <div className="px-3 py-6 text-center font-mono text-[11px] text-ink-3">
              {running ? "Waiting for worker output..." : "No worker log output recorded yet."}
            </div>
          ) : mode === "structured" ? (
            <DshLogTimeline events={parsed.events} wrap={wrap} />
          ) : (
            <pre
              className={cn(
                "p-3 font-mono text-[11px] leading-relaxed text-ink-2",
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
              )}
            >
              {ansiSpans(rawText).map((seg, i) => (
                <span key={i} className={seg.className}>
                  {seg.text}
                </span>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ResultPanel({ run, defaultOpen = false }: { run: TaskRun; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const parsed = React.useMemo(() => parseHarnessLogEvents(run.output ?? ""), [run.output]);
  const isError = run.status === "failed" || run.status === "interrupted" || run.status === "timeout";
  const durLabel = run.duration_ms
    ? `${(run.duration_ms / 1000).toFixed(1)}s`
    : run.duration_s
      ? `${run.duration_s}s`
      : "—";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[10px] border bg-surface",
        isError ? "border-danger/35" : "border-line"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left hover:bg-well/40"
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="size-3.5 text-ink-3" /> : <ChevronRight className="size-3.5 text-ink-3" />}
          {isError ? (
            <AlertTriangle className="size-3.5 shrink-0 text-danger-text" />
          ) : (
            <CheckCircle2 className="size-3.5 shrink-0 text-success-text" />
          )}
          <span className="text-xs font-medium text-ink">Run #{run.run}</span>
          <ToneBadge tone={isError ? "danger" : run.status === "running" ? "accent" : "success"}>
            {run.status}
          </ToneBadge>
          {run.executor && <ToneBadge tone="neutral">{run.executor}</ToneBadge>}
          {run.model && <span className="truncate font-mono text-[11px] text-ink-3">{run.model}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] tabular-nums text-ink-3">
          {run.usage?.turns ? <span>{run.usage.turns} turn(s)</span> : null}
          {run.usage?.total_tokens ? <span>{run.usage.total_tokens.toLocaleString()} tok</span> : null}
          {run.usage?.cost_usd ? <span>${run.usage.cost_usd.toFixed(4)}</span> : null}
          <span>{durLabel}</span>
          {run.started_at > 0 && <span className="text-ink-4">{fmtTime(run.started_at)}</span>}
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t border-line bg-canvas/40 p-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-ink-3">
            {run.started_at > 0 && <span>started: {fmtDateTime(run.started_at)}</span>}
            {run.ended_at && run.ended_at > 0 ? <span>ended: {fmtDateTime(run.ended_at)}</span> : null}
            {run.worker_id && <span>worker: {run.worker_id}</span>}
            {run.session_id && <span>session: {run.session_id}</span>}
          </div>

          {run.error && (
            <div className="rounded-[7px] border border-danger/35 bg-danger-tint/70 px-2.5 py-2 font-mono text-[11px] text-ink">
              {run.error}
            </div>
          )}

          {run.output?.trim() ? (
            parsed.structuredCount > 0 ? (
              <div className="rounded-[8px] border border-line bg-surface">
                <DshLogTimeline events={parsed.events} wrap />
              </div>
            ) : (
              <div className="rounded-[8px] border border-line bg-surface p-2.5">
                <FormattedProse content={run.output} />
              </div>
            )
          ) : (
            <p className="font-mono text-[11px] text-ink-3">No output payload recorded for this run.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ResultStack({ task, runs }: { task: Task; runs: TaskRun[] }) {
  const ordered = React.useMemo(() => [...runs].sort((a, b) => b.run - a.run), [runs]);

  if (ordered.length === 0) {
    if (!task.result?.trim() && !task.error_sig?.trim()) {
      return (
        <EmptyNote
          icon={<ScrollText className="size-4" />}
          title="No completed runs yet"
          hint="Dispatch the task to see run outputs, token usage, and structured results here."
        />
      );
    }
    const synthetic: TaskRun = {
      run: 1,
      executor: task.executor,
      model: task.model,
      status: task.status === "failed" ? "failed" : "completed",
      started_at: task.started_at || task.updated_at,
      ended_at: task.completed_at || task.updated_at,
      error: task.error_sig,
      output: task.result,
      events: 0,
    };
    return <ResultPanel run={synthetic} defaultOpen />;
  }

  return (
    <div className="space-y-2">
      {ordered.map((r, idx) => (
        <ResultPanel key={r.run} run={r} defaultOpen={idx === 0} />
      ))}
    </div>
  );
}

export function TaskOutput({ task, runs }: { task: Task; runs: TaskRun[] }) {
  const running = task.status === "in_progress";
  const latest = runs.length > 0 ? runs[runs.length - 1] : undefined;
  const initialText = task.result || latest?.output || "";

  return (
    <div className="space-y-4">
      <WorkerLogPanel
        taskId={task.id}
        running={running}
        initialText={initialText}
        title={running ? "Live Worker Stream" : "Worker Log Tail"}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Run History Outputs
          </h3>
          {runs.length > 0 && (
            <span className="font-mono text-[10.5px] text-ink-3">
              {runs.length} {runs.length === 1 ? "run" : "runs"}
            </span>
          )}
        </div>
        <ResultStack task={task} runs={runs} />
      </div>
    </div>
  );
}
