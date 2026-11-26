import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Columns3,
  Copy,
  Cpu,
  ExternalLink,
  FolderGit2,
  GitPullRequest,
  GripVertical,
  HelpCircle,
  Inbox,
  LayoutGrid,
  ListTodo,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Table2,
  Trash2,
  Workflow,
} from "@/components/ui/icons";
import {
  api,
  apiOr,
  del,
  getSavedBoardId,
  LIVE_FALLBACK_MS,
  NEXT,
  parseModelCatalog,
  patch,
  post,
  setSavedBoardId,
  STATUSES,
  type Board,
  type Status,
  type Task,
  type Workspace,
} from "./api";
import { OsIcon, StatusBadge } from "@/components/board/taskDetailParts";
import { RunningIndicator } from "@/components/board/AgentStatus";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { TaskQuestionCard } from "@/components/board/TaskQuestionCard";
import { WorkflowTree } from "@/components/studio/WorkflowTree";
import { BOARD_EMOJI_PRESETS, BoardEmojiTile } from "@/components/studio/StudioAssets";
import { StudioPageHeader } from "@/components/studio/StudioPageHeader";
import { ErrorBox, LABEL, StatusHeaderPill, statusColor } from "./ui";
import { fmtDateTime, initials, relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  FilterBar,
  type Filter,
  type FilterFieldDef,
  type FilterOption,
} from "@/components/ui/filter-token-bar";
import { Segmented } from "@/components/ui/segmented";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Tip } from "@/components/ui/tooltip";
import { toast, toastError } from "@/components/ui/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EXECUTORS, TaskDialog, type StartMode } from "@/components/board/TaskDialog";
import { EXECUTOR_LABELS, useExecutorConfig } from "@/lib/executors";
import { isPipelinesEnabled } from "@/lib/features";

export { EXECUTORS, TaskDialog, TaskDialog as CreateTask };

const COLLAPSIBLE_EMPTY_STATUSES = new Set<Status>(["backlog", "blocked", "failed"]);

const EMPTY_COPY: Record<Status, { title: string; hint: string }> = {
  backlog: { title: "Backlog is clear", hint: "Triaged ideas and low-priority items park here." },
  todo: { title: "Nothing queued", hint: "Tasks in Todo are ready for agent dispatch." },
  blocked: { title: "Nothing blocked", hint: "Tasks waiting on dependencies land here." },
  in_progress: { title: "No active runs", hint: "Dispatched tasks appear here while a worker executes." },
  waiting_input: { title: "No open questions", hint: "Tasks waiting on your Grill-Me or clarification answer appear here." },
  review: { title: "Nothing in review", hint: "Completed runs wait here for diff approval." },
  done: { title: "Nothing done yet", hint: "Approved tasks are collected here." },
  failed: { title: "No failed tasks", hint: "Tasks exceeding max retries stop here." },
};

const EMPTY_ICONS: Record<Status, React.ComponentType<{ className?: string }>> = {
  backlog: Inbox,
  todo: ListTodo,
  blocked: ShieldAlert,
  in_progress: Cpu,
  waiting_input: HelpCircle,
  review: GitPullRequest,
  done: CheckCircle2,
  failed: AlertCircle,
};

const REVIEW_WIP_LIMIT = 5;
const MAX_RETRY_DISPLAY = 3;

const EFFORT_META: Record<string, { dot: string; label: string }> = {
  high: { dot: "bg-red-500", label: "Priority: High effort" },
  medium: { dot: "bg-blue-500", label: "Priority: Medium effort" },
  low: { dot: "bg-slate-500", label: "Priority: Low effort" },
};

function formatAgentTag(executor?: string, model?: string): string {
  const exec = executor || "default";
  if (!model) return exec;
  const shortModel = model.includes("/") ? model.split("/").pop() || model : model;
  return `${exec} · ${shortModel}`;
}

function formatWorkspaceTag(workspace: string): string {
  const leaf = workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
  if (leaf.length <= 16) return leaf;
  return `${leaf.slice(0, 14)}…`;
}

/** Columns that can receive a brand-new task directly. */
const QUICK_ADD: Partial<Record<Status, StartMode>> = {
  backlog: "manual",
  todo: "queue",
};

function taskFieldValue(t: Task, field: string): string {
  switch (field) {
    case "status":
      return t.status;
    case "executor":
      return t.executor || "default";
    case "workspace":
      return t.workspace || "";
    case "model":
      return t.model || "default";
    default:
      return "";
  }
}

function matchesFilter(t: Task, filter: Filter): boolean {
  if (!filter.values.length) return true;
  const value = taskFieldValue(t, filter.field);
  switch (filter.operator) {
    case "is_not":
      return value !== filter.values[0];
    case "is_any":
      return filter.values.includes(value);
    case "is_none":
      return !filter.values.includes(value);
    default:
      return value === filter.values[0];
  }
}

function matchesFilters(t: Task, filters: Filter[]): boolean {
  return filters.every((f) => matchesFilter(t, f));
}

export const EFFORTS = ["", "low", "medium", "high"];

export function useBoards() {
  return useQuery({ queryKey: ["boards"], queryFn: () => api<Board[]>("/api/v1/boards") });
}

export function useBoardId() {
  const b = useBoards();
  const [selected, setSelected] = useState<string>(getSavedBoardId);

  useEffect(() => {
    const onSwitch = (e: Event) => {
      const id = (e as CustomEvent<string>).detail ?? getSavedBoardId();
      setSelected(id);
    };
    window.addEventListener("switchyard:board", onSwitch);
    return () => window.removeEventListener("switchyard:board", onSwitch);
  }, []);

  const list = b.data ?? [];
  const activeBoard = list.find((x) => x.id === selected) ?? list[0];
  const boardId = activeBoard?.id;

  const setBoardId = (id: string) => {
    setSelected(id);
    setSavedBoardId(id);
  };

  return { boardId, activeBoard, boards: b, setBoardId };
}

