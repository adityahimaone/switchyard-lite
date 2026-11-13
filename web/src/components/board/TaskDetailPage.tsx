import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, GitBranch, Link2 } from "lucide-react";
import { api, apiOr, del, post, type Status, type Task, type Workspace, type WorktreeInfo } from "@/api";
import { TaskDetailPanels } from "@/components/board/TaskDetailContent";
import {
  Field,
  FieldList,
  OsIcon,
  Section,
  StatusBadge,
  TaskActions,
  TaskHeader,
} from "@/components/board/taskDetailParts";
import { CopyButton } from "@/components/ui/copy-button";
import { ErrorBox } from "@/ui";
import { fmtDateTime, relativeTime } from "@/lib/time";
import { toast, toastError } from "@/components/ui/toast";

export function TaskDetailPage({
  id,
  onBack,
  onReview,
}: {
  id: string;
  onBack: () => void;
  onReview: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();

  const task = useQuery({
    queryKey: ["task", id],
    queryFn: () => api<Task>(`/api/v1/tasks/${id}`),
    refetchInterval: 4000,
  });

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiOr<Workspace[]>("/api/v1/workspaces", []),
  });

  const worktree = useQuery({
    queryKey: ["worktree", id],
    queryFn: () => apiOr<WorktreeInfo>(`/api/v1/tasks/${id}/worktree`, { exists: false }),
  });

  const boardTasks = useQuery({
    queryKey: ["tasks", task.data?.board_id],
    enabled: !!task.data?.board_id,
    queryFn: () => api<Task[]>(`/api/v1/boards/${task.data!.board_id}/tasks`),
  });

  const move = useMutation({
    mutationFn: (to: Status) => post(`/api/v1/tasks/${id}/move`, { status: to }),
    onSuccess: (_d, to) => {
      qc.invalidateQueries();
      toast(`Moved to ${to.replace("_", " ")}`, { tone: "success" });
    },
    onError: (e) => toastError(e, "Could not move task"),
  });

  const dispatch = useMutation({
    mutationFn: () => post(`/api/v1/tasks/${id}/dispatch`),
    onSuccess: () => {
      qc.invalidateQueries();
      toast("Task dispatched", { tone: "success" });
    },
    onError: (e) => toastError(e, "Dispatch failed"),
  });

  const remove = useMutation({
    mutationFn: () => del(`/api/v1/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries();
      toast("Task deleted", { tone: "info" });
      onBack();
    },
    onError: (e) => toastError(e, "Could not delete task"),
  });

  const t = task.data;
  const matchedWs = workspaces.data?.find((w) => w.path === t?.workspace);
  const deps = (t?.blocked_by ?? []).map((dep) => ({
    id: dep,
    task: boardTasks.data?.find((b) => b.id === dep),
  }));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <TaskHeader
        id={id}
        task={t}
        matchedWs={matchedWs}
        variant="page"
        editing={editing}
        onToggleEdit={() => setEditing((v) => !v)}
        onBack={onBack}
        sticky
      />

      <div className="mx-auto w-full max-w-[1240px] px-4 py-4 sm:px-6">
        {task.error && (
          <div className="mb-3">
            <ErrorBox error={task.error} />
          </div>
        )}

        {t && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface/60 px-3 py-2">
            <TaskActions
              task={t}
              onDispatch={() => dispatch.mutate()}
              dispatchPending={dispatch.isPending}
              onMove={(to) => move.mutate(to)}
              movePending={move.isPending}
              onOpenReview={() => onReview(id)}
              onDelete={() => remove.mutate()}
              deletePending={remove.isPending}
            />
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_286px]">
          <div className="min-w-0">
            <TaskDetailPanels
              id={id}
              variant="page"
              editing={editing}
              setEditing={setEditing}
              onDeleted={onBack}
              onReviewPage={onReview}
              showActions={false}
            />
          </div>

          <aside className="hidden flex-col gap-3 lg:sticky lg:top-[76px] lg:flex" aria-label="Task properties">
            {t && (
              <>
                <Section title="Lifecycle">
                  <div className="mb-2 flex items-center gap-2">
                    <StatusBadge status={t.status} />
                    <span className="text-[10px] text-ink-4">updated {relativeTime(t.updated_at)}</span>
                  </div>
                  <FieldList>
                    <Field label="Created">{fmtDateTime(t.created_at)}</Field>
                    <Field label="Updated">{fmtDateTime(t.updated_at)}</Field>
                    <Field label="Retries">
                      <span className={t.retry_count > 0 ? "text-warning-text" : undefined}>{t.retry_count}</span>
                    </Field>
                    {t.run_id && (
                      <Field label="Pipeline">
                        <span className="font-mono text-[11px]">
                          {t.run_id}
                          {t.stage_id ? ` / ${t.stage_id}` : ""}
                        </span>
                      </Field>
                    )}
                  </FieldList>
                </Section>

                <Section title={<><Cpu className="size-3" /> Execution</>}>
                  <FieldList>
                    <Field label="Executor">{t.executor || "board default"}</Field>
                    <Field label="Model">
                      <span className="font-mono text-[11px]">{t.model || "executor default"}</span>
                    </Field>
                    <Field label="Effort">{t.effort || "default"}</Field>
                  </FieldList>
                </Section>

                <Section title={<><GitBranch className="size-3" /> Workspace</>}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    <OsIcon ws={matchedWs} path={t.workspace} className="size-3.5" />
                    <span className="truncate">
                      {t.workspace
                        ? (matchedWs?.name ?? (t.workspace.split(/[\\/]/).filter(Boolean).pop() || t.workspace))
                        : "scratch"}
                    </span>
                  </div>
                  {t.workspace ? (
                    <div className="flex items-start gap-1 rounded border border-line bg-well/50 px-1.5 py-1">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3" title={t.workspace}>
                        {t.workspace}
                      </span>
                      <CopyButton value={t.workspace} label="Copy workspace path" />
                    </div>
                  ) : (
                    <p className="m-0 text-[11px] text-ink-4">No repository attached.</p>
                  )}
                  {worktree.data?.exists && (
                    <FieldList>
                      <Field label="Branch">
                        <span className="font-mono text-[11px]">{worktree.data.branch}</span>
                      </Field>
                      <Field label="Base">
                        <span className="font-mono text-[11px]">{worktree.data.base_sha?.slice(0, 10)}</span>
                      </Field>
                    </FieldList>
                  )}
                </Section>

                <Section title={<><Link2 className="size-3" /> Dependencies ({deps.length})</>}>
                  {deps.length === 0 ? (
                    <p className="m-0 text-[11px] text-ink-4">Not blocked by any prerequisite.</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {deps.map((d) => (
                        <li key={d.id} className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">
                            {d.task ? d.task.title : d.id}
                          </span>
                          {d.task && <StatusBadge status={d.task.status} />}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
