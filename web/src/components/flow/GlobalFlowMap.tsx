import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Database,
  Expand,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Kanban,
  Laptop,
  Layers,
  Minimize2,
  Monitor,
  Play,
  Radio,
  RotateCcw,
  Search,
  Server,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "@/components/ui/icons";
import {
  api,
  LIVE_FALLBACK_MS,
  type FlowActiveResponse,
  type FlowBoardSummary,
  type FlowTask,
  type FlowWorkerSummary,
} from "@/api";
import { cn } from "@/lib/utils";
import { ErrorBox } from "@/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkerLogPanel } from "@/components/board/OutputPanels";

/* -------------------------------------------------------------------------- */
/* Topology Model & Geometry                                                  */
/* -------------------------------------------------------------------------- */

export type FlowNodeId =
  | "meta7"
  | "orchestrator"
  | "kanban"
  | "dispatcher"
  | "memory"
  | "node-agent-server"
  | "tailscale"
  | "mac"
  | "linux"
  | "windows"
  | "review";

export interface Point {
  x: number;
  y: number;
}

export interface DagStageItem {
  id: string;
  name?: string;
  status: string;
  depends_on?: string[];
}

interface LayoutNode {
  id: FlowNodeId;
  label: string;
  sub: string;
  group: string;
  hue: string;
  icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  pos: Point;
  summary: string;
  responsibilities: string[];
}

interface LayoutEdge {
  from: FlowNodeId;
  to: FlowNodeId;
  color: string;
}

const CARD_W = 214;
const CARD_H = 58;
const GRAPH_W = 1440;
const GRAPH_H = 740;
const MINIMAP_W = 188;
const MINIMAP_H = 114;

const SPEED_IDLE = 72;
const SPEED_ACTIVE = 250;
const SPEED_TRACED = 310;

const NODES: LayoutNode[] = [
  {
    id: "meta7",
    label: "Pipelines & meta7",
    sub: "autonomous DAG studio",
    group: "ORCHESTRATION",
    hue: "#8b5cf6",
    icon: Workflow,
    pos: { x: 150, y: 165 },
    summary: "Autonomous multi-stage meta7 & design-thinking coordinator producing structured artifacts and chained git branches.",
    responsibilities: [
      "Breaks complex specs into explore, design, verify, review, and impl DAGs",
      "Maintains append-only .state.graph event logs and .01.impl handoffs",
      "Automatically triggers back-arc revisions on FAIL:design / FAIL:context",
    ],
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    sub: "intent + planning",
    group: "CONTROL PLANE",
    hue: "var(--c-accent)",
    icon: Brain,
    pos: { x: 430, y: 165 },
    summary: "Control plane coordinator managing task dependencies, gates, and board-level context.",
    responsibilities: [
      "Resolves DAG blocking dependencies across tasks and pipeline stages",
      "Enforces boundary isolation between exploration, synthesis, and review",
      "Tracks evolution budgets and continuation prompts across runs",
    ],
  },
  {
    id: "kanban",
    label: "Kanban Hub",
    sub: "SQLite · all boards",
    group: "GLOBAL STATE",
    hue: "#7c3aed",
    icon: Kanban,
    pos: { x: 150, y: 375 },
    summary: "Central durable SQLite state machine synchronizing every board, task queue, and lifecycle event.",
    responsibilities: [
      "Tracks backlog, todo, blocked, in_progress, review, done, and failed",
      "Broadcasts live SSE invalidations across every connected browser session",
      "Consolidates standalone board tasks cleanly into unified pipeline runs",
    ],
  },
  {
    id: "dispatcher",
    label: "Task Dispatcher",
    sub: "atomic claim & lease",
    group: "SCHEDULING",
    hue: "#f59e0b",
    icon: Server,
    pos: { x: 430, y: 375 },
    summary: "Atomic claim loop matching ready tasks to eligible workspaces and healthy remote nodes.",
    responsibilities: [
      "Acquires leased task claims and reaps stale worker locks safely",
      "Provisions isolated sy/<task-id> worktrees from configured base branches",
      "Re-queues or back-routes failed attempts with structured error signatures",
    ],
  },
  {
    id: "memory",
    label: "Worktree & Context",
    sub: "git sy/* · @files · $skills",
    group: "CONTEXT",
    hue: "#0ea5e9",
    icon: Database,
    pos: { x: 430, y: 580 },
    summary: "Repository worktree manager, workspace index, and agent skill injector.",
    responsibilities: [
      "Isolates each agent attempt on a clean sy/<task-id> git branch",
      "Chains verification gate bands onto sy/<impl> branches automatically",
      "Injects @file references, symbols, and workspace SaaS guardrails",
    ],
  },
  {
    id: "node-agent-server",
    label: "Node-Agent Hub",
    sub: "queue · model catalog",
    group: "DISPATCH",
    hue: "#f97316",
    icon: Server,
    pos: { x: 715, y: 375 },
    summary: "Worker runtime broker handling executor launches, model discovery, and live log streaming.",
    responsibilities: [
      "Executes Claude Code, Codex, Command Code, omp, and DeepSeek harnesses",
      "Exposes /api/dispatch, /api/models, and incremental worker log streams",
      "Reports real-time node heartbeats and advertised workspace paths",
    ],
  },
  {
    id: "tailscale",
    label: "Tailscale / Mesh",
    sub: "cross-host transport",
    group: "NETWORK",
    hue: "#06b6d4",
    icon: Radio,
    pos: { x: 995, y: 375 },
    summary: "Encrypted mesh transport connecting the control plane to local and remote worker machines.",
    responsibilities: [
      "Routes jobs securely across macOS, Linux cloud, and Windows hosts",
      "Monitors end-to-end ping latency and node reachability",
      "Streams live execution chunks without exposing public worker ports",
    ],
  },
  {
    id: "mac",
    label: "macOS Worker",
    sub: "Apple · local / Tailscale",
    group: "EXECUTION",
    hue: "#ec4899",
    icon: Laptop,
    pos: { x: 1275, y: 175 },
    summary: "macOS execution host running Xcode, Apple Silicon toolchains, and local repository worktrees.",
    responsibilities: [
      "Runs tasks targeting /Users/* workspaces and macOS tooling",
      "Streams stdout/stderr HERMES events and structured traces live",
      "Maintains isolated git branches ready for diff inspection",
    ],
  },
  {
    id: "linux",
    label: "Linux / Cloud Worker",
    sub: "control host · containers",
    group: "EXECUTION",
    hue: "#10b981",
    icon: Server,
    pos: { x: 1275, y: 375 },
    summary: "Linux server execution environment hosting backend builds, deploys, and automated checks.",
    responsibilities: [
      "Executes Linux/server workspaces and containerized build pipelines",
      "Runs high-concurrency verification bands and test suites",
      "Reports worker heartbeat and health telemetry",
    ],
  },
  {
    id: "windows",
    label: "Windows Worker",
    sub: "PowerShell · MSVC",
    group: "EXECUTION",
    hue: "#3b82f6",
    icon: Monitor,
    pos: { x: 1275, y: 575 },
    summary: "Windows workstation / scheduled worker executing native Windows workspaces over node-agent.",
    responsibilities: [
      "Handles drive-letter (D:\\ / C:\\) workspaces on Windows hosts",
      "Coordinates remote worktree creation directly on the Windows node",
      "Feeds diffs and artifacts back to Review Gate transparently",
    ],
  },
  {
    id: "review",
    label: "Review Gate",
    sub: "diff · verdict · merge",
    group: "QUALITY GATE",
    hue: "#16a34a",
    icon: GitPullRequest,
    pos: { x: 715, y: 580 },
    summary: "Automated and human verification checkpoint inspecting git diffs against base SHAs.",
    responsibilities: [
      "Evaluates PASS / FAIL:design / FAIL:context verdicts and rejection feedback",
      "Approves clean branches (or auto-merges when configured)",
      "Routes rejected or failed iterations back into Kanban Hub for retry",
    ],
  },
];