export function BoardScreen({
  open,
  onNewBoard,
  onEditBoard,
}: {
  open: (id: string) => void;
  onNewBoard?: () => void;
  onEditBoard?: (b: Board) => void;
}) {
  const qc = useQueryClient();
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();

  const tasks = useQuery({
    queryKey: ["tasks", boardId],
    enabled: !!boardId,
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () => api<Task[]>(`/api/v1/boards/${boardId}/tasks`),
  });

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiOr<Workspace[]>("/api/v1/workspaces", []),
  });

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: Status }) => post(`/api/v1/tasks/${id}/move`, { status: to }),
    // Show the card in the target column immediately; roll back if the
    // server rejects the transition (status machine / dependency block).
    onMutate: async ({ id, to }) => {
      await qc.cancelQueries({ queryKey: ["tasks", boardId] });
      const previous = qc.getQueryData<Task[]>(["tasks", boardId]);
      qc.setQueryData<Task[]>(["tasks", boardId], (list = []) =>
        list.map((t) => (t.id === id ? { ...t, status: to, updated_at: Date.now() / 1000 } : t))
      );
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["tasks", boardId], ctx.previous);
      toastError(e, "Could not move task");
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast(`Moved to ${LABEL[vars.to] ?? vars.to}`, { tone: "success" });
    },
  });

  const dispatch = useMutation({
    mutationFn: (id: string) => post(`/api/v1/tasks/${id}/dispatch`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Task dispatched", { tone: "success" });
    },
    onError: (e) => toastError(e, "Dispatch failed"),
  });

  const retryTask = useMutation({
    mutationFn: (id: string) => post(`/api/v1/tasks/${id}/retry`, { dispatch_now: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast("Task requeued & retrying", { tone: "success" });
    },
    onError: (e) => toastError(e, "Retry failed"),
  });

  const runBoardTasks = useMutation({
    mutationFn: async (taskIds: string[]) => {
      await Promise.all(taskIds.map((id) => post(`/api/v1/tasks/${id}/dispatch`)));
      return taskIds.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast(`Dispatched ${count} queued task${count === 1 ? "" : "s"}`, { tone: "success" });
    },
    onError: (e) => toastError(e, "Failed to dispatch board tasks"),
  });

  const runBoardMeta7 = useMutation({
    mutationFn: () =>
      post<{ id: string }>("/api/v1/pipelines", {
        template: "meta7",
        board_id: boardId,
        include_board_tasks: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast("meta7 board run started", {
        tone: "success",
        description: "Coordinating eligible board tasks — open Pipelines to watch the state graph.",
      });
    },
    onError: (e) => toastError(e, "Failed to run board with meta7"),
  });

  const runTaskMeta7 = useMutation({
    mutationFn: (t: {
      id: string;
      title: string;
      prompt?: string;
      acceptance?: string;
      workspace?: string;
      branch?: string;
      executor?: string;
      model?: string;
      effort?: string;
      paths?: string[];
      skills?: string[];
    }) =>
      post<{ id: string }>("/api/v1/pipelines", {
        template: "meta7",
        board_id: boardId,
        goal: t.title,
        context: [t.prompt, t.acceptance ? `Acceptance:\n${t.acceptance}` : ""]
          .filter(Boolean)
          .join("\n\n"),
        workspace: t.workspace ?? "",
        branch: t.branch ?? "",
        executor: t.executor ?? "",
        model: t.model ?? "",
        effort: t.effort ?? "",
        context_paths: t.paths,
        skills: t.skills,
        source_task_ids: [t.id],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast("meta7 pipeline launched for task", {
        tone: "success",
        description: "Open Pipelines to inspect artifacts and the state graph.",
      });
    },
    onError: (e) => toastError(e, "Failed to launch meta7"),
  });

  const [over, setOver] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [boardAtEnd, setBoardAtEnd] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"board" | "table" | "lanes">("board");
  const [creating, setCreating] = useState<{ startMode: StartMode } | null>(null);
  const [boardModal, setBoardModal] = useState<"new" | "edit" | null>(null);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<Status>>(() => new Set());
  const toggleColExpanded = (s: Status) =>
    setExpandedCols((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const mk = useMutation({
    mutationFn: () => post<Board>("/api/v1/boards", { name: "Main" }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      if (created?.id) setBoardId(created.id);
    },
  });

  const allTasks = tasks.data ?? [];

  const nextTodoTask = useMemo(
    () => allTasks.find((t) => t.status === "todo" && t.execution_mode !== "tracker"),
    [allTasks]
  );

  const updateBoardScrollEnd = () => {
    const el = boardRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth + 2) {
      setBoardAtEnd(true);
      return;
    }
    const remaining = el.scrollWidth - el.clientWidth - el.scrollLeft;
    setBoardAtEnd(remaining <= 12);
  };

  useEffect(() => {
    updateBoardScrollEnd();
    window.addEventListener("resize", updateBoardScrollEnd);
    return () => window.removeEventListener("resize", updateBoardScrollEnd);
  }, [viewMode, allTasks.length]);

  const eligibleDispatchTasks = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          t.status === "todo" &&
          t.execution_mode !== "tracker" &&
          !t.run_id &&
          !t.parent_id &&
          !t.title.startsWith("[pipeline]")
      ),
    [allTasks]
  );

  const eligibleMeta7Tasks = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          (t.status === "todo" || t.status === "backlog") &&
          !t.run_id &&
          !t.parent_id &&
          !t.title.startsWith("[pipeline]")
      ),
    [allTasks]
  );

  const executorsOnBoard = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTasks) s.add(t.executor || "default");
    return Array.from(s);
  }, [allTasks]);

  const workspacesOnBoard = useMemo(() => {
    const map = new Map<string, { path: string; label: string; count: number }>();
    for (const t of allTasks) {
      const path = t.workspace || "";
      if (!path) continue;
      const label = path.split(/[\\/]/).filter(Boolean).pop() || path;
      const cur = map.get(path);
      if (cur) cur.count += 1;
      else map.set(path, { path, label, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allTasks]);

  const modelsOnBoard = useMemo(() => {
    const map = new Map<string, { value: string; label: string; count: number }>();
    for (const t of allTasks) {
      const m = t.model || "default";
      const cur = map.get(m);
      if (cur) cur.count += 1;
      else map.set(m, { value: m, label: m === "default" ? "Default" : m, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allTasks]);

  const filterFields = useMemo<FilterFieldDef[]>(() => {
    const statusOptions: FilterOption[] = STATUSES.map((s) => ({
      value: s,
      label: LABEL[s] ?? s,
      glyph: (
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ background: statusColor(s) }}
        />
      ),
      count: allTasks.filter((t) => t.status === s).length,
    }));
    const executorOptions: FilterOption[] = executorsOnBoard.map((ex) => ({
      value: ex,
      label: ex === "default" ? "Default" : ex,
      glyph: <Cpu className="size-3" />,
      count: allTasks.filter((t) => (t.executor || "default") === ex).length,
    }));
    const workspaceOptions: FilterOption[] = workspacesOnBoard.map((w) => ({
      value: w.path,
      label: w.label,
      glyph: <FolderGit2 className="size-3" />,
      count: w.count,
    }));
    const modelOptions: FilterOption[] = modelsOnBoard.map((m) => ({
      value: m.value,
      label: m.label,
      glyph: <Cpu className="size-3" />,
      count: m.count,
    }));
    const base = [
      { value: "is", label: "is" },
      { value: "is_not", label: "is not" },
      { value: "is_any", label: "is any of", multi: true },
      { value: "is_none", label: "is none of", multi: true },
    ];
    return [
      {
        id: "status",
        label: "Status",
        icon: <CircleDot className="size-3" />,
        operators: base,
        options: statusOptions,
      },
      {
        id: "executor",
        label: "Executor",
        icon: <Cpu className="size-3" />,
        operators: base,
        options: executorOptions,
      },
      ...(workspaceOptions.length
        ? [
            {
              id: "workspace",
              label: "Workspace",
              icon: <FolderGit2 className="size-3" />,
              operators: base,
              options: workspaceOptions,
            },
          ]
        : []),
      ...(modelOptions.length
        ? [
            {
              id: "model",
              label: "Model",
              icon: <Cpu className="size-3" />,
              operators: base,
              options: modelOptions,
            },
          ]
        : []),
    ];
  }, [allTasks, executorsOnBoard, workspacesOnBoard, modelsOnBoard]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (!matchesFilters(t, filters)) return false;
      if (!needle) return true;
      return (
        t.title.toLowerCase().includes(needle) ||
        (t.prompt || "").toLowerCase().includes(needle) ||
        t.id.toLowerCase().includes(needle) ||
        (t.workspace || "").toLowerCase().includes(needle)
      );
    });
  }, [allTasks, q, filters]);

  // "/" focuses the board search, like the command palette's ⌘K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkMove(to: Status) {
    const ids = Array.from(selected);
    const results = await Promise.allSettled(ids.map((id) => post(`/api/v1/tasks/${id}/move`, { status: to })));
    const failed = results.filter((r) => r.status === "rejected").length;
    setSelected(new Set());
    await qc.invalidateQueries({ queryKey: ["tasks"] });
    if (failed) toast(`${failed} of ${ids.length} moves failed`, { tone: "error" });
    else toast(`Moved ${ids.length} task${ids.length === 1 ? "" : "s"} to ${LABEL[to] ?? to}`, { tone: "success" });
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    const results = await Promise.allSettled(ids.map((id) => del(`/api/v1/tasks/${id}`)));
    const failed = results.filter((r) => r.status === "rejected").length;
    setSelected(new Set());
    await qc.invalidateQueries({ queryKey: ["tasks"] });
    if (failed) toast(`${failed} deletions failed`, { tone: "error" });
    else toast(`Deleted ${ids.length} task${ids.length === 1 ? "" : "s"}`, { tone: "info" });
  }

  if (boards.isSuccess && !boardId) {
    return (
      <div style={{ padding: 24 }}>
        <div className="panel" style={{ maxWidth: 440, margin: "8vh auto", textAlign: "center" }}>
          <h3>No board yet</h3>
          <p className="muted">Create your first Switchyard board to start queuing and dispatching agent tasks.</p>
          <div className="bar" style={{ justifyContent: "center", marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" onClick={() => mk.mutate()}>
              Create board
            </button>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      <StudioPageHeader
        leading={(boards.data?.length ?? 0) <= 1 && activeBoard ? <BoardEmojiTile board={activeBoard} size={26} /> : undefined}
        title={
          (boards.data?.length ?? 0) > 1 ? (
            <BoardSwitcher
              boards={boards.data}
              value={boardId}
              onChange={setBoardId}
              showTriggerBadge={false}
              triggerClassName="h-8 rounded-[9px] border-transparent bg-transparent px-2 text-[15px] font-semibold hover:border-line hover:bg-well"
              className="w-auto min-w-[160px] max-w-[240px]"
            />
          ) : (
            <h2 className="m-0 truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">
              {activeBoard ? activeBoard.name : "Board"}
            </h2>
          )
        }
        count={
          filtered.length === allTasks.length
            ? `${allTasks.length} ${allTasks.length === 1 ? "task" : "tasks"}`
            : `${filtered.length} / ${allTasks.length} tasks`
        }
        center={
          <Segmented
            label="Board view mode"
            value={viewMode}
            onChange={setViewMode}
            options={[
              {
                value: "board",
                label: (
                  <>
                    <Columns3 className="size-3" />
                    Board
                  </>
                ),
              },
              {
                value: "table",
                label: (
                  <>
                    <Table2 className="size-3" />
                    Table
                  </>
                ),
              },
              {
                value: "lanes",
                label: (
                  <>
                    <LayoutGrid className="size-3" />
                    Lanes
                  </>
                ),
              },
            ]}
          />
        }
        actions={
          <>
            {isPipelinesEnabled()
              ? eligibleMeta7Tasks.length > 0 && (
                  <Tip label="Coordinate all eligible todo/backlog tasks on this board into a meta7 pipeline">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => runBoardMeta7.mutate()}
                      disabled={!boardId || runBoardMeta7.isPending}
                    >
                      <Workflow className="size-3.5 text-[var(--status-progress)]" />
                      <span>Run board ({eligibleMeta7Tasks.length})</span>
                    </button>
                  </Tip>
                )
              : eligibleDispatchTasks.length > 0 && (
                  <Tip label="Dispatch all queued Todo tasks on this board to active workers">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => runBoardTasks.mutate(eligibleDispatchTasks.map((t) => t.id))}
                      disabled={!boardId || runBoardTasks.isPending}
                    >
                      <Play className="size-3.5 text-[var(--status-progress)]" />
                      <span>Run board ({eligibleDispatchTasks.length})</span>
                    </button>
                  </Tip>
                )}

            <button
              className="btn studio-scenic-cta sm"
              onClick={() => setCreating({ startMode: "queue" })}
              disabled={!boardId}
            >
              <Plus className="size-3.5" />
              <span>New task</span>
            </button>
          </>
        }
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2" role="search" aria-label="Filter tasks">
            <div
              className={cn(
                "group relative flex h-7 w-[220px] items-center rounded-[9px] border pr-2 pl-2.5 transition-[border-color,background-color] duration-150",
                q
                  ? "border-accent/45 bg-surface"
                  : "border-line bg-well/65 hover:border-line-strong hover:bg-surface"
              )}
            >
              <Search
                className={cn("size-3.5 shrink-0 transition-colors", q ? "text-accent-text" : "text-ink-4")}
                aria-hidden
              />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQ("");
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Search tasks, prompts, IDs…"
                aria-label="Search tasks"
                className="field-flat ml-2 h-full w-full bg-transparent text-xs font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-4"
              />
              {q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label="Clear search"
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-well hover:text-ink"
                >
                  <span aria-hidden className="text-[12px] leading-none">×</span>
                </button>
              ) : (
                <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
                  <kbd className="rounded-[4px] border border-line bg-surface px-1 py-0.5 font-mono text-[9px] text-ink-4">
                    /
                  </kbd>
                  <kbd className="rounded-[4px] border border-line bg-surface px-1 py-0.5 font-mono text-[9px] text-ink-4">
                    ⌘K
                  </kbd>
                </span>
              )}
            </div>

            <FilterBar
              fields={filterFields}
              value={filters}
              onChange={setFilters}
              addLabel="Filter"
              emptyLabel="Add filter"
              aria-label="Task filters"
            />

            <div className="bar-spacer" />

            <button
              type="button"
              className={cn(
                "btn sm",
                bulkMode && "border-accent bg-accent-tint text-accent-text"
              )}
              aria-pressed={bulkMode}
              onClick={() => {
                setBulkMode((v) => !v);
                setSelected(new Set());
              }}
            >
              <CheckCircle2 className="size-3" />
              Bulk select
            </button>
          </div>
        }
      />

      {bulkMode && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-4 py-1.5">
          <span className="tabular text-xs font-semibold text-ink">
            {selected.size} selected
          </span>
          <span className="text-ink-4">·</span>
          <button className="btn sm" disabled={!selected.size} onClick={() => void bulkMove("todo")}>
            Move to Todo
          </button>
          <button className="btn sm" disabled={!selected.size} onClick={() => void bulkMove("backlog")}>
            Move to Backlog
          </button>
          <button className="btn sm" disabled={!selected.size} onClick={() => void bulkMove("blocked")}>
            Block
          </button>
          <button className="btn sm danger" disabled={!selected.size} onClick={() => void bulkDelete()}>
            <Trash2 className="size-3" />
            Delete
          </button>
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div style={{ padding: "0 24px" }}>
        <ErrorBox error={tasks.error ?? move.error ?? boards.error ?? dispatch.error ?? runBoardMeta7.error ?? runTaskMeta7.error} />
      </div>

      {creating && boardId && (
        <TaskDialog
          boardId={boardId}
          board={activeBoard}
          candidates={allTasks}
          initialStartMode={creating.startMode}
          onClose={() => setCreating(null)}
          onCreated={(t) => open(t.id)}
        />
      )}

      {boardModal === "new" && (
        <BoardDialog
          mode="new"
          onClose={() => setBoardModal(null)}
          onSaved={(b) => {
            setBoardModal(null);
            if (b?.id) setBoardId(b.id);
          }}
        />
      )}

      {boardModal === "edit" && activeBoard && (
        <BoardDialog
          mode="edit"
          board={activeBoard}
          onClose={() => setBoardModal(null)}
          onSaved={() => setBoardModal(null)}
          onDeleted={() => {
            setBoardModal(null);
            const remaining = (boards.data ?? []).filter((x) => x.id !== activeBoard.id);
            setBoardId(remaining[0]?.id ?? "");
          }}
        />
      )}

      {viewMode === "board" && (
        <div className="board-scroller">
          <div
            ref={boardRef}
            className={cn("board board-scroll", boardAtEnd && "at-end")}
            data-dragging={draggingId ? "true" : undefined}
            onScroll={updateBoardScrollEnd}
          >
            {STATUSES.map((s) => {
              const colTasks = filtered.filter((t) => t.status === s);
              const copy = EMPTY_COPY[s];
              const quickAdd = QUICK_ADD[s];
              const isReviewBottleneck = s === "review" && colTasks.length >= REVIEW_WIP_LIMIT;
              const isCollapsibleEmpty = COLLAPSIBLE_EMPTY_STATUSES.has(s) && colTasks.length === 0;
              const isCollapsed = isCollapsibleEmpty && !expandedCols.has(s);
              if (isCollapsed) {
                return (
                  <div
                    key={s}
                    className={cn("col glass-column items-center justify-start px-1.5 py-3", over === s && "over")}
                    data-status={s}
                    data-collapsed="true"
                    style={{ ["--lamp" as string]: statusColor(s), width: "44px", minWidth: "44px", maxWidth: "44px" }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOver(s);
                    }}
                    onDragLeave={() => setOver("")}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOver("");
                      setDraggingId(null);
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) move.mutate({ id, to: s });
                    }}
                  >
                    <Tip label={`Expand ${LABEL[s]} column (empty)`}>
                      <button
                        type="button"
                        onClick={() => toggleColExpanded(s)}
                        aria-label={`Expand ${LABEL[s]} column`}
                        className="flex h-full w-full flex-col items-center gap-2 rounded-lg py-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--glass-2)] hover:text-[var(--text-primary)]"
                      >
                        <span className="col-count">0</span>
                        <span
                          className="select-none text-[11px] font-semibold tracking-wide"
                          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                        >
                          <StatusHeaderPill status={s} />
                        </span>
                      </button>
                    </Tip>
                  </div>
                );
              }
              return (
                <div
                  key={s}
                  className={cn("col glass-column", over === s && "over")}
                  data-status={s}
                  data-wip-exceeded={isReviewBottleneck || undefined}
                  style={{ ["--lamp" as string]: statusColor(s) }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(s);
                  }}
                  onDragLeave={() => setOver("")}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver("");
                    setDraggingId(null);
                    const id = e.dataTransfer.getData("text/plain");
                    if (id) move.mutate({ id, to: s });
                  }}
                >
                  <div className="col-header">
                    <h3>
                      <StatusHeaderPill status={s} />
                      <span className="col-count">{colTasks.length}</span>
                      {isCollapsibleEmpty && (
                        <Tip label={`Collapse ${LABEL[s]} column`}>
                          <button
                            type="button"
                            onClick={() => toggleColExpanded(s)}
                            aria-label={`Collapse ${LABEL[s]} column`}
                            className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--glass-3)] hover:text-[var(--text-primary)]"
                          >
                            Hide
                          </button>
                        </Tip>
                      )}
                      {s === "review" && (
                        <Tip
                          label={
                            isReviewBottleneck
                              ? `Bottleneck: ${colTasks.length} tasks in review (WIP limit ${REVIEW_WIP_LIMIT})`
                              : `Review WIP limit: ${REVIEW_WIP_LIMIT} tasks`
                          }
                        >
                          <span
                            data-testid="review-wip-badge"
                            className={cn(
                              "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                              isReviewBottleneck
                                ? "border-[var(--status-review-border)] bg-[var(--status-review-bg)] text-[var(--status-review)]"
                                : "border-[var(--glass-border-soft)] bg-[var(--glass-2)] text-[var(--text-muted)]"
                            )}
                          >
                            {isReviewBottleneck && (
                              <AlertTriangle color="currentColor" className="size-2.5 shrink-0" aria-hidden />
                            )}
                            {colTasks.length}/{REVIEW_WIP_LIMIT} WIP
                          </span>
                        </Tip>
                      )}
                      {quickAdd && (
                        <Tip label={`Add task to ${LABEL[s]}`}>
                          <button
                            type="button"
                            onClick={() => setCreating({ startMode: quickAdd })}
                            aria-label={`Add task to ${LABEL[s]}`}
                            className="col-quick-btn inline-flex items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--glass-3)] hover:text-[var(--text-primary)]"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </Tip>
                      )}
                    </h3>
                    <div className="track-line" />
                  </div>

                  <div className="col-well">
                    {colTasks.length === 0 ? (
                      s === "in_progress" ? (
                        <div className="col-empty justify-start pt-4">
                          <div className="flex w-full flex-col items-center rounded-[14px] border border-dashed border-[var(--glass-border)] bg-[var(--glass-2)] px-3 py-5 text-center">
                            <Cpu color="currentColor" className="mb-1.5 size-5 text-[var(--status-progress)] opacity-75" />
                            <strong className="text-[12px] text-[var(--text-primary)]">{copy.title}</strong>
                            <span className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                              {copy.hint}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (nextTodoTask) dispatch.mutate(nextTodoTask.id);
                                else setCreating({ startMode: "queue" });
                              }}
                              disabled={dispatch.isPending}
                              className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-[12px] border border-[var(--glass-btn-primary-border)] bg-[var(--glass-btn-primary-bg)] px-3 text-[11px] font-semibold text-[var(--glass-btn-primary-ink)] shadow-[var(--glass-shadow-sm)] transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              <Play color="currentColor" className="size-2.5 fill-current" />
                              <span>Run next task</span>
                            </button>
                            <span className="mt-1.5 text-[10.5px] text-[var(--text-muted)]">
                              or drag a task card here
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="col-empty">
                          {(() => {
                            const Icon = EMPTY_ICONS[s];
                            return <Icon className="mb-1 size-5 text-[var(--lamp)] opacity-50" />;
                          })()}
                          <strong className="text-[var(--text-primary)]">{copy.title}</strong>
                          <span>{copy.hint}</span>
                          {quickAdd && (
                            <button
                              type="button"
                              onClick={() => setCreating({ startMode: quickAdd })}
                              className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-[12px] border border-[var(--glass-border)] bg-[var(--glass-3)] px-2.5 text-[11px] font-semibold text-[var(--text-primary)] shadow-[var(--glass-shadow-sm)] transition-colors hover:bg-surface"
                            >
                              <Plus className="size-3" />
                              Add task
                            </button>
                          )}
                        </div>
                      )
                    ) : (
                      colTasks.map((t) => {
                        const isSel = selected.has(t.id);
                        const firstLine = (t.prompt || "").split("\n").find((l) => l.trim())?.trim() ?? "";
                        const fullAgentLabel = `${t.executor || "default"}${t.model ? ` · ${t.model}` : ""}`;
                        const shortAgentLabel = formatAgentTag(t.executor, t.model);
                        const shortWsLabel = t.workspace ? formatWorkspaceTag(t.workspace) : "";
                        const effortMeta = t.effort ? EFFORT_META[t.effort] : undefined;
                        const assignee = (t as Task & { assignee?: string }).assignee;

                        return (
                          <div
                            key={t.id}
                            className={cn("card glass-card group", draggingId === t.id && "is-dragging")}
                            data-status={t.status}
                            data-selected={isSel || undefined}
                            style={{ ["--lamp" as string]: statusColor(t.status) }}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", t.id);
                              setDraggingId(t.id);
                            }}
                            onDragEnd={() => setDraggingId(null)}
                            onClick={() => (bulkMode ? toggleSelect(t.id) : open(t.id))}
                          >
                            <span aria-hidden className="card-coupler" />

                            {/* Card top telemetry bar */}
                            <div className="mb-1.5 flex min-h-[20px] items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <GripVertical
                                  className="size-3.5 shrink-0 cursor-grab text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-75 active:cursor-grabbing"
                                  aria-hidden
                                />
                                {bulkMode && (
                                  <input
                                    type="checkbox"
                                    checked={isSel}
                                    onChange={() => toggleSelect(t.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ width: 14, height: 14 }}
                                    aria-label={`Select ${t.title}`}
                                  />
                                )}
                                <Tip label={`Click to copy ${t.id}`}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void navigator.clipboard?.writeText(t.id);
                                      toast("Task id copied", { tone: "info", description: t.id });
                                    }}
                                    aria-label={`Copy task id ${t.id}`}
                                    className="truncate font-mono text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                                  >
                                    {t.id}
                                  </button>
                                </Tip>
                                {t.execution_mode === "tracker" && (
                                  <Tip label="Passive MCP monitor card (skipped by dispatcher)">
                                    <span className="badge">monitor</span>
                                  </Tip>
                                )}
                                {t.question?.status === "pending" && (
                                  <Tip label={t.question.question}>
                                    <span className="badge review inline-flex items-center gap-0.5">
                                      <HelpCircle className="size-2.5" />
                                      question
                                    </span>
                                  </Tip>
                                )}
                                {t.run_id && <span className="badge review">pipeline</span>}
                              </div>

                              {!bulkMode && (
                                <Menu
                                  label={`Actions for ${t.title}`}
                                  trigger={
                                    <button
                                      type="button"
                                      aria-label={`Actions for ${t.title}`}
                                      className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-muted)] opacity-0 transition-[opacity,background-color,transform] duration-100 ease-[var(--ease-out-expo)] hover:bg-well hover:text-[var(--text-primary)] active:scale-95 group-hover:opacity-100 focus-visible:opacity-100"
                                    >
                                      <MoreHorizontal className="size-3.5" />
                                    </button>
                                  }
                                >
                                  <MenuLabel>Task</MenuLabel>
                                  <MenuItem icon={ExternalLink} onSelect={() => open(t.id)}>
                                    Open details
                                  </MenuItem>
                                  <MenuItem
                                    icon={Copy}
                                    onSelect={() => {
                                      void navigator.clipboard?.writeText(t.id);
                                      toast("Task id copied", { tone: "info", description: t.id });
                                    }}
                                  >
                                    Copy id
                                  </MenuItem>
                                  {t.status === "todo" && t.execution_mode !== "tracker" && (
                                    <MenuItem icon={Play} onSelect={() => dispatch.mutate(t.id)}>
                                      Dispatch now
                                    </MenuItem>
                                  )}
                                  {(t.status === "failed" || t.status === "blocked") && t.execution_mode !== "tracker" && (
                                    <MenuItem icon={RotateCcw} onSelect={() => retryTask.mutate(t.id)}>
                                      Retry now
                                    </MenuItem>
                                  )}
                                  {isPipelinesEnabled() &&
                                    (t.status === "todo" || t.status === "backlog") &&
                                    !t.run_id &&
                                    !t.parent_id &&
                                    !t.title.startsWith("[pipeline]") && (
                                      <MenuItem
                                        icon={Workflow}
                                        disabled={runTaskMeta7.isPending}
                                        onSelect={() => runTaskMeta7.mutate(t)}
                                      >
                                        Run with meta7
                                      </MenuItem>
                                    )}
                                  {NEXT[t.status].length > 0 && (
                                    <>
                                      <MenuSeparator />
                                      <MenuLabel>Move to</MenuLabel>
                                      {NEXT[t.status].map((n) => (
                                        <MenuItem key={n} icon={ArrowRight} onSelect={() => move.mutate({ id: t.id, to: n })}>
                                          {LABEL[n] ?? n}
                                        </MenuItem>
                                      ))}
                                    </>
                                  )}
                                </Menu>
                              )}
                            </div>

                            <Tip label={t.title} side="top" delayDuration={300}>
                              <div className="card-title line-clamp-2">{t.title}</div>
                            </Tip>

                            {firstLine && (
                              <Tip label={t.prompt} side="bottom" delayDuration={350}>
                                <div className="card-snippet line-clamp-2">{firstLine}</div>
                              </Tip>
                            )}

                            <div className="meta">
                              <Tip label={fullAgentLabel}>
                                <span className="badge accent max-w-[140px] truncate">
                                  <span className="truncate">{shortAgentLabel}</span>
                                </span>
                              </Tip>
                              {t.workspace && (
                                <Tip label={t.workspace}>
                                  <span className="badge inline-flex max-w-[116px] items-center gap-1 truncate">
                                    <OsIcon
                                      ws={(workspaces.data ?? []).find((w) => w.path === t.workspace)}
                                      path={t.workspace}
                                      className="size-3 shrink-0"
                                    />
                                    <span className="truncate">{shortWsLabel}</span>
                                  </span>
                                </Tip>
                              )}
                              {t.blocked_by?.length > 0 && (
                                <Tip label={`Blocked by: ${t.blocked_by.join(", ")}`}>
                                  <span className="badge warn shrink-0">
                                    {t.blocked_by.length} dep{t.blocked_by.length === 1 ? "" : "s"}
                                  </span>
                                </Tip>
                              )}
                              {t.retry_count > 0 && (
                                <Tip label={`Attempted ${t.retry_count} of ${MAX_RETRY_DISPLAY} retries`}>
                                  <span className="badge-retry shrink-0">
                                    <RotateCcw color="currentColor" className="size-2.5 shrink-0" aria-hidden />
                                    retry {t.retry_count}/{MAX_RETRY_DISPLAY}
                                  </span>
                                </Tip>
                              )}
                              {t.error_sig && (
                                <Tip label={t.error_sig}>
                                  <span className="badge border-danger/35 bg-danger-tint text-danger-text max-w-[165px] truncate">
                                    {t.error_sig}
                                  </span>
                                </Tip>
                              )}
                            </div>

                            {t.question?.status === "pending" && <TaskQuestionCard task={t} variant="card" />}

                            <WorkflowTree
                              task={t}
                              subtasks={allTasks.filter((sub) => sub.parent_id === t.id)}
                              variant="card"
                            />

                            <div className="card-footer">
                              <div className="flex min-w-0 items-center gap-1.5">
                                {effortMeta && (
                                  <Tip label={effortMeta.label}>
                                    <span
                                      aria-label={effortMeta.label}
                                      className={cn(
                                        "size-2 shrink-0 rounded-full ring-2 ring-white/50 dark:ring-slate-900/50",
                                        effortMeta.dot
                                      )}
                                    />
                                  </Tip>
                                )}
                                {assignee && (
                                  <Tip label={`Assignee: ${assignee}`}>
                                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-2)] font-mono text-[8.5px] font-bold text-[var(--text-primary)]">
                                      {initials(assignee)}
                                    </span>
                                  </Tip>
                                )}
                                <Tip label={`Updated ${fmtDateTime(t.updated_at)}`}>
                                  <span className="font-mono text-[11px] tabular text-[var(--text-muted)]">
                                    {relativeTime(t.updated_at)}
                                  </span>
                                </Tip>
                              </div>
                              {t.status === "todo" && t.execution_mode !== "tracker" ? (
                                <button
                                  className="btn primary xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    dispatch.mutate(t.id);
                                  }}
                                  disabled={dispatch.isPending}
                                >
                                  <Play className="size-2.5 fill-current" />
                                  <span>Dispatch</span>
                                </button>
                              ) : t.status === "failed" && t.execution_mode !== "tracker" ? (
                                <button
                                  className="btn outline xs text-danger-text border-danger/35 hover:bg-danger-tint"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    retryTask.mutate(t.id);
                                  }}
                                  disabled={retryTask.isPending}
                                >
                                  <RotateCcw className="size-2.5" />
                                  <span>Retry</span>
                                </button>
                              ) : t.status === "in_progress" ? (
                                <RunningIndicator task={t} compact />
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-accent-text opacity-0 transition-opacity duration-100 ease-[var(--ease-out-expo)] group-hover:opacity-100">
                                  Open
                                  <ArrowRight className="size-2.5" />
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === "table" && (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div className="glass-card overflow-hidden">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <ListTodo className="size-6 text-[var(--text-secondary)]" />
                <strong className="text-sm text-[var(--text-primary)]">No matching tasks</strong>
                <p className="m-0 text-xs text-[var(--text-secondary)]">
                  Clear active filters or create a new task to populate the ledger.
                </p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Workspace</th>
                    <th>Agent</th>
                    <th>Deps</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const matchedWs = (workspaces.data ?? []).find((w) => w.path === t.workspace);
                    return (
                      <tr key={t.id} onClick={() => open(t.id)} className="cursor-pointer">
                        <td className="font-mono text-[11px] text-[var(--text-muted)]">{t.id}</td>
                        <td>
                          <div className="font-semibold text-[var(--text-primary)]">{t.title}</div>
                          {t.prompt && (
                            <div className="max-w-[38ch] truncate font-mono text-[11px] text-[var(--text-secondary)]">
                              {t.prompt}
                            </div>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={t.status} />
                        </td>
                        <td>
                          {t.workspace ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                              <OsIcon ws={matchedWs} path={t.workspace} className="size-3.5" />
                              {matchedWs?.name ?? (t.workspace.split(/[\\/]/).filter(Boolean).pop() || t.workspace)}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-muted)]">scratch</span>
                          )}
                        </td>
                        <td>
                          <span className="badge accent">
                            {t.executor || "default"}
                            {t.model ? ` · ${t.model}` : ""}
                          </span>
                        </td>
                        <td className="font-mono text-xs tabular text-[var(--text-secondary)]">
                          {t.blocked_by?.length ? `${t.blocked_by.length} blocked` : "—"}
                        </td>
                        <td className="font-mono text-[11px] tabular text-[var(--text-muted)]">
                          {relativeTime(t.updated_at)}
                        </td>
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          {t.status === "todo" ? (
                            <button
                              type="button"
                              className="btn primary sm"
                              onClick={() => dispatch.mutate(t.id)}
                              disabled={dispatch.isPending}
                            >
                              <Play className="size-2.5 fill-current" />
                              Dispatch
                            </button>
                          ) : (
                            <button type="button" className="btn sm" onClick={() => open(t.id)}>
                              Open
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {viewMode === "lanes" && (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(executorsOnBoard.length ? executorsOnBoard : ["default"]).map((exec) => {
              const laneTasks = filtered.filter((t) => (t.executor || "default") === exec);
              return (
                <section
                  key={exec}
                  className="glass-column flex flex-col gap-2 p-3"
                >
                  <div className="flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <Cpu className="size-3.5 text-accent-text" />
                      <h3 className="m-0 font-[var(--font-display)] text-sm font-bold text-[var(--text-primary)]">
                        {exec}
                      </h3>
                    </div>
                    <span className="badge tabular">{laneTasks.length} tasks</span>
                  </div>
                  {laneTasks.length === 0 ? (
                    <div className="rounded-[14px] border border-dashed border-[var(--glass-border)] bg-[var(--glass-2)] py-6 text-center text-xs text-[var(--text-muted)]">
                      No matching tasks
                    </div>
                  ) : (
                    laneTasks.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => open(t.id)}
                        className="card glass-card group"
                        data-status={t.status}
                        style={{ ["--lamp" as string]: statusColor(t.status) }}
                      >
                        <span aria-hidden className="card-coupler" />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-[var(--text-muted)]">{t.id}</span>
                          <StatusBadge status={t.status} />
                        </div>
                        <div className="card-title mt-1.5">{t.title}</div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                          <span className="truncate font-mono">{t.model || "default model"}</span>
                          <span className="tabular text-[var(--text-muted)]">{relativeTime(t.updated_at)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function BoardDialog({
  mode,
  board,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "new" | "edit";
  board?: Board;
  onClose: () => void;
  onSaved: (b?: Board) => void;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const { visibleExecutors } = useExecutorConfig();
  const [name, setName] = useState(board?.name ?? "");
  const [emoji, setEmoji] = useState(board?.emoji ?? "");
  const [defaultExecutor, setDefaultExecutor] = useState(board?.default_executor ?? "");
  const [defaultModel, setDefaultModel] = useState(board?.default_model ?? "");
  const selectableExecutors =
    defaultExecutor && !visibleExecutors.includes(defaultExecutor)
      ? [defaultExecutor, ...visibleExecutors]
      : visibleExecutors;

  const models = useQuery({
    queryKey: ["models", defaultExecutor],
    enabled: !!defaultExecutor,
    queryFn: async () =>
      parseModelCatalog(await apiOr<unknown>(`/api/v1/models?executor=${encodeURIComponent(defaultExecutor)}`, {})).models,
  });

  const save = useMutation({
    mutationFn: () =>
      mode === "new"
        ? post<Board>("/api/v1/boards", {
            name: name.trim(),
            emoji: emoji.trim(),
            default_executor: defaultExecutor,
            default_model: defaultModel,
          })
        : patch<Board>(`/api/v1/boards/${board!.id}`, {
            name: name.trim(),
            emoji: emoji.trim(),
            default_executor: defaultExecutor,
            default_model: defaultModel,
          }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast(mode === "new" ? "Board created" : "Board updated", { tone: "success" });
      onSaved(res);
    },
    onError: (e) => toastError(e, "Could not save board"),
  });

  const remove = useMutation({
    mutationFn: () => del(`/api/v1/boards/${board!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast("Board deleted", { tone: "info" });
      onDeleted?.();
    },
    onError: (e) => toastError(e, "Could not delete board"),
  });

  const DEFAULT_SENTINEL = "__default__";

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-lg p-0" showClose>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader>
            <DialogTitle>{mode === "new" ? "New board" : `Edit board · ${board?.name}`}</DialogTitle>
            <DialogDescription>
              Configure the board name and the executor/model inherited by new tasks.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-3.5">
            <ErrorBox error={save.error ?? remove.error} />
            <div className="space-y-1.5">
              <Label htmlFor="board-name">Board name</Label>
              <Input
                id="board-name"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. f8-saas, switchyard-core"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="board-emoji">Board emoji</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                <BoardEmojiTile board={{ id: board?.id ?? "new", name: name || "Board", emoji }} size={32} />
                {BOARD_EMOJI_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setEmoji(preset)}
                    aria-label={`Select emoji ${preset}`}
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-[8px] border text-[15px] transition-colors",
                      emoji === preset
                        ? "border-accent bg-accent-tint"
                        : "border-line bg-well/60 hover:border-line-strong hover:bg-well"
                    )}
                  >
                    {preset}
                  </button>
                ))}
                <Input
                  id="board-emoji"
                  aria-label="Board emoji"
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value)}
                  placeholder="Custom"
                  maxLength={8}
                  className="ml-auto h-8 w-20 text-center"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="board-executor">Default executor</Label>
                <Select
                  value={defaultExecutor || DEFAULT_SENTINEL}
                  onValueChange={(v) => {
                    setDefaultExecutor(v === DEFAULT_SENTINEL ? "" : v);
                    setDefaultModel("");
                  }}
                >
                  <SelectTrigger id="board-executor" size="sm" aria-label="Default executor">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_SENTINEL}>(system default)</SelectItem>
                    {selectableExecutors.map((x) => (
                      <SelectItem key={x} value={x}>
                        {EXECUTOR_LABELS[x] ?? x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="board-model">Default model</Label>
                {models.data?.length ? (
                  <Select
                    value={defaultModel || DEFAULT_SENTINEL}
                    onValueChange={(v) => setDefaultModel(v === DEFAULT_SENTINEL ? "" : v)}
                    disabled={!defaultExecutor}
                  >
                    <SelectTrigger id="board-model" size="sm" aria-label="Default model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_SENTINEL}>(executor default)</SelectItem>
                      {models.data.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="board-model"
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    placeholder="(executor default)"
                    disabled={!defaultExecutor}
                    className="font-mono text-xs"
                  />
                )}
              </div>
            </div>
          </DialogBody>

          <DialogFooter className="sm:items-center">
            {mode === "edit" && board && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
                className="sm:mr-auto"
              >
                Delete board
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="signal" size="sm" loading={save.isPending} disabled={!name.trim()}>
              {mode === "new" ? "Create board" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
