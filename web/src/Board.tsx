import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiOr, NEXT, normalizeModels, post, STATUSES, type Board, type Status, type Task } from "./api";
import { ErrorBox, Lamp } from "./ui";

export function useBoards() { return useQuery({ queryKey: ["boards"], queryFn: () => api<Board[]>("/api/v1/boards") }); }
export function useBoardId() {
  const b = useBoards();
  return { boardId: b.data?.[0]?.id, boards: b };
}

export function BoardScreen({ open }: { open: (id: string) => void }) {
  const qc = useQueryClient();
  const { boardId, boards } = useBoardId();
  const tasks = useQuery({ queryKey: ["tasks", boardId], enabled: !!boardId, refetchInterval: 4000,
    queryFn: () => api<Task[]>(`/api/v1/boards/${boardId}/tasks`) });
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: Status }) => post(`/api/v1/tasks/${id}/move`, { status: to }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const [over, setOver] = useState("");
  const [creating, setCreating] = useState(false);
  const mk = useMutation({ mutationFn: () => post("/api/v1/boards", { name: "Main" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["boards"] }) });

  if (boards.isSuccess && !boardId) return <div><p>No board yet.</p><button className="btn primary" onClick={() => mk.mutate()}>Create board</button></div>;
  return (
    <div>
      <div className="bar"><h2>Board</h2><button className="btn primary" onClick={() => setCreating(true)} disabled={!boardId}>New task</button></div>
      <ErrorBox error={tasks.error ?? move.error ?? boards.error} />
      {creating && boardId && <CreateTask boardId={boardId} onClose={() => setCreating(false)} />}
      <div className="board">
        {STATUSES.map((s) => (
          <div key={s} className={"col" + (over === s ? " over" : "")}
            onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver("")}
            onDrop={(e) => { e.preventDefault(); setOver(""); const id = e.dataTransfer.getData("text/plain"); if (id) move.mutate({ id, to: s }); }}>
            <h3><Lamp status={s} />({tasks.data?.filter((t) => t.status === s).length ?? 0})</h3>
            {tasks.data?.filter((t) => t.status === s).map((t) => (
              <div key={t.id} className="card" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)} onClick={() => open(t.id)}>
                <div>{t.title}</div>
                <div className="meta">{t.executor || "default"}{t.model ? ` · ${t.model}` : ""}</div>
                <div className="moves" onClick={(e) => e.stopPropagation()}>
                  {NEXT[t.status].map((n) => <button key={n} className="btn" onClick={() => move.mutate({ id: t.id, to: n })}>→ {n}</button>)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const EXECUTORS = ["claude", "codex", "commandcode", "omp", "dsh"];
const EFFORTS = ["", "low", "medium", "high"];

export function CreateTask({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", prompt: "", acceptance: "", workspace: "", executor: "", model: "", effort: "", branch: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value, ...(k === "executor" ? { model: "" } : {}) }));
  const models = useQuery({ queryKey: ["models", f.executor], enabled: !!f.executor,
    queryFn: async () => normalizeModels(await apiOr<unknown>(`/api/v1/models?executor=${encodeURIComponent(f.executor)}`, [])) });
  const ws = useQuery({ queryKey: ["ws", f.workspace], enabled: f.workspace.length > 1,
    queryFn: () => apiOr<{ is_git?: boolean; branches?: string[] }>(`/api/v1/workspaces/inspect?path=${encodeURIComponent(f.workspace)}`, {}) });
  const isGit = ws.data?.is_git === true; // non-git (or unknown) workspaces hide the branch selector
  const create = useMutation({
    mutationFn: () => post("/api/v1/tasks", { board_id: boardId, ...f, branch: isGit ? f.branch : "" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); },
  });
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <h3 style={{ marginTop: 0 }}>New task</h3>
      <ErrorBox error={create.error} />
      <label className="f">Title<input required value={f.title} onChange={set("title")} /></label>
      <label className="f">Prompt<textarea rows={3} value={f.prompt} onChange={set("prompt")} /></label>
      <label className="f">Acceptance<textarea rows={2} value={f.acceptance} onChange={set("acceptance")} /></label>
      <label className="f">Workspace path<input value={f.workspace} onChange={set("workspace")} /></label>
      {isGit && (
        <label className="f">Branch
          {ws.data?.branches?.length ? <select value={f.branch} onChange={set("branch")}><option value="">(current)</option>{ws.data.branches.map((b) => <option key={b}>{b}</option>)}</select>
            : <input value={f.branch} onChange={set("branch")} />}
        </label>
      )}
      <label className="f">Executor
        <select value={f.executor} onChange={set("executor")}><option value="">(board default)</option>{EXECUTORS.map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <label className="f">Model
        <select value={f.model} onChange={set("model")} disabled={!f.executor}>
          <option value="">(executor default)</option>
          {models.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="f">Effort
        <select value={f.effort} onChange={set("effort")}>{EFFORTS.map((x) => <option key={x} value={x}>{x || "(default)"}</option>)}</select>
      </label>
      <div className="bar"><button className="btn primary" disabled={create.isPending}>Create</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
    </form>
  );
}
