import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, apiOr, post, setToken, STATUSES, type Task } from "./api";
import { ErrorBox, Lamp, Panel, Unavailable } from "./ui";
import { useBoardId } from "./Board";

interface Overview { counts: Record<string, number>; total: number; boards: number; health: { status: string; db: boolean } }

export function OverviewScreen() {
  const q = useQuery({ queryKey: ["overview"], refetchInterval: 5000, queryFn: () => api<Overview>("/api/v1/overview") });
  return (
    <div><div className="bar"><h2>Overview</h2>{q.data && <span className="lamp" style={{ ["--lamp" as string]: q.data.health.status === "ok" ? "var(--c-success)" : "var(--c-danger)" }}>Health: {q.data.health.status}</span>}</div>
      <ErrorBox error={q.error} />
      {q.data && <div className="grid">
        <div className="stat"><b>{q.data.total}</b>Total tasks</div>
        {STATUSES.map((s) => <div key={s} className="stat"><b>{q.data!.counts[s] ?? 0}</b><Lamp status={s} /></div>)}
      </div>}
    </div>
  );
}

interface Worker { id: string; name?: string; status?: string; executor?: string; task_id?: string }
export function WorkersScreen() {
  const q = useQuery({ queryKey: ["workers"], refetchInterval: 4000, queryFn: () => apiOr<Worker[] | null>("/api/v1/workers", null) });
  return (
    <div><div className="bar"><h2>Workers</h2></div><ErrorBox error={q.error} />
      {q.data === null && <Unavailable what="Workers" />}
      {q.data && (q.data.length === 0 ? <p className="muted">No workers registered.</p> :
        <table><thead><tr><th>Worker</th><th>Executor</th><th>Status</th><th>Task</th></tr></thead>
          <tbody>{q.data.map((w) => <tr key={w.id}><td>{w.name ?? w.id}</td><td>{w.executor ?? "—"}</td><td><Lamp status={w.status ?? "unknown"} /></td><td>{w.task_id ?? "—"}</td></tr>)}</tbody></table>)}
    </div>
  );
}

interface Stage { id: string; name?: string; status: string; depends_on?: string[] }
interface Run { id: string; name?: string; status?: string; stages?: Stage[] }

export function layers(stages: Stage[]): Stage[][] {
  const depth = new Map<string, number>();
  const byId = new Map(stages.map((s) => [s.id, s]));
  const d = (s: Stage, seen = new Set<string>()): number => {
    if (depth.has(s.id)) return depth.get(s.id)!;
    if (seen.has(s.id)) return 0;
    seen.add(s.id);
    const v = Math.max(-1, ...(s.depends_on ?? []).map((x) => (byId.get(x) ? d(byId.get(x)!, seen) : -1))) + 1;
    depth.set(s.id, v); return v;
  };
  const out: Stage[][] = [];
  stages.forEach((s) => (out[d(s)] ??= []).push(s));
  return out.filter(Boolean);
}

export function Dag({ stages }: { stages: Stage[] }) {
  const cols = layers(stages), W = 170, H = 54, GX = 60, GY = 20;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, i) => c.forEach((s, j) => pos.set(s.id, { x: 10 + i * (W + GX), y: 10 + j * (H + GY) })));
  const w = 20 + cols.length * (W + GX), h = 20 + Math.max(1, ...cols.map((c) => c.length)) * (H + GY);
  return (
    <svg width={w} height={h} role="img" aria-label="stage graph" style={{ maxWidth: "100%" }}>
      {stages.flatMap((s) => (s.depends_on ?? []).map((p) => { const a = pos.get(p), b = pos.get(s.id); return a && b ? <line key={p + s.id} x1={a.x + W} y1={a.y + H / 2} x2={b.x} y2={b.y + H / 2} stroke="var(--c-line-strong)" strokeWidth={2} /> : null; }))}
      {stages.map((s) => { const p = pos.get(s.id)!; return (
        <g key={s.id} transform={`translate(${p.x},${p.y})`}>
          <rect width={W} height={H} rx={8} fill="var(--c-surface)" stroke="var(--c-line-strong)" />
          <text x={12} y={22} fill="var(--c-ink)" fontSize={13}>{s.name ?? s.id}</text>
          <circle cx={16} cy={38} r={4} fill={s.status === "running" ? "var(--c-st-in_progress)" : s.status === "succeeded" || s.status === "done" ? "var(--c-st-done)" : s.status === "failed" ? "var(--c-st-failed)" : "var(--c-ink-4)"} />
          <text x={26} y={42} fill="var(--c-ink-3)" fontSize={11}>{s.status}</text>
        </g>); })}
    </svg>
  );
}

