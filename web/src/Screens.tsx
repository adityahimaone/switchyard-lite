import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, Check, Cpu, GitBranch, KeyRound, Layers, Lock, Palette, Play, Server, ShieldCheck, Sparkles } from "@/components/ui/icons";
import { api, apiOr, del, LIVE_FALLBACK_MS, post, setToken, STATUSES, type FlowTask, type Task, type Worker } from "./api";
import { ErrorBox, LABEL, Lamp, Panel, statusColor, Unavailable } from "./ui";
import { useBoardId } from "./Board";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Overview {
  counts: Record<string, number>;
  total: number;
  boards: number;
  workspaces?: number;
  workers?: number;
  pipelines?: number;
  health: { status: string; db: boolean };
}

export function OverviewScreen() {
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();
  const [scopeBoard, setScopeBoard] = useState(false);

  const q = useQuery({
    queryKey: ["overview", scopeBoard ? boardId : "all"],
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () =>
      api<Overview>(
        `/api/v1/overview${scopeBoard && boardId ? `?board_id=${encodeURIComponent(boardId)}` : ""}`
      ),
  });

  const summaryCards = q.data
    ? [
        { label: "Total tasks", value: q.data.total, icon: Layers, accent: true },
        { label: "Boards", value: q.data.boards, icon: GitBranch, accent: false },
        ...(q.data.workspaces !== undefined
          ? [{ label: "Workspaces", value: q.data.workspaces, icon: Server, accent: false }]
          : []),
        ...(q.data.workers !== undefined
          ? [{ label: "Workers", value: q.data.workers, icon: Cpu, accent: false }]
          : []),
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title-row">
            <h2>Overview</h2>
            <span className="pill-count">telemetry</span>
          </div>
          <p className="page-subtitle">
            Control-plane health, queue depth, and execution status across boards and agents.
          </p>
        </div>

        <div className="page-header-actions">
          {(boards.data?.length ?? 0) > 0 && (
            <button
              type="button"
              className={"chip" + (scopeBoard ? " active" : "")}
              onClick={() => setScopeBoard((v) => !v)}
            >
              {scopeBoard && activeBoard ? `Board: ${activeBoard.name}` : "All boards"}
            </button>
          )}
          {(boards.data?.length ?? 0) > 1 && scopeBoard && (
            <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
          )}
          <a href="#/logs" className="chip inline-flex items-center gap-1.5" title="Open the Logs page">
            <Activity className="size-3.5" />
            <span>Live Activity Stream → Logs</span>
          </a>
          {q.data && (
            <span
              className="lamp rounded-full border border-line bg-surface px-3 py-1.5 text-xs shadow-[var(--lift-1)]"
              style={{
                ["--lamp" as string]:
                  q.data.health.status === "ok" ? "var(--c-success)" : "var(--c-danger)",
              }}
            >
              <span className="lamp-dot pulse" />
              Health: {q.data.health.status}
            </span>
          )}
        </div>
      </div>

      <ErrorBox error={q.error} />

      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--lift-1),var(--lift-inset)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                      {card.label}
                    </span>
                    <span
                      className={
                        card.accent
                          ? "inline-flex size-7 items-center justify-center rounded-full bg-accent-tint text-accent-text"
                          : "inline-flex size-7 items-center justify-center rounded-full bg-well text-ink-3"
                      }
                    >
                      <Icon className="size-3.5" />
                    </span>
                  </div>
                  <div className="mt-2 font-[var(--font-display)] text-[28px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-ink">
                    {card.value}
                  </div>
                </div>
              );
            })}
          </div>

          <Panel title="Status Station Matrix">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
              {STATUSES.map((s) => {
                const count = q.data!.counts[s] ?? 0;
                const pct = q.data!.total > 0 ? Math.round((count / q.data!.total) * 100) : 0;
                return (
                  <div
                    key={s}
                    className="flex flex-col justify-between gap-2 rounded-[18px] border border-line bg-well/55 p-3 shadow-[var(--well-inset)]"
                  >
                    <Lamp status={s} />
                    <div className="flex items-baseline justify-between gap-2">
                      <b className="font-[var(--font-display)] text-2xl font-extrabold leading-none tabular-nums text-ink">
                        {count}
                      </b>
                      <span className="font-mono text-[10.5px] tabular-nums text-ink-4">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {q.data.total > 0 && (
            <Panel title="Task Distribution">
              <div className="space-y-3">
                <div className="flex h-3.5 overflow-hidden rounded-full bg-well p-0.5 shadow-[var(--well-inset)] gap-0.5">
                  {STATUSES.map((s) => {
                    const n = q.data!.counts[s] ?? 0;
                    if (!n) return null;
                    const pct = (n / q.data!.total) * 100;
                    return (
                      <div
                        key={s}
                        title={`${s}: ${n} (${Math.round(pct)}%)`}
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: statusColor(s) }}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {STATUSES.map((s) => {
                    const n = q.data!.counts[s] ?? 0;
                    if (!n) return null;
                    return (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-well/60 px-2.5 py-1 text-[11px] font-medium text-ink-2"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ background: statusColor(s) }}
                          aria-hidden
                        />
                        <span>{LABEL[s] ?? s}</span>
                        <span className="font-mono tabular-nums text-ink-3">{n}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

export { WorkspacesPage as WorkspacesScreen } from "@/components/workspaces/WorkspacesPage";
export { LogsPage as LogsScreen } from "@/components/logs/LogsPage";

export function WorkersScreen() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const q = useQuery({
    queryKey: ["workers"],
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () => apiOr<Worker[] | null>("/api/v1/workers", null),
  });

  const add = useMutation({
    mutationFn: () => post("/api/v1/workers", { name: name.trim(), url: url.trim() }),
    onSuccess: () => {
      setName("");
      setUrl("");
      qc.invalidateQueries({ queryKey: ["workers"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/v1/workers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title-row">
            <h2>Workers</h2>
            {q.data && <span className="pill-count tabular-nums">{q.data.length} online</span>}
          </div>
          <p className="page-subtitle">Node-agent endpoints executing claimed tasks across workspaces.</p>
        </div>
      </div>

      <ErrorBox error={q.error ?? add.error ?? remove.error} />

      <form
        className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--lift-1),var(--lift-inset)] space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-bold tracking-[-0.015em] text-ink">Register worker</h3>
          <span className="font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">Endpoint registry</span>
        </div>
        <div className="form-grid">
          <label className="f m-0">
            Worker name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. mac-node-agent"
            />
          </label>
          <label className="f m-0">
            Node-Agent URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://100.75.2.78:8788"
              className="mono"
            />
          </label>
        </div>
        <button className="btn primary" disabled={add.isPending || !name.trim()}>
          Register worker
        </button>
      </form>

      {q.data === null && <Unavailable what="Workers" />}
      {q.data &&
        (q.data.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-line-strong bg-surface/75 p-6 text-center">
            <p className="muted m-0 text-xs">No workers registered.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--lift-1),var(--lift-inset)]">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>URL / Endpoint</th>
                  <th>Executor</th>
                  <th>Status</th>
                  <th>Task</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <strong>{w.name ?? w.id}</strong>
                    </td>
                    <td className="mono muted">{w.url || "—"}</td>
                    <td>{w.executor ?? "—"}</td>
                    <td>
                      <Lamp status={w.status ?? "running"} />
                    </td>
                    <td className="font-mono text-xs">{w.task_id ?? "—"}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => remove.mutate(w.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

export interface Stage {
  id: string;
  name?: string;
  status: string;
  depends_on?: string[];
}

interface Run {
  id: string;
  name?: string;
  template?: string;
  goal?: string;
  status?: string;
  stages?: Stage[];
}

export function layers(stages: Stage[]): Stage[][] {
  const depth = new Map<string, number>();
  const byId = new Map(stages.map((s) => [s.id, s]));
  const d = (s: Stage, seen = new Set<string>()): number => {
    if (depth.has(s.id)) return depth.get(s.id)!;
    if (seen.has(s.id)) return 0;
    seen.add(s.id);
    const v =
      Math.max(
        -1,
        ...(s.depends_on ?? []).map((x) => (byId.get(x) ? d(byId.get(x)!, seen) : -1))
      ) + 1;
    depth.set(s.id, v);
    return v;
  };
  const out: Stage[][] = [];
  stages.forEach((s) => (out[d(s)] ??= []).push(s));
  return out.filter(Boolean);
}

export function Dag({ stages }: { stages: Stage[] }) {
  const cols = layers(stages),
    W = 180,
    H = 56,
    GX = 64,
    GY = 22;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, i) =>
    c.forEach((s, j) => pos.set(s.id, { x: 12 + i * (W + GX), y: 12 + j * (H + GY) }))
  );
  const w = 24 + cols.length * (W + GX),
    h = 24 + Math.max(1, ...cols.map((c) => c.length)) * (H + GY);
  return (
    <svg width={w} height={h} role="img" aria-label="stage graph" style={{ maxWidth: "100%" }}>
      {stages.flatMap((s) =>
        (s.depends_on ?? []).map((p) => {
          const a = pos.get(p),
            b = pos.get(s.id);
          return a && b ? (
            <line
              key={p + s.id}
              x1={a.x + W}
              y1={a.y + H / 2}
              x2={b.x}
              y2={b.y + H / 2}
              stroke="var(--c-line-strong)"
              strokeWidth={2}
            />
          ) : null;
        })
      )}
      {stages.map((s) => {
        const p = pos.get(s.id)!;
        const fill =
          s.status === "running" || s.status === "in_progress"
            ? "var(--c-st-in_progress)"
            : s.status === "succeeded" || s.status === "done"
            ? "var(--c-st-done)"
            : s.status === "failed" || s.status === "blocked"
            ? "var(--c-st-failed)"
            : s.status === "review" || s.status === "evolved"
            ? "var(--c-st-review)"
            : "var(--c-ink-4)";
        return (
          <g key={s.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: "pointer" }}>
            <rect width={W} height={H} rx={10} fill="var(--c-surface)" stroke="var(--c-line-strong)" />
            <text x={14} y={23} fill="var(--c-ink)" fontSize={13} fontWeight={600}>
              {s.name ?? s.id}
            </text>
            <circle cx={18} cy={40} r={4} fill={fill} />
            <text x={28} y={44} fill="var(--c-ink-3)" fontSize={11}>
              {s.status}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PipelineScreen() {
  const qc = useQueryClient();
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();
  const [goal, setGoal] = useState("");
  const [template, setTemplate] = useState("design-thinking");

  const templates = useQuery({
    queryKey: ["pipeline-templates"],
    queryFn: () => apiOr<{ name: string; description?: string }[]>("/api/v1/pipelines/templates", []),
  });

  const q = useQuery({
    queryKey: ["pipelines"],
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () => apiOr<Run[] | null>("/api/v1/pipelines", null),
  });

  const start = useMutation({
    mutationFn: () => post("/api/v1/pipelines", { template, board_id: boardId, goal }),
    onSuccess: () => {
      setGoal("");
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => post(`/api/v1/pipelines/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title-row">
            <h2>Pipeline runs</h2>
            {q.data && <span className="pill-count tabular-nums">{q.data.length} runs</span>}
          </div>
          <p className="page-subtitle">Deterministic multi-stage DAG orchestrations executed on the active board.</p>
        </div>
        <div className="page-header-actions">
          {(boards.data?.length ?? 0) > 1 && (
            <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
          )}
        </div>
      </div>

      <ErrorBox error={q.error ?? start.error ?? cancel.error} />

      {boardId && (
        <form
          className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--lift-1),var(--lift-inset)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (goal.trim()) start.mutate();
          }}
        >
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-2">
            <Sparkles className="size-3.5 text-accent-text" />
            <span>Launch pipeline {activeBoard ? `on ${activeBoard.name}` : ""}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(templates.data?.length ?? 0) > 0 && (
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger className="w-[180px]" aria-label="Pipeline template" size="default">
                  <SelectValue placeholder="Choose template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.data?.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Start design-thinking pipeline goal…"
              className="min-w-[220px] flex-1"
            />
            <button className="btn primary" disabled={start.isPending || !goal.trim()}>
              <Play className="size-3.5 fill-current" />
              <span>Start pipeline</span>
            </button>
          </div>
        </form>
      )}

      {q.data === null && <Unavailable what="Pipelines" />}
      {q.data?.length === 0 && (
        <div className="rounded-[22px] border border-dashed border-line-strong bg-surface/75 p-6 text-center">
          <p className="muted m-0 text-xs">No pipeline runs.</p>
        </div>
      )}
      {q.data?.map((r) => (
        <Panel
          key={r.id}
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>{r.name ?? r.id}</span>
              {r.status && <span className="badge mono">{r.status}</span>}
              {r.goal ? <span className="text-xs font-normal text-ink-3">· {r.goal}</span> : null}
            </span>
          }
          actions={
            r.status === "running" ? (
              <button
                type="button"
                className="btn sm danger"
                onClick={() => cancel.mutate(r.id)}
                disabled={cancel.isPending}
              >
                Cancel run
              </button>
            ) : undefined
          }
        >
          {r.stages?.length ? (
            <div className="dot-canvas">
              <Dag stages={r.stages} />
            </div>
          ) : (
            <p className="muted m-0 text-xs">No stages.</p>
          )}
        </Panel>
      ))}
    </div>
  );
}

export function FlowScreen({ open }: { open: (id: string) => void }) {
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();
  const [showAll, setShowAll] = useState(false);

  // Live worker/task mapping from the append-only event state, like
  // kanban-board's /api/flow/active. One query powers both the DAG and the
  // live strip; SSE invalidation keeps it fresh without a 1s poll.
  const q = useQuery({
    queryKey: ["flow", boardId],
    enabled: !!boardId,
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () =>
      api<{ tasks: FlowTask[]; retention_seconds: number }>(
        `/api/v1/flow/active?board_id=${encodeURIComponent(boardId)}`
      ),
  });

  const all = q.data?.tasks ?? [];
  const connected = all.filter(
    (t) => (t.blocked_by?.length ?? 0) > 0 || all.some((o) => (o.blocked_by ?? []).includes(t.task_id))
  );
  const source = showAll ? all : connected;

  const stages: Stage[] = source.map((t) => ({
    id: t.task_id,
    name: t.title.slice(0, 22),
    status: t.stage === "running" ? "in_progress" : t.status ?? "todo",
    depends_on: t.blocked_by ?? [],
  }));
  const live = all.filter((t) => ["running", "dispatched", "review"].includes(t.stage));

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title-row">
            <h2>Flow map</h2>
            <span className="pill-count tabular-nums">{stages.length} nodes</span>
            <span className="pill-count tabular-nums">{live.length} live</span>
          </div>
          <p className="page-subtitle">
            Live worker mapping and dependency graph {activeBoard ? `for ${activeBoard.name}` : "across tasks"}. Click any node to open it.
          </p>
        </div>

        <div className="page-header-actions">
          <button
            type="button"
            className={"chip" + (showAll ? " active" : "")}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Showing all board tasks" : "Dependencies only"}
          </button>
          {(boards.data?.length ?? 0) > 1 && (
            <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
          )}
        </div>
      </div>

      <ErrorBox error={q.error} />

      {live.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-line bg-surface/70 p-3 shadow-[var(--lift-1)]">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
            <Activity className="size-3" /> Live on workers
          </span>
          {live.map((t) => (
            <button
              key={t.task_id}
              type="button"
              onClick={() => open(t.task_id)}
              title={`${t.stage} · ${t.node_id || "unassigned"} · ${t.executor || "auto"}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-well/70 px-2.5 py-1 text-[10px] text-ink-2 transition-colors hover:border-accent/50 hover:text-accent-text"
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor(t.status ?? "todo") }} />
              <span className="max-w-[150px] truncate font-medium">{t.title}</span>
              <span className="font-mono text-[9px] text-ink-4">{t.node_id || t.stage}</span>
              {t.executor && <span className="font-mono text-[9px] text-ink-4">{t.executor}</span>}
            </button>
          ))}
        </div>
      )}

      {stages.length ? (
        <div
          className="dot-canvas shadow-[var(--lift-1)]"
          onClick={(e) => {
            const g = (e.target as Element).closest("g");
            const i = g && [...g.parentElement!.querySelectorAll("g")].indexOf(g);
            if (i !== null && i !== undefined && i >= 0) open(stages[i].id);
          }}
        >
          <Dag stages={stages} />
        </div>
      ) : (
        <div className="rounded-[22px] border border-dashed border-line-strong bg-surface/75 p-6 text-center">
          <p className="muted m-0 text-xs">
            No task dependencies yet. Toggle &ldquo;Showing all board tasks&rdquo; above or link tasks via Dependencies.
          </p>
        </div>
      )}
    </div>
  );
}

const PALETTES = [
  { id: "", label: "Royal Switch Cobalt (Default)", swatch: "#3760f5", tag: "Cobalt" },
  { id: "prism", label: "Prism Orchid", swatch: "#6b5bff", tag: "Spectrum" },
  { id: "emerald", label: "Signal Emerald", swatch: "#13794b", tag: "Signal" },
  { id: "obsidian", label: "Obsidian Ink", swatch: "#1e293b", tag: "Monochrome" },
] as const;

export function SettingsScreen({ logout }: { logout: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("agent");
  const [scope, setScope] = useState("write");

  const list = useQuery({
    queryKey: ["tokens"],
    queryFn: () => apiOr<{ id: number; name: string; scope: string }[] | null>("/api/v1/tokens", null),
  });

  const create = useMutation({
    mutationFn: () => post<{ token: string }>("/api/v1/tokens", { name, scope }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => del(`/api/v1/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const session = useQuery({
    queryKey: ["session-info"],
    queryFn: () =>
      apiOr<{ login_enabled: boolean; password_source?: string }>("/api/v1/session", {
        login_enabled: false,
      }),
  });
  const passwordSource = session.data?.password_source ?? "none";
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const pwMismatch = confirmPw.length > 0 && newPw !== confirmPw;
  const changePw = useMutation({
    mutationFn: () =>
      post("/api/v1/session/password", { current_password: curPw, new_password: newPw }),
    onSuccess: () => {
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
      qc.invalidateQueries({ queryKey: ["session-info"] });
    },
  });

  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const [palette, setPalette] = useState(
    document.documentElement.getAttribute("data-theme-palette") ?? ""
  );
  const [compact, setCompact] = useState(
    document.documentElement.getAttribute("data-density") === "compact"
  );

  function applyPalette(next: string) {
    setPalette(next);
    if (next) {
      document.documentElement.setAttribute("data-theme-palette", next);
      localStorage.setItem("switchyard.palette", next);
    } else {
      document.documentElement.removeAttribute("data-theme-palette");
      localStorage.removeItem("switchyard.palette");
    }
  }

  function applyCompact(next: boolean) {
    setCompact(next);
    if (next) {
      document.documentElement.setAttribute("data-density", "compact");
      localStorage.setItem("switchyard.density", "compact");
    } else {
      document.documentElement.removeAttribute("data-density");
      localStorage.removeItem("switchyard.density");
    }
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title-row">
            <h2>Settings</h2>
          </div>
          <p className="page-subtitle">Workspace appearance tokens, scoped API credentials, and session control.</p>
        </div>
      </div>

      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <Palette className="size-3.5 text-ink-3" />
            <span>Appearance &amp; Theme Palette</span>
          </span>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-well/65 px-3.5 py-1.5 text-xs font-medium text-ink-2">
            <input
              type="checkbox"
              className="w-auto"
              checked={dark}
              onChange={(e) => {
                setDark(e.target.checked);
                document.documentElement.classList.toggle("dark", e.target.checked);
                localStorage.setItem("switchyard.dark", e.target.checked ? "1" : "");
              }}
            />
            <span>Dark mode</span>
          </label>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-well/65 px-3.5 py-1.5 text-xs font-medium text-ink-2">
            <input
              type="checkbox"
              className="w-auto"
              checked={compact}
              onChange={(e) => applyCompact(e.target.checked)}
            />
            <span>Compact card density</span>
          </label>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {PALETTES.map((p) => {
            const active = palette === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPalette(p.id)}
                className={
                  active
                    ? "flex items-center justify-between gap-2 rounded-[18px] border border-accent/50 bg-accent-tint/70 px-3.5 py-3 text-left text-ink shadow-[var(--lift-1)]"
                    : "flex items-center justify-between gap-2 rounded-[18px] border border-line bg-well/55 px-3.5 py-3 text-left text-ink-2 transition-colors hover:border-line-strong hover:bg-surface"
                }
                aria-pressed={active}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="size-4 shrink-0 rounded-full border border-white/40 shadow-[var(--lift-1)]"
                    style={{ background: p.swatch }}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{p.label}</span>
                    <span className="block font-mono text-[10px] text-ink-4">{p.tag}</span>
                  </span>
                </span>
                {active && <Check className="size-3.5 shrink-0 text-accent-text" />}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5 text-ink-3" />
            <span>Password &amp; access</span>
          </span>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] leading-relaxed text-ink-3">
            <ShieldCheck className="size-3.5 text-ink-3" />
            <span>Sign-in source</span>
            <span className="badge mono">{passwordSource}</span>
            <span className="text-ink-4">
              {passwordSource === "stored"
                ? "Stored as a PBKDF2-SHA256 hash in this database."
                : passwordSource === "env"
                  ? "From SWITCHYARD_ADMIN_PASSWORD on the server."
                  : "No password set yet — setting one enables password login."}
            </span>
          </div>

          <ErrorBox error={changePw.error} />
          {changePw.isSuccess && (
            <p className="m-0 rounded-[12px] border border-success/35 bg-success-tint/60 px-3 py-2 text-[11px] text-success-text">
              Password updated. Use the new one the next time you sign in.
            </p>
          )}

          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="f mb-0">
              <span className="text-[11px] font-medium text-ink-2">
                Current password{passwordSource === "none" ? " (not set)" : ""}
              </span>
              <input
                type="password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                autoComplete="current-password"
                disabled={passwordSource === "none"}
                placeholder={passwordSource === "none" ? "No current password" : "Current password"}
              />
            </label>
            <label className="f mb-0">
              <span className="text-[11px] font-medium text-ink-2">New password</span>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </label>
            <label className="f mb-0">
              <span className="text-[11px] font-medium text-ink-2">Confirm new password</span>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
                placeholder="Repeat the new password"
                aria-invalid={pwMismatch}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              className="btn primary"
              disabled={
                changePw.isPending ||
                newPw.length < 8 ||
                pwMismatch ||
                (passwordSource !== "none" && curPw.length === 0)
              }
              onClick={() => changePw.mutate()}
            >
              {changePw.isPending ? "Updating…" : "Update password"}
            </button>
            <span className="text-[10px] text-ink-4">
              Changing the password does not revoke existing API tokens.
            </span>
          </div>
          {pwMismatch && <p className="m-0 text-[11px] text-danger-text">Passwords do not match.</p>}
        </div>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="size-3.5 text-ink-3" />
            <span>API tokens</span>
          </span>
        }
      >
        {list.data === null ? (
          <p className="muted m-0 text-xs">
            Token management API is not available; create tokens with{" "}
            <code>switchyard-lite token create</code>.
          </p>
        ) : (
          <div className="space-y-3">
            <ErrorBox error={create.error ?? revoke.error} />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-[170px]"
                aria-label="Token name"
              />
              <SearchSelect
                value={scope}
                onValueChange={setScope}
                ariaLabel="Scope"
                size="default"
                className="w-[140px]"
                options={[
                  { value: "read", label: "read", sublabel: "read-only access" },
                  { value: "write", label: "write", sublabel: "read + mutate tasks" },
                  { value: "admin", label: "admin", sublabel: "full control" },
                ]}
                searchPlaceholder="Search scopes…"
              />
              <button className="btn primary" onClick={() => create.mutate()}>
                Create
              </button>
            </div>
            {create.data && (
              <p className="m-0 rounded-[14px] border border-accent/35 bg-accent-tint/50 px-3 py-2 text-xs text-ink">
                New token (copy now): <code className="font-mono font-semibold">{create.data.token}</code>
              </p>
            )}
            <div className="overflow-hidden rounded-[16px] border border-line">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Scope</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data?.map((t) => (
                    <tr key={t.id}>
                      <td className="font-medium">{t.name}</td>
                      <td>
                        <span className="badge mono">{t.scope}</span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => revoke.mutate(t.id)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Session">
        <button
          className="btn"
          onClick={() => {
            setToken("");
            logout();
          }}
        >
          Sign out (forget token)
        </button>
      </Panel>
    </div>
  );
}
