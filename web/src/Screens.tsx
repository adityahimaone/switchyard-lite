import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, apiOr, del, post, setToken, STATUSES, type Task, type Worker } from "./api";
import { ErrorBox, Lamp, Panel, statusColor, Unavailable } from "./ui";
import { useBoardId } from "./Board";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Overview {
  counts: Record<string, number>;
  total: number;
  boards: number;
  workspaces?: number;
  workers?: number;
  pipelines?: number;
  health: { status: string; db: boolean };
}

export function OverviewScreen() {
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();
  const [scopeBoard, setScopeBoard] = useState(false);

  const q = useQuery({
    queryKey: ["overview", scopeBoard ? boardId : "all"],
    refetchInterval: 5000,
    queryFn: () =>
      api<Overview>(
        `/api/v1/overview${scopeBoard && boardId ? `?board_id=${encodeURIComponent(boardId)}` : ""}`
      ),
  });

  return (
    <div>
      <div className="bar">
        <h2>Overview</h2>
        <a href="#/logs" className="chip inline-flex items-center gap-1" title="Open the Logs page">
          Live Activity Stream → Logs
        </a>
        {(boards.data?.length ?? 0) > 0 && (
          <button
            type="button"
            className={"chip" + (scopeBoard ? " active" : "")}
            onClick={() => setScopeBoard((v) => !v)}
          >
            {scopeBoard && activeBoard ? `Board: ${activeBoard.name}` : "All boards"}
          </button>
        )}
        {(boards.data?.length ?? 0) > 1 && scopeBoard && (
          <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
        )}
        {q.data && (
          <span
            className="lamp"
            style={{
              ["--lamp" as string]:
                q.data.health.status === "ok" ? "var(--c-success)" : "var(--c-danger)",
            }}
          >
            <span className="lamp-dot pulse" />
            Health: {q.data.health.status}
          </span>
        )}
      </div>

      <ErrorBox error={q.error} />

      {q.data && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <b>{q.data.total}</b>
              <span>Total tasks</span>
            </div>
            <div className="stat">
              <b>{q.data.boards}</b>
              <span>Boards</span>
            </div>
            {q.data.workspaces !== undefined && (
              <div className="stat">
                <b>{q.data.workspaces}</b>
                <span>Workspaces</span>
              </div>
            )}
            {q.data.workers !== undefined && (
              <div className="stat">
                <b>{q.data.workers}</b>
                <span>Workers</span>
              </div>
            )}
            {STATUSES.map((s) => (
              <div key={s} className="stat">
                <b>{q.data!.counts[s] ?? 0}</b>
                <Lamp status={s} />
              </div>
            ))}
          </div>

          {q.data.total > 0 && (
            <Panel title="Task Distribution">
              <div
                style={{
                  display: "flex",
                  height: 12,
                  borderRadius: 999,
                  overflow: "hidden",
                  background: "var(--c-well)",
                  gap: 2,
                }}
              >
                {STATUSES.map((s) => {
                  const n = q.data!.counts[s] ?? 0;
                  if (!n) return null;
                  const pct = (n / q.data!.total) * 100;
                  return (
                    <div
                      key={s}
                      title={`${s}: ${n} (${Math.round(pct)}%)`}
                      style={{ width: `${pct}%`, background: statusColor(s) }}
                    />
                  );
                })}
              </div>
            </Panel>
          )}
        </>
      )}

    </div>
  );
}

export { WorkspacesPage as WorkspacesScreen } from "@/components/workspaces/WorkspacesPage";
export { LogsPage as LogsScreen } from "@/components/logs/LogsPage";