const NODE_MAP: Record<FlowNodeId, LayoutNode> = Object.fromEntries(
  NODES.map((n) => [n.id, n])
) as Record<FlowNodeId, LayoutNode>;

const INITIAL_POS: Record<FlowNodeId, Point> = Object.fromEntries(
  NODES.map((n) => [n.id, n.pos])
) as Record<FlowNodeId, Point>;

const EDGES: LayoutEdge[] = [
  { from: "meta7", to: "orchestrator", color: "#8b5cf6" },
  { from: "meta7", to: "kanban", color: "#8b5cf6" },
  { from: "orchestrator", to: "kanban", color: "#6366f1" },
  { from: "orchestrator", to: "memory", color: "#0ea5e9" },
  { from: "kanban", to: "dispatcher", color: "#f59e0b" },
  { from: "memory", to: "dispatcher", color: "#0ea5e9" },
  { from: "dispatcher", to: "node-agent-server", color: "#f97316" },
  { from: "node-agent-server", to: "tailscale", color: "#06b6d4" },
  { from: "tailscale", to: "mac", color: "#ec4899" },
  { from: "tailscale", to: "linux", color: "#10b981" },
  { from: "tailscale", to: "windows", color: "#3b82f6" },
  { from: "mac", to: "review", color: "#16a34a" },
  { from: "linux", to: "review", color: "#16a34a" },
  { from: "windows", to: "review", color: "#16a34a" },
  { from: "review", to: "kanban", color: "#eab308" },
];

