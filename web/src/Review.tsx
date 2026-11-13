import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderGit2, GitPullRequest, X } from "lucide-react";
import { api, ApiError, apiOr, LIVE_FALLBACK_MS, post, type Task } from "./api";
import { ErrorBox, Lamp, Unavailable } from "./ui";
import { useBoardId } from "./Board";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";

export function DiffView({ text }: { text: string }) {
  const lines = text.split("\n");
  const adds = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const dels = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-[var(--c-mint-wash)] px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-success-text">
          +{adds} additions
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger-tint px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-danger-text">
          −{dels} deletions
        </span>
      </div>
      <pre className="diff" aria-label="diff">
        {lines.map((l, i) => (
          <span
            key={i}
            className={
              l.startsWith("@@")
                ? "hunk"
                : l.startsWith("+") && !l.startsWith("+++")
                ? "add"
                : l.startsWith("-") && !l.startsWith("---")
                ? "del"
                : undefined
            }
          >
            {l || " "}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function ReviewScreen({ taskId, pick }: { taskId?: string; pick: (id: string) => void }) {
  const qc = useQueryClient();
  const { boardId, boards, setBoardId } = useBoardId();

  const queue = useQuery({
    queryKey: ["tasks", boardId, "review"],
    enabled: !!boardId,
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () => api<Task[]>(`/api/v1/boards/${boardId}/tasks?status=review`),
  });

  const reviewSettings = useQuery({
    queryKey: ["settings", "review"],
    queryFn: () => apiOr<{ auto_merge: boolean }>("/api/v1/settings/review", { auto_merge: false }),
  });

  const toggleAutoMerge = useMutation({
    mutationFn: (auto_merge: boolean) => post("/api/v1/settings/review", { auto_merge }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "review"] }),
  });

  const id = taskId ?? queue.data?.[0]?.id;
  const activeTask = queue.data?.find((t) => t.id === id);

  const diff = useQuery({
    queryKey: ["diff", id],
    enabled: !!id,
    retry: false,
    queryFn: () =>
      api<string | { diff: string }>(`/api/v1/tasks/${id}/diff`).then((d) =>
        typeof d === "string" ? d : d.diff
      ),
  });

  const [reason, setReason] = useState("");
  const done = () => qc.invalidateQueries();
  const approve = useMutation({ mutationFn: () => post(`/api/v1/tasks/${id}/approve`), onSuccess: done });
  const reject = useMutation({
    mutationFn: () => post(`/api/v1/tasks/${id}/reject`, { reason }),
    onSuccess: () => {
      setReason("");
      done();
    },
  });

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title-row">
            <h2>Review Gate</h2>
            <span className="pill-count tabular-nums">{queue.data?.length ?? 0} awaiting</span>
          </div>
          <p className="page-subtitle">
            Inspect worktree diffs against base SHA before marking tasks done or requeueing with feedback.
          </p>
        </div>

        <div className="page-header-actions">
          {(boards.data?.length ?? 0) > 1 && (
            <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 shadow-[var(--lift-1)]">
            <input
              type="checkbox"
              className="w-auto"
              checked={reviewSettings.data?.auto_merge ?? false}
              onChange={(e) => toggleAutoMerge.mutate(e.target.checked)}
            />
            <span>Auto-merge branch on approve</span>
          </label>
        </div>
      </div>

      <ErrorBox error={queue.error ?? approve.error ?? reject.error} />

      {queue.data?.length === 0 && !taskId && (
        <div className="rounded-[24px] border border-dashed border-line-strong bg-surface/80 p-8 text-center shadow-[var(--lift-1)]">
          <GitPullRequest className="mx-auto mb-2 size-6 text-ink-3" />
          <p className="m-0 text-sm font-semibold text-ink">Nothing awaiting review on this board</p>
          <p className="muted mt-1 text-xs">
            Tasks enter Review automatically after an agent worker completes execution.
          </p>
        </div>
      )}

      {(id || (queue.data?.length ?? 0) > 0) && (
        <div className="grid items-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
          {(queue.data?.length ?? 0) > 0 && (
            <aside
              aria-label="Review queue"
              className="rounded-[22px] border border-line bg-surface p-3 shadow-[var(--lift-1),var(--lift-inset)]"
            >
              <div className="mb-2 flex items-center justify-between px-1.5">
                <span className="font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                  Review queue
                </span>
                <span className="font-mono text-[10.5px] tabular-nums text-ink-4">
                  {queue.data?.length ?? 0}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {queue.data?.map((t) => {
                  const selected = t.id === id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={
                        selected
                          ? "flex w-full flex-col gap-1 rounded-[16px] border border-accent/45 bg-accent-tint/70 px-3 py-2.5 text-left text-ink shadow-[var(--lift-1)]"
                          : "flex w-full flex-col gap-1 rounded-[16px] border border-line bg-well/55 px-3 py-2.5 text-left text-ink-2 transition-colors hover:border-line-strong hover:bg-surface"
                      }
                      aria-pressed={selected}
                      onClick={() => pick(t.id)}
                    >
                      <span className="line-clamp-2 text-[13px] font-semibold leading-snug">{t.title}</span>
                      <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-3">
                        <span>{t.id}</span>
                        {t.executor && <span>· {t.executor}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}

          {id && (
            <div className={queue.data?.length ? "min-w-0 space-y-3" : "min-w-0 space-y-3 lg:col-span-2"}>
              {activeTask && (
                <div className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--lift-1),var(--lift-inset)] space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="m-0 text-base font-bold tracking-[-0.02em] text-ink">{activeTask.title}</h3>
                    <Lamp status={activeTask.status} />
                    <span className="badge mono">{activeTask.id}</span>
                    {activeTask.workspace && (
                      <span className="badge inline-flex items-center gap-1">
                        <FolderGit2 className="size-3" />
                        <span className="max-w-[260px] truncate">{activeTask.workspace}</span>
                      </span>
                    )}
                  </div>
                  {activeTask.acceptance && (
                    <div className="rounded-[14px] border border-line bg-well/55 px-3 py-2 text-xs leading-relaxed text-ink-2">
                      <b className="font-semibold text-ink">Acceptance criteria:</b> {activeTask.acceptance}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--lift-1),var(--lift-inset)]">
                {diff.error instanceof ApiError && [404, 409].includes(diff.error.status) ? (
                  <Unavailable what="Diff (no git worktree attached to this task)" />
                ) : diff.error ? (
                  <ErrorBox error={diff.error} />
                ) : diff.data !== undefined ? (
                  <DiffView text={diff.data || "(empty diff)"} />
                ) : (
                  <p className="muted m-0 text-xs">Loading diff…</p>
                )}
              </div>

              <div className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--lift-1),var(--lift-inset)] space-y-3">
                <label className="f m-0">
                  <span className="text-xs font-semibold text-ink-2">Rejection reason / review feedback</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Describe required changes if rejecting…"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn primary" onClick={() => approve.mutate()} disabled={approve.isPending}>
                    <Check className="size-3.5" />
                    <span>Approve</span>
                  </button>
                  <button
                    className="btn danger"
                    onClick={() => reject.mutate()}
                    disabled={reject.isPending}
                  >
                    <X className="size-3.5" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
