import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Apple,
  CloudDownload,
  FolderGit2,
  GitBranch,
  HardDrive,
  Info,
  Laptop,
  Monitor,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Trash2,
} from "@/components/ui/icons";
import {
  apiOr,
  del,
  platformOfWorkspace,
  post,
  put,
  type LiveWorkspace,
  type PlatformKey,
  type Task,
  type Worker,
  type Workspace,
} from "@/api";
import { CopyButton } from "@/components/ui/copy-button";
import { toast, toastError } from "@/components/ui/toast";
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

function OscilloscopeMonitor({
  points,
  ok,
  running,
  pinging,
  latencyMs,
  status,
  wsId,
}: {
  points: PingPoint[];
  ok: boolean;
  running: boolean;
  pinging: boolean;
  latencyMs?: number;
  status?: string;
  wsId?: string;
}) {
  const pts = points.slice(-24);
  const last = pts[pts.length - 1];
  const isOffline = (!ok && pts.length > 0) || (last ? !last.ok : false) || status === "unreachable";

  const w = 260;
  const h = 34;
  const mid = 17;

  const modeKey = isOffline
    ? "unreachable"
    : running
      ? "running"
      : ok || status === "local" || status === "connected"
        ? "online"
        : "standby";

  const strokeColor = isOffline
    ? "#f43f5e"
    : running
      ? "#38bdf8"
      : modeKey === "online"
        ? "#10b981"
        : "#94a3b8";

  const gradientId = useMemo(
    () => `scope-grad-${wsId ? wsId.replace(/[^a-zA-Z0-9]/g, "") : Math.random().toString(36).slice(2, 7)}`,
    [wsId]
  );

  const { pathD, areaD, blipPoint } = useMemo(() => {
    if (isOffline) {
      const d = `M 0 ${mid} L 60 ${mid} L 62 ${mid - 0.5} L 64 ${mid + 0.5} L 66 ${mid} L 160 ${mid} L 162 ${mid - 0.5} L 164 ${mid + 0.5} L 166 ${mid} L ${w} ${mid}`;
      const area = `${d} L ${w} ${h} L 0 ${h} Z`;
      return { pathD: d, areaD: area, blipPoint: null };
    }

    if (running) {
      const d = `M 0 ${mid} L 28 ${mid} L 36 ${mid} L 42 ${mid - 2} L 46 ${mid + 2} L 52 4 L 58 ${h - 4} L 64 ${mid} L 74 ${mid - 4} L 84 ${mid} L 140 ${mid} L 148 ${mid - 2} L 152 ${mid + 2} L 158 3 L 164 ${h - 3} L 170 ${mid} L 180 ${mid - 4} L 190 ${mid} L ${w} ${mid}`;
      const area = `${d} L ${w} ${h} L 0 ${h} Z`;
      return { pathD: d, areaD: area, blipPoint: { x: 158, y: 3 } };
    }

    if (pts.length > 0) {
      const good = pts.filter((p) => p.ok && p.ms != null).map((p) => p.ms!);
      const min = good.length ? Math.min(...good) : 0;
      const max = good.length ? Math.max(...good) : 10;
      const span = Math.max(1, max - min);
      const step = w / 23;

      let lastX = 0;
      let lastY = mid;

      const coords = Array.from({ length: 24 }, (_, idx) => {
        const p = pts[idx - (24 - pts.length)];
        const x = Math.round(idx * step);
        if (!p || !p.ok || p.ms == null) {
          if (idx === 8) return `${x} ${mid - 1.5}`;
          if (idx === 10) return `${x} 5`;
          if (idx === 12) return `${x} ${h - 5}`;
          if (idx === 14) return `${x} ${mid - 3}`;
          return `${x} ${mid}`;
        }
        const norm = (p.ms - min) / span;
        const y = Math.round(h - 5 - norm * (h - 10));
        lastX = x;
        lastY = y;
        return `${x} ${y}`;
      });

      const d = "M " + coords.join(" L ");
      const area = `${d} L ${w} ${h} L 0 ${h} Z`;
      return { pathD: d, areaD: area, blipPoint: { x: lastX, y: lastY } };
    }

    const d = `M 0 ${mid} L 68 ${mid} L 78 ${mid} L 84 ${mid - 2} L 88 ${mid + 2} L 94 5 L 100 ${h - 5} L 106 ${mid} L 116 ${mid - 3.5} L 126 ${mid} L ${w} ${mid}`;
    const area = `${d} L ${w} ${h} L 0 ${h} Z`;
    return { pathD: d, areaD: area, blipPoint: { x: 94, y: 5 } };
  }, [isOffline, running, pts, w, h, mid]);

  return (
    <div
      className={cn(
        "oscilloscope-bay",
        isOffline && "unreachable",
        running && "running"
      )}
      title="Live workspace telemetry oscilloscope"
    >
      <div className="oscilloscope-reticle-center" />
      {pinging && <div className="oscilloscope-radar-sweep" />}

      {/* Top micro HUD bar */}
      <div className="relative z-10 flex items-center justify-between gap-1 text-[9px] font-mono leading-none">
        <span className="tracking-[0.14em] text-neutral-400 uppercase">
          CH-1 · {modeKey}
        </span>
        <div>
          {isOffline ? (
            <span className="font-bold tracking-wider text-rose-400">FLATLINE</span>
          ) : running ? (
            <span className="flex items-center gap-1 font-bold tracking-wider text-cyan-400">
              <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse" />
              RUNNING
            </span>
          ) : pinging ? (
            <span className="flex items-center gap-1 font-bold tracking-wider text-amber-400">
              <RefreshCw className="size-2.5 animate-spin" />
              PINGING
            </span>
          ) : latencyMs !== undefined ? (
            <span className="font-bold tabular-nums text-emerald-400">
              {latencyMs} ms
            </span>
          ) : (
            <span className="text-neutral-400">STANDBY</span>
          )}
        </div>
      </div>

      {/* Waveform SVG */}
      <div className="relative z-0 h-[34px] w-full">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
            </linearGradient>
            <filter id={`glow-${gradientId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <path d={areaD} fill={`url(#${gradientId})`} />

          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="3"
            opacity="0.3"
            filter={`url(#glow-${gradientId})`}
          />

          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {blipPoint && !isOffline && (
            <g transform={`translate(${blipPoint.x}, ${blipPoint.y})`}>
              <circle r="2.5" fill={strokeColor} />
              <circle
                r="5"
                fill="none"
                stroke={strokeColor}
                strokeWidth="1"
                className="animate-ping opacity-60"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Bottom micro HUD bar */}
      <div className="relative z-10 flex items-center justify-between gap-1 text-[8.5px] font-mono leading-none text-neutral-500">
        <span>200mV / DIV</span>
        <span>
          {isOffline
            ? "TIMEOUT"
            : running
              ? "EXEC LOAD 100%"
              : pts.length > 0
                ? `${pts.length} PTS`
                : "READY"}
        </span>
      </div>
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
  /**
   * Machine identity comes from the live kanban-board registry (backend field
   * `machine`) and the path shape — never from a stale "mac: " name or an empty
   * host column. Imported Windows checkouts like D:\xampp\htdocs\portal-hadirr
   * have no host/os saved locally, so the old `initial.host ? ssh : local`
   * check opened the edit sheet on "This machine". Resolving here fixes that.
   */
  const resolvedMachine = platformOfWorkspace(initial ?? null);
  const initialTransport: "local" | "ssh" = resolvedMachine === "current" ? "local" : "ssh";
  const initialOs = resolvedMachine === "mac" ? "mac" : resolvedMachine === "windows" ? "windows" : "linux";
  const initialHost =
    initial?.host ||
    (resolvedMachine === "mac" ? "mac-tailscale" : resolvedMachine === "windows" ? "windows-tailscale" : "");
  const [transport, setTransport] = useState<"local" | "ssh">(initialTransport);
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [path, setPath] = useState(initial?.path ?? "");
  const [host, setHost] = useState(initialHost);
  const [os, setOs] = useState(initialOs);
  const [kind, setKind] = useState(initial?.kind || (initial?.git ? "repo" : "dir"));
  const [labels, setLabels] = useState(initial?.labels?.join(", ") ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [customHost, setCustomHost] = useState<boolean>(
    Boolean(initialHost && !SSH_PRESETS[initialHost] && !workers.some((w) => w.name === initialHost))
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

  /** Always derived from the form so the highlighted preset is never stale. */
  const activePreset: "current" | "mac" | "windows" | "remote-linux" =
    transport === "local" ? "current" : os === "mac" ? "mac" : os === "windows" ? "windows" : "remote-linux";

  const machineLabel =
    resolvedMachine === "current" ? "This machine" : PLATFORM_META[resolvedMachine].label;

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
                  aria-pressed={activePreset === "current"}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-control border px-2 py-1.5 text-xs font-medium transition-colors",
                    activePreset === "current"
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
                  aria-pressed={activePreset === "mac"}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-control border px-2 py-1.5 text-xs font-medium transition-colors",
                    activePreset === "mac"
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
                  aria-pressed={activePreset === "windows"}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-control border px-2 py-1.5 text-xs font-medium transition-colors",
                    activePreset === "windows"
                      ? "border-accent/50 bg-accent/14 text-accent-text"
                      : "border-line bg-well/50 text-ink-2 hover:border-line-strong"
                  )}
                >
                  <Laptop className="size-3.5" />
                  Windows
                </button>
              </div>
              {editing && (
                <p className="mt-1.5 mb-0 flex items-start gap-1 text-[10px] leading-relaxed text-ink-4">
                  <Info className="mt-px size-2.5 shrink-0" />
                  Auto-selected from the workspace's machine: <strong className="font-medium text-ink-3">{machineLabel}</strong>
                  {initial?.live && " (kanban-board live registry)"}. The path shape and live metadata take priority over the name.
                </p>
              )}
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

  /** kanban-board's live registry, served by node-agent from workspaces.json. */
  const liveCatalog = useQuery({
    queryKey: ["workspaces-live"],
    refetchInterval: 60000,
    queryFn: () =>
      apiOr<{ workspaces: LiveWorkspace[]; count: number }>("/api/v1/workspaces/live", {
        workspaces: [],
        count: 0,
      }),
  });

  const syncLive = useMutation({
    mutationFn: () => post<{ imported: number; updated: number; live: number }>("/api/v1/workspaces/sync"),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspaces-live"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast("Live workspaces synced", {
        tone: "success",
        description: `${res.imported} imported · ${res.updated} machine records repaired · ${res.live} in kanban-board registry`,
      });
    },
    onError: (e) => toastError(e, "Could not sync live workspaces"),
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
          variant="outline"
          size="sm"
          loading={syncLive.isPending}
          onClick={() => syncLive.mutate()}
          title="Import machine identity (name, OS, host, labels) from kanban-board's live workspaces.json"
        >
          <CloudDownload className="size-3.5" />
          Sync live
          {(liveCatalog.data?.count ?? 0) > 0 && (
            <span className="font-mono text-[10px] opacity-70">{liveCatalog.data?.count}</span>
          )}
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

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface/60 px-3 py-2 text-[11px] text-ink-3">
        <Radio className={cn("size-3.5", (liveCatalog.data?.count ?? 0) > 0 && "text-success-text")} />
        <span>
          <strong className="font-medium text-ink-2">kanban-board live registry</strong>
          {" · "}
          {(liveCatalog.data?.count ?? 0) > 0
            ? `${liveCatalog.data?.count} workspaces reported by node-agent`
            : "node-agent registry unavailable — showing local records"}
        </span>
        <span className="h-3 w-px bg-line" aria-hidden />
        <span>
          Machine type is resolved from the live OS/host and the path shape (
          <code className="font-mono">D:\…</code> → Windows), so stale <code className="font-mono">mac: </code>
          prefixes no longer decide the preset.
        </span>
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
                      <div
                        key={w.id}
                        className={cn(
                          "group relative flex flex-col justify-between rounded-[12px] border border-line bg-surface p-3.5 shadow-[var(--lift-1),var(--lift-inset)]",
                          "transition-[border-color,box-shadow,transform] duration-150 ease-[var(--ease-out-expo)]",
                          "hover:border-line-strong hover:shadow-[var(--lift-2),var(--lift-inset)]"
                        )}
                      >
                        <div>
                          {/* Card Tier 1: Identity, status, and quick management */}
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="flex min-w-0 flex-1 items-start gap-2.5">
                              <div className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-line bg-well/70 shadow-[var(--well-inset)]">
                                <Icon className="size-4 text-ink-2" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4 className="m-0 truncate text-[13.5px] font-semibold tracking-tight text-ink" title={w.name}>
                                  {w.name}
                                </h4>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={cn(
                                      "inline-flex h-5 items-center gap-1.5 rounded-md border px-2 text-[10.5px] font-medium leading-none",
                                      st.tone === "text-success-text" && "border-success/30 bg-success-tint text-success-text",
                                      st.tone === "text-danger-text" && "border-danger/30 bg-danger-tint text-danger-text",
                                      st.tone === "text-ink-2" && "border-line bg-well text-ink-2",
                                      st.tone === "text-ink-3" && "border-line bg-well text-ink-3"
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "size-1.5 shrink-0 rounded-full",
                                        st.dot,
                                        isRunning && "animate-pulse"
                                      )}
                                      aria-hidden
                                    />
                                    {isRunning ? "Running task" : st.label}
                                  </span>

                                  <Badge variant="outline" className="h-5 rounded-md px-1.5 font-mono text-[10px]">
                                    {meta.badge}
                                  </Badge>

                                  {w.live && (
                                    <Badge
                                      variant="success"
                                      className="h-5 rounded-md px-1.5 font-mono text-[10px]"
                                      title={`From kanban-board live registry${w.live_id ? ` · ${w.live_id}` : ""}`}
                                    >
                                      live · kanban
                                    </Badge>
                                  )}

                                  {w.machine && w.machine !== pk && (
                                    <Badge variant="outline" className="h-5 rounded-md px-1.5 font-mono text-[10px]">
                                      machine · {w.machine}
                                    </Badge>
                                  )}

                                  {w.host && (
                                    <Badge variant="secondary" className="h-5 rounded-md px-1.5 font-mono text-[10px]">
                                      ssh · {w.host}
                                    </Badge>
                                  )}

                                  {!w.host && w.node && (
                                    <Badge
                                      variant="secondary"
                                      className="h-5 rounded-md px-1.5 font-mono text-[10px]"
                                      title={w.hostname || w.node}
                                    >
                                      node · {w.node}
                                    </Badge>
                                  )}

                                  {(w.git || w.kind === "repo") && (
                                    <Badge variant="success" className="h-5 rounded-md px-1.5 font-mono text-[10px]">
                                      <GitBranch className="size-2.5" />
                                      git
                                    </Badge>
                                  )}

                                  {(w.labels ?? []).map((lbl) => (
                                    <Badge key={lbl} variant="review" className="h-5 rounded-md px-1.5 text-[10px]">
                                      {lbl}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
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

                          {/* Card Tier 2: Path capsule and note */}
                          <div className="mt-2.5 flex items-center justify-between gap-1.5 rounded-[7px] border border-line/70 bg-well/60 px-2 py-1 text-[11px]">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-ink-3">
                              <FolderGit2 className="size-3 shrink-0 text-ink-4" />
                              <span className="truncate" title={w.path}>
                                {w.path}
                              </span>
                            </div>
                            <CopyButton value={w.path} label="Copy workspace path" />
                          </div>

                          {w.note && (
                            <p className="mt-1.5 mb-0 line-clamp-2 text-xs leading-relaxed text-ink-2">
                              {w.note}
                            </p>
                          )}
                        </div>

                        {/* Card Tier 3: Oscilloscope Telemetry Bay & Actions */}
                        <div className="mt-3 flex flex-col gap-2">
                          <OscilloscopeMonitor
                            points={histories[w.id] ?? []}
                            ok={w.status !== "unreachable"}
                            running={isRunning}
                            pinging={pinging === w.id || pinging === "__all__"}
                            latencyMs={w.latency_ms}
                            status={w.status}
                            wsId={w.id}
                          />

                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <div className="flex items-center gap-1.5">
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

                            {isRunning && (
                              <span className="inline-flex h-5 items-center gap-1 rounded-md border border-accent/30 bg-accent-tint px-2 font-mono text-[10px] font-semibold text-accent-text">
                                <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                                active
                              </span>
                            )}
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