export function PipelineScreen() {
  const qc = useQueryClient();
  const { boardId } = useBoardId();
  const [goal, setGoal] = useState("");
  const q = useQuery({ queryKey: ["pipelines"], refetchInterval: 3000, queryFn: () => apiOr<Run[] | null>("/api/v1/pipelines", null) });
  const start = useMutation({
    mutationFn: () => post("/api/v1/pipelines", { template: "design-thinking", board_id: boardId, goal }),
    onSuccess: () => { setGoal(""); qc.invalidateQueries({ queryKey: ["pipelines"] }); qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });
  return (
    <div><div className="bar"><h2>Pipeline runs</h2></div><ErrorBox error={q.error ?? start.error} />
      {boardId && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); if (goal.trim()) start.mutate(); }}>
          <div className="bar">
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Start design-thinking pipeline goal…" style={{ flex: 1 }} />
            <button className="btn primary" disabled={start.isPending || !goal.trim()}>Start pipeline</button>
          </div>
        </form>
      )}
      {q.data === null && <Unavailable what="Pipelines" />}
      {q.data?.length === 0 && <p className="muted">No pipeline runs.</p>}
      {q.data?.map((r) => <Panel key={r.id} title={`${r.name ?? r.id}${r.status ? " — " + r.status : ""}`}>{r.stages?.length ? <div style={{ overflow: "auto" }}><Dag stages={r.stages} /></div> : <p className="muted">No stages.</p>}</Panel>)}
    </div>
  );
}

export function FlowScreen({ open }: { open: (id: string) => void }) {
  const { boardId } = useBoardId();
  const q = useQuery({ queryKey: ["tasks", boardId], enabled: !!boardId, refetchInterval: 5000, queryFn: () => api<Task[]>(`/api/v1/boards/${boardId}/tasks`) });
  const stages: Stage[] = (q.data ?? []).filter((t) => t.blocked_by.length || (q.data ?? []).some((o) => o.blocked_by.includes(t.id)))
    .map((t) => ({ id: t.id, name: t.title.slice(0, 22), status: t.status, depends_on: t.blocked_by }));
  return (
    <div><div className="bar"><h2>Flow map</h2></div><ErrorBox error={q.error} />
      {stages.length ? <div style={{ overflow: "auto" }} onClick={(e) => { const g = (e.target as Element).closest("g"); const i = g && [...g.parentElement!.querySelectorAll("g")].indexOf(g); if (i !== null && i !== undefined && i >= 0) open(stages[i].id); }}><Dag stages={stages} /></div> : <p className="muted">No task dependencies yet.</p>}
    </div>
  );
}

export function SettingsScreen({ logout }: { logout: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("agent");
  const [scope, setScope] = useState("write");
  const list = useQuery({ queryKey: ["tokens"], queryFn: () => apiOr<{ id: number; name: string; scope: string }[] | null>("/api/v1/tokens", null) });
  const create = useMutation({ mutationFn: () => post<{ token: string }>("/api/v1/tokens", { name, scope }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }) });
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  return (
    <div><div className="bar"><h2>Settings</h2></div>
      <Panel title="Appearance"><label><input type="checkbox" style={{ width: "auto" }} checked={dark} onChange={(e) => { setDark(e.target.checked); document.documentElement.classList.toggle("dark", e.target.checked); localStorage.setItem("switchyard.dark", e.target.checked ? "1" : ""); }} /> Dark mode</label></Panel>
      <Panel title="API tokens">
        {list.data === null ? <p className="muted">Token management API is not available; create tokens with <code>switchyard-lite token create</code>.</p> : <>
          <ErrorBox error={create.error} />
          <div className="bar"><input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} aria-label="Token name" />
            <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: 100 }} aria-label="Scope"><option>read</option><option>write</option><option>admin</option></select>
            <button className="btn primary" onClick={() => create.mutate()}>Create</button></div>
          {create.data && <p>New token (copy now): <code>{create.data.token}</code></p>}
          <table><tbody>{list.data?.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.scope}</td></tr>)}</tbody></table></>}
      </Panel>
      <Panel title="Session"><button className="btn" onClick={() => { setToken(""); logout(); }}>Sign out (forget token)</button></Panel>
    </div>
  );
}
