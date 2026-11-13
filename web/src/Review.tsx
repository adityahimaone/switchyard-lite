import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderGit2, X } from "lucide-react";
import { api, ApiError, apiOr, post, type Task } from "./api";
import { ErrorBox, Lamp, Unavailable } from "./ui";
import { useBoardId } from "./Board";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";

export function DiffView({ text }: { text: string }) {
  const lines = text.split("\n");
  const adds = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const dels = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  return (
    <div>
      <div className="bar" style={{ marginBottom: 8 }}>
        <span className="badge" style={{ color: "var(--c-success-text)" }}>+{adds} additions</span>
        <span className="badge" style={{ color: "var(--c-danger-text)" }}>−{dels} deletions</span>
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
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();

  const queue = useQuery({
    queryKey: ["tasks", boardId, "review"],
    enabled: !!boardId,
    refetchInterval: 5000,
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
    <div>
      <div className="bar">
        <h2>Review Gate</h2>
        {(boards.data?.length ?? 0) > 1 && (
          <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
        )}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={reviewSettings.data?.auto_merge ?? false}
            onChange={(e) => toggleAutoMerge.mutate(e.target.checked)}
          />
          Auto-merge branch on approve
        </label>
      </div>

      <ErrorBox error={queue.error ?? approve.error ?? reject.error} />

      {queue.data?.length === 0 && !taskId && (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Nothing awaiting review on this board. Tasks enter Review after a worker run succeeds.
          </p>
        </div>
      )}

      {(queue.data?.length ?? 0) > 0 && (
        <div className="bar">
          {queue.data?.map((t) => (
            <button
              key={t.id}
              className={"btn" + (t.id === id ? " primary" : "")}
              aria-pressed={t.id === id}
              onClick={() => pick(t.id)}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      {id && (
        <div>
          {activeTask && (
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="bar" style={{ marginBottom: 6 }}>
                <strong>{activeTask.title}</strong>
                <Lamp status={activeTask.status} />
                <span className="badge mono">{activeTask.id}</span>
                {activeTask.workspace && (
                  <span className="badge inline-flex items-center gap-1">
                    <FolderGit2 className="size-3" />
                    <span>{activeTask.workspace}</span>
                  </span>
                )}
              </div>
              {activeTask.acceptance && (
                <div style={{ fontSize: 12 }}>
                  <b>Acceptance criteria:</b> {activeTask.acceptance}
                </div>
              )}
            </div>
          )}

          {diff.error instanceof ApiError && [404, 409].includes(diff.error.status) ? (
            <Unavailable what="Diff (no git worktree attached to this task)" />
          ) : diff.error ? (
            <ErrorBox error={diff.error} />
          ) : diff.data !== undefined ? (
            <DiffView text={diff.data || "(empty diff)"} />
          ) : (
            <p className="muted">Loading diff…</p>
          )}

          <div className="panel">
            <label className="f">
              Rejection reason / review feedback
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe required changes if rejecting…"
              />
            </label>
            <div className="bar" style={{ marginBottom: 0 }}>
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
  );
}
