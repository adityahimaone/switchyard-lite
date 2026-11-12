import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, post, type Task } from "./api";
import { ErrorBox, Unavailable } from "./ui";
import { useBoardId } from "./Board";

export function DiffView({ text }: { text: string }) {
  return (
    <pre className="diff" aria-label="diff">
      {text.split("\n").map((l, i) => (
        <span key={i} className={l.startsWith("@@") ? "hunk" : l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : undefined}>{l || " "}{"\n"}</span>
      ))}
    </pre>
  );
}

export function ReviewScreen({ taskId, pick }: { taskId?: string; pick: (id: string) => void }) {
  const qc = useQueryClient();
  const { boardId } = useBoardId();
  const queue = useQuery({ queryKey: ["tasks", boardId, "review"], enabled: !!boardId, refetchInterval: 5000,
    queryFn: () => api<Task[]>(`/api/v1/boards/${boardId}/tasks?status=review`) });
  const id = taskId ?? queue.data?.[0]?.id;
  const diff = useQuery({ queryKey: ["diff", id], enabled: !!id, retry: false,
    queryFn: () => api<string | { diff: string }>(`/api/v1/tasks/${id}/diff`).then((d) => (typeof d === "string" ? d : d.diff)) });
  const [reason, setReason] = useState("");
  const done = () => qc.invalidateQueries();
  const approve = useMutation({ mutationFn: () => post(`/api/v1/tasks/${id}/approve`), onSuccess: done });
  const reject = useMutation({ mutationFn: () => post(`/api/v1/tasks/${id}/reject`, { reason }), onSuccess: () => { setReason(""); done(); } });
  return (
    <div>
      <div className="bar"><h2>Review</h2></div>
      <ErrorBox error={queue.error ?? approve.error ?? reject.error} />
      {queue.data?.length === 0 && !taskId && <p className="muted">Nothing awaiting review.</p>}
      <div className="bar">{queue.data?.map((t) => <button key={t.id} className="btn" aria-pressed={t.id === id} onClick={() => pick(t.id)}>{t.title}</button>)}</div>
      {id && (diff.error instanceof ApiError && diff.error.status === 404 ? <Unavailable what="Diff" /> :
        diff.error ? <ErrorBox error={diff.error} /> : diff.data !== undefined ? <DiffView text={diff.data || "(empty diff)"} /> : <p className="muted">Loading diff…</p>)}
      {id && (
        <div className="panel">
          <label className="f">Rejection reason<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="bar">
            <button className="btn primary" onClick={() => approve.mutate()} disabled={approve.isPending}>Approve</button>
            <button className="btn danger" onClick={() => reject.mutate()} disabled={reject.isPending}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}