const STAGE_COLOR: Record<string, string> = {
  queued: "var(--c-ink-3)",
  blocked: "var(--c-warning)",
  dispatched: "var(--c-warning)",
  running: "var(--c-accent)",
  review: "var(--c-review)",
  done: "var(--c-success-text)",
  failed: "var(--c-danger-text)",
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function resolveWorkerNode(t: FlowTask): "mac" | "windows" | "linux" {
  const m = (t.machine || "").toLowerCase();
  const nid = (t.node_id || "").toLowerCase();
  const ws = (t.workspace || "").toLowerCase();
  if (m === "mac" || nid.includes("mac") || ws.startsWith("/users/")) return "mac";
  if (m === "windows" || nid.includes("win") || /^[a-z]:[\\/]/i.test(ws) || ws.includes("\\")) {
    return "windows";
  }
  return "linux";
}

function stationedNodeFor(t: FlowTask): FlowNodeId {
  if (t.stage === "running") return resolveWorkerNode(t);
  if (t.stage === "dispatched") return "node-agent-server";
  if (t.stage === "review" || t.stage === "done" || t.stage === "failed") return "review";
  if (t.run_id) return "meta7";
  return "kanban";
}

function channelChain(t: FlowTask, replayAll = false): FlowNodeId[] {
  const worker = resolveWorkerNode(t);
  const head: FlowNodeId[] = t.run_id ? ["meta7", "orchestrator", "kanban"] : ["kanban"];
  if (replayAll) {
    return [...head, "dispatcher", "node-agent-server", "tailscale", worker, "review"];
  }
  if (t.stage === "running") {
    return [...head, "dispatcher", "node-agent-server", "tailscale", worker];
  }
  if (t.stage === "dispatched") {
    return [...head, "dispatcher", "node-agent-server"];
  }
  if (t.stage === "review" || t.stage === "done" || t.stage === "failed") {
    return [worker, "review", "kanban"];
  }
  if (t.stage === "queued" || t.stage === "blocked") {
    return t.run_id ? ["meta7", "orchestrator", "kanban"] : ["kanban", "dispatcher"];
  }
  return [];
}

function edgeKey(a: FlowNodeId, b: FlowNodeId) {
  return `${a}->${b}`;
}

function elbowPath(from: Point, to: Point, midX: number, rIn = 16): string {
  if (Math.abs(to.y - from.y) < 1) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const vert = Math.abs(to.y - from.y);
  const r = Math.min(rIn, vert / 2, Math.abs(midX - from.x), Math.abs(to.x - midX));
  if (r <= 0.5) return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
  const dir = to.y > from.y ? 1 : -1;
  const s = Math.sign(midX - from.x) || 1;
  const s2 = Math.sign(to.x - midX) || 1;
  const sweep1 = s * dir > 0 ? 1 : 0;
  const sweep2 = s2 * dir > 0 ? 0 : 1;
  return [
    `M ${from.x} ${from.y}`,
    `L ${midX - s * r} ${from.y}`,
    `A ${r} ${r} 0 0 ${sweep1} ${midX} ${from.y + dir * r}`,
    `L ${midX} ${to.y - dir * r}`,
    `A ${r} ${r} 0 0 ${sweep2} ${midX + s2 * r} ${to.y}`,
    `L ${to.x} ${to.y}`,
  ].join(" ");
}

function elbowPathV(from: Point, to: Point, midY: number, rIn = 16): string {
  if (Math.abs(to.x - from.x) < 1) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const horiz = Math.abs(to.x - from.x);
  const r = Math.min(rIn, horiz / 2, Math.abs(midY - from.y), Math.abs(to.y - midY));
  if (r <= 0.5) return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
  const dir = to.x > from.x ? 1 : -1;
  const sv = Math.sign(midY - from.y) || 1;
  const sweep = sv * dir > 0 ? 1 : 0;
  return [
    `M ${from.x} ${from.y}`,
    `L ${from.x} ${midY - sv * r}`,
    `A ${r} ${r} 0 0 ${sweep} ${from.x + dir * r} ${midY}`,
    `L ${to.x - dir * r} ${midY}`,
    `A ${r} ${r} 0 0 ${sweep} ${to.x} ${midY + sv * r}`,
    `L ${to.x} ${to.y}`,
  ].join(" ");
}

function pathLength(d: string): number {
  let total = 0;
  let px = 0;
  let py = 0;
  const re = /([MLA])\s*([^MLA]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1];
    const vals = m[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    if (cmd === "M" && vals.length >= 2) {
      px = vals[0];
      py = vals[1];
    } else if (cmd === "L") {
      for (let j = 0; j + 1 < vals.length; j += 2) {
        total += Math.hypot(vals[j] - px, vals[j + 1] - py);
        px = vals[j];
        py = vals[j + 1];
      }
    } else if (cmd === "A" && vals.length >= 2) {
      const r = Math.abs(vals[0]);
      total += (Math.PI / 2) * r;
      px = vals[vals.length - 2];
      py = vals[vals.length - 1];
    }
  }
  return Math.max(1, total);
}

function anchor(
  a: FlowNodeId,
  b: FlowNodeId,
  positions: Record<FlowNodeId, Point>
): { path: string; len: number } {
  const from = positions[a];
  const to = positions[b];
  let path: string;
  if (Math.abs(from.y - to.y) < 4) {
    const dir = to.x >= from.x ? 1 : -1;
    const p1 = { x: from.x + (dir * CARD_W) / 2, y: from.y };
    const p2 = { x: to.x - (dir * CARD_W) / 2, y: to.y };
    path = elbowPath(p1, p2, (p1.x + p2.x) / 2);
  } else if (Math.abs(from.x - to.x) < 4) {
    const dir = to.y >= from.y ? 1 : -1;
    const p1 = { x: from.x, y: from.y + (dir * CARD_H) / 2 };
    const p2 = { x: to.x, y: to.y - (dir * CARD_H) / 2 };
    path = elbowPathV(p1, p2, (p1.y + p2.y) / 2);
  } else {
    const right = to.x > from.x;
    const p1 = { x: from.x + (right ? CARD_W / 2 : -CARD_W / 2), y: from.y };
    const p2 = { x: to.x - (right ? CARD_W / 2 : -CARD_W / 2), y: to.y };
    path = elbowPath(p1, p2, (p1.x + p2.x) / 2);
  }
  return { path, len: pathLength(path) };
}

function taskCardPositions(count: number, center: Point): Point[] {
  const start = center.y + CARD_H / 2 + 16;
  const pitch = 24;
  return Array.from({ length: count }, (_, idx) => ({
    x: center.x,
    y: start + idx * pitch,
  }));
}

function cycleFor(pathLen: number, speed: number): number {
  const oneWay = Math.max(1, pathLen) / speed;
  return oneWay * 2.4;
}

/* -------------------------------------------------------------------------- */
/* Subcomponents                                                              */
/* -------------------------------------------------------------------------- */

function TravelingDot({
  label,
  pathD,
  pathLen,
  phaseRatio,
  mode,
  color = "#f8fafc",
}: {
  label: string;
  pathD: string;
  pathLen: number;
  phaseRatio: number;
  mode: "idle" | "active" | "traced";
  color?: string;
}) {
  const speed = mode === "traced" ? SPEED_TRACED : mode === "active" ? SPEED_ACTIVE : SPEED_IDLE;
  const cycle = cycleFor(pathLen, speed);
  const size = mode === "traced" ? 6 : mode === "active" ? 5 : 3.5;
  const anim =
    mode === "idle"
      ? "animate-[flow-idle_0s_linear_infinite]"
      : "animate-[flow-active_0s_linear_infinite]";

  return (
    <div
      className={cn("pointer-events-none absolute left-0 top-0 size-0 motion-reduce:hidden", anim)}
      style={
        {
          offsetPath: `path("${pathD}")`,
          offsetRotate: "0deg",
          animationDuration: `${cycle}s`,
          animationDelay: `-${phaseRatio * cycle}s`,
          animationFillMode: "backwards",
        } as CSSProperties
      }
    >
      <span
        className="pointer-events-auto absolute left-0 top-0 block -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: size,
          height: size,
          background: mode === "traced" ? "#ffffff" : color,
          opacity: mode === "idle" ? 0.7 : 1,
          boxShadow:
            mode === "traced"
              ? "0 0 10px 2px rgba(47,91,255,0.9)"
              : mode === "active"
                ? `0 0 7px 1.5px ${color}`
                : "0 0 3px 1px rgba(148,163,184,0.45)",
        }}
        title={label}
      />
    </div>
  );
}

function MiniEkg({ online, color }: { online: boolean; color: string }) {
  const path = online
    ? "M 0 8 L 8 8 L 11 4 L 14 12 L 17 2 L 20 11 L 23 8 L 36 8"
    : "M 0 8 L 36 8";
  return (
    <svg width={36} height={14} viewBox="0 0 36 14" aria-hidden className="shrink-0 overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" opacity={online ? 0.3 : 0.25} />
      {online && (
        <path
          d={path}
          pathLength={100}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="oscilloscope-pulse-trace motion-reduce:hidden"
        />
      )}
    </svg>
  );
}

