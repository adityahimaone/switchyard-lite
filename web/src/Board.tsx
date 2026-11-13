import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Columns3,
  Copy,
  Cpu,
  ExternalLink,
  FolderGit2,
  GitPullRequest,
  Inbox,
  LayoutGrid,
  ListTodo,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Table2,
  Trash2,
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
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { ErrorBox, LABEL, Lamp, statusColor } from "./ui";
import { relativeTime } from "@/lib/time";
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

export { EXECUTORS, TaskDialog, TaskDialog as CreateTask };

const EMPTY_COPY: Record<Status, { title: string; hint: string }> = {
  backlog: { title: "Backlog is clear", hint: "Triaged ideas and low-priority items park here." },
  todo: { title: "Nothing queued", hint: "Tasks in Todo are ready for agent dispatch." },
  blocked: { title: "Nothing blocked", hint: "Tasks waiting on dependencies land here." },
  in_progress: { title: "No active runs", hint: "Dispatched tasks appear here while a worker executes." },
  review: { title: "Nothing in review", hint: "Completed runs wait here for diff approval." },
  done: { title: "Nothing done yet", hint: "Approved tasks are collected here." },
  failed: { title: "No failed tasks", hint: "Tasks exceeding max retries stop here." },
};

const EMPTY_ICONS: Record<Status, React.ComponentType<{ className?: string }>> = {
  backlog: Inbox,
  todo: ListTodo,
  blocked: ShieldAlert,
  in_progress: Cpu,
  review: GitPullRequest,
  done: CheckCircle2,
  failed: AlertCircle,
};

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

  const [over, setOver] = useState("");
  const [viewMode, setViewMode] = useState<"board" | "table" | "lanes">("board");
  const [creating, setCreating] = useState<{ startMode: StartMode } | null>(null);
  const [boardModal, setBoardModal] = useState<"new" | "edit" | null>(null);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mk = useMutation({
    mutationFn: () => post<Board>("/api/v1/boards", { name: "Main" }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      if (created?.id) setBoardId(created.id);
    },
  });

  const allTasks = tasks.data ?? [];

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
      <div className="page-header page-header-stack">
        <div className="bar">
          <h2>
            <span>{activeBoard ? activeBoard.name : "Board"}</span>
            {activeBoard?.default_executor && (
              <span className="badge accent" title="Board default executor">
                {activeBoard.default_executor}
                {activeBoard.default_model ? ` · ${activeBoard.default_model}` : ""}
              </span>
            )}
          </h2>
          <span className="bar-sub">Queue, dispatch and review for this board.</span>
          <div className="bar-spacer" />

          {(boards.data?.length ?? 0) > 0 && (
            <BoardSwitcher
              boards={boards.data}
              value={boardId}
              onChange={setBoardId}
              className="w-auto min-w-[180px]"
            />
          )}

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

          <Tip label="Create a new board">
            <button
              type="button"
              className="btn"
              onClick={() => (onNewBoard ? onNewBoard() : setBoardModal("new"))}
            >
              <Plus className="size-3.5" />
              <span>New board</span>
            </button>
          </Tip>

          {activeBoard && (
            <Tip label="Board settings">
              <button
                type="button"
                className="btn ghost icon"
                onClick={() => (onEditBoard ? onEditBoard(activeBoard) : setBoardModal("edit"))}
                aria-label="Board settings"
              >
                <Settings2 className="size-3.5" />
              </button>
            </Tip>
          )}

        </div>

        {/* Compact filter & search bar: one row of tokens, no status strip. */}
        <div className="flex flex-wrap items-center gap-1.5" role="search" aria-label="Filter tasks">
          <div
            className={cn(
              "group relative flex h-9 w-[300px] items-center rounded-full border pr-2 pl-3 transition-[border-color,background-color,box-shadow] duration-150",
              q
                ? "border-accent/45 bg-surface shadow-[var(--lift-1)]"
                : "border-line bg-well/55 hover:border-line-strong hover:bg-surface"
            )}
          >
            <Search
              className={cn("size-4 shrink-0 transition-colors", q ? "text-accent-text" : "text-ink-3")}
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
              className="ml-2 w-full bg-transparent text-[12px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-4"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-well hover:text-ink"
              >
                <span aria-hidden className="text-[14px] leading-none">×</span>
              </button>
            ) : (
              <kbd className="hidden shrink-0 rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-[9px] text-ink-4 sm:inline">
                /
              </kbd>
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

          <span className="ml-0.5 font-mono text-[10px] tabular-nums text-ink-4">
            {filtered.length === allTasks.length
              ? `${allTasks.length} ${allTasks.length === 1 ? "task" : "tasks"}`
              : `${filtered.length} of ${allTasks.length}`}
          </span>

          <div className="bar-spacer" />

          <button
            type="button"
            className={"btn sm" + (bulkMode ? " primary" : "")}
            aria-pressed={bulkMode}
            onClick={() => {
              setBulkMode((v) => !v);
              setSelected(new Set());
            }}
          >
            <CheckCircle2 className="size-3" />
            Bulk select
          </button>

          <button
            className="btn primary"
            onClick={() => setCreating({ startMode: "queue" })}
            disabled={!boardId}
          >
            <Plus className="size-3.5" />
            <span>New task</span>
          </button>
        </div>
      </div>

      {bulkMode && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-6 py-2">
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
        <ErrorBox error={tasks.error ?? move.error ?? boards.error ?? dispatch.error} />
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
          <div className="board">
            {STATUSES.map((s) => {
              const colTasks = filtered.filter((t) => t.status === s);
              const copy = EMPTY_COPY[s];
              const quickAdd = QUICK_ADD[s];
              return (
                <div
                  key={s}
                  className={"col" + (over === s ? " over" : "")}
                  style={{ ["--lamp" as string]: statusColor(s) }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(s);
                  }}
                  onDragLeave={() => setOver("")}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver("");
                    const id = e.dataTransfer.getData("text/plain");
                    if (id) move.mutate({ id, to: s });
                  }}
                >
                  <div className="col-header">
                    <h3>
                      <Lamp status={s} />
                      <span className="col-count">{colTasks.length}</span>
                      {quickAdd && (
                        <Tip label={`Add task to ${LABEL[s]}`}>
                          <button
                            type="button"
                            onClick={() => setCreating({ startMode: quickAdd })}
                            aria-label={`Add task to ${LABEL[s]}`}
                            className="ml-1 inline-flex size-5 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-raised hover:text-ink"
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
                      <div className="col-empty">
                        {(() => {
                          const Icon = EMPTY_ICONS[s];
                          return <Icon className="size-5 mb-1 opacity-40 text-[var(--lamp)]" />;
                        })()}
                        <strong>{copy.title}</strong>
                        <span>{copy.hint}</span>
                        {quickAdd && (
                          <button
                            type="button"
                            onClick={() => setCreating({ startMode: quickAdd })}
                            className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-ink-2 shadow-[var(--lift-1)] transition-colors hover:border-line-strong hover:text-ink"
                          >
                            <Plus className="size-3" />
                            Add task
                          </button>
                        )}
                      </div>
                    ) : (
                      colTasks.map((t) => {
                        const isSel = selected.has(t.id);
                        const firstLine = (t.prompt || "").split("\n").find((l) => l.trim())?.trim() ?? "";
                        return (
                          <div
                            key={t.id}
                            className="card group"
                            data-status={t.status}
                            data-selected={isSel || undefined}
                            style={{ ["--lamp" as string]: statusColor(t.status) }}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                            onClick={() => (bulkMode ? toggleSelect(t.id) : open(t.id))}
                          >
                            <span aria-hidden className="card-coupler" />

                            {/* Card top telemetry bar */}
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-1.5">
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
                                <span className="truncate font-mono text-[10px] font-medium text-ink-4">
                                  {t.id}
                                </span>
                                {t.run_id && <span className="badge review">pipeline</span>}
                              </div>

                              {!bulkMode && (
                                <Menu
                                  label={`Actions for ${t.title}`}
                                  trigger={
                                    <button
                                      type="button"
                                      aria-label={`Actions for ${t.title}`}
                                      className="-mt-0.5 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-ink-4 opacity-0 transition-[opacity,background-color] hover:bg-well hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
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
                                  {t.status === "todo" && (
                                    <MenuItem icon={Play} onSelect={() => dispatch.mutate(t.id)}>
                                      Dispatch now
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

                            <div className="card-title">{t.title}</div>

                            {firstLine && <div className="card-snippet">{firstLine}</div>}

                            <div className="meta">
                              <span className="badge accent">
                                {t.executor || "default"}
                                {t.model ? ` · ${t.model}` : ""}
                              </span>
                              {t.effort && <span className="badge">{t.effort}</span>}
                              {t.workspace && (
                                <span className="badge inline-flex items-center gap-1" title={t.workspace}>
                                  <OsIcon
                                    ws={(workspaces.data ?? []).find((w) => w.path === t.workspace)}
                                    path={t.workspace}
                                    className="size-3"
                                  />
                                  {t.workspace.split(/[\\/]/).filter(Boolean).pop() || t.workspace}
                                </span>
                              )}
                              {t.blocked_by?.length > 0 && (
                                <span className="badge warn" title={`Blocked by: ${t.blocked_by.join(", ")}`}>
                                  {t.blocked_by.length} dep{t.blocked_by.length === 1 ? "" : "s"}
                                </span>
                              )}
                              {t.retry_count > 0 && <span className="badge warn">retry {t.retry_count}</span>}
                            </div>

                            <div className="mt-2.5 flex items-center gap-1.5 border-t border-line/60 pt-2">
                              <span className="font-mono text-[10px] text-ink-4" title="Last updated">
                                {relativeTime(t.updated_at)}
                              </span>
                              <div className="flex-1" />
                              {t.status === "todo" ? (
                                <button
                                  className="btn primary sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    dispatch.mutate(t.id);
                                  }}
                                  disabled={dispatch.isPending}
                                >
                                  <Play className="size-2.5 fill-current" />
                                  <span>Dispatch</span>
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-text opacity-0 transition-opacity group-hover:opacity-100">
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
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--glass-lift-card)]">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <ListTodo className="size-6 text-ink-3" />
                <strong className="text-sm text-ink">No matching tasks</strong>
                <p className="m-0 text-xs text-ink-3">Clear active filters or create a new task to populate the ledger.</p>
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
                        <td className="font-mono text-[11px] text-ink-3">{t.id}</td>
                        <td>
                          <div className="font-semibold text-ink">{t.title}</div>
                          {t.prompt && (
                            <div className="max-w-[38ch] truncate font-mono text-[11px] text-ink-3">
                              {t.prompt}
                            </div>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={t.status} />
                        </td>
                        <td>
                          {t.workspace ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                              <OsIcon ws={matchedWs} path={t.workspace} className="size-3.5" />
                              {matchedWs?.name ?? (t.workspace.split(/[\\/]/).filter(Boolean).pop() || t.workspace)}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-4">scratch</span>
                          )}
                        </td>
                        <td>
                          <span className="badge accent">
                            {t.executor || "default"}
                            {t.model ? ` · ${t.model}` : ""}
                          </span>
                        </td>
                        <td className="font-mono text-xs tabular text-ink-3">
                          {t.blocked_by?.length ? `${t.blocked_by.length} blocked` : "—"}
                        </td>
                        <td className="font-mono text-[11px] tabular text-ink-3">{relativeTime(t.updated_at)}</td>
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
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(executorsOnBoard.length ? executorsOnBoard : ["default"]).map((exec) => {
              const laneTasks = filtered.filter((t) => (t.executor || "default") === exec);
              return (
                <section
                  key={exec}
                  className="flex flex-col gap-2.5 rounded-[22px] border border-line bg-well/65 p-3.5 shadow-[var(--well-inset)]"
                >
                  <div className="flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <Cpu className="size-3.5 text-accent-text" />
                      <h3 className="m-0 font-[var(--font-display)] text-sm font-bold text-ink">{exec}</h3>
                    </div>
                    <span className="badge tabular">{laneTasks.length} tasks</span>
                  </div>
                  {laneTasks.length === 0 ? (
                    <div className="rounded-[14px] border border-dashed border-line-strong/70 bg-surface/50 py-6 text-center text-xs text-ink-4">
                      No matching tasks
                    </div>
                  ) : (
                    laneTasks.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => open(t.id)}
                        className="card group"
                        data-status={t.status}
                        style={{ ["--lamp" as string]: statusColor(t.status) }}
                      >
                        <span aria-hidden className="card-coupler" />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-ink-4">{t.id}</span>
                          <StatusBadge status={t.status} />
                        </div>
                        <div className="card-title mt-1.5">{t.title}</div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-3">
                          <span className="truncate font-mono">{t.model || "default model"}</span>
                          <span className="tabular">{relativeTime(t.updated_at)}</span>
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
  const [name, setName] = useState(board?.name ?? "");
  const [defaultExecutor, setDefaultExecutor] = useState(board?.default_executor ?? "");
  const [defaultModel, setDefaultModel] = useState(board?.default_model ?? "");

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
            default_executor: defaultExecutor,
            default_model: defaultModel,
          })
        : patch<Board>(`/api/v1/boards/${board!.id}`, {
            name: name.trim(),
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
                    {EXECUTORS.map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
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
                    className="h-8 rounded-full font-mono text-xs"
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
