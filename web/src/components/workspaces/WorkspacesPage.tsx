import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Apple,
  FolderGit2,
  GitBranch,
  HardDrive,
  Laptop,
  Monitor,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  apiOr,
  del,
  platformOfWorkspace,
  post,
  put,
  type PlatformKey,
  type Task,
  type Worker,
  type Workspace,
} from "@/api";
import { cn } from "@/lib/utils";
import { ErrorBox } from "@/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export const PLATFORM_ORDER: PlatformKey[] = ["mac", "windows", "current", "linux"];

export const PLATFORM_META: Record<PlatformKey, { label: string; badge: string; Icon: typeof Monitor }> = {
  mac: { label: "macOS", badge: "mac", Icon: Apple },
  windows: { label: "Windows", badge: "windows", Icon: Laptop },
  current: { label: "Current machine", badge: "current", Icon: Monitor },
  linux: { label: "Linux", badge: "linux", Icon: HardDrive },
};

const SSH_PRESETS: Record<string, { path: string; name: string; os: "mac" | "windows" | "linux"; id: string }> = {
  "mac-tailscale": {
    id: "mac-dev",
    path: "/Users/adityahimawan/Development",
    name: "Mac Dev",
    os: "mac",
  },
  "windows-tailscale": {
    id: "windows-dev",
    path: "C:\\Users\\user",
    name: "Windows Dev",
    os: "windows",
  },
};

const OS_OPTIONS = [
  { value: "mac", label: "macOS" },
  { value: "windows", label: "Windows" },
  { value: "linux", label: "Linux" },
] as const;

type WsStatus = "connected" | "unreachable" | "unknown" | "local";

const STATUS_STYLE: Record<WsStatus, { tone: string; dot: string; label: string; filled: boolean }> = {
  connected: { tone: "text-success-text", dot: "bg-success", label: "Connected", filled: true },
  local: { tone: "text-ink-2", dot: "bg-success", label: "Local", filled: true },
  unreachable: { tone: "text-danger-text", dot: "bg-danger", label: "Unreachable", filled: true },
  unknown: { tone: "text-ink-3", dot: "border border-ink-4 bg-transparent", label: "Not pinged", filled: false },
};

function statusStyleFor(w: Workspace) {
  const raw = (w.status || "").toLowerCase();
  if (raw === "connected" || raw === "online" || raw === "ok") return STATUS_STYLE.connected;
  if (raw === "local") return STATUS_STYLE.local;
  if (raw === "unreachable" || raw === "offline" || raw === "missing" || raw === "error") {
    return STATUS_STYLE.unreachable;
  }
  return w.host || w.node ? STATUS_STYLE.unknown : STATUS_STYLE.local;
}

interface PingPoint {
  at: number;
  ok: boolean;
  ms?: number;
}

export function groupWorkspacesByPlatform(workspaces: Workspace[]): [PlatformKey, Workspace[]][] {
  const buckets = new Map<PlatformKey, Workspace[]>();
  for (const ws of workspaces) {
    const key = platformOfWorkspace(ws);
    buckets.set(key, [...(buckets.get(key) ?? []), ws]);
  }
  return PLATFORM_ORDER.filter((k) => (buckets.get(k)?.length ?? 0) > 0).map((k) => [
    k,
    buckets.get(k) ?? [],
  ]);
}

function EkgTrace({
  points,
  ok,
  running,
  latencyMs,
}: {
  points: PingPoint[];
  ok: boolean;
  running: boolean;
  latencyMs?: number;
}) {
  const pts = points.slice(-24);
  const last = pts[pts.length - 1];
  const offline = (!ok && pts.length > 0) || (last ? !last.ok : false);
  const stroke = offline ? "var(--c-danger)" : "var(--c-success)";
  const good = pts.filter((p) => p.ok && p.ms != null).map((p) => p.ms!);
  const min = good.length ? Math.min(...good) : 0;
  const max = good.length ? Math.max(...good) : 10;

  const w = 220;
  const h = 34;
  const mid = h / 2;

  const pathD = useMemo(() => {
    if (pts.length === 0) {
      return `M 0 ${mid} L 52 ${mid} L 60 11 L 68 23 L 76 ${mid} L 146 ${mid} L 154 9 L 162 25 L 170 ${mid} L ${w} ${mid}`;
    }
    const step = w / 23;
    const coords = Array.from({ length: 24 }, (_, idx) => {
      const p = pts[idx - (24 - pts.length)];
      const x = Math.round(idx * step);
      if (!p || !p.ok || p.ms == null) return `${x} ${mid}`;
      const span = Math.max(1, max - min);
      const norm = (p.ms - min) / span;
      const y = Math.round(h - 6 - norm * (h - 12));
      return `${x} ${y}`;
    });
    return "M " + coords.join(" L ");
  }, [pts, max, min]);

  return (
    <div className="ekg-box mt-2.5 flex items-center justify-between gap-2" title="Workspace heartbeat telemetry">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full overflow-visible">
        <path
          d={pathD}
          fill="none"
          stroke={stroke}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {running && (
          <circle cx={w - 4} cy={mid} r="3" fill="var(--c-accent)" />
        )}
      </svg>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-3">
        {latencyMs !== undefined ? `${latencyMs}ms` : running ? "active" : "ready"}
      </span>
    </div>
  );
}

