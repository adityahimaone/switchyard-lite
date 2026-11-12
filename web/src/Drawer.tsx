import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiOr, NEXT, post, type Comment, type Task, type TaskEvent } from "./api";
import { ErrorBox, Lamp } from "./ui";

export function TaskDrawer({ id, onClose, review }: { id: string; onClose: () => void; review: (id: string) => void }) {
  const qc = useQueryClient();
  const task = useQuery({ queryKey: ["task", id], queryFn: () => api<Task>(`/api/v1/tasks/${id}`), refetchInterval: 4000 });
  const comments = useQuery({ queryKey: ["comments", id], queryFn: () => api<Comment[]>(`/api/v1/tasks/${id}/comments`) });
  const events = useQuery({ queryKey: ["events", id], refetchInterval: 4000, queryFn: () => api<TaskEvent[]>(`/api/v1/events?task_id=${id}`) });
  const attachments = useQuery({ queryKey: ["attachments", id], queryFn: () => apiOr<{ id: number; name: string; size: number }[]>(`/api/v1/tasks/${id}/attachments`, []) });
  const [body, setBody] = useState("");
  const inval = () => qc.invalidateQueries();
  const add = useMutation({ mutationFn: () => post(`/api/v1/tasks/${id}/comments`, { author: "web", body }), onSuccess: () => { setBody(""); inval(); } });
  const move = useMutation({ mutationFn: (to: string) => post(`/api/v1/tasks/${id}/move`, { status: to }), onSuccess: inval });
  const dispatch = useMutation({ mutationFn: () => post(`/api/v1/tasks/${id}/dispatch`), onSuccess: inval });
  const t = task.data;
  return (
    <aside className="drawer" aria-label="Task detail">
      <div className="bar"><h2>{t?.title ?? "Task"}</h2><button className="btn" onClick={onClose} aria-label="Close">✕</button></div>
      <ErrorBox error={task.error ?? move.error ?? dispatch.error ?? add.error} />
      {t && <>
        <p><Lamp status={t.status} /> <span className="muted">{t.executor || "default"}{t.model ? ` · ${t.model}` : ""}{t.effort ? ` · ${t.effort}` : ""} · retries {t.retry_count}</span></p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{t.prompt}</pre>
        {t.acceptance && <p><b>Acceptance:</b> {t.acceptance}</p>}
        {t.workspace && <p className="muted">Workspace: <code>{t.workspace}</code></p>}
        <div className="moves">
          {t.status === "todo" && <button className="btn primary" onClick={() => dispatch.mutate()}>Dispatch</button>}
          {t.status === "review" && <button className="btn primary" onClick={() => review(id)}>Open review</button>}
          {NEXT[t.status].map((n) => <button key={n} className="btn" onClick={() => move.mutate(n)}>→ {n}</button>)}
        </div>
        <h3>Dependencies</h3>
        {t.blocked_by.length ? <ul>{t.blocked_by.map((d) => <li key={d}><code>{d}</code></li>)}</ul> : <p className="muted">None.</p>}
        <h3>Attachments</h3>
        {attachments.data?.length ? <ul>{attachments.data.map((a) => <li key={a.id}>{a.name} <span className="muted">({a.size} B)</span></li>)}</ul> : <p className="muted">None.</p>}
        <h3>Comments</h3>
        {comments.data?.map((c, i) => <p key={c.id ?? i}><b>{c.author}</b>: {c.body}</p>)}
        <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" />
          <button className="btn" style={{ marginTop: 6 }}>Comment</button>
        </form>
        <h3>Timeline</h3>
        <ol style={{ paddingLeft: 18 }}>
          {events.data?.map((e) => <li key={e.id}><b>{e.kind}</b> <span className="muted">{new Date(e.created_at * (e.created_at > 1e12 ? 1 : 1000)).toLocaleString()}</span></li>)}
        </ol>
      </>}
    </aside>
  );
}

export { apiOr };