export function WorkersScreen() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const q = useQuery({
    queryKey: ["workers"],
    refetchInterval: 4000,
    queryFn: () => apiOr<Worker[] | null>("/api/v1/workers", null),
  });

  const add = useMutation({
    mutationFn: () => post("/api/v1/workers", { name: name.trim(), url: url.trim() }),
    onSuccess: () => {
      setName("");
      setUrl("");
      qc.invalidateQueries({ queryKey: ["workers"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/v1/workers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <div>
      <div className="bar">
        <h2>Workers</h2>
        <span className="bar-sub">Node-agent endpoints executing claimed tasks.</span>
      </div>
      <ErrorBox error={q.error ?? add.error ?? remove.error} />

      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <h3>Register worker</h3>
        <div className="form-grid">
          <label className="f">
            Worker name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. mac-node-agent"
            />
          </label>
          <label className="f">
            Node-Agent URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://100.75.2.78:8788"
              className="mono"
            />
          </label>
        </div>
        <button className="btn primary" disabled={add.isPending || !name.trim()}>
          Register worker
        </button>
      </form>

      {q.data === null && <Unavailable what="Workers" />}
      {q.data &&
        (q.data.length === 0 ? (
          <p className="muted">No workers registered.</p>
        ) : (
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>URL / Endpoint</th>
                  <th>Executor</th>
                  <th>Status</th>
                  <th>Task</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <strong>{w.name ?? w.id}</strong>
                    </td>
                    <td className="mono muted">{w.url || "—"}</td>
                    <td>{w.executor ?? "—"}</td>
                    <td>
                      <Lamp status={w.status ?? "running"} />
                    </td>
                    <td>{w.task_id ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => remove.mutate(w.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

export interface Stage {
  id: string;
  name?: string;
  status: string;
  depends_on?: string[];
}

interface Run {
  id: string;
  name?: string;
  template?: string;
  goal?: string;
  status?: string;
  stages?: Stage[];
}

export function layers(stages: Stage[]): Stage[][] {
  const depth = new Map<string, number>();
  const byId = new Map(stages.map((s) => [s.id, s]));
  const d = (s: Stage, seen = new Set<string>()): number => {
    if (depth.has(s.id)) return depth.get(s.id)!;
    if (seen.has(s.id)) return 0;
    seen.add(s.id);
    const v =
      Math.max(
        -1,
        ...(s.depends_on ?? []).map((x) => (byId.get(x) ? d(byId.get(x)!, seen) : -1))
      ) + 1;
    depth.set(s.id, v);
    return v;
  };
  const out: Stage[][] = [];
  stages.forEach((s) => (out[d(s)] ??= []).push(s));
  return out.filter(Boolean);
}

export function Dag({ stages }: { stages: Stage[] }) {
  const cols = layers(stages),
    W = 180,
    H = 56,
    GX = 64,
    GY = 22;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, i) =>
    c.forEach((s, j) => pos.set(s.id, { x: 12 + i * (W + GX), y: 12 + j * (H + GY) }))
  );
  const w = 24 + cols.length * (W + GX),
    h = 24 + Math.max(1, ...cols.map((c) => c.length)) * (H + GY);
  return (
    <svg width={w} height={h} role="img" aria-label="stage graph" style={{ maxWidth: "100%" }}>
      {stages.flatMap((s) =>
        (s.depends_on ?? []).map((p) => {
          const a = pos.get(p),
            b = pos.get(s.id);
          return a && b ? (
            <line
              key={p + s.id}
              x1={a.x + W}
              y1={a.y + H / 2}
              x2={b.x}
              y2={b.y + H / 2}
              stroke="var(--c-line-strong)"
              strokeWidth={2}
            />
          ) : null;
        })
      )}
      {stages.map((s) => {
        const p = pos.get(s.id)!;
        const fill =
          s.status === "running" || s.status === "in_progress"
            ? "var(--c-st-in_progress)"
            : s.status === "succeeded" || s.status === "done"
            ? "var(--c-st-done)"
            : s.status === "failed" || s.status === "blocked"
            ? "var(--c-st-failed)"
            : s.status === "review" || s.status === "evolved"
            ? "var(--c-st-review)"
            : "var(--c-ink-4)";
        return (
          <g key={s.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: "pointer" }}>
            <rect width={W} height={H} rx={10} fill="var(--c-surface)" stroke="var(--c-line-strong)" />
            <text x={14} y={23} fill="var(--c-ink)" fontSize={13} fontWeight={600}>
              {s.name ?? s.id}
            </text>
            <circle cx={18} cy={40} r={4} fill={fill} />
            <text x={28} y={44} fill="var(--c-ink-3)" fontSize={11}>
              {s.status}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PipelineScreen() {
  const qc = useQueryClient();
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();
  const [goal, setGoal] = useState("");
  const [template, setTemplate] = useState("design-thinking");

  const templates = useQuery({
    queryKey: ["pipeline-templates"],
    queryFn: () => apiOr<{ name: string; description?: string }[]>("/api/v1/pipelines/templates", []),
  });

  const q = useQuery({
    queryKey: ["pipelines"],
    refetchInterval: 3000,
    queryFn: () => apiOr<Run[] | null>("/api/v1/pipelines", null),
  });

  const start = useMutation({
    mutationFn: () => post("/api/v1/pipelines", { template, board_id: boardId, goal }),
    onSuccess: () => {
      setGoal("");
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => post(`/api/v1/pipelines/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });

  return (
    <div>
      <div className="bar">
        <h2>Pipeline runs</h2>
        {(boards.data?.length ?? 0) > 1 && (
          <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
        )}
      </div>
      <ErrorBox error={q.error ?? start.error ?? cancel.error} />
      {boardId && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (goal.trim()) start.mutate();
          }}
        >
          <div className="bar" style={{ marginBottom: 0 }}>
            {(templates.data?.length ?? 0) > 0 && (
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger className="w-[180px]" aria-label="Pipeline template" size="default">
                  <SelectValue placeholder="Choose template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.data?.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Start design-thinking pipeline goal…"
              style={{ flex: 1 }}
            />
            <button className="btn primary" disabled={start.isPending || !goal.trim()}>
              Start pipeline
            </button>
          </div>
        </form>
      )}
      {q.data === null && <Unavailable what="Pipelines" />}
      {q.data?.length === 0 && <p className="muted">No pipeline runs.</p>}
      {q.data?.map((r) => (
        <Panel
          key={r.id}
          title={
            <span>
              {r.name ?? r.id}
              {r.status ? ` — ${r.status}` : ""}
              {r.goal ? <span className="muted"> · {r.goal}</span> : null}
            </span>
          }
          actions={
            r.status === "running" ? (
              <button
                type="button"
                className="btn sm danger"
                onClick={() => cancel.mutate(r.id)}
                disabled={cancel.isPending}
              >
                Cancel run
              </button>
            ) : undefined
          }
        >
          {r.stages?.length ? (
            <div className="dot-canvas">
              <Dag stages={r.stages} />
            </div>
          ) : (
            <p className="muted">No stages.</p>
          )}
        </Panel>
      ))}
    </div>
  );
}

export function FlowScreen({ open }: { open: (id: string) => void }) {
  const { boardId, activeBoard, boards, setBoardId } = useBoardId();
  const [showAll, setShowAll] = useState(false);

  const q = useQuery({
    queryKey: ["tasks", boardId],
    enabled: !!boardId,
    refetchInterval: 5000,
    queryFn: () => api<Task[]>(`/api/v1/boards/${boardId}/tasks`),
  });

  const all = q.data ?? [];
  const connected = all.filter(
    (t) => t.blocked_by.length || all.some((o) => o.blocked_by.includes(t.id))
  );
  const source = showAll ? all : connected;

  const stages: Stage[] = source.map((t) => ({
    id: t.id,
    name: t.title.slice(0, 22),
    status: t.status,
    depends_on: t.blocked_by,
  }));

  return (
    <div>
      <div className="bar">
        <h2>Flow map</h2>
        <button
          type="button"
          className={"chip" + (showAll ? " active" : "")}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Showing all board tasks" : "Dependencies only"}
        </button>
        {(boards.data?.length ?? 0) > 1 && (
          <BoardSwitcher boards={boards.data} value={boardId} onChange={setBoardId} className="w-auto min-w-[180px]" />
        )}
      </div>
      <ErrorBox error={q.error} />
      {stages.length ? (
        <div
          className="dot-canvas"
          onClick={(e) => {
            const g = (e.target as Element).closest("g");
            const i = g && [...g.parentElement!.querySelectorAll("g")].indexOf(g);
            if (i !== null && i !== undefined && i >= 0) open(stages[i].id);
          }}
        >
          <Dag stages={stages} />
        </div>
      ) : (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            No task dependencies yet. Toggle &ldquo;Showing all board tasks&rdquo; above or link tasks via Dependencies.
          </p>
        </div>
      )}
    </div>
  );
}

const PALETTES = [
  { id: "", label: "Signal Blue (Default)" },
  { id: "lime", label: "Lime Forest" },
  { id: "zen", label: "Zen Linen" },
] as const;

export function SettingsScreen({ logout }: { logout: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("agent");
  const [scope, setScope] = useState("write");

  const list = useQuery({
    queryKey: ["tokens"],
    queryFn: () => apiOr<{ id: number; name: string; scope: string }[] | null>("/api/v1/tokens", null),
  });

  const create = useMutation({
    mutationFn: () => post<{ token: string }>("/api/v1/tokens", { name, scope }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => del(`/api/v1/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const [palette, setPalette] = useState(
    document.documentElement.getAttribute("data-theme-palette") ?? ""
  );
  const [compact, setCompact] = useState(
    document.documentElement.getAttribute("data-density") === "compact"
  );

  function applyPalette(next: string) {
    setPalette(next);
    if (next) {
      document.documentElement.setAttribute("data-theme-palette", next);
      localStorage.setItem("switchyard.palette", next);
    } else {
      document.documentElement.removeAttribute("data-theme-palette");
      localStorage.removeItem("switchyard.palette");
    }
  }

  function applyCompact(next: boolean) {
    setCompact(next);
    if (next) {
      document.documentElement.setAttribute("data-density", "compact");
      localStorage.setItem("switchyard.density", "compact");
    } else {
      document.documentElement.removeAttribute("data-density");
      localStorage.removeItem("switchyard.density");
    }
  }

  return (
    <div>
      <div className="bar">
        <h2>Settings</h2>
      </div>

      <Panel title="Appearance & Theme Palette">
        <div className="bar" style={{ marginBottom: 12 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={dark}
              onChange={(e) => {
                setDark(e.target.checked);
                document.documentElement.classList.toggle("dark", e.target.checked);
                localStorage.setItem("switchyard.dark", e.target.checked ? "1" : "");
              }}
            />
            Dark mode
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 16 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={compact}
              onChange={(e) => applyCompact(e.target.checked)}
            />
            Compact card density
          </label>
        </div>

        <div className="chip-row">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={"chip" + (palette === p.id ? " active" : "")}
              onClick={() => applyPalette(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="API tokens">
        {list.data === null ? (
          <p className="muted">
            Token management API is not available; create tokens with{" "}
            <code>switchyard-lite token create</code>.
          </p>
        ) : (
          <>
            <ErrorBox error={create.error ?? revoke.error} />
            <div className="bar">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: 160 }}
                aria-label="Token name"
              />
              <SearchSelect
                value={scope}
                onValueChange={setScope}
                ariaLabel="Scope"
                size="default"
                className="w-[130px]"
                options={[
                  { value: "read", label: "read", sublabel: "read-only access" },
                  { value: "write", label: "write", sublabel: "read + mutate tasks" },
                  { value: "admin", label: "admin", sublabel: "full control" },
                ]}
                searchPlaceholder="Search scopes…"
              />
              <button className="btn primary" onClick={() => create.mutate()}>
                Create
              </button>
            </div>
            {create.data && (
              <p>
                New token (copy now): <code>{create.data.token}</code>
              </p>
            )}
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>
                      <span className="badge mono">{t.scope}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => revoke.mutate(t.id)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>

      <Panel title="Session">
        <button
          className="btn"
          onClick={() => {
            setToken("");
            logout();
          }}
        >
          Sign out (forget token)
        </button>
      </Panel>
    </div>
  );
}