function WorkspaceSheet({
  initial,
  workers,
  onClose,
  onSaved,
}: {
  initial?: Workspace | null;
  workers: Worker[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const initialTransport = initial?.host ? "ssh" : "local";
  const [transport, setTransport] = useState<"local" | "ssh">(initialTransport);
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [path, setPath] = useState(initial?.path ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [os, setOs] = useState(initial?.os ?? (initialTransport === "local" ? "linux" : "mac"));
  const [kind, setKind] = useState(initial?.kind || (initial?.git ? "repo" : "dir"));
  const [labels, setLabels] = useState(initial?.labels?.join(", ") ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [customHost, setCustomHost] = useState<boolean>(
    Boolean(initial?.host && !SSH_PRESETS[initial.host] && !workers.some((w) => w.name === initial.host))
  );
  const [err, setErr] = useState<string | null>(null);

  const inspect = useQuery({
    queryKey: ["ws-inspect", path],
    enabled: transport === "local" && path.trim().length > 1,
    queryFn: () =>
      apiOr<{ is_git?: boolean; branches?: string[] }>(
        `/api/v1/workspaces/inspect?path=${encodeURIComponent(path.trim())}`,
        {}
      ),
  });

  const applyMachinePreset = (preset: "current" | "mac" | "windows") => {
    setErr(null);
    if (preset === "current") {
      setTransport("local");
      setHost("");
      setCustomHost(false);
      setOs("linux");
      if (!editing && !name.trim()) setName("Current machine");
    } else if (preset === "mac") {
      const p = SSH_PRESETS["mac-tailscale"];
      setTransport("ssh");
      setHost("mac-tailscale");
      setCustomHost(false);
      setOs("mac");
      if (!editing) {
        if (!id.trim()) setId(p.id);
        if (!name.trim() || name === "Current machine" || name === "Windows Dev") setName(p.name);
        if (!path.trim() || path === SSH_PRESETS["windows-tailscale"].path) setPath(p.path);
      }
    } else {
      const p = SSH_PRESETS["windows-tailscale"];
      setTransport("ssh");
      setHost("windows-tailscale");
      setCustomHost(false);
      setOs("windows");
      if (!editing) {
        if (!id.trim()) setId(p.id);
        if (!name.trim() || name === "Current machine" || name === "Mac Dev") setName(p.name);
        if (!path.trim() || path === SSH_PRESETS["mac-tailscale"].path) setPath(p.path);
      }
    }
  };

  const pickHost = (v: string) => {
    if (v === "__custom__") {
      setCustomHost(true);
      setHost("");
      return;
    }
    setCustomHost(false);
    setHost(v);
    const preset = SSH_PRESETS[v];
    if (preset) {
      setOs(preset.os);
      if (!editing) {
        if (!path.trim()) setPath(preset.path);
        if (!name.trim()) setName(preset.name);
        if (!id.trim()) setId(preset.id);
      }
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        id: id.trim().toLowerCase() || undefined,
        name: name.trim() || path.trim(),
        path: path.trim(),
        host: transport === "ssh" ? host.trim() : "",
        os,
        kind,
        labels: labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        note: note.trim(),
      };
      return editing
        ? put<Workspace>(`/api/v1/workspaces/${initial!.id}`, payload)
        : post<Workspace>("/api/v1/workspaces", payload);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) {
      setErr("Path is required");
      return;
    }
    if (transport === "ssh" && !host.trim()) {
      setErr("Remote host is required");
      return;
    }
    setErr(null);
    save.mutate();
  };

  const hostOptions = [
    ...Object.keys(SSH_PRESETS),
    ...workers.map((w) => w.name || w.id).filter((n) => n && !SSH_PRESETS[n]),
  ];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${initial?.name}` : "New Workspace"}</SheetTitle>
          <SheetDescription>
            Register a directory or git repository on this machine, macOS, or Windows host.
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          <form className="flex flex-col gap-3.5" onSubmit={submit}>
            <div>
              <Label className="mb-1.5">Machine preset</Label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => applyMachinePreset("current")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-control border px-2 py-1.5 text-xs font-medium transition-colors",
                    transport === "local"
                      ? "border-accent/50 bg-accent/14 text-accent-text"
                      : "border-line bg-well/50 text-ink-2 hover:border-line-strong"
                  )}
                >
                  <Monitor className="size-3.5" />
                  This machine
                </button>
                <button
                  type="button"
                  onClick={() => applyMachinePreset("mac")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-control border px-2 py-1.5 text-xs font-medium transition-colors",
                    transport === "ssh" && os === "mac"
                      ? "border-accent/50 bg-accent/14 text-accent-text"
                      : "border-line bg-well/50 text-ink-2 hover:border-line-strong"
                  )}
                >
                  <Apple className="size-3.5" />
                  Mac
                </button>
                <button
                  type="button"
                  onClick={() => applyMachinePreset("windows")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-control border px-2 py-1.5 text-xs font-medium transition-colors",
                    transport === "ssh" && os === "windows"
                      ? "border-accent/50 bg-accent/14 text-accent-text"
                      : "border-line bg-well/50 text-ink-2 hover:border-line-strong"
                  )}
                >
                  <Laptop className="size-3.5" />
                  Windows
                </button>
              </div>
            </div>

            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="ws-id">ID (optional)</Label>
                <Input
                  id="ws-id"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="mac-dev"
                  className="font-mono text-xs"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ws-transport">Transport</Label>
              <Select
                value={transport}
                onValueChange={(v) => {
                  const next = v as "local" | "ssh";
                  setTransport(next);
                  if (next === "local") setHost("");
                }}
              >
                <SelectTrigger id="ws-transport" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local (current machine)</SelectItem>
                  <SelectItem value="ssh">SSH / Node (Mac, Windows, or remote Linux)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {transport === "ssh" && (
              <div className="space-y-1.5">
                <Label htmlFor="ws-host">Remote host</Label>
                <Select value={customHost ? "__custom__" : host || "__custom__"} onValueChange={pickHost}>
                  <SelectTrigger id="ws-host" size="sm">
                    <SelectValue placeholder="Choose host" />
                  </SelectTrigger>
                  <SelectContent>
                    {hostOptions.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Custom host…</SelectItem>
                  </SelectContent>
                </Select>
                {(customHost || !hostOptions.includes(host)) && (
                  <Input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="hostname or tailscale node name"
                    className="mt-1.5 font-mono text-xs"
                  />
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mac Dev · switchyard-lite"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ws-path">Filesystem path</Label>
              <Input
                id="ws-path"
                required
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={os === "windows" ? "C:\\Users\\user\\dev\\repo" : "/Users/you/Development/repo"}
                className="font-mono text-xs"
              />
              {transport === "local" && path.trim().length > 1 && inspect.data && (
                <p className="text-[11px] text-ink-3">
                  {inspect.data.is_git
                    ? `✓ Git repository${inspect.data.branches?.length ? ` · ${inspect.data.branches.length} branches` : ""}`
                    : "Directory (not a git repo or path not present locally)"}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ws-os">OS</Label>
                <Select value={os || "linux"} onValueChange={setOs}>
                  <SelectTrigger id="ws-os" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ws-kind">Kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="ws-kind" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="repo">Git repository</SelectItem>
                    <SelectItem value="dir">Directory</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ws-labels">Labels</Label>
              <Input
                id="ws-labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder="work, saas (comma separated)"
              />
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const cur = labels
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (!cur.includes("work")) setLabels([...cur, "work"].join(", "));
                  }}
                  className="rounded-full border border-review/30 bg-review-tint px-2 py-0.5 text-[11px] font-medium text-review-text hover:brightness-110"
                >
                  + work
                </button>
                <span className="text-[11px] text-ink-3">Quick-tag workspace</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ws-note">Note</Label>
              <Textarea
                id="ws-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional setup or machine notes…"
              />
            </div>

            <ErrorBox error={err ? new Error(err) : null} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="signal" size="sm" loading={save.isPending}>
                {editing ? "Save changes" : "Add workspace"}
              </Button>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function WorkspacesPage() {
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<{ open: boolean; edit: Workspace | null }>({ open: false, edit: null });
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);
  const [inspectTarget, setInspectTarget] = useState<Workspace | null>(null);
  const [platform, setPlatform] = useState<PlatformKey | "all">("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [q, setQ] = useState("");
  const [autoPing, setAutoPing] = useState(true);
  const [pinging, setPinging] = useState<string | null>(null);
  const [histories, setHistories] = useState<Record<string, PingPoint[]>>({});
  const pingingRef = useRef(false);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    refetchInterval: 15000,
    queryFn: () => apiOr<Workspace[] | null>("/api/v1/workspaces", null),
  });

  const workers = useQuery({
    queryKey: ["workers"],
    queryFn: () => apiOr<Worker[]>("/api/v1/workers", []),
  });

  const runningWorkspaces = useQuery({
    queryKey: ["ws-running"],
    refetchInterval: 6000,
    queryFn: async () => {
      const boards = await apiOr<{ id: string }[]>("/api/v1/boards", []);
      const active = new Set<string>();
      for (const b of boards) {
        const list = await apiOr<Task[]>(`/api/v1/boards/${b.id}/tasks`, []);
        for (const t of list) {
          if (t.status === "in_progress" && t.workspace) active.add(t.workspace);
        }
      }
      return active;
    },
  });

  const inspectQuery = useQuery({
    queryKey: ["ws-inspect-modal", inspectTarget?.path],
    enabled: !!inspectTarget?.path,
    queryFn: () =>
      apiOr<{ path?: string; is_git?: boolean; branches?: string[] }>(
        `/api/v1/workspaces/inspect?path=${encodeURIComponent(inspectTarget!.path)}`,
        {}
      ),
  });

  const recordPingPoints = (list: Workspace[]) => {
    const now = Date.now();
    setHistories((prev) => {
      const next = { ...prev };
      for (const w of list) {
        const ok = w.status === "local" || w.status === "connected" || w.status === "unknown";
        const pt: PingPoint = { at: now, ok: w.status !== "unreachable", ms: w.latency_ms };
        next[w.id] = [...(next[w.id] ?? []), pt].slice(-24);
        void ok;
      }
      return next;
    });
  };

  useEffect(() => {
    if (!autoPing || !workspaces.data?.length) return;
    let stop = false;
    const tick = async () => {
      if (stop || pingingRef.current || document.hidden) return;
      pingingRef.current = true;
      try {
        const updated = await post<Workspace[]>("/api/v1/workspaces/ping");
        if (!stop && Array.isArray(updated)) {
          qc.setQueryData(["workspaces"], updated);
          recordPingPoints(updated);
        }
      } catch {
        /* ignore background ping failures */
      } finally {
        pingingRef.current = false;
      }
    };
    const iv = setInterval(() => void tick(), 30000);
    return () => {
      stop = true;
      clearInterval(iv);
      pingingRef.current = false;
    };
  }, [autoPing, qc, workspaces.data?.length]);

  const pingAll = async () => {
    setPinging("__all__");
    try {
      const updated = await post<Workspace[]>("/api/v1/workspaces/ping");
      if (Array.isArray(updated)) {
        qc.setQueryData(["workspaces"], updated);
        recordPingPoints(updated);
      }
    } finally {
      setPinging(null);
    }
  };

  const pingOne = async (w: Workspace) => {
    setPinging(w.id);
    try {
      const res = await post<Workspace>(`/api/v1/workspaces/${w.id}/ping`);
      if (res) {
        qc.setQueryData<Workspace[] | null>(["workspaces"], (old) =>
          old ? old.map((x) => (x.id === w.id ? res : x)) : old
        );
        recordPingPoints([res]);
      }
    } finally {
      setPinging(null);
    }
  };

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/v1/workspaces/${id}`),
    onSuccess: () => {
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const list = workspaces.data ?? [];
  const allGroups = useMemo(() => groupWorkspacesByPlatform(list), [list]);

  const platformCounts = useMemo(() => {
    const counts = new Map<PlatformKey, number>();
    for (const [k, items] of allGroups) counts.set(k, items.length);
    return counts;
  }, [allGroups]);

  const availableTags = useMemo(() => {
    const set = new Set<string>(["work"]);
    for (const w of list) {
      for (const l of w.labels ?? []) set.add(l);
    }
    return Array.from(set);
  }, [list]);

  const shownGroups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filteredGroups = (platform === "all" ? allGroups : allGroups.filter(([k]) => k === platform))
      .map(([k, items]): [PlatformKey, Workspace[]] => {
        const byTag =
          tagFilter === "all" ? items : items.filter((w) => (w.labels ?? []).includes(tagFilter));
        const bySearch = !needle
          ? byTag
          : byTag.filter(
              (w) =>
                w.name.toLowerCase().includes(needle) ||
                w.path.toLowerCase().includes(needle) ||
                (w.host ?? "").toLowerCase().includes(needle) ||
                (w.note ?? "").toLowerCase().includes(needle) ||
                (w.labels ?? []).some((l) => l.toLowerCase().includes(needle))
            );
        return [k, bySearch];
      })
      .filter(([, items]) => items.length > 0);
    return filteredGroups;
  }, [allGroups, platform, tagFilter, q]);

  const shownTotal = shownGroups.reduce((acc, [, items]) => acc + items.length, 0);

  return (
    <div>
      <div className="bar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Workspaces</h2>
          <span className="bar-sub">
            Hosts and repositories across macOS, Windows, and current machine.
          </span>
        </div>
        <div className="bar-spacer" />
        <Button
          type="button"
          variant={autoPing ? "default" : "outline"}
          size="sm"
          onClick={() => setAutoPing((v) => !v)}
          title="Auto ping workspaces every 30s"
        >
          <Radio className={cn("size-3.5", autoPing && "text-success-text")} />
          Auto ping
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={pinging === "__all__"}
          onClick={() => void pingAll()}
        >
          <RefreshCw className="size-3.5" />
          Ping all
        </Button>
        <Button
          type="button"
          variant="signal"
          size="sm"
          onClick={() => setSheet({ open: true, edit: null })}
        >
          <Plus className="size-3.5" />
          New workspace
        </Button>
      </div>

      {/* Filter bar */}
      <div className="toolbar-row mb-4 rounded-card border border-line bg-surface/60 px-3 py-2">
        <div className="search-box">
          <Search className="size-3.5 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workspaces…"
            aria-label="Search workspaces"
          />
        </div>

        <div className="chip-row">
          <button
            type="button"
            className={cn("chip", platform === "all" && "active")}
            onClick={() => setPlatform("all")}
          >
            All ({list.length})
          </button>
          {PLATFORM_ORDER.map((pk) => {
            const Icon = PLATFORM_META[pk].Icon;
            const c = platformCounts.get(pk) ?? 0;
            return (
              <button
                key={pk}
                type="button"
                className={cn("chip inline-flex items-center gap-1", platform === pk && "active")}
                onClick={() => setPlatform(platform === pk ? "all" : pk)}
              >
                <Icon className="size-3" />
                {PLATFORM_META[pk].label} ({c})
              </button>
            );
          })}
        </div>

        <div className="chip-row">
          <button
            type="button"
            className={cn("chip", tagFilter === "all" && "active")}
            onClick={() => setTagFilter("all")}
          >
            All tags
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={cn("chip", tagFilter === tag && "active")}
              onClick={() => setTagFilter(tagFilter === tag ? "all" : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>

        <span className="muted tabular ml-auto text-xs">
          {shownTotal} of {list.length}
        </span>
      </div>

      <ErrorBox error={workspaces.error ?? remove.error} />

      {workspaces.data === null ? (
        <div className="panel">Workspaces require an active control plane connection.</div>
      ) : list.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 py-10 text-center">
          <FolderGit2 className="size-6 text-ink-3" />
          <strong className="text-sm text-ink">No workspaces yet</strong>
          <p className="m-0 max-w-md text-xs text-ink-3">
            Add your Current machine directory, Mac host, or Windows host so tasks can target the right checkout.
          </p>
          <Button variant="signal" size="sm" onClick={() => setSheet({ open: true, edit: null })}>
            <Plus className="size-3.5" />
            New workspace
          </Button>
        </div>
      ) : shownGroups.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 py-8 text-center">
          <strong className="text-sm text-ink">No matching workspaces</strong>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQ("");
              setPlatform("all");
              setTagFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {shownGroups.map(([pk, items]) => {
            const meta = PLATFORM_META[pk];
            const Icon = meta.Icon;
            return (
              <section key={pk} className="flex flex-col gap-3">
                <div className="flex items-center gap-2 border-b border-line pb-2">
                  <Icon className="size-4 text-ink-2" />
                  <h3 className="m-0 text-sm font-semibold text-ink">{meta.label}</h3>
                  <Badge variant="secondary" className="tabular-nums">
                    {items.length} {items.length === 1 ? "workspace" : "workspaces"}
                  </Badge>
                </div>

                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))" }}
                >
                  {items.map((w) => {
                    const st = statusStyleFor(w);
                    const isRunning = runningWorkspaces.data?.has(w.path) ?? false;
                    return (
                      <div key={w.id} className="panel mb-0 flex flex-col justify-between gap-2">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <Icon className="size-3.5 shrink-0 text-ink-3" />
                                <strong className="truncate text-sm text-ink">{w.name}</strong>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", st.tone)}>
                                  <span className={cn("size-2 rounded-full", st.dot, isRunning && "animate-pulse")} />
                                  {isRunning ? "Running task" : st.label}
                                </span>
                                <Badge variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
                                  {meta.badge}
                                </Badge>
                                {w.host && (
                                  <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[10px]">
                                    ssh · {w.host}
                                  </Badge>
                                )}
                                {!w.host && w.node && (
                                  <Badge
                                    variant="secondary"
                                    className="px-1.5 py-0 font-mono text-[10px]"
                                    title={w.hostname || w.node}
                                  >
                                    node · {w.node}
                                  </Badge>
                                )}
                                {(w.git || w.kind === "repo") && (
                                  <Badge variant="success" className="px-1.5 py-0 font-mono text-[10px]">
                                    <GitBranch className="size-2.5" />
                                    git
                                  </Badge>
                                )}
                                {(w.labels ?? []).map((lbl) => (
                                  <Badge key={lbl} variant="review" className="px-1.5 py-0 text-[10px]">
                                    {lbl}
                                  </Badge>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                title="Edit workspace"
                                aria-label={`Edit ${w.name}`}
                                onClick={() => setSheet({ open: true, edit: w })}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                title="Delete workspace"
                                aria-label={`Delete ${w.name}`}
                                onClick={() => setPendingDelete(w)}
                                className="text-danger-text hover:bg-danger/10"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>

                          <div
                            className="mt-2 break-all font-mono text-[11px] text-ink-3"
                            title={w.path}
                          >
                            {w.path}
                          </div>

                          {w.note && (
                            <p className="mt-1.5 mb-0 line-clamp-2 text-xs text-ink-2">{w.note}</p>
                          )}
                        </div>

                        <div>
                          <EkgTrace
                            points={histories[w.id] ?? []}
                            ok={w.status !== "unreachable"}
                            running={isRunning}
                            latencyMs={w.latency_ms}
                          />

                          <div className="mt-2 flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              loading={pinging === w.id}
                              onClick={() => void pingOne(w)}
                            >
                              <RefreshCw className="size-3" />
                              Ping
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => setInspectTarget(w)}
                            >
                              <GitBranch className="size-3" />
                              Inspect git
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {sheet.open && (
        <WorkspaceSheet
          initial={sheet.edit}
          workers={workers.data ?? []}
          onClose={() => setSheet({ open: false, edit: null })}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["workspaces"] });
            qc.invalidateQueries({ queryKey: ["overview"] });
          }}
        />
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="max-w-md p-0">
          <DialogHeader>
            <DialogTitle>Delete workspace</DialogTitle>
            <DialogDescription>
              Delete "{pendingDelete?.name}"? Existing tasks keep their path string, and you can re-add the workspace anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            >
              Delete workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!inspectTarget} onOpenChange={(o) => !o && setInspectTarget(null)}>
        <DialogContent className="max-w-lg p-0">
          <DialogHeader>
            <DialogTitle>Inspect · {inspectTarget?.name}</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">{inspectTarget?.path}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {inspectQuery.isLoading ? (
              <p className="text-xs text-ink-3">Inspecting git repository…</p>
            ) : inspectQuery.data?.is_git ? (
              <div className="space-y-2">
                <Badge variant="success">Git repository detected</Badge>
                <div className="text-xs font-medium text-ink-2">Local branches</div>
                {inspectQuery.data.branches?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {inspectQuery.data.branches.map((b) => (
                      <Badge key={b} variant="secondary" className="font-mono">
                        <GitBranch className="size-3" />
                        {b}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink-3">No local branches found.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-3">
                Not a local git repository on this control plane host (if this workspace lives on a remote Mac/Windows worker, git branches are resolved by the node agent at dispatch time).
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInspectTarget(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
