import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Cpu,
  ExternalLink,
  GitPullRequest,
  Inbox,
  ListTodo,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  apiOr,
  del,
  getSavedBoardId,
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
import { OsIcon } from "@/components/board/taskDetailParts";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { ErrorBox, LABEL, Lamp, statusColor } from "./ui";
import { relativeTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { FilterPill } from "@/components/ui/pill";
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
    refetchInterval: 4000,
    queryFn: () => api<Task[]>(`/api/v1/boards/${boardId}/tasks`),
  });

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiOr<Workspace[]>("/api/v1/workspaces", []),
  });

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: Status }) => post(`/api/v1/tasks/${id}/move`, { status: to }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast(`Moved to ${LABEL[vars.to] ?? vars.to}`, { tone: "success" });
    },
    onError: (e) => toastError(e, "Could not move task"),
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
  const [creating, setCreating] = useState<{ startMode: StartMode } | null>(null);
  const [boardModal, setBoardModal] = useState<"new" | "edit" | null>(null);
  const [q, setQ] = useState("");
  const [fExec, setFExec] = useState("");
  const [fStatus, setFStatus] = useState<Status | "">("");
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (fStatus && t.status !== fStatus) return false;
      if (fExec && (t.executor || "default") !== fExec) return false;
      if (!needle) return true;
      return (
        t.title.toLowerCase().includes(needle) ||
        (t.prompt || "").toLowerCase().includes(needle) ||
        t.id.toLowerCase().includes(needle) ||
        (t.workspace || "").toLowerCase().includes(needle)
      );
    });
  }, [allTasks, q, fExec, fStatus]);

  const executorsOnBoard = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTasks) s.add(t.executor || "default");
    return Array.from(s);
  }, [allTasks]);

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

  const activeFilterCount = (q.trim() !== "" ? 1 : 0) + (fExec !== "" ? 1 : 0) + (fStatus !== "" ? 1 : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      <div className="page-header">
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

          <button
            className="btn primary"
            onClick={() => setCreating({ startMode: "queue" })}
            disabled={!boardId}
          >
            <Plus className="size-3.5" />
            <span>New task</span>
          </button>
        </div>

        {/* Filter & search toolbar (Concept 1 Tactile Capsule Bar) */}
        <div className="toolbar-row" role="search" aria-label="Filter tasks">
          <div className="search-box">
            <Search className="size-3.5" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tasks, prompt, id…"
              aria-label="Search tasks"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full p-0.5 text-ink-4 hover:bg-raised hover:text-ink"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <FilterPill
            count={activeFilterCount}
            active={activeFilterCount > 0}
            onClear={
              activeFilterCount > 0
                ? () => {
                    setQ("");
                    setFExec("");
                    setFStatus("");
                  }
                : undefined
            }
          />

          <div className="chip-row">
            {executorsOnBoard.map((ex) => (
              <button
                key={ex}
                type="button"
                className={"chip" + (fExec === ex ? " active" : "")}
                aria-pressed={fExec === ex}
                onClick={() => setFExec(fExec === ex ? "" : ex)}
              >
                {ex}
              </button>
            ))}
          </div>

          <span className="muted tabular" style={{ fontSize: 12 }}>
            {filtered.length === allTasks.length
              ? `${allTasks.length} ${allTasks.length === 1 ? "task" : "tasks"}`
              : `${filtered.length} of ${allTasks.length} tasks`}
          </span>

          <div className="bar-spacer" />

          <button
            type="button"
            className={"btn sm" + (bulkMode ? " primary" : " ghost")}
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
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                            {bulkMode && (
                              <input
                                type="checkbox"
                                checked={isSel}
                                onChange={() => toggleSelect(t.id)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ width: 14, height: 14, marginTop: 2 }}
                                aria-label={`Select ${t.title}`}
                              />
                            )}
                            <div className="card-title" style={{ flex: 1 }}>
                              {t.title}
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

                          {firstLine && <div className="card-snippet">{firstLine}</div>}

                          <div className="meta">
                            <span className="badge">
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
                                ⛓ {t.blocked_by.length} dep{t.blocked_by.length === 1 ? "" : "s"}
                              </span>
                            )}
                            {t.retry_count > 0 && <span className="badge warn">retry {t.retry_count}</span>}
                            {t.run_id && <span className="badge review">pipeline</span>}
                          </div>

                          <div className="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-1.5">
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