function FlowNodeCard({
  node,
  count,
  meta,
  selected,
  traced,
  dimmed,
  workerStats,
  onSelect,
  onDragStart,
  onDragMove,
  onDragCancel,
  style,
}: {
  node: LayoutNode;
  count: number;
  meta?: string;
  selected: boolean;
  traced: boolean;
  dimmed: boolean;
  workerStats?: { online: number; total: number; latencyMs?: number };
  onSelect: () => void;
  onDragStart: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragCancel: () => void;
  style: CSSProperties;
}) {
  const Icon = node.icon;
  const isWorker = node.id === "mac" || node.id === "linux" || node.id === "windows";
  const online = (workerStats?.online ?? 0) > 0;

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* synthetic event guard */
        }
        onDragStart(e);
      }}
      onPointerMove={onDragMove}
      onPointerUp={(e) => {
        try {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        } catch {
          /* ignore */
        }
        onSelect();
      }}
      onPointerCancel={onDragCancel}
      aria-pressed={selected}
      title={meta ?? node.sub}
      className={cn(
        "absolute flex h-[58px] w-[214px] cursor-grab items-center gap-2.5 rounded-[13px] border bg-surface px-3 text-left shadow-[var(--lift-1)]",
        "transition-[border-color,box-shadow,opacity] duration-150 ease-out hover:border-line-strong hover:shadow-[var(--lift-2)]",
        "active:cursor-grabbing focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus/40",
        selected || traced
          ? "border-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--c-accent)_18%,transparent)]"
          : count > 0
            ? "border-line-strong"
            : "border-line",
        dimmed && "opacity-45"
      )}
      style={style}
    >
      <span
        aria-hidden
        className="absolute inset-y-2.5 left-0 w-[3.5px] rounded-r-full"
        style={{ background: node.hue }}
      />
      <span
        className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-[9px] border border-line/70 bg-well"
        aria-hidden
      >
        <Icon className="size-3.5" style={{ color: node.hue }} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold leading-tight text-ink">
            {node.label}
          </span>
        </span>
        <span className={cn("mt-0.5 block truncate text-[10.5px] text-ink-3", meta && "font-mono text-[10px]")}>
          {meta ?? node.sub}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end justify-center gap-1">
        {isWorker && workerStats ? (
          <>
            <MiniEkg online={online} color={online ? node.hue : "var(--c-ink-4)"} />
            <span className="font-mono text-[9.5px] tabular-nums text-ink-3">
              {workerStats.latencyMs ? `${workerStats.latencyMs}ms` : online ? `${workerStats.online}/${workerStats.total} up` : `${workerStats.total} ws`}
            </span>
          </>
        ) : count > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-accent/30 bg-accent-tint px-1.5 font-mono text-[10px] font-semibold tabular-nums text-accent-text">
            {count}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function RouteInspector({
  node,
  focusedTask,
  nodeTasks,
  boards,
  workers,
  onClearTask,
  onSelectTask,
  onReplayTask,
  onOpenDrawer,
  onClose,
}: {
  node: LayoutNode | null;
  focusedTask: FlowTask | null;
  nodeTasks: FlowTask[];
  boards: FlowBoardSummary[];
  workers: FlowWorkerSummary[];
  onClearTask: () => void;
  onSelectTask: (taskId: string) => void;
  onReplayTask: (taskId: string) => void;
  onOpenDrawer: (taskId: string) => void;
  onClose: () => void;
}) {
  if (!node && !focusedTask) return null;

  const hops = focusedTask ? channelChain(focusedTask, true) : [];
  const activeHop = focusedTask ? stationedNodeFor(focusedTask) : null;
  const activeIdx = activeHop ? hops.lastIndexOf(activeHop) : -1;

  return (
    <aside
      aria-label="Flow map inspector"
      className="flex w-full max-w-[350px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:shadow-[var(--lift-3)]"
    >
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p
            className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: focusedTask ? STAGE_COLOR[focusedTask.stage] ?? "var(--c-accent)" : node?.hue }}
          >
            {focusedTask ? `ROUTE TRACE · ${focusedTask.stage}` : node?.group}
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold text-ink">
            {focusedTask ? focusedTask.title : node?.label}
          </h3>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3">
            {focusedTask ? `${focusedTask.task_id} · ${focusedTask.board || "Board"}` : node?.sub}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
          className="rounded-[7px] p-1 text-ink-3 transition-colors hover:bg-well hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="space-y-4 p-4">
        {focusedTask ? (
          <>
            {node && (
              <button
                type="button"
                onClick={onClearTask}
                className="text-[11px] font-medium text-accent-text hover:underline"
              >
                ← Back to {node.label} ({nodeTasks.length} tasks)
              </button>
            )}

            <div className="rounded-[12px] border border-line bg-well/50 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                  Route Hops
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => onReplayTask(focusedTask.task_id)}
                  >
                    <Play className="size-3" />
                    Replay
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="signal"
                    onClick={() => onOpenDrawer(focusedTask.task_id)}
                  >
                    <ExternalLink className="size-3" />
                    Drawer
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {hops.map((hop, idx) => {
                  const isCurrent = hop === activeHop;
                  const reached = activeIdx >= 0 ? idx <= activeIdx : false;
                  return (
                    <span key={`${hop}-${idx}`} className="inline-flex items-center gap-1">
                      <span
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                          isCurrent
                            ? "border-accent bg-accent-tint text-accent-text font-semibold"
                            : reached
                              ? "border-line-strong bg-surface text-ink-2"
                              : "border-line bg-well text-ink-4"
                        )}
                      >
                        {NODE_MAP[hop]?.label ?? hop}
                      </span>
                      {idx < hops.length - 1 && (
                        <span className="text-[10px] text-ink-4">→</span>
                      )}
                    </span>
                  );
                })}
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 text-[11px]">
                <div>
                  <dt className="text-ink-4">Task ID</dt>
                  <dd className="flex items-center gap-1 font-mono text-ink-2">
                    <span className="truncate">{focusedTask.task_id}</span>
                    <CopyButton value={focusedTask.task_id} label="Copy task id" />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-4">Board</dt>
                  <dd className="truncate font-medium text-ink-2">{focusedTask.board || focusedTask.board_id}</dd>
                </div>
                <div>
                  <dt className="text-ink-4">Target Worker</dt>
                  <dd className="truncate font-mono text-ink-2">
                    {focusedTask.node_id || focusedTask.machine || "local"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-4">Executor / Model</dt>
                  <dd className="truncate font-mono text-ink-2">
                    {focusedTask.executor || "default"}
                    {focusedTask.model ? ` / ${focusedTask.model}` : ""}
                  </dd>
                </div>
                {focusedTask.branch && (
                  <div className="col-span-2">
                    <dt className="text-ink-4">Branch</dt>
                    <dd className="inline-flex items-center gap-1 font-mono text-ink-2">
                      <GitBranch className="size-3 text-ink-4" />
                      {focusedTask.branch}
                    </dd>
                  </div>
                )}
                {focusedTask.workspace && (
                  <div className="col-span-2">
                    <dt className="text-ink-4">Workspace</dt>
                    <dd className="truncate font-mono text-[10.5px] text-ink-3" title={focusedTask.workspace}>
                      {focusedTask.workspace}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <WorkerLogPanel
              taskId={focusedTask.task_id}
              running={focusedTask.stage === "running"}
              compact
              title="Live Worker Stream"
            />
          </>
        ) : node ? (
          <>
            <div className="rounded-[12px] border border-line bg-well/40 p-3 space-y-2">
              <p className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                Architecture Role
              </p>
              <p className="m-0 text-xs leading-relaxed text-ink-2">{node.summary}</p>
              <ul className="m-0 space-y-1 pl-0 text-[11.5px] text-ink-3 list-none">
                {node.responsibilities.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="font-mono text-accent-text select-none">›</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            {node.id === "kanban" && boards.length > 0 && (
              <div className="space-y-1.5">
                <p className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                  Global Boards ({boards.length})
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {boards.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between rounded-[9px] border border-line bg-well/40 px-2.5 py-1.5 text-xs"
                    >
                      <span className="truncate font-medium text-ink">{b.name}</span>
                      <span className="font-mono text-[10.5px] tabular-nums text-ink-3">
                        {b.active} active · {b.total} total
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(node.id === "mac" || node.id === "linux" || node.id === "windows") && (
              <div className="space-y-1.5">
                <p className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                  Registered Hosts &amp; Workspaces
                </p>
                {workers.filter((w) => w.machine === node.id).length === 0 ? (
                  <p className="m-0 text-xs text-ink-4">No registered workspaces on {node.label} yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {workers
                      .filter((w) => w.machine === node.id)
                      .map((w) => (
                        <div
                          key={w.id}
                          className="rounded-[9px] border border-line bg-well/40 px-2.5 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-ink">{w.name}</span>
                            <Badge
                              variant={
                                w.status === "connected" || w.status === "local"
                                  ? "success"
                                  : w.status === "unreachable"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {w.status || "unknown"}
                            </Badge>
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-ink-4">
                            {w.host ? `${w.host} · ` : ""}
                            {w.path}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                  Tasks Passing Through ({nodeTasks.length})
                </p>
              </div>
              {nodeTasks.length === 0 ? (
                <p className="m-0 text-xs text-ink-4">
                  No matching tasks routed through {node.label} in the selected window.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {nodeTasks.map((t) => (
                    <div
                      key={t.task_id}
                      className="rounded-[10px] border border-line bg-well/40 p-2.5 transition-colors hover:border-line-strong"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectTask(t.task_id)}
                          className="min-w-0 flex-1 text-left text-xs font-medium text-ink hover:text-accent-text"
                        >
                          <span className="line-clamp-2">{t.title}</span>
                        </button>
                        <Badge variant="outline" className="shrink-0 font-mono text-[9.5px]">
                          {t.stage}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-ink-3">
                        <span className="truncate font-mono">
                          {t.task_id} · {t.board || "board"}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSelectTask(t.task_id)}
                            className="rounded px-1.5 py-0.5 font-medium text-accent-text hover:bg-accent-tint"
                          >
                            Trace
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenDrawer(t.task_id)}
                            className="rounded px-1.5 py-0.5 font-medium text-ink-2 hover:bg-well"
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Main GlobalFlowMap Component                                               */
/* -------------------------------------------------------------------------- */

export function GlobalFlowMap({
  open,
  renderDag,
}: {
  open: (id: string) => void;
  renderDag: (stages: DagStageItem[]) => ReactNode;
}) {
  const [boardFilter, setBoardFilter] = useState<string>("__all__");
  const [windowFilter, setWindowFilter] = useState<string>("smart");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [layerMode, setLayerMode] = useState<"topology" | "dag">("topology");
  const [query, setQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<FlowNodeId | null>("kanban");
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);

  const [view, setView] = useState<{ x: number; y: number; scale: number } | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<FlowNodeId, Point>>>({});
  const [dims, setDims] = useState({ w: 1000, h: 640 });
  const [panDelta, setPanDelta] = useState<Point | null>(null);
  const [expanded, setExpanded] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const nodeDragRef = useRef<{
    id: FlowNodeId;
    x: number;
    y: number;
    origin: Point;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const boardParam = boardFilter === "__all__" ? "" : boardFilter;

  const q = useQuery({
    queryKey: ["flow", boardParam, windowFilter],
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () => {
      const sp = new URLSearchParams();
      if (boardParam) sp.set("board_id", boardParam);
      if (windowFilter) sp.set("window", windowFilter);
      const qs = sp.toString();
      return api<FlowActiveResponse>(`/api/v1/flow/active${qs ? `?${qs}` : ""}`);
    },
  });

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) {
        setDims({
          w: Math.max(320, entry.contentRect.width),
          h: Math.max(420, entry.contentRect.height),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layerMode]);

  useEffect(() => {
    const onFs = () => setExpanded(document.fullscreenElement === canvasRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!replaying) return;
    const id = window.setTimeout(() => setReplaying(false), 14_000);
    return () => window.clearTimeout(id);
  }, [replaying]);

  const tasks = q.data?.tasks ?? [];
  const boards = q.data?.boards ?? [];
  const workers = q.data?.workers ?? [];

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (stageFilter !== "all" && t.stage !== stageFilter) return false;
      if (!needle) return true;
      const hay = `${t.title} ${t.task_id} ${t.board} ${t.executor} ${t.workspace ?? ""} ${t.node_id}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [tasks, stageFilter, query]);

  const liveCount = useMemo(
    () => tasks.filter((t) => ["running", "dispatched", "review"].includes(t.stage)).length,
    [tasks]
  );

  const positions = useMemo(() => ({ ...INITIAL_POS, ...overrides }), [overrides]);

  const fit = useMemo(() => {
    const scale = Math.min(1, (dims.w - 72) / GRAPH_W, (dims.h - 72) / GRAPH_H);
    const s = Math.max(0.36, scale);
    return {
      scale: s,
      x: (dims.w - GRAPH_W * s) / 2,
      y: (dims.h - GRAPH_H * s) / 2,
    };
  }, [dims]);

  const v = view ?? fit;
  const actualView = panDelta ? { ...v, x: panDelta.x, y: panDelta.y } : v;

  const zoomAt = useCallback(
    (factor: number) => {
      setView((base) => {
        const b = base ?? fit;
        const scale = clamp(b.scale * factor, 0.35, 2.0);
        const cx = dims.w / 2;
        const cy = dims.h / 2;
        return {
          scale,
          x: cx - ((cx - b.x) / b.scale) * scale,
          y: cy - ((cy - b.y) / b.scale) * scale,
        };
      });
    },
    [dims, fit]
  );

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: v.x, py: v.y };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPanDelta({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };

  const onCanvasPointerUp = () => {
    if (panDelta) {
      setView({ scale: v.scale, x: panDelta.x, y: panDelta.y });
    }
    setPanDelta(null);
    dragRef.current = null;
  };

  const onNodePointerDown = (e: ReactPointerEvent<HTMLButtonElement>, id: FlowNodeId) => {
    e.stopPropagation();
    nodeDragRef.current = {
      id,
      x: e.clientX,
      y: e.clientY,
      origin: positions[id],
      moved: false,
    };
  };

  const onNodePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = nodeDragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / actualView.scale;
    const dy = (e.clientY - d.y) / actualView.scale;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setOverrides((cur) => ({ ...cur, [d.id]: { x: d.origin.x + dx, y: d.origin.y + dy } }));
  };

  const onNodePointerUp = (id: FlowNodeId) => {
    const d = nodeDragRef.current;
    nodeDragRef.current = null;
    if (d?.moved) return;
    setFocusedTaskId(null);
    setSelectedNode((cur) => (cur === id ? cur : id));
  };

  const tracedTaskId = hoveredTaskId ?? focusedTaskId;
  const tracedTask = useMemo(
    () => (tracedTaskId ? visibleTasks.find((t) => t.task_id === tracedTaskId) ?? tasks.find((t) => t.task_id === tracedTaskId) ?? null : null),
    [tracedTaskId, visibleTasks, tasks]
  );

  const focusedTask = useMemo(
    () => (focusedTaskId ? visibleTasks.find((t) => t.task_id === focusedTaskId) ?? tasks.find((t) => t.task_id === focusedTaskId) ?? null : null),
    [focusedTaskId, visibleTasks, tasks]
  );

  const tracedNodes = useMemo(() => {
    if (!tracedTask) return new Set<FlowNodeId>();
    return new Set<FlowNodeId>(channelChain(tracedTask, true));
  }, [tracedTask]);

  const tracedEdges = useMemo(() => {
    const set = new Set<string>();
    if (!tracedTask) return set;
    const chain = channelChain(tracedTask, true);
    for (let i = 0; i < chain.length - 1; i++) {
      set.add(edgeKey(chain[i], chain[i + 1]));
    }
    return set;
  }, [tracedTask]);

  const activeEdgeKeys = useMemo(() => {
    const set = new Set<string>();
    for (const t of visibleTasks) {
      const chain = channelChain(t, replaying);
      for (let i = 0; i < chain.length - 1; i++) {
        set.add(edgeKey(chain[i], chain[i + 1]));
      }
    }
    return set;
  }, [visibleTasks, replaying]);

  const edgeGeometries = useMemo(
    () =>
      EDGES.map((edge) => {
        const { path, len } = anchor(edge.from, edge.to, positions);
        const key = edgeKey(edge.from, edge.to);
        return {
          ...edge,
          key,
          path,
          len,
          active: activeEdgeKeys.has(key),
          traced: tracedEdges.has(key),
        };
      }),
    [positions, activeEdgeKeys, tracedEdges]
  );

  const taskStations = useMemo(() => {
    const grouped = new Map<FlowNodeId, FlowTask[]>();
    for (const t of visibleTasks) {
      const st = stationedNodeFor(t);
      const list = grouped.get(st) ?? [];
      if (list.length < 4) {
        list.push(t);
        grouped.set(st, list);
      }
    }
    return [...grouped.entries()].flatMap(([nodeId, list]) => {
      const pts = taskCardPositions(list.length, positions[nodeId]);
      return list.map((task, idx) => ({ task, pos: pts[idx] }));
    });
  }, [visibleTasks, positions]);

  const nodeCounts = useMemo(() => {
    const counts = new Map<FlowNodeId, number>();
    for (const t of visibleTasks) {
      for (const n of channelChain(t, replaying)) {
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    return counts;
  }, [visibleTasks, replaying]);

  const workerStatsByNode = useMemo(() => {
    const out: Record<"mac" | "linux" | "windows", { online: number; total: number; latencyMs?: number }> = {
      mac: { online: 0, total: 0 },
      linux: { online: 0, total: 0 },
      windows: { online: 0, total: 0 },
    };
    for (const w of workers) {
      const m = w.machine === "mac" || w.machine === "windows" ? w.machine : "linux";
      out[m].total += 1;
      if (w.status === "connected" || w.status === "local") {
        out[m].online += 1;
        if (w.latency_ms && (!out[m].latencyMs || w.latency_ms < out[m].latencyMs!)) {
          out[m].latencyMs = w.latency_ms;
        }
      }
    }
    return out;
  }, [workers]);

  const minimapView = useMemo(() => {
    const left = clamp(-actualView.x / actualView.scale, 0, GRAPH_W);
    const top = clamp(-actualView.y / actualView.scale, 0, GRAPH_H);
    const right = clamp((-actualView.x + dims.w) / actualView.scale, 0, GRAPH_W);
    const bottom = clamp((-actualView.y + dims.h) / actualView.scale, 0, GRAPH_H);
    return {
      left,
      top,
      width: Math.max(24, right - left),
      height: Math.max(24, bottom - top),
    };
  }, [actualView, dims]);

  const selectedNodeObj = selectedNode ? NODE_MAP[selectedNode] : null;
  const selectedNodeTasks = useMemo(() => {
    if (!selectedNode) return [];
    return visibleTasks.filter((t) => channelChain(t, true).includes(selectedNode));
  }, [selectedNode, visibleTasks]);

  const dagStages: DagStageItem[] = useMemo(
    () =>
      visibleTasks.map((t) => ({
        id: t.task_id,
        name: `${t.board ? `${t.board}: ` : ""}${t.title}`,
        status: t.stage === "running" ? "in_progress" : t.status ?? "todo",
        depends_on:
          t.blocked_by && t.blocked_by.length > 0
            ? t.blocked_by
            : t.parent_id
              ? [t.parent_id]
              : [],
      })),
    [visibleTasks]
  );

  const toggleExpand = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void canvasRef.current?.requestFullscreen();
    }
  };

  const packetTasks = useMemo(
    () =>
      visibleTasks
        .filter((t) => replaying || t.stage === "running" || t.stage === "dispatched" || t.stage === "review")
        .slice(0, 20),
    [visibleTasks, replaying]
  );

  return (
    <div className="space-y-3">
      <div className="page-header page-header-stack">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="page-header-left">
            <div className="page-title-row">
              <h2>Flow map</h2>
              <Badge variant="outline" className="font-mono text-[10.5px] tabular-nums">
                {visibleTasks.length} visible
              </Badge>
              <Badge variant={liveCount > 0 ? "default" : "secondary"} className="font-mono text-[10.5px] tabular-nums">
                {liveCount} live
              </Badge>
              <Badge variant="secondary" className="font-mono text-[10.5px] tabular-nums">
                {boards.length} boards
              </Badge>
            </div>
            <p className="page-subtitle">
              Global real-time routing across all boards, meta7 pipelines, and remote worker hosts. Hover or click any pill to trace its route.
            </p>
          </div>

          <Segmented
            label="Flow map layer"
            value={layerMode}
            onChange={(m) => setLayerMode(m as "topology" | "dag")}
            options={[
              {
                value: "topology",
                label: (
                  <>
                    <Activity className="size-3.5" />
                    Topology &amp; Routing
                  </>
                ),
              },
              {
                value: "dag",
                label: (
                  <>
                    <Layers className="size-3.5" />
                    Dependency &amp; Pipeline DAG
                  </>
                ),
              },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "group relative flex h-8 min-w-[200px] flex-1 max-w-[280px] items-center rounded-[10px] border pr-2 pl-2.5 transition-[border-color,background-color,box-shadow] duration-150",
              query
                ? "border-accent/45 bg-surface shadow-[var(--lift-1)]"
                : "border-line bg-well/55 hover:border-line-strong hover:bg-surface"
            )}
          >
            <Search
              className={cn("size-3.5 shrink-0 transition-colors", query ? "text-accent-text" : "text-ink-3")}
              aria-hidden
            />
            <input
              ref={searchRef}
              aria-label="Search flow tasks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search tasks, boards, nodes…"
              className="field-flat ml-2 h-full w-full bg-transparent text-xs font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-4"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-well hover:text-ink"
              >
                <span aria-hidden className="text-[13px] leading-none">×</span>
              </button>
            ) : (
              <kbd className="hidden shrink-0 rounded-[5px] border border-line bg-surface px-1.5 py-0.5 font-mono text-[9px] text-ink-4 sm:inline">
                /
              </kbd>
            )}
          </div>

          <Select value={boardFilter} onValueChange={setBoardFilter}>
            <SelectTrigger size="sm" aria-label="Filter board" className="w-[180px]">
              <SelectValue placeholder="All boards" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All boards (Global)</SelectItem>
              {boards.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name} ({b.total})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={windowFilter} onValueChange={setWindowFilter}>
            <SelectTrigger size="sm" aria-label="Time window" className="w-[165px]">
              <SelectValue placeholder="Window" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="smart">Smart (Active + Recent)</SelectItem>
              <SelectItem value="30m">Live (30 min)</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="all">All history</SelectItem>
            </SelectContent>
          </Select>

          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger size="sm" aria-label="Stage filter" className="w-[140px]">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="dispatched">Dispatched</SelectItem>
              <SelectItem value="review">In review</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="sm"
            variant={replaying ? "signal" : "outline"}
            onClick={() => setReplaying((v) => !v)}
            disabled={visibleTasks.length === 0}
            title="Animate packet streams along all visible task routes"
          >
            {replaying ? <RotateCcw className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
            <span>{replaying ? "Replaying…" : "Replay Flow"}</span>
          </Button>
        </div>
      </div>

      <ErrorBox error={q.error} />

      {layerMode === "topology" ? (
        <div className="relative flex h-[640px] min-h-[540px] overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--lift-1)]">
          <div
            ref={canvasRef}
            className="flow-canvas-grid relative min-w-0 flex-1 select-none overflow-hidden"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                zoomAt(e.deltaY < 0 ? 1.12 : 0.89);
              }
            }}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: GRAPH_W,
                height: GRAPH_H,
                transform: `translate(${actualView.x}px, ${actualView.y}px) scale(${actualView.scale})`,
              }}
            >
              <svg className="pointer-events-none absolute inset-0" width={GRAPH_W} height={GRAPH_H}>
                <defs>
                  <filter id="flow-edge-glow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="4.5" />
                  </filter>
                </defs>
                {edgeGeometries.map((edge) => {
                  const dim = tracedTask && !edge.traced;
                  return (
                    <g key={edge.key}>
                      <path
                        d={edge.path}
                        fill="none"
                        stroke={edge.traced ? "var(--c-accent)" : edge.color}
                        strokeWidth={edge.traced ? 16 : edge.active ? 14 : 7}
                        opacity={dim ? 0.08 : edge.traced ? 0.55 : edge.active ? 0.42 : 0.22}
                        filter="url(#flow-edge-glow)"
                      />
                      <path
                        d={edge.path}
                        fill="none"
                        stroke={edge.traced ? "var(--c-accent)" : edge.color}
                        strokeWidth={edge.traced ? 4.5 : edge.active ? 3.5 : 2.25}
                        opacity={dim ? 0.2 : edge.traced ? 1 : edge.active ? 0.95 : 0.65}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Ambient idle pulses along each topology edge */}
              {edgeGeometries.map((edge, idx) => (
                <TravelingDot
                  key={`idle-${edge.key}`}
                  label={`${edge.from} → ${edge.to}`}
                  pathD={edge.path}
                  pathLen={edge.len}
                  phaseRatio={(idx * 0.19) % 1}
                  mode="idle"
                  color={edge.color}
                />
              ))}

              {/* Active / Replay streaming packets */}
              {packetTasks.flatMap((t, idx) => {
                const chain = channelChain(t, replaying || t.task_id === tracedTaskId);
                return chain.slice(0, -1).flatMap((from, hop) => {
                  const to = chain[hop + 1];
                  const g = edgeGeometries.find((e) => e.from === from && e.to === to);
                  if (!g) return [];
                  const isTraced = t.task_id === tracedTaskId;
                  return [0, 0.33, 0.66].map((offset) => (
                    <TravelingDot
                      key={`pkt-${t.task_id}-${g.key}-${offset}`}
                      label={`${t.title} (${t.stage})`}
                      pathD={g.path}
                      pathLen={g.len}
                      phaseRatio={(offset + idx * 0.13) % 1}
                      mode={isTraced ? "traced" : "active"}
                      color={STAGE_COLOR[t.stage] ?? g.color}
                    />
                  ));
                });
              })}

              {/* Highlighted packets specifically for a hovered/focused historical task */}
              {tracedTask &&
                !packetTasks.some((t) => t.task_id === tracedTask.task_id) &&
                channelChain(tracedTask, true)
                  .slice(0, -1)
                  .flatMap((from, hop, arr) => {
                    const to = arr[hop + 1];
                    const g = edgeGeometries.find((e) => e.from === from && e.to === to);
                    if (!g) return [];
                    return [0, 0.25, 0.5, 0.75].map((phase) => (
                      <TravelingDot
                        key={`trace-${tracedTask.task_id}-${g.key}-${phase}`}
                        label={tracedTask.title}
                        pathD={g.path}
                        pathLen={g.len}
                        phaseRatio={phase}
                        mode="traced"
                        color="var(--c-accent)"
                      />
                    ));
                  })}

              {/* Interactive System & Worker Nodes */}
              {NODES.map((node) => (
                <FlowNodeCard
                  key={node.id}
                  node={node}
                  count={nodeCounts.get(node.id) ?? 0}
                  meta={
                    node.id === "kanban" && boards.length > 0
                      ? `${boards.length} boards · ${tasks.length} tasks`
                      : undefined
                  }
                  selected={!focusedTask && selectedNode === node.id}
                  traced={tracedNodes.has(node.id)}
                  dimmed={!!tracedTask && !tracedNodes.has(node.id)}
                  workerStats={
                    node.id === "mac" || node.id === "linux" || node.id === "windows"
                      ? workerStatsByNode[node.id]
                      : undefined
                  }
                  onSelect={() => onNodePointerUp(node.id)}
                  onDragStart={(e) => onNodePointerDown(e, node.id)}
                  onDragMove={onNodePointerMove}
                  onDragCancel={() => {
                    nodeDragRef.current = null;
                  }}
                  style={{
                    left: positions[node.id].x - CARD_W / 2,
                    top: positions[node.id].y - CARD_H / 2,
                  }}
                />
              ))}

              {/* Orbiting Task Pills below stationed nodes */}
              {taskStations.map(({ task, pos }) => {
                const isFocused = focusedTaskId === task.task_id;
                const isHovered = hoveredTaskId === task.task_id;
                const tone = STAGE_COLOR[task.stage] ?? "var(--c-ink-3)";
                return (
                  <button
                    key={`pill-${task.task_id}`}
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseEnter={() => setHoveredTaskId(task.task_id)}
                    onMouseLeave={() => setHoveredTaskId((c) => (c === task.task_id ? null : c))}
                    onClick={() => {
                      setFocusedTaskId(task.task_id);
                      setSelectedNode(stationedNodeFor(task));
                    }}
                    title={`${task.title} · ${task.board || "Board"} (${task.stage})`}
                    className={cn(
                      "absolute z-20 flex h-5 max-w-[196px] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border bg-surface px-2 text-[10px] shadow-[var(--lift-1)] transition-[border-color,transform] duration-150",
                      isFocused || isHovered
                        ? "border-accent text-accent-text scale-105"
                        : "border-line-strong text-ink-2 hover:border-accent/60"
                    )}
                    style={{ left: pos.x, top: pos.y }}
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        task.stage === "running" && "animate-pulse"
                      )}
                      style={{ background: tone }}
                    />
                    <span className="truncate font-mono text-[9.5px] font-semibold">
                      {task.task_id}
                    </span>
                    <span className="truncate text-[9.5px] text-ink-3">{task.board || task.stage}</span>
                  </button>
                );
              })}
            </div>

            {/* Canvas Status Pill */}
            <div className="pointer-events-none absolute left-4 top-3 flex flex-wrap items-center gap-2 rounded-full border border-line bg-surface/90 px-3 py-1 text-[11px] text-ink-3 shadow-[var(--lift-1)] backdrop-blur-sm">
              {replaying ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-accent-text">
                  <Play className="size-3 fill-current" /> Replaying global routes
                </span>
              ) : visibleTasks.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 text-success-text" />
                  Drag canvas or nodes · Scroll with Ctrl/Cmd to zoom
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="size-3 text-warning-text" />
                  No tasks match filter — switch window to All history
                </span>
              )}
            </div>

            {/* Bottom-left Zoom & Fit Controls */}
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute bottom-4 left-4 flex items-center gap-0.5 rounded-[12px] border border-line bg-surface/95 p-1 shadow-[var(--lift-2)]"
            >
              <button type="button" aria-label="Zoom out" title="Zoom out" className="map-control" onClick={() => zoomAt(0.84)}>
                <ZoomOut className="size-3.5" />
              </button>
              <span className="w-10 text-center font-mono text-[10px] tabular-nums text-ink-3">
                {Math.round(actualView.scale * 100)}%
              </span>
              <button type="button" aria-label="Zoom in" title="Zoom in" className="map-control" onClick={() => zoomAt(1.18)}>
                <ZoomIn className="size-3.5" />
              </button>
              <button type="button" aria-label="Fit graph" title="Fit graph" className="map-control" onClick={() => setView(null)}>
                <Layers className="size-3.5" />
              </button>
              {Object.keys(overrides).length > 0 && (
                <button
                  type="button"
                  aria-label="Reset node positions"
                  title="Reset node positions"
                  className="map-control"
                  onClick={() => {
                    setOverrides({});
                    setView(null);
                  }}
                >
                  <RotateCcw className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                aria-label={expanded ? "Exit fullscreen" : "Expand map"}
                title={expanded ? "Exit fullscreen" : "Expand map"}
                className="map-control"
                onClick={toggleExpand}
              >
                {expanded ? <Minimize2 className="size-3.5" /> : <Expand className="size-3.5" />}
              </button>
            </div>

            {/* Interactive Minimap */}
            <button
              type="button"
              aria-label="Recenter map from minimap"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                setView({
                  scale: actualView.scale,
                  x: dims.w / 2 - (GRAPH_W / 2) * actualView.scale,
                  y: dims.h / 2 - (GRAPH_H / 2) * actualView.scale,
                })
              }
              className="absolute bottom-4 right-4 hidden rounded-[12px] border border-line bg-surface/95 p-2 shadow-[var(--lift-2)] md:block"
              style={{ width: MINIMAP_W, height: MINIMAP_H }}
            >
              <span className="relative block h-full w-full">
                <svg
                  viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label="Topology minimap"
                  className="h-full w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const scale = Math.min(rect.width / GRAPH_W, rect.height / GRAPH_H);
                    const ox = (rect.width - GRAPH_W * scale) / 2;
                    const oy = (rect.height - GRAPH_H * scale) / 2;
                    const gx = clamp((e.clientX - rect.left - ox) / scale, 0, GRAPH_W);
                    const gy = clamp((e.clientY - rect.top - oy) / scale, 0, GRAPH_H);
                    setView({
                      scale: actualView.scale,
                      x: dims.w / 2 - gx * actualView.scale,
                      y: dims.h / 2 - gy * actualView.scale,
                    });
                  }}
                >
                  {edgeGeometries.map((e) => (
                    <path
                      key={`mm-${e.key}`}
                      d={e.path}
                      fill="none"
                      stroke="var(--c-line-strong)"
                      strokeWidth={7}
                      strokeLinecap="round"
                    />
                  ))}
                  {NODES.map((n) => (
                    <rect
                      key={`mm-n-${n.id}`}
                      x={positions[n.id].x - CARD_W / 2}
                      y={positions[n.id].y - CARD_H / 2}
                      width={CARD_W}
                      height={CARD_H}
                      rx={14}
                      fill={n.hue}
                      fillOpacity={selectedNode === n.id ? 1 : 0.55}
                    />
                  ))}
                  <rect
                    x={minimapView.left}
                    y={minimapView.top}
                    width={minimapView.width}
                    height={minimapView.height}
                    rx={10}
                    fill="var(--c-accent-tint)"
                    stroke="var(--c-accent)"
                    strokeWidth={4}
                  />
                </svg>
                <span className="pointer-events-none absolute bottom-0 right-1 font-mono text-[8px] tracking-[0.14em] text-ink-4">
                  MINIMAP
                </span>
              </span>
            </button>
          </div>

          <RouteInspector
            node={selectedNodeObj}
            focusedTask={focusedTask}
            nodeTasks={selectedNodeTasks}
            boards={boards}
            workers={workers}
            onClearTask={() => setFocusedTaskId(null)}
            onSelectTask={(id) => setFocusedTaskId(id)}
            onReplayTask={(id) => {
              setFocusedTaskId(id);
              setReplaying(true);
            }}
            onOpenDrawer={open}
            onClose={() => {
              setFocusedTaskId(null);
              setSelectedNode(null);
            }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {dagStages.length ? (
            <div
              className="dot-canvas shadow-[var(--lift-1)]"
              onClick={(e) => {
                const g = (e.target as Element).closest("g");
                const i = g && [...g.parentElement!.querySelectorAll("g")].indexOf(g);
                if (i !== null && i !== undefined && i >= 0) open(dagStages[i].id);
              }}
            >
              {renderDag(dagStages)}
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-line-strong bg-surface/75 p-6 text-center">
              <p className="muted m-0 text-xs">
                No tasks match the current global filters.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
