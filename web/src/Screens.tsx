import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  KeyRound,
  Layers,
  Lock,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
} from "@/components/ui/icons";
import {
  api,
  apiOr,
  del,
  LIVE_FALLBACK_MS,
  parseModelCatalog,
  platformOfWorkspace,
  post,
  setToken,
  STATUSES,
  type Board,
  type FlowTask,
  type PipelineArtifact,
  type PipelineNode,
  type PipelineRun,
  type PipelineStage,
  type PipelineTemplate,
  type PipelineTemplateStage,
  type PlatformKey,
  type Task,
  type Worker,
  type Workspace,
  type WorkspaceInspect,
} from "./api";
import { cn } from "@/lib/utils";
import { ErrorBox, LABEL, Lamp, Panel, statusColor, Unavailable } from "./ui";
import { useBoardId } from "./Board";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast, toastError } from "@/components/ui/toast";
import { WorkerLogPanel } from "@/components/board/OutputPanels";
import { BranchField, PromptOmnibox, SaasRulesBanner } from "@/components/board/TaskContextFields";
import { EFFORTS, EXECUTOR_LABELS, EXECUTORS, PLATFORM_LABELS, PlatformIcon } from "@/components/board/TaskDialog";

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

export type Stage = PipelineStage;

const PIPELINE_DEFAULT_SENTINEL = "__default__";
const PIPELINE_SCRATCH_SENTINEL = "__scratch__";

const META7_CONTEXT_TEMPLATE = `Scope & Objectives
──────────────────
- Describe the system outcome and primary user workflows.

Technical Constraints
─────────────────────
- Stack / invariants / performance or security boundaries.

Deliverables
────────────
- Key components, APIs, and acceptance criteria.`;

