import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, FileCode2, FolderGit2, GitBranch, Play, Plus, Sparkles } from "@/components/ui/icons";
import { post, type Task } from "@/api";
import { HarnessAvatar } from "@/components/studio/StudioAssets";
import { StatusHeaderPill } from "@/ui";
import { toast, toastError } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Dual-Density Per-Card Workflow Tree:
 * - variant="card": Compact tech-stack/skills/MCP/subtask strip on Kanban cards.
 * - variant="detail": Interactive dot-grid node tree connecting Workspace/Branch ->
 *   Parent Task + Context Notes -> Hybrid Subtasks (parent_id) & Harness Runs.
 */
export function WorkflowTree({
  task,
  subtasks = [],
  variant = "detail",
  onOpenTask,
}: {
  task: Task;
  subtasks?: Task[];
  variant?: "card" | "detail";
  onOpenTask?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const addSubtask = useMutation({
    mutationFn: () =>
      post<Task>("/api/v1/tasks", {
        board_id: task.board_id,
        parent_id: task.id,
        title: newTitle.trim(),
        prompt: `Subtask of "${task.title}": ${newTitle.trim()}`,
        workspace: task.workspace,
        branch: task.branch,
        executor: task.executor,
        model: task.model,
        status: "todo",
      }),
    onSuccess: () => {
      setNewTitle("");
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Subtask added to workflow tree", { tone: "success" });
    },
    onError: (e) => toastError(e, "Failed to add subtask"),
  });

  const dispatchSub = useMutation({
    mutationFn: (id: string) => post(`/api/v1/tasks/${id}/dispatch`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Subtask dispatched", { tone: "success" });
    },
    onError: (e) => toastError(e, "Dispatch failed"),
  });

  const skills = task.skills ?? [];
  const mcps = task.mcps ?? [];
  const paths = task.paths ?? [];

  if (variant === "card") {
    if (skills.length === 0 && mcps.length === 0 && subtasks.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line/60 pt-1.5 text-[10px]">
        <span className="rounded-md bg-amber-500/12 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
          Stack
        </span>
        {skills.slice(0, 2).map((s) => (
          <span key={s} className="rounded-md border border-line bg-well/70 px-1.5 py-0.5 font-mono text-ink-2">
            ${s}
          </span>
        ))}
        {mcps.slice(0, 2).map((m) => (
          <span key={m} className="rounded-md border border-accent/25 bg-accent-tint/60 px-1.5 py-0.5 font-mono text-accent-text">
            mcp:{m}
          </span>
        ))}
        {subtasks.length > 0 && (
          <span className="ml-auto font-mono text-[10px] tabular-nums text-ink-3">
            {subtasks.filter((s) => s.status === "done").length}/{subtasks.length} sub
          </span>
        )}
      </div>
    );
  }

  const wsLabel = task.workspace ? task.workspace.split(/[\\/]/).filter(Boolean).pop() : "Unassigned workspace";

  return (
    <div
      data-testid="workflow-tree-canvas"
      className="studio-dot-grid relative overflow-x-auto rounded-[16px] border border-line bg-well/55 p-5"
    >
      <div className="mx-auto flex min-w-[540px] max-w-3xl flex-col items-center">
        {/* Level 1: Workspace & Branch Root Node */}
        <div className="inline-flex items-center gap-2.5 rounded-full border border-line-strong bg-surface px-4 py-1.5 text-[12px] shadow-[var(--glass-shadow-sm)]">
          <FolderGit2 className="size-3.5 text-accent" />
          <span className="font-semibold text-ink">{wsLabel}</span>
          {task.branch && (
            <>
              <span className="text-ink-4">·</span>
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-3">
                <GitBranch className="size-3" />
                {task.branch}
              </span>
            </>
          )}
        </div>

        {/* Connector */}
        <div className="h-5 w-px bg-accent/50" />

        {/* Level 2: Main Task Node + Context Sidecar */}
        <div className="flex w-full flex-wrap items-center justify-center gap-4">
          <div className="w-[310px] rounded-[14px] border border-line-strong bg-surface p-3.5 shadow-[var(--glass-shadow-md)]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Parent Task</div>
                <div className="mt-0.5 truncate text-[13.5px] font-semibold text-ink">{task.title}</div>
              </div>
              <StatusHeaderPill status={task.status} />
            </div>

            <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-ink-3">
              <span>Assigned to</span>
              <HarnessAvatar harness={task.executor || "studio"} size={22} />
              <span className="font-mono text-[11px] text-ink-2">
                {task.executor || "auto"}
                {task.model ? ` · ${task.model}` : ""}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                Tech-Stack
              </span>
              {skills.length === 0 && mcps.length === 0 ? (
                <span className="font-mono text-[10.5px] text-ink-4">No skills/MCP attached</span>
              ) : (
                <>
                  {skills.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-well px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
                    >
                      <Sparkles className="size-2.5 text-accent" />${s}
                    </span>
                  ))}
                  {mcps.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent-tint px-1.5 py-0.5 font-mono text-[10.5px] text-accent-text"
                    >
                      <Cpu className="size-2.5" />
                      {m}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Horizontal Connector + Context Files Node */}
          <div className="hidden h-px w-6 bg-accent/50 sm:block" />
          <div className="w-[210px] rounded-[12px] border border-line bg-surface/95 p-3 shadow-[var(--glass-shadow-sm)]">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
              <FileCode2 className="size-3.5 text-ink-3" />
              <span>Context & Files</span>
            </div>
            <div className="mt-1.5 space-y-1 font-mono text-[10.5px] text-ink-3">
              {paths.length > 0 ? (
                paths.slice(0, 3).map((p) => (
                  <div key={p} className="truncate">
                    @{p}
                  </div>
                ))
              ) : (
                <div className="text-ink-4">Auto-discovered in worktree</div>
              )}
              {paths.length > 3 && <div className="text-ink-4">+{paths.length - 3} more</div>}
            </div>
          </div>
        </div>

        {/* Branch Connectors */}
        <div className="mt-0.5 grid w-full max-w-2xl grid-cols-2 gap-6 pt-5">
          {/* Left Branch: Hybrid Subtasks */}
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-dashed border-line-strong bg-surface/85 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Subtasks ({subtasks.length})
              </span>
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:border-accent hover:text-accent"
              >
                <Plus className="size-3" />
                Add
              </button>
            </div>

            {adding && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newTitle.trim()) addSubtask.mutate();
                }}
                className="flex gap-1.5"
              >
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Subtask title..."
                  className="h-7 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={!newTitle.trim() || addSubtask.isPending}
                  className="rounded-md bg-accent px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  Save
                </button>
              </form>
            )}

            {subtasks.length === 0 ? (
              <p className="m-0 text-[11.5px] text-ink-4">
                No child subtasks yet. Break complex work into parallel dispatchable subtasks.
              </p>
            ) : (
              <div className="space-y-2">
                {subtasks.map((st) => (
                  <div
                    key={st.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-[10px] border border-line bg-surface p-2 text-[12px] shadow-2xs",
                      onOpenTask && "cursor-pointer hover:border-accent/50"
                    )}
                    onClick={() => onOpenTask?.(st.id)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <HarnessAvatar harness={st.executor || task.executor} size={20} />
                      <span className="truncate font-medium text-ink">{st.title}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <StatusHeaderPill status={st.status} />
                      {st.status === "todo" && (
                        <button
                          type="button"
                          title="Dispatch subtask"
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatchSub.mutate(st.id);
                          }}
                          className="rounded-md border border-line p-1 text-ink-3 hover:border-accent hover:text-accent"
                        >
                          <Play className="size-2.5 fill-current" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Branch: Assigned Harness & Session Continuity */}
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-line-strong bg-surface/90 p-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Assigned Harness & Continuity
            </span>
            <div className="flex items-center gap-2.5 rounded-[10px] border border-line bg-well/40 p-2.5">
              <HarnessAvatar harness={task.executor || "studio"} size={30} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-ink">
                  {(task.executor || "auto").toUpperCase()} Agent
                </div>
                <div className="truncate font-mono text-[10.5px] text-ink-3">
                  {task.model || "default model"}
                  {task.effort ? ` · ${task.effort}` : ""}
                </div>
              </div>
            </div>
            {task.harness_sessions && Object.keys(task.harness_sessions).length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Bound Sessions</div>
                {Object.entries(task.harness_sessions).map(([h, sid]) => (
                  <div
                    key={h}
                    className="flex items-center justify-between rounded-md border border-line bg-surface px-2 py-1 font-mono text-[10.5px]"
                  >
                    <span className="font-semibold text-ink-2">{h}</span>
                    <span className="max-w-[140px] truncate text-ink-4">{sid}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
