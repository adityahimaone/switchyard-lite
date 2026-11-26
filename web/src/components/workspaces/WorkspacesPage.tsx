import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Apple,
  CloudDownload,
  FolderGit2,
  GitBranch,
  HardDrive,
  Info,
  Laptop,
  LayoutGrid,
  Monitor,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Table2,
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
import { StudioPageHeader } from "@/components/studio/StudioPageHeader";
import { StudioMetricCard } from "@/components/studio/StudioCharts";
import { Segmented } from "@/components/ui/segmented";
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

function pointsToSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    // Catmull-Rom to Cubic Bezier control points (tension = 0.5)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function OscilloscopeMonitor({
  points,
  ok,
  running,
  pinging,
  latencyMs,
  status,
  wsId,
  staggerIndex = 0,
  compact = false,
}: {
  points: PingPoint[];
  ok: boolean;
  running: boolean;
  pinging: boolean;
  latencyMs?: number;
  status?: string;
  wsId?: string;
  staggerIndex?: number;
  compact?: boolean;
}) {
  const pts = points.slice(-24);
  const last = pts[pts.length - 1];
  const isOffline = (!ok && pts.length > 0) || (last ? !last.ok : false) || status === "unreachable";

  const bayRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = bayRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin: "160px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const w = compact ? 150 : 260;
  const h = compact ? 24 : 38;
  const mid = h / 2;

  const modeKey = isOffline
    ? "offline"
    : running
      ? "exec"
      : ok || status === "local" || status === "connected"
        ? "live"
        : "standby";

  const strokeColor = isOffline
    ? "#f43f5e"
    : running
      ? "#38bdf8"
      : modeKey === "live"
        ? "#10b981"
        : "#94a3b8";

  const validMs = useMemo(
    () => pts.filter((p) => p.ok && p.ms != null).map((p) => p.ms!),
    [pts]
  );
  const avgMs = validMs.length ? Math.round(validMs.reduce((a, b) => a + b, 0) / validMs.length) : latencyMs;
  const minMs = validMs.length ? Math.min(...validMs) : latencyMs;
  const maxMs = validMs.length ? Math.max(...validMs) : latencyMs;

  const delaySeconds = useMemo(() => {
    let hash = 0;
    const str = wsId || "workspace";
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const step = ((Math.abs(hash) + staggerIndex * 3) % 6) * 0.45;
    return Number(step.toFixed(2));
  }, [wsId, staggerIndex]);

  const durationSeconds = pinging ? 1.0 : running ? 1.45 : isOffline ? 4.2 : 2.6;

  const gradientId = useMemo(
    () => `scope-grad-${wsId ? wsId.replace(/[^a-zA-Z0-9]/g, "") : Math.random().toString(36).slice(2, 7)}`,
    [wsId]
  );

  const beamGradId = useMemo(
    () => `scope-beam-${wsId ? wsId.replace(/[^a-zA-Z0-9]/g, "") : Math.random().toString(36).slice(2, 7)}`,
    [wsId]
  );

  const { pathD, areaD, blipPoint } = useMemo(() => {
    if (isOffline) {
      const d = `M 0 ${mid} L ${w} ${mid}`;
      const area = `M 0 ${mid} L ${w} ${mid} L ${w} ${h} L 0 ${h} Z`;
      return { pathD: d, areaD: area, blipPoint: null };
    }

    const step = w / 23;
    const currentMs = latencyMs ?? (pts.length > 0 && pts[pts.length - 1]?.ms != null ? pts[pts.length - 1].ms! : 4);
    const localMin = validMs.length ? Math.min(...validMs) : currentMs * 0.8;
    const localMax = validMs.length ? Math.max(...validMs) : currentMs * 1.2;
    const range = Math.max(6, localMax - localMin);
    const latScale = Math.min(1, Math.max(0.15, Math.log10(Math.max(2, currentMs)) / 2.3));
    const ampScale = compact ? 0.65 : 1;

    let peakX = Math.round(9 * step);
    let peakY = mid;

    const coords: { x: number; y: number }[] = Array.from({ length: 24 }, (_, i) => {
      const x = Number((i * step).toFixed(1));
      const p = pts[i];
      const ms = p && p.ok && p.ms != null ? p.ms : currentMs;
      const baseSignalY = mid + 2.5 * ampScale - latScale * (8 * ampScale);

      let dy = 0;
      if (running) {
        if (i === 6 || i === 18) dy = -12 * ampScale;
        else if (i === 7 || i === 19) dy = 8.5 * ampScale;
        else if (i === 5 || i === 17) dy = -3 * ampScale;
        else dy = Math.sin(i * 1.4) * (2.5 * ampScale);
      } else {
        const relNorm = (ms - localMin) / range;
        const pingDelta = (0.5 - relNorm) * (6 * latScale * ampScale);

        if (i === 9) {
          dy = (-10 - latScale * 5) * ampScale;
          peakX = x;
          peakY = Math.round(Math.max(3, baseSignalY + dy));
        } else if (i === 10) {
          dy = 7.5 * ampScale;
        } else if (i === 8) {
          dy = -2.5 * ampScale;
        } else if (i === 12) {
          dy = -3 * ampScale;
        } else if (i === 21) {
          dy = (-5.5 - latScale * 4) * ampScale + pingDelta;
        } else if (i === 22) {
          dy = 4.5 * ampScale;
        } else {
          dy = Math.sin(i * 1.1 + (wsId ? wsId.charCodeAt(0) : 0)) * ((1.8 + latScale * 2.8) * ampScale) + pingDelta;
        }
      }

      const y = Number(Math.min(h - 3, Math.max(3, baseSignalY + dy)).toFixed(1));
      return { x, y };
    });

    const d = pointsToSmoothPath(coords);
    const area = `${d} L ${w} ${h} L 0 ${h} Z`;
    return { pathD: d, areaD: area, blipPoint: { x: peakX, y: peakY } };
  }, [isOffline, running, pts, validMs, latencyMs, wsId, w, h, mid, compact]);

  const peakFraction = blipPoint ? blipPoint.x / w : 0.36;
  const pingOffsetSeconds = Number((durationSeconds * peakFraction).toFixed(2));

  return (
    <div
      ref={bayRef}
      className={cn(
        "oscilloscope-bay rounded-[10px] border border-white/10",
        compact ? "px-2 py-1" : "px-2.5 py-2",
        isOffline && "unreachable",
        running && "running"
      )}
      data-paused={!onScreen || undefined}
      style={{
        ["--scope-delay" as string]: `${delaySeconds}s`,
        ["--scope-duration" as string]: `${durationSeconds}s`,
        ["--scope-ping-offset" as string]: `${pingOffsetSeconds}s`,
        ["--scope-stroke" as string]: strokeColor,
      }}
      title={
        avgMs !== undefined
          ? `EKG telemetry · avg ${avgMs}ms (min ${minMs}ms / max ${maxMs}ms)`
          : "Live workspace EKG telemetry"
      }
    >
      <div className="oscilloscope-reticle-center" />

      {!compact && (
        <div className="relative z-10 mb-1 flex items-center justify-between gap-1 font-mono text-[9px] leading-none">
          <span className="inline-flex items-center gap-1.5 tracking-[0.12em] text-neutral-400 uppercase">
            <span
              className={cn(
                "size-1.5 rounded-full",
                isOffline ? "bg-rose-400" : running ? "bg-sky-400 animate-pulse" : "bg-emerald-400"
              )}
            />
            EKG · {modeKey}
          </span>
          <div className="flex items-center gap-2 tabular-nums">
            {avgMs !== undefined && !isOffline && (
              <span className="text-[8.5px] text-neutral-500">
                avg {avgMs}ms
              </span>
            )}
            {isOffline ? (
              <span className="font-bold tracking-wider text-rose-400">FLATLINE</span>
            ) : running ? (
              <span className="font-bold tracking-wider text-sky-400">ACTIVE</span>
            ) : pinging ? (
              <span className="inline-flex items-center gap-1 font-bold tracking-wider text-amber-400">
                <RefreshCw className="size-2.5 animate-spin" />
                PING
              </span>
            ) : latencyMs !== undefined ? (
              <span className="font-bold text-emerald-400">{latencyMs} ms</span>
            ) : (
              <span className="text-neutral-400">READY</span>
            )}
          </div>
        </div>
      )}

      <div className={cn("relative z-0 w-full", compact ? "h-[24px]" : "h-[38px]")}>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.26" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={beamGradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0" />
              <stop offset="55%" stopColor={strokeColor} stopOpacity="0.08" />
              <stop offset="88%" stopColor={strokeColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.78" />
            </linearGradient>
          </defs>

          <path d={areaD} fill={`url(#${gradientId})`} />

          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={isOffline ? 0.35 : 0.24}
          />

          {!isOffline && (
            <path
              d={pathD}
              pathLength="100"
              fill="none"
              stroke={strokeColor}
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="oscilloscope-pulse-glow"
              opacity="0.38"
            />
          )}

          {!isOffline && (
            <path
              d={pathD}
              pathLength="100"
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="oscilloscope-pulse-core"
            />
          )}

          {!isOffline && blipPoint && !compact && (
            <circle cx={blipPoint.x} cy={blipPoint.y} r="2.2" fill={strokeColor} opacity="0.85" />
          )}

          {!isOffline && (
            <g className="oscilloscope-scan-beam" aria-hidden="true">
              <rect x="-30" y="0" width="30" height={h} fill={`url(#${beamGradId})`} />
              <line x1="0" y1="0" x2="0" y2={h} stroke={strokeColor} strokeWidth="1.2" opacity="0.9" />
            </g>
          )}

          {isOffline && (
            <g transform={`translate(${w}, ${mid})`}>
              <circle r="2" fill={strokeColor} opacity="0.6" />
            </g>
          )}
        </svg>
      </div>

      {!compact && (
        <div className="relative z-10 mt-1 flex items-center justify-between gap-1 font-mono text-[8.5px] leading-none text-neutral-500 tabular-nums">
          <span>
            {minMs !== undefined && maxMs !== undefined && !isOffline
              ? `${minMs}–${maxMs}ms range`
              : "200mV / DIV"}
          </span>
          <span>
            {isOffline
              ? "TIMEOUT"
              : running
                ? "EXEC LOAD 100%"
                : pts.length > 0
                  ? `${pts.length} SAMPLES`
                  : "STANDBY"}
          </span>
        </div>
      )}
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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
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

  // Seed / synchronize 24 live telemetry points per workspace from server data
  useEffect(() => {
    if (!workspaces.data?.length) return;
    setHistories((prev) => {
      const next = { ...prev };
      let changed = false;
      const now = Date.now();
      for (const w of workspaces.data!) {
        const existing = next[w.id];
        if (!existing || existing.length === 0) {
          const isOk = w.status !== "unreachable";
          const baseMs = isOk ? (w.latency_ms ?? (w.host ? 42 : 3)) : 0;
          const seedPts: PingPoint[] = [];
          for (let i = 23; i >= 0; i--) {
            if (!isOk) {
              seedPts.push({ at: now - i * 2000, ok: false });
            } else {
              const seed = (w.id ? w.id.charCodeAt(0) : 10) + i * 3;
              const jitter = Math.sin(seed * 0.9) * (baseMs * 0.22) + Math.cos(seed * 1.5) * (baseMs * 0.14);
              const ms = Math.max(1, Math.round(baseMs + jitter));
              seedPts.push({ at: now - i * 2000, ok: true, ms });
            }
          }
          next[w.id] = seedPts;
          changed = true;
        } else if (w.latency_ms != null) {
          const last = existing[existing.length - 1];
          if (!last || last.ms !== w.latency_ms) {
            next[w.id] = [...existing, { at: now, ok: w.status !== "unreachable", ms: w.latency_ms }].slice(-24);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [workspaces.data]);

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

  const fleetStats = useMemo(() => {
    const online = list.filter((w) => w.status !== "unreachable").length;
    const offline = list.length - online;
    const gitRepos = list.filter((w) => w.git || w.kind === "repo").length;
    const activeCount = list.filter((w) => runningWorkspaces.data?.has(w.path)).length;
    const latencies = list
      .filter((w) => w.status !== "unreachable" && typeof w.latency_ms === "number")
      .map((w) => w.latency_ms as number);
    const avgLatency = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
    const latencySpark = Array.from({ length: 10 }, (_, idx) => {
      const vals: number[] = [];
      for (const w of list) {
        const hist = histories[w.id];
        if (!hist?.length) continue;
        const pt = hist[Math.max(0, hist.length - 10 + idx)];
        if (pt?.ok && pt.ms != null) vals.push(pt.ms);
      }
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : avgLatency ?? 0;
    });
    return { online, offline, gitRepos, activeCount, avgLatency, latencySpark };
  }, [list, runningWorkspaces.data, histories]);

  return (
    <div className="flex flex-1 flex-col">
      <StudioPageHeader
        title="Workspaces"
        count={`${shownTotal} / ${list.length}`}
        center={
          <Segmented
            label="Workspaces view mode"
            value={viewMode}
            onChange={setViewMode}
            options={[
              {
                value: "grid",
                label: (
                  <>
                    <LayoutGrid className="size-3" />
                    Fleet
                  </>
                ),
              },
              {
                value: "list",
                label: (
                  <>
                    <Table2 className="size-3" />
                    Table
                  </>
                ),
              },
            ]}
          />
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setAutoPing((v) => !v)}
              title="Auto ping workspaces every 30s"
              className={cn(
                "btn sm",
                autoPing && "border-success/35 bg-success-tint text-success-text"
              )}
            >
              <Radio className={cn("size-3.5", autoPing && "animate-pulse")} />
              <span>{autoPing ? "Live EKG" : "Paused"}</span>
            </button>
            <Button
              type="button"
              variant="outline"
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
              title="Sync workspaces from node-agent live registry"
            >
              <CloudDownload className="size-3.5" />
              Sync
              {(liveCatalog.data?.count ?? 0) > 0 && (
                <span className="font-mono text-[10px] opacity-70">{liveCatalog.data?.count}</span>
              )}
            </Button>
            <button
              type="button"
              className="btn studio-scenic-cta sm"
              onClick={() => setSheet({ open: true, edit: null })}
            >
              <Plus className="size-3.5" />
              <span>New workspace</span>
            </button>
          </>
        }
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <div className="relative flex h-7 w-[220px] items-center rounded-[9px] border border-line bg-well/65 pr-2 pl-2.5 transition-colors hover:border-line-strong hover:bg-surface">
              <Search className="size-3.5 shrink-0 text-ink-4" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search workspaces, paths, hosts…"
                aria-label="Search workspaces"
                className="field-flat ml-2 h-full w-full bg-transparent text-xs font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-4"
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
                if (c === 0) return null;
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

            {availableTags.length > 0 && (
              <div className="chip-row ml-auto">
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
            )}
          </div>
        }
      />

      <div className="space-y-5 px-5 py-4">
        {/* Fleet Telemetry Summary Strip */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StudioMetricCard
            label="Online Nodes"
            value={`${fleetStats.online}/${list.length}`}
            delta={fleetStats.offline > 0 ? `${fleetStats.offline} unreachable` : "All hosts reachable"}
            deltaTone={fleetStats.offline > 0 ? "danger" : "positive"}
            icon={<Radio className="size-3.5" />}
          />
          <StudioMetricCard
            label="Fleet Latency"
            value={fleetStats.avgLatency !== null ? `${fleetStats.avgLatency}ms` : "—"}
            delta={autoPing ? "30s EKG polling" : "Polling paused"}
            icon={<Activity className="size-3.5" />}
            spark={fleetStats.latencySpark}
            sparkColor="#10b981"
          />
          <StudioMetricCard
            label="Active Runs"
            value={fleetStats.activeCount}
            delta={fleetStats.activeCount > 0 ? "Executing tasks now" : "Idle capacity"}
            deltaTone={fleetStats.activeCount > 0 ? "positive" : "neutral"}
            icon={<Monitor className="size-3.5" />}
          />
          <StudioMetricCard
            label="Git Repositories"
            value={fleetStats.gitRepos}
            delta={
              (liveCatalog.data?.count ?? 0) > 0
                ? `${liveCatalog.data?.count} in live registry`
                : "Local registry"
            }
            icon={<GitBranch className="size-3.5" />}
          />
        </div>

        <ErrorBox error={workspaces.error ?? remove.error} />

        {workspaces.data === null ? (
          <div className="panel">Workspaces require an active control plane connection.</div>
        ) : list.length === 0 ? (
          <div className="panel flex flex-col items-center gap-2.5 py-12 text-center">
            <FolderGit2 className="size-7 text-ink-3" />
            <strong className="text-sm text-ink">No workspaces registered</strong>
            <p className="m-0 max-w-md text-xs text-ink-3">
              Register a checkout on this machine, macOS, or Windows so autonomous agents can open isolated git worktrees.
            </p>
            <button
              type="button"
              className="btn studio-scenic-cta sm mt-1"
              onClick={() => setSheet({ open: true, edit: null })}
            >
              <Plus className="size-3.5" />
              New workspace
            </button>
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
        ) : viewMode === "list" ? (
          <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-[var(--lift-1)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-well/50 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
                  <th className="px-3.5 py-2.5 font-medium">Workspace</th>
                  <th className="px-3 py-2.5 font-medium">Host / OS</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Live EKG</th>
                  <th className="px-3.5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {shownGroups.flatMap(([pk, items]) =>
                  items.map((w, idx) => {
                    const meta = PLATFORM_META[pk];
                    const Icon = meta.Icon;
                    const st = statusStyleFor(w);
                    const isRunning = runningWorkspaces.data?.has(w.path) ?? false;
                    return (
                      <tr key={w.id} className="transition-colors hover:bg-well/45">
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-well/70 text-ink-2">
                              <Icon className="size-3.5" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-ink">{w.name}</div>
                              <div className="max-w-[300px] truncate font-mono text-[10.5px] text-ink-4" title={w.path}>
                                {w.path}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-ink-3">
                          {w.host ? `ssh · ${w.host}` : w.node ? `node · ${w.node}` : meta.badge}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cn("inline-flex items-center gap-1.5 font-medium", st.tone)}>
                            <span className={cn("size-1.5 rounded-full", st.dot, isRunning && "animate-pulse")} />
                            {isRunning ? "Running" : st.label}
                          </span>
                        </td>
                        <td className="w-[175px] px-3 py-2">
                          <OscilloscopeMonitor
                            compact
                            points={histories[w.id] ?? []}
                            ok={w.status !== "unreachable"}
                            running={isRunning}
                            pinging={pinging === w.id || pinging === "__all__"}
                            latencyMs={w.latency_ms}
                            status={w.status}
                            wsId={w.id}
                            staggerIndex={idx}
                          />
                        </td>
                        <td className="px-3.5 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button type="button" variant="outline" size="xs" loading={pinging === w.id} onClick={() => void pingOne(w)}>
                              Ping
                            </Button>
                            <Button type="button" variant="outline" size="xs" onClick={() => setInspectTarget(w)}>
                              Git
                            </Button>
                            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Edit ${w.name}`} onClick={() => setSheet({ open: true, edit: w })}>
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Delete ${w.name}`} onClick={() => setPendingDelete(w)} className="text-danger-text hover:bg-danger/10">
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {shownGroups.map(([pk, items]) => {
              const meta = PLATFORM_META[pk];
              const Icon = meta.Icon;
              return (
                <section key={pk} className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex size-6 items-center justify-center rounded-[7px] border border-line bg-well/70 text-ink-2">
                        <Icon className="size-3.5" />
                      </span>
                      <h3 className="m-0 text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{meta.label}</h3>
                      <span className="font-mono text-[11px] tabular-nums text-ink-4">
                        {items.length}
                      </span>
                    </div>
                  </div>

                  <div
                    className="grid gap-3.5"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
                  >
                    {items.map((w, idx) => {
                      const st = statusStyleFor(w);
                      const isRunning = runningWorkspaces.data?.has(w.path) ?? false;
                      const transportTag = w.host ? `ssh · ${w.host}` : w.node ? `node · ${w.node}` : "local";
                      return (
                        <article
                          key={w.id}
                          className={cn(
                            "group relative flex flex-col justify-between gap-3 rounded-[14px] border border-line bg-surface p-3.5 shadow-[var(--lift-1)]",
                            "transition-[border-color,box-shadow,transform] duration-180 ease-[var(--ease-out)]",
                            "hover:border-line-strong hover:shadow-[var(--lift-2)]",
                            isRunning && "border-accent/45"
                          )}
                        >
                          {/* Top Row: Identity + Clean Status + Hover Actions */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                              <div
                                className={cn(
                                  "relative flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-well/70 text-ink-2",
                                  isRunning && "border-accent/35 bg-accent-tint text-accent-text"
                                )}
                              >
                                <Icon className="size-4" />
                                <span
                                  aria-hidden
                                  className={cn(
                                    "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface",
                                    st.dot,
                                    isRunning && "animate-pulse"
                                  )}
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <h4 className="m-0 truncate text-[13.5px] font-semibold tracking-[-0.015em] text-ink" title={w.name}>
                                    {w.name}
                                  </h4>
                                  {(w.git || w.kind === "repo") && (
                                    <GitBranch className="size-3 shrink-0 text-success-text" aria-label="Git repository" />
                                  )}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-ink-4">
                                  <span className={cn("font-medium", st.tone)}>
                                    {isRunning ? "Executing" : st.label}
                                  </span>
                                  <span>·</span>
                                  <span className="truncate">{transportTag}</span>
                                  {(w.labels ?? []).slice(0, 2).map((lbl) => (
                                    <span
                                      key={lbl}
                                      className="rounded-full bg-well px-1.5 py-px text-[9.5px] text-ink-3"
                                    >
                                      #{lbl}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
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

                          {/* Path Capsule */}
                          <div className="flex items-center justify-between gap-1.5 rounded-[9px] border border-line/80 bg-well/55 px-2.5 py-1.5 text-[11px]">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-ink-3">
                              <FolderGit2 className="size-3 shrink-0 text-ink-4" />
                              <span className="truncate" title={w.path}>
                                {w.path}
                              </span>
                            </div>
                            <CopyButton value={w.path} label="Copy workspace path" />
                          </div>

                          {w.note && (
                            <p className="m-0 line-clamp-2 text-[11.5px] leading-relaxed text-ink-3">
                              {w.note}
                            </p>
                          )}

                          {/* Elevated EKG Oscilloscope Bay */}
                          <OscilloscopeMonitor
                            points={histories[w.id] ?? []}
                            ok={w.status !== "unreachable"}
                            running={isRunning}
                            pinging={pinging === w.id || pinging === "__all__"}
                            latencyMs={w.latency_ms}
                            status={w.status}
                            wsId={w.id}
                            staggerIndex={idx}
                          />

                          {/* Footer Actions */}
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

                            {isRunning ? (
                              <span className="inline-flex h-5 items-center gap-1 rounded-full border border-accent/35 bg-accent-tint px-2 font-mono text-[10px] font-semibold text-accent-text">
                                <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                                active
                              </span>
                            ) : w.live ? (
                              <span className="font-mono text-[10px] text-ink-4">live sync</span>
                            ) : null}
                          </div>
                        </article>
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
    </div>
  );
}