function statusBadgeVariant(
  status?: string
): "default" | "secondary" | "destructive" | "success" | "review" {
  switch (status) {
    case "done":
    case "succeeded":
      return "success";
    case "failed":
    case "cancelled":
      return "destructive";
    case "review":
    case "evolved":
    case "blocked":
      return "review";
    case "running":
    case "in_progress":
      return "default";
    default:
      return "secondary";
  }
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

export function Dag({
  stages,
  selectedStage,
  onSelectStage,
  templateStages,
}: {
  stages: Stage[];
  selectedStage?: string;
  onSelectStage?: (stageId: string) => void;
  templateStages?: PipelineTemplateStage[];
}) {
  const cols = layers(stages);
  const hasNodes = stages.some((s) => (s.nodes?.length ?? 0) > 0);
  const W = hasNodes ? 198 : 180;
  const H = hasNodes ? 68 : 56;
  const GX = 58;
  const GY = 22;

  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, i) =>
    c.forEach((s, j) => pos.set(s.id, { x: 12 + i * (W + GX), y: 12 + j * (H + GY) }))
  );

  const backArcs: { from: string; to: string; verdict: string }[] = [];
  for (const ts of templateStages ?? []) {
    if (!ts.back_arcs || !pos.has(ts.id)) continue;
    for (const [verdict, target] of Object.entries(ts.back_arcs)) {
      if (pos.has(target)) backArcs.push({ from: ts.id, to: target, verdict });
    }
  }

  const maxRows = Math.max(1, ...cols.map((c) => c.length));
  const arcPad = backArcs.length > 0 ? 28 + backArcs.length * 16 : 0;
  const w = 24 + cols.length * W + Math.max(0, cols.length - 1) * GX;
  const h = 24 + maxRows * H + Math.max(0, maxRows - 1) * GY + arcPad;
  const baselineBottom = 12 + maxRows * H + Math.max(0, maxRows - 1) * GY;

  return (
    <svg width={w} height={h} role="img" aria-label="stage graph" style={{ maxWidth: "100%", height: "auto" }}>
      <defs>
        <marker
          id="dag-back-arrow"
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="5.5"
          markerHeight="5.5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="var(--c-st-review)" />
        </marker>
      </defs>

      {stages.flatMap((s) =>
        (s.depends_on ?? []).map((p) => {
          const a = pos.get(p);
          const b = pos.get(s.id);
          return a && b ? (
            <line
              key={p + "->" + s.id}
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

      {/* Keep back-arc paths outside <g> so FlowScreen's <g> index mapping onto stages remains 1:1. */}
      {backArcs.map((arc, idx) => {
        const a = pos.get(arc.from)!;
        const b = pos.get(arc.to)!;
        const x1 = a.x + W * 0.55;
        const y1 = a.y + H;
        const x2 = b.x + W * 0.45;
        const y2 = b.y + H;
        const dipY = baselineBottom + 18 + idx * 16;
        const labelX = (x1 + x2) / 2;
        return (
          <path
            key={`${arc.from}-${arc.verdict}-${arc.to}`}
            d={`M ${x1} ${y1} C ${x1} ${dipY + 10}, ${x2} ${dipY + 10}, ${x2} ${y2}`}
            fill="none"
            stroke="var(--c-st-review)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            markerEnd="url(#dag-back-arrow)"
          />
        );
      })}
      {backArcs.map((arc, idx) => {
        const a = pos.get(arc.from)!;
        const b = pos.get(arc.to)!;
        const labelX = (a.x + W * 0.55 + (b.x + W * 0.45)) / 2;
        const labelY = baselineBottom + 14 + idx * 16;
        return (
          <text
            key={`lbl-${arc.from}-${arc.verdict}-${arc.to}`}
            x={labelX}
            y={labelY}
            textAnchor="middle"
            fill="var(--c-st-review)"
            fontSize={9.5}
            fontWeight={600}
            fontFamily="var(--font-mono, monospace)"
          >
            {arc.verdict} → {arc.to}
          </text>
        );
      })}

      {stages.map((s) => {
        const p = pos.get(s.id)!;
        const isSelected = selectedStage === s.id;
        const nodes = s.nodes ?? [];
        const doneCount = nodes.filter((n) => n.status === "done" || n.status === "succeeded").length;
        const evolvedCount = nodes.filter((n) => n.evolved).length;
        const latestVerdict = [...nodes].reverse().find((n) => n.verdict)?.verdict;
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
        const verdictGood = latestVerdict === "PASS";
        return (
          <g
            key={s.id}
            transform={`translate(${p.x},${p.y})`}
            style={{ cursor: "pointer" }}
            onClick={onSelectStage ? () => onSelectStage(s.id) : undefined}
          >
            <rect
              width={W}
              height={H}
              rx={11}
              fill="var(--c-surface)"
              stroke={isSelected ? "var(--c-accent)" : "var(--c-line-strong)"}
              strokeWidth={isSelected ? 2 : 1.15}
            />
            <text x={14} y={23} fill="var(--c-ink)" fontSize={13} fontWeight={600}>
              {s.name ?? s.id}
            </text>
            {evolvedCount > 0 && (
              <text
                x={W - 12}
                y={22}
                textAnchor="end"
                fill="var(--c-st-review)"
                fontSize={10}
                fontWeight={600}
              >
                ↻ {evolvedCount}
              </text>
            )}
            <circle cx={18} cy={hasNodes ? 46 : 40} r={4} fill={fill} />
            <text x={28} y={hasNodes ? 50 : 44} fill="var(--c-ink-3)" fontSize={11}>
              {s.status}
              {nodes.length > 0 ? ` · ${doneCount}/${nodes.length}` : ""}
            </text>
            {latestVerdict && (
              <text
                x={W - 12}
                y={hasNodes ? 50 : 44}
                textAnchor="end"
                fill={verdictGood ? "var(--c-st-done)" : "var(--c-st-review)"}
                fontSize={10}
                fontWeight={700}
                fontFamily="var(--font-mono, monospace)"
              >
                {latestVerdict}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function PipelineRunCard({
  run: r,
  templateSpec,
  openTask,
  onCancel,
  cancelling,
  onRetry,
  retrying,
  onRestart,
  restarting,
}: {
  run: PipelineRun;
  templateSpec?: PipelineTemplate;
  openTask?: (id: string) => void;
  onCancel: (id: string) => void;
  cancelling: boolean;
  onRetry: (args: { runId: string; stage?: string; nodeKey?: string }) => void;
  retrying: boolean;
  onRestart: (id: string) => void;
  restarting: boolean;
}) {
  const stages = r.stages ?? [];
  const defaultStageId =
    stages.find((s) => s.status === "running" || s.status === "failed")?.id ?? stages[0]?.id ?? "";
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const activeStage = stages.find((s) => s.id === (selectedStageId || defaultStageId)) ?? stages[0];

  const nodes = activeStage?.nodes ?? [];
  const defaultNodeKey =
    nodes.find((n) => n.status === "running" || n.status === "in_progress" || n.status === "failed")?.key ??
    nodes[0]?.key ??
    "";
  const [focusedNodeKey, setFocusedNodeKey] = useState<string>("");
  const focusedNode: PipelineNode | undefined =
    nodes.find((n) => n.key === (focusedNodeKey || defaultNodeKey)) ?? nodes[0];

  const artifacts = r.artifacts ?? [];
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string>("");
  const implArtifact = artifacts.find((a) => a.category === "impl" || a.name.endsWith(".impl"));
  const activeArtifact: PipelineArtifact | undefined =
    artifacts.find((a) => a.path === selectedArtifactPath) ?? implArtifact ?? artifacts[0];

  const hasFailedNodes = stages.some((s) =>
    (s.nodes ?? []).some((n) => n.status === "failed" || n.status === "blocked")
  );
  const showStudio = stages.some((s) => (s.nodes?.length ?? 0) > 0) || artifacts.length > 0 || (r.state_graph?.length ?? 0) > 0;
  const wsBase = r.workspace ? r.workspace.split(/[\\/]/).filter(Boolean).pop() || r.workspace : "";
  const stateGraphLines = r.state_graph ?? [];

  return (
    <Panel
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Workflow className="size-3.5 text-accent-text" />
            <span>{r.project_name || r.name || r.id}</span>
          </span>
          {r.status && <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>}
          {r.template && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {r.template}
            </Badge>
          )}
          {r.budget && (
            <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
              loop {r.review_loops ?? 0}/{r.budget.max_review_loops} · evo {r.evolutions ?? 0}/{r.budget.max_evolutions}
            </Badge>
          )}
          {wsBase && (
            <Badge variant="secondary" className="font-mono text-[10px]">
              <FolderGit2 className="size-3" />
              {wsBase}
            </Badge>
          )}
          {r.branch && (
            <Badge variant="secondary" className="font-mono text-[10px]">
              <GitBranch className="size-3" />
              {r.branch}
            </Badge>
          )}
          {r.executor && (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {r.executor}
              {r.model ? `/${r.model}` : ""}
            </Badge>
          )}
          {(r.source_task_ids?.length ?? 0) > 0 && (
            <Badge variant="default" className="font-mono text-[10px] tabular-nums">
              {r.source_task_ids!.length} board tasks
            </Badge>
          )}
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {(hasFailedNodes || r.status === "failed") && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={retrying}
              onClick={() => onRetry({ runId: r.id })}
            >
              <RotateCcw className="size-3" />
              Retry failed
            </Button>
          )}
          {r.status !== "running" && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={restarting}
              onClick={() => onRestart(r.id)}
              title="RESTART: ignore earlier graph attempts and create a fresh meta7 run with the same config"
            >
              <RefreshCw className="size-3" />
              Restart
            </Button>
          )}
          {r.status === "running" && (
            <Button
              type="button"
              size="xs"
              variant="destructive"
              onClick={() => onCancel(r.id)}
              disabled={cancelling}
            >
              Cancel run
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        {(r.goal || r.reason) && (
          <div className="space-y-1.5">
            {r.goal && <p className="m-0 text-xs leading-relaxed text-ink-2">{r.goal}</p>}
            {r.reason && (
              <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger-text">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{r.reason}</span>
              </div>
            )}
          </div>
        )}

        {stages.length ? (
          <div className="dot-canvas overflow-x-auto">
            <Dag
              stages={stages}
              selectedStage={activeStage?.id}
              onSelectStage={(sid) => {
                setSelectedStageId(sid);
                setFocusedNodeKey("");
              }}
              templateStages={templateSpec?.stages}
            />
          </div>
        ) : (
          <p className="muted m-0 text-xs">No stages.</p>
        )}

        {showStudio && (
          <Tabs defaultValue="stages" className="rounded-[14px] border border-line bg-well/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <TabsList variant="line" className="border-b-0">
                <TabsTrigger value="stages">
                  <Terminal className="size-3.5" />
                  Stage Nodes &amp; Live Trace
                </TabsTrigger>
                <TabsTrigger value="artifacts">
                  <FileCode2 className="size-3.5" />
                  Artifacts
                  <span className="pill-count tabular-nums">{artifacts.length}</span>
                </TabsTrigger>
                <TabsTrigger value="graph">
                  <ScrollText className="size-3.5" />
                  .state.graph
                  <span className="pill-count tabular-nums">{stateGraphLines.length}</span>
                </TabsTrigger>
              </TabsList>

              {implArtifact && (
                <div className="inline-flex items-center gap-1.5 rounded-[8px] border border-accent/30 bg-accent-tint px-2 py-1 text-[11px] font-medium text-accent-text">
                  <CheckCircle2 className="size-3" />
                  <code className="font-mono">{implArtifact.name}</code>
                  <CopyButton value={implArtifact.content} label={`Copy ${implArtifact.name}`} size="xs" />
                </div>
              )}
            </div>

            <TabsContent value="stages" className="pt-2">
              {stages.length > 0 && activeStage ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {stages.map((s) => {
                        const selected = s.id === activeStage.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setSelectedStageId(s.id);
                              setFocusedNodeKey("");
                            }}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[11px] font-medium transition-colors",
                              selected
                                ? "border-accent bg-accent-tint text-accent-text"
                                : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"
                            )}
                          >
                            <span
                              className="size-1.5 rounded-full"
                              style={{ background: statusColor(s.status) }}
                              aria-hidden
                            />
                            <span>{s.name ?? s.id}</span>
                          </button>
                        );
                      })}
                    </div>
                    <Badge variant={statusBadgeVariant(activeStage.status)}>{activeStage.status}</Badge>
                  </div>

                  {nodes.length === 0 ? (
                    <p className="muted m-0 py-3 text-xs">
                      Stage <code className="font-mono">{activeStage.id}</code> has not materialized task nodes yet.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[320px_1fr]">
                      <div className="space-y-1.5">
                        {nodes.map((n) => {
                          const isFocused = focusedNode?.key === n.key;
                          return (
                            <div
                              key={n.key}
                              role="button"
                              tabIndex={0}
                              onClick={() => setFocusedNodeKey(n.key)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setFocusedNodeKey(n.key);
                                }
                              }}
                              className={cn(
                                "rounded-[10px] border p-2.5 text-left transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
                                isFocused
                                  ? "border-accent bg-surface shadow-[var(--lift-1)]"
                                  : "border-line bg-surface/75 hover:border-line-strong hover:bg-surface"
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate font-mono text-[11px] font-semibold text-ink">
                                    {n.key}
                                  </span>
                                  <Badge variant="outline" className="px-1.5 text-[9.5px] font-mono">
                                    {n.kind}
                                  </Badge>
                                </div>
                                <Badge variant={statusBadgeVariant(n.status)}>{n.status}</Badge>
                              </div>

                              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex flex-wrap items-center gap-1">
                                  {n.verdict && (
                                    <Badge
                                      variant={n.verdict === "PASS" ? "success" : "review"}
                                      className="font-mono text-[9.5px]"
                                    >
                                      {n.verdict}
                                    </Badge>
                                  )}
                                  {n.evolved && (
                                    <Badge variant="review" className="text-[9.5px]">
                                      ↻ evolved
                                    </Badge>
                                  )}
                                  {n.retry_count > 0 && (
                                    <span className="font-mono text-[10px] text-ink-3">
                                      retry {n.retry_count}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1">
                                  {openTask && (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="ghost"
                                      className="h-6 px-1.5 text-[10.5px]"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openTask(n.task_id);
                                      }}
                                    >
                                      <ExternalLink className="size-3" />
                                      Open
                                    </Button>
                                  )}
                                  {(n.status === "failed" || n.status === "blocked") && (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      className="h-6 px-1.5 text-[10.5px]"
                                      disabled={retrying}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onRetry({ runId: r.id, nodeKey: n.key });
                                      }}
                                    >
                                      <RotateCcw className="size-3" />
                                      Retry
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {focusedNode && (
                        <div className="space-y-2.5 min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-ink">
                                {focusedNode.key}
                              </span>
                              <code className="rounded bg-well px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3">
                                {focusedNode.task_id}
                              </code>
                            </div>
                            {openTask && (
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                onClick={() => openTask(focusedNode.task_id)}
                              >
                                <ExternalLink className="size-3" />
                                Inspect task drawer
                              </Button>
                            )}
                          </div>

                          {(focusedNode.items?.length ?? 0) > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              {focusedNode.items!.map((item, i) => (
                                <Badge key={i} variant="secondary" className="max-w-full truncate font-mono text-[10px]">
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {focusedNode.last_error_sig && (
                            <div className="rounded-[10px] border border-danger/30 bg-danger-tint px-3 py-2 font-mono text-[11px] text-danger-text">
                              error_sig: {focusedNode.last_error_sig}
                            </div>
                          )}

                          {focusedNode.output && (
                            <div className="rounded-[10px] border border-line bg-surface p-2.5">
                              <div className="mb-1 flex items-center justify-between">
                                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                                  Node output
                                </span>
                                <CopyButton value={focusedNode.output} label="Copy output" />
                              </div>
                              <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-2">
                                {focusedNode.output}
                              </pre>
                            </div>
                          )}

                          <WorkerLogPanel
                            taskId={focusedNode.task_id}
                            running={focusedNode.status === "running" || focusedNode.status === "in_progress"}
                            compact
                            title={`Live worker stream · ${focusedNode.key}`}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="muted m-0 py-3 text-xs">No stage details available.</p>
              )}
            </TabsContent>

            <TabsContent value="artifacts" className="pt-2 space-y-2.5">
              {r.artifact_dir && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3 py-1.5 text-[11px] text-ink-3">
                  <span className="inline-flex items-center gap-1.5">
                    <FolderGit2 className="size-3.5 text-ink-3" />
                    Workspace artifact mirror: <code className="font-mono text-ink-2">{r.artifact_dir}</code>
                  </span>
                  <CopyButton value={r.artifact_dir} label="Copy artifact path" />
                </div>
              )}

              {artifacts.length === 0 ? (
                <p className="muted m-0 py-3 text-xs">
                  No artifacts materialized yet — files appear here as each meta7 stage completes.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[240px_1fr]">
                  <div className="space-y-1">
                    {artifacts.map((art) => {
                      const active = activeArtifact?.path === art.path;
                      return (
                        <button
                          key={art.path}
                          type="button"
                          onClick={() => setSelectedArtifactPath(art.path)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-[9px] border px-2.5 py-2 text-left transition-colors",
                            active
                              ? "border-accent bg-surface text-ink shadow-[var(--lift-1)]"
                              : "border-line bg-surface/70 text-ink-2 hover:border-line-strong hover:bg-surface"
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[11px] font-semibold">{art.name}</div>
                            <div className="truncate font-mono text-[10px] text-ink-4">{art.path}</div>
                          </div>
                          <Badge variant={art.category === "impl" ? "default" : "secondary"} className="text-[9.5px]">
                            {art.category}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>

                  {activeArtifact && (
                    <div className="min-w-0 rounded-[12px] border border-line bg-surface p-3">
                      <div className="mb-2 flex items-center justify-between gap-2 border-b border-line pb-2">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs font-semibold text-ink">
                            {activeArtifact.path}
                          </div>
                        </div>
                        <CopyButton value={activeArtifact.content} label={`Copy ${activeArtifact.name}`} size="sm" />
                      </div>
                      <pre className="m-0 max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-2">
                        {activeArtifact.content}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="graph" className="pt-2">
              <div className="rounded-[12px] border border-line bg-surface p-3">
                <div className="mb-2 flex items-center justify-between gap-2 border-b border-line pb-2">
                  <span className="font-mono text-[11px] font-semibold text-ink-2">
                    .state.graph (append-only coordinator log)
                  </span>
                  <CopyButton value={stateGraphLines.join("\n")} label="Copy .state.graph" size="sm" />
                </div>
                {stateGraphLines.length === 0 ? (
                  <p className="muted m-0 py-2 text-xs">No state graph lines recorded yet.</p>
                ) : (
                  <div className="max-h-[320px] overflow-auto space-y-1 font-mono text-[11px]">
                    {stateGraphLines.map((line, i) => (
                      <div key={i} className="flex gap-2.5 leading-relaxed">
                        <span className="w-6 shrink-0 select-none text-right text-ink-4 tabular-nums">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 break-all text-ink-2">{line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Panel>
  );
}

export function PipelineScreen({ open }: { open?: (id: string) => void }) {
  const qc = useQueryClient();
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();
  const [goal, setGoal] = useState("");
  const [projectName, setProjectName] = useState("");
  const [contextBody, setContextBody] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [wsUserEdited, setWsUserEdited] = useState(false);
  const [branch, setBranch] = useState("");
  const [branchRefresh, setBranchRefresh] = useState(0);
  const [executor, setExecutor] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [includeBoardTasks, setIncludeBoardTasks] = useState(false);
  // null = follow the active flow switch so "activate meta7" also selects it.
  const [picked, setPicked] = useState<string | null>(null);
  const contextRef = useRef<HTMLTextAreaElement>(null);

  const templates = useQuery({
    queryKey: ["pipeline-templates"],
    queryFn: () => apiOr<PipelineTemplate[]>("/api/v1/pipelines/templates", []),
  });

  const templateByName = useMemo(() => {
    const map = new Map<string, PipelineTemplate>();
    for (const t of templates.data ?? []) map.set(t.name, t);
    return map;
  }, [templates.data]);

  const activeFlow = useQuery({
    queryKey: ["pipeline-default"],
    queryFn: () => apiOr<{ default: string }>("/api/v1/pipelines/default", { default: "design-thinking" }),
  });

  const template = picked ?? activeFlow.data?.default ?? "design-thinking";
  const isMeta7 = template === "meta7";

  const savedWorkspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiOr<Workspace[]>("/api/v1/workspaces", []),
  });

  const boardTasksQuery = useQuery({
    queryKey: ["tasks", boardId],
    enabled: !!boardId,
    queryFn: () => apiOr<Task[]>(`/api/v1/boards/${encodeURIComponent(boardId)}/tasks`, []),
  });
  const boardTasks = boardTasksQuery.data ?? [];

  const eligibleBoardTasks = useMemo(
    () =>
      boardTasks.filter(
        (t) =>
          (t.status === "todo" || t.status === "backlog") &&
          !t.run_id &&
          !t.parent_id &&
          !t.title.startsWith("[pipeline]")
      ),
    [boardTasks]
  );

  useEffect(() => {
    if (wsUserEdited || workspace) return;
    const recentWs = boardTasks.find((c) => c.workspace)?.workspace;
    if (recentWs) {
      setWorkspace(recentWs);
      return;
    }
    const list = savedWorkspaces.data ?? [];
    if (list.length > 0) {
      const live = list.find((w) => w.status === "local" || w.status === "connected");
      setWorkspace((live ?? list[0]).path);
    }
  }, [boardTasks, savedWorkspaces.data, workspace, wsUserEdited]);

  const wsInspect = useQuery({
    queryKey: ["ws", workspace, branchRefresh],
    enabled: workspace.trim().length > 1,
    staleTime: 30_000,
    queryFn: () =>
      apiOr<WorkspaceInspect>(
        `/api/v1/workspaces/inspect?path=${encodeURIComponent(workspace.trim())}${branchRefresh ? "&refresh=1" : ""}`,
        { path: workspace, is_git: false, branches: [], local: false, source: "none" }
      ),
  });

  const currentBoard: Board | undefined = activeBoard;
  const effectiveExecutor = executor || currentBoard?.default_executor || "";
  const modelsQuery = useQuery({
    queryKey: ["models", effectiveExecutor],
    enabled: !!effectiveExecutor,
    queryFn: async () =>
      parseModelCatalog(
        await apiOr<unknown>(`/api/v1/models?executor=${encodeURIComponent(effectiveExecutor)}`, {})
      ),
  });
  const modelList = modelsQuery.data?.models ?? [];

  const groupedWorkspaces = useMemo(() => {
    const order: PlatformKey[] = ["mac", "windows", "current", "linux"];
    const map = new Map<PlatformKey, Workspace[]>();
    for (const w of savedWorkspaces.data ?? []) {
      const pk = platformOfWorkspace(w);
      map.set(pk, [...(map.get(pk) ?? []), w]);
    }
    return order.filter((k) => (map.get(k)?.length ?? 0) > 0).map((k) => [k, map.get(k)!] as const);
  }, [savedWorkspaces.data]);

  const workspaceOptions = useMemo<SearchSelectOption[]>(() => {
    const opts: SearchSelectOption[] = [
      {
        value: PIPELINE_SCRATCH_SENTINEL,
        label: "No workspace (scratch)",
        sublabel: "design artifacts only · no repository worktree",
        icon: <Sparkles className="size-3.5" />,
        keywords: ["scratch", "none", "empty"],
      },
    ];
    for (const [pk, list] of groupedWorkspaces) {
      for (const w of list) {
        const live = w.status === "local" || w.status === "connected";
        opts.push({
          value: w.path,
          label: w.name,
          sublabel: w.path,
          icon: <PlatformIcon platform={pk} />,
          badge: w.host ? "ssh" : (w.node ?? "local"),
          badgeNode: (
            <span className="inline-flex items-center gap-1">
              <span
                className={cn("size-1.5 rounded-full", live && "animate-pulse")}
                style={{ background: live ? "var(--c-success)" : "var(--c-line-strong)" }}
                aria-hidden
              />
              <span className="font-mono text-[9px] text-ink-3">{w.host || w.node || "local"}</span>
            </span>
          ),
          keywords: [w.name, w.path, w.host ?? "", PLATFORM_LABELS[pk], ...(w.labels ?? [])],
        });
      }
    }
    const trimmed = workspace.trim();
    if (trimmed && !opts.some((o) => o.value === trimmed)) {
      opts.splice(1, 0, {
        value: trimmed,
        label: trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed,
        sublabel: trimmed,
        badge: "unsaved",
      });
    }
    return opts;
  }, [groupedWorkspaces, workspace]);

  const selectedWsObj = useMemo(
    () => (savedWorkspaces.data ?? []).find((w) => w.path === workspace),
    [savedWorkspaces.data, workspace]
  );

  const saasActive =
    wsInspect.data?.saas === true ||
    /gadjian|hadirr|baktiku|\/saas\//i.test(workspace.replace(/\\/g, "/")) ||
    (selectedWsObj?.labels ?? []).some((l) => ["work", "saas", "fast-8", "fast8"].includes(l.toLowerCase()));

  const setDefault = useMutation({
    mutationFn: (name: string) => post<{ default: string }>("/api/v1/pipelines/default", { default: name }),
    onSuccess: (res) => {
      setPicked(res?.default ?? null);
      qc.invalidateQueries({ queryKey: ["pipeline-default"] });
    },
  });

  const q = useQuery({
    queryKey: ["pipelines"],
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () => apiOr<PipelineRun[] | null>("/api/v1/pipelines", null),
  });

  const start = useMutation({
    mutationFn: () =>
      post<PipelineRun>("/api/v1/pipelines", {
        template,
        board_id: boardId,
        goal: goal.trim(),
        project_name: isMeta7 ? projectName.trim() || undefined : undefined,
        context: contextBody.trim() || undefined,
        workspace: workspace.trim() || undefined,
        branch: branch.trim() || undefined,
        executor: executor || undefined,
        model: model.trim() || undefined,
        effort: effort || undefined,
        context_paths: paths.length ? paths : undefined,
        skills: skills.length ? skills : undefined,
        include_board_tasks: isMeta7 && includeBoardTasks && eligibleBoardTasks.length > 0,
      }),
    onSuccess: () => {
      setGoal("");
      setProjectName("");
      setContextBody("");
      setPaths([]);
      setSkills([]);
      setIncludeBoardTasks(false);
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast(`${template} pipeline started`, { tone: "success" });
    },
    onError: (e) => toastError(e, "Failed to start pipeline"),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => post(`/api/v1/pipelines/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toastError(e, "Cancel failed"),
  });

  const retryNode = useMutation({
    mutationFn: ({ runId, stage, nodeKey }: { runId: string; stage?: string; nodeKey?: string }) =>
      post(`/api/v1/pipelines/${runId}/retry`, { stage, node_key: nodeKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Requeued failed pipeline nodes", { tone: "success" });
    },
    onError: (e) => toastError(e, "Retry failed"),
  });

  const restartRun = useMutation({
    mutationFn: (id: string) => post<PipelineRun>(`/api/v1/pipelines/${id}/restart`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Restarted meta7 pipeline run", { tone: "success" });
    },
    onError: (e) => toastError(e, "Restart failed"),
  });

  const canLaunch =
    !!goal.trim() || (isMeta7 && includeBoardTasks && eligibleBoardTasks.length > 0);

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title-row">
            <h2>Pipeline runs</h2>
            {q.data && <span className="pill-count tabular-nums">{q.data.length} runs</span>}
          </div>
          <p className="page-subtitle">
            Autonomous multi-stage DAG orchestrations and meta7 context studio executed on the active board.
          </p>
        </div>
        <div className="page-header-actions">
          {(boards.data?.length ?? 0) > 1 && (
            <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
          )}
        </div>
      </div>

      <ErrorBox error={q.error ?? start.error ?? cancel.error ?? setDefault.error ?? retryNode.error ?? restartRun.error} />

      {boardId && (
        <form
          className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--lift-1),var(--lift-inset)] space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canLaunch) start.mutate();
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-2">
              {isMeta7 ? (
                <Workflow className="size-3.5 text-accent-text" />
              ) : (
                <Sparkles className="size-3.5 text-accent-text" />
              )}
              <span>Launch pipeline {currentBoard ? `on ${currentBoard.name}` : ""}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Flow</span>
              <Segmented
                label="Active pipeline flow"
                value={template}
                onChange={(name) => {
                  setPicked(name);
                  setDefault.mutate(name);
                }}
                options={(templates.data?.length ? templates.data.map((t) => t.name) : ["design-thinking", "meta7"]).map(
                  (name) => ({ value: name, label: name })
                )}
              />
              {setDefault.isPending && <span className="muted text-[11px]">saving…</span>}
            </div>
          </div>

          {isMeta7 && (
            <div className="rounded-[12px] border border-accent/25 bg-accent-tint/50 px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
              <strong>meta7 autonomous coordinator</strong> materializes{" "}
              <code className="font-mono text-[10.5px]">projects/&lt;slug&gt;/.&lt;slug&gt;.context</code>, drives{" "}
              <code className="font-mono text-[10.5px]">explore → cross_examine → synthesize → design → verify → review → impl</code>{" "}
              with automatic back-arc routing &amp; chained{" "}
              <code className="font-mono text-[10.5px]">sy/&lt;impl&gt;</code> 4-way verification gates.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_296px]">
            <div className="space-y-3 min-w-0">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_180px]">
                <div className="space-y-1">
                  <Label htmlFor="pipeline-goal" className="text-[11px] font-medium text-ink-3">
                    Goal / Objective
                  </Label>
                  <Input
                    id="pipeline-goal"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder={
                      includeBoardTasks && eligibleBoardTasks.length > 0
                        ? `Optional — leave blank to infer from ${eligibleBoardTasks.length} board tasks`
                        : `Describe the ${template} objective…`
                    }
                  />
                </div>
                {isMeta7 && (
                  <div className="space-y-1">
                    <Label htmlFor="pipeline-project-slug" className="text-[11px] font-medium text-ink-3">
                      CURRENT_NAME (slug)
                    </Label>
                    <Input
                      id="pipeline-project-slug"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="auto from goal"
                      className="font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pipeline-context" className="text-[11px] font-medium text-ink-3">
                    {isMeta7 ? "CONTEXT specification (.context body)" : "Context & Constraints (optional)"}
                  </Label>
                  {isMeta7 && (
                    <button
                      type="button"
                      className="text-[10.5px] font-medium text-accent-text hover:underline"
                      onClick={() =>
                        setContextBody((prev) =>
                          prev.trim() ? `${prev.trim()}\n\n${META7_CONTEXT_TEMPLATE}` : META7_CONTEXT_TEMPLATE
                        )
                      }
                    >
                      Insert .context template
                    </button>
                  )}
                </div>
                <PromptOmnibox
                  id="pipeline-context"
                  value={contextBody}
                  onChange={setContextBody}
                  workspace={workspace}
                  paths={paths}
                  onPathsChange={setPaths}
                  skills={skills}
                  onSkillsChange={setSkills}
                  inputRef={contextRef}
                  boardTasks={boardTasks}
                  rows={isMeta7 ? 6 : 4}
                  placeholder="Write problem description, constraints, architecture goals… Type @ for workspace files or $ for agent skills."
                />
              </div>

              {isMeta7 && eligibleBoardTasks.length > 0 && (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-[12px] border border-line bg-well/60 px-3 py-2 text-xs text-ink-2 hover:border-line-strong">
                  <Checkbox
                    checked={includeBoardTasks}
                    onCheckedChange={(v) => setIncludeBoardTasks(v === true)}
                  />
                  <span className="flex-1">
                    Include{" "}
                    <strong className="font-semibold text-ink tabular-nums">
                      {eligibleBoardTasks.length}
                    </strong>{" "}
                    active <code className="font-mono text-[10.5px]">todo/backlog</code> tasks on{" "}
                    <strong>{currentBoard?.name ?? "this board"}</strong> into unified meta7 context
                  </span>
                </label>
              )}
            </div>

            <div className="space-y-2.5 rounded-[14px] border border-line bg-well/50 p-3">
              <div className="space-y-1">
                <Label htmlFor="pipeline-ws" className="text-[11px] font-medium text-ink-3">
                  <FolderGit2 className="size-3 text-ink-3" />
                  {isMeta7 ? "Target Workspace (EXTRA_REFS)" : "Target Workspace"}
                </Label>
                <SearchSelect
                  id="pipeline-ws"
                  value={workspace || PIPELINE_SCRATCH_SENTINEL}
                  onValueChange={(v) => {
                    setWsUserEdited(true);
                    setWorkspace(v === PIPELINE_SCRATCH_SENTINEL ? "" : v);
                    setBranch("");
                  }}
                  options={workspaceOptions}
                  placeholder="Select workspace…"
                  searchPlaceholder="Search workspaces…"
                  emptyMessage="No workspaces"
                  ariaLabel="Target workspace"
                  size="sm"
                />
              </div>

              <SaasRulesBanner active={saasActive} compact />

              <BranchField
                workspace={workspace}
                isGit={wsInspect.data?.is_git === true}
                inspect={wsInspect.data}
                value={branch}
                onChange={setBranch}
                loading={wsInspect.isFetching}
                onRefresh={() => setBranchRefresh((c) => c + 1)}
              />

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-ink-3">Executor</Label>
                  <Select
                    value={executor || PIPELINE_DEFAULT_SENTINEL}
                    onValueChange={(v) => {
                      setExecutor(v === PIPELINE_DEFAULT_SENTINEL ? "" : v);
                      setModel("");
                    }}
                  >
                    <SelectTrigger size="sm" aria-label="Pipeline executor">
                      <SelectValue placeholder="Board default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PIPELINE_DEFAULT_SENTINEL}>
                        {currentBoard?.default_executor
                          ? `Default (${currentBoard.default_executor})`
                          : "Default"}
                      </SelectItem>
                      {EXECUTORS.map((ex) => (
                        <SelectItem key={ex} value={ex}>
                          {EXECUTOR_LABELS[ex] ?? ex}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-ink-3">Effort</Label>
                  <Select
                    value={effort || PIPELINE_DEFAULT_SENTINEL}
                    onValueChange={(v) => setEffort(v === PIPELINE_DEFAULT_SENTINEL ? "" : v)}
                  >
                    <SelectTrigger size="sm" aria-label="Pipeline effort">
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PIPELINE_DEFAULT_SENTINEL}>Default</SelectItem>
                      {EFFORTS.map((ef) => (
                        <SelectItem key={ef} value={ef}>
                          {ef}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="pipeline-model" className="text-[11px] font-medium text-ink-3">
                  Model
                </Label>
                {modelList.length > 0 ? (
                  <SearchSelect
                    id="pipeline-model"
                    value={model || PIPELINE_DEFAULT_SENTINEL}
                    onValueChange={(v) => setModel(v === PIPELINE_DEFAULT_SENTINEL ? "" : v)}
                    options={[
                      {
                        value: PIPELINE_DEFAULT_SENTINEL,
                        label: currentBoard?.default_model
                          ? `Default (${currentBoard.default_model})`
                          : "Default",
                      },
                      ...modelList.map((m) => ({
                        value: m.id,
                        label: m.name,
                        sublabel: m.sublabel,
                        badge: m.badge,
                      })),
                    ]}
                    placeholder="Select model…"
                    searchPlaceholder="Filter models…"
                    emptyMessage="No models"
                    ariaLabel="Pipeline model"
                    size="sm"
                  />
                ) : (
                  <Input
                    id="pipeline-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={currentBoard?.default_model || "executor default"}
                    className="h-8 font-mono text-xs"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
            <span className="text-[11px] text-ink-4">
              {paths.length > 0 || skills.length > 0
                ? `Attached: ${paths.length} files · ${skills.length} skills`
                : "Type @ in context for files/cards or $ for agent skills"}
            </span>
            <Button type="submit" variant="signal" disabled={start.isPending || !canLaunch}>
              {isMeta7 ? <Workflow className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
              <span>{isMeta7 ? "Launch meta7 pipeline" : "Start pipeline"}</span>
            </Button>
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
        <PipelineRunCard
          key={r.id}
          run={r}
          templateSpec={r.template ? templateByName.get(r.template) : undefined}
          openTask={open}
          onCancel={(id) => cancel.mutate(id)}
          cancelling={cancel.isPending}
          onRetry={(args) => retryNode.mutate(args)}
          retrying={retryNode.isPending}
          onRestart={(id) => restartRun.mutate(id)}
          restarting={restartRun.isPending}
        />
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
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-xs font-medium text-ink-2 shadow-[var(--lift-1),var(--lift-inset)] transition-colors hover:border-line-strong hover:bg-well/50 hover:text-ink select-none">
            <Checkbox
              checked={dark}
              onCheckedChange={(checked) => {
                const isDark = checked === true;
                setDark(isDark);
                document.documentElement.classList.toggle("dark", isDark);
                localStorage.setItem("switchyard.dark", isDark ? "1" : "");
              }}
              aria-label="Dark mode"
            />
            <span>Dark mode</span>
          </label>

          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-xs font-medium text-ink-2 shadow-[var(--lift-1),var(--lift-inset)] transition-colors hover:border-line-strong hover:bg-well/50 hover:text-ink select-none">
            <Checkbox
              checked={compact}
              onCheckedChange={(checked) => applyCompact(checked === true)}
              aria-label="Compact card density"
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
