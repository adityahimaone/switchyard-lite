import * as React from "react";
import { ChevronDown, ChevronRight, Cpu, Layers, Sparkles } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type TraceSpanStatus = "ok" | "running" | "error" | "skipped";

export interface TraceSpan {
  id: string;
  label: string;
  detail?: string;
  actor?: string;
  status: TraceSpanStatus;
  /** Unix timestamp in milliseconds. */
  startedAt: number;
  /** Unix timestamp in milliseconds (omit for active/running spans). */
  endedAt?: number;
  durationMs?: number;
  tokens?: number;
  costUsd?: number;
  meta?: Record<string, string | number | undefined>;
  children?: TraceSpan[];
}

export interface AgentTraceProps {
  spans: TraceSpan[];
  originMs?: number;
  totalDurationMs?: number;
  title?: string;
  subtitle?: string;
  className?: string;
}

const STATUS_DOT: Record<TraceSpanStatus, string> = {
  ok: "bg-success",
  running: "bg-accent animate-pulse",
  error: "bg-danger",
  skipped: "bg-ink-4",
};

const STATUS_BAR: Record<TraceSpanStatus, string> = {
  ok: "bg-success/80 border-success",
  running: "bg-accent/80 border-accent animate-pulse",
  error: "bg-danger/85 border-danger",
  skipped: "bg-ink-4/50 border-ink-4",
};

const STATUS_BADGE: Record<TraceSpanStatus, string> = {
  ok: "bg-success-tint text-success-text border-line",
  running: "bg-accent-tint text-accent-text border-accent/30",
  error: "bg-danger-tint text-danger-text border-danger/30",
  skipped: "bg-well text-ink-3 border-line",
};

export function formatTraceDuration(ms?: number): string {
  if (ms === undefined || ms === null || Number.isNaN(ms) || ms < 0) return "—";
  if (ms === 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const min = Math.floor(sec / 60);
  const remS = Math.round(sec % 60);
  if (min < 60) return remS > 0 ? `${min}m ${remS}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remM = min % 60;
  return remM > 0 ? `${hr}h ${remM}m` : `${hr}h`;
}

export function formatTraceTokens(tokens?: number): string {
  if (!tokens || tokens <= 0) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`;
  return `${tokens} tok`;
}

function collectBounds(spans: TraceSpan[], nowMs: number): { minMs: number; maxMs: number; count: number; tokens: number; cost: number } {
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = 0;
  let count = 0;
  let tokens = 0;
  let cost = 0;

  const walk = (list: TraceSpan[]) => {
    for (const sp of list) {
      count += 1;
      if (sp.startedAt > 0 && sp.startedAt < minMs) minMs = sp.startedAt;
      const end = sp.endedAt ?? (sp.durationMs ? sp.startedAt + sp.durationMs : sp.status === "running" ? nowMs : sp.startedAt);
      if (end > maxMs) maxMs = end;
      if (sp.tokens) tokens += sp.tokens;
      if (sp.costUsd) cost += sp.costUsd;
      if (sp.children?.length) walk(sp.children);
    }
  };
  walk(spans);
  if (!Number.isFinite(minMs)) minMs = 0;
  if (maxMs < minMs) maxMs = minMs;
  return { minMs, maxMs, count, tokens, cost };
}

interface TraceSpanRowProps {
  span: TraceSpan;
  depth: number;
  originMs: number;
  totalDurationMs: number;
  nowMs: number;
  defaultOpen?: boolean;
}

function TraceSpanRow({ span, depth, originMs, totalDurationMs, nowMs, defaultOpen = true }: TraceSpanRowProps) {
  const hasChildren = (span.children?.length ?? 0) > 0;
  const metaEntries = Object.entries(span.meta ?? {}).filter(([, v]) => v !== undefined && v !== "");
  const [expanded, setExpanded] = React.useState(defaultOpen);
  const [showMeta, setShowMeta] = React.useState(false);

  const rawDuration =
    span.durationMs ??
    (span.endedAt && span.startedAt ? Math.max(0, span.endedAt - span.startedAt) : span.status === "running" ? Math.max(0, nowMs - span.startedAt) : 0);

  const safeTotal = Math.max(1, totalDurationMs);
  const startOffset = Math.max(0, span.startedAt - originMs);
  const leftPct = Math.min(98, Math.max(0, (startOffset / safeTotal) * 100));
  const widthPct = Math.min(100 - leftPct, Math.max(rawDuration > 0 ? 1.2 : 0.6, (rawDuration / safeTotal) * 100));

  return (
    <div className="border-b border-line/60 last:border-b-0">
      <div
        className={cn(
          "group grid grid-cols-[minmax(0,1fr)_96px] @sm/trace:grid-cols-[minmax(190px,1.25fr)_minmax(120px,1fr)_82px] items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-well/60",
          (hasChildren || metaEntries.length > 0) && "cursor-pointer"
        )}
        onClick={() => {
          if (hasChildren) {
            setExpanded((v) => !v);
          } else if (metaEntries.length > 0) {
            setShowMeta((v) => !v);
          }
        }}
      >
        {/* Left: hierarchy + label */}
        <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${depth * 14}px` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              aria-label={expanded ? "Collapse span" : "Expand span"}
              className="flex size-4 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-well hover:text-ink"
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          ) : (
            <span className="flex size-4 shrink-0 items-center justify-center">
              <span className={cn("size-1.5 rounded-full", STATUS_DOT[span.status])} />
            </span>
          )}

          <span className="truncate font-medium text-ink" title={span.label}>
            {span.label}
          </span>

          {span.actor && (
            <span className="hidden @md/trace:inline-flex shrink-0 items-center rounded border border-line bg-well px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-3">
              {span.actor}
            </span>
          )}

          {span.detail && (
            <span className="truncate text-[11px] text-ink-3" title={span.detail}>
              {span.detail}
            </span>
          )}

          {metaEntries.length > 0 && !hasChildren && (
            <span className="hidden @sm/trace:inline shrink-0 text-[10px] text-ink-4 opacity-0 transition-opacity group-hover:opacity-100">
              {showMeta ? "hide" : "info"}
            </span>
          )}
        </div>

        {/* Middle: waterfall timing bar */}
        <div className="relative hidden h-5 items-center @sm/trace:flex">
          <div className="pointer-events-none absolute inset-y-0 left-1/4 w-px bg-line/40" />
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-line/40" />
          <div className="pointer-events-none absolute inset-y-0 left-3/4 w-px bg-line/40" />
          <div className="relative h-2.5 w-full rounded-full bg-well/80">
            <div
              className={cn("absolute top-0 h-2.5 min-w-[3px] rounded-full border", STATUS_BAR[span.status])}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${span.label}: ${formatTraceDuration(rawDuration)}`}
            />
          </div>
        </div>

        {/* Right: duration + tokens */}
        <div className="flex flex-col items-end justify-center font-mono text-[11px] tabular-nums">
          <span className={cn(span.status === "error" ? "font-medium text-danger-text" : span.status === "running" ? "text-accent-text" : "text-ink-2")}>
            {span.status === "running" && rawDuration === 0 ? "live" : formatTraceDuration(rawDuration)}
          </span>
          {span.tokens ? (
            <span className="text-[10px] text-ink-4">{formatTraceTokens(span.tokens)}</span>
          ) : null}
        </div>
      </div>

      {showMeta && metaEntries.length > 0 && (
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line/40 bg-well/40 px-3 py-1.5 font-mono text-[10.5px] text-ink-2"
          style={{ paddingLeft: `${depth * 14 + 32}px` }}
        >
          {metaEntries.map(([k, v]) => (
            <span key={k} className="inline-flex items-baseline gap-1">
              <span className="text-ink-4">{k}:</span>
              <span className="break-all text-ink-2">{String(v)}</span>
            </span>
          ))}
        </div>
      )}

      {hasChildren && expanded && (
        <div>
          {span.children!.map((child) => (
            <TraceSpanRow
              key={child.id}
              span={child}
              depth={depth + 1}
              originMs={originMs}
              totalDurationMs={totalDurationMs}
              nowMs={nowMs}
              defaultOpen={depth < 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentTrace({ spans, originMs, totalDurationMs, title = "Execution trace", subtitle, className }: AgentTraceProps) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const hasRunning = React.useMemo(() => {
    const check = (list: TraceSpan[]): boolean => list.some((s) => s.status === "running" || (s.children ? check(s.children) : false));
    return check(spans);
  }, [spans]);

  React.useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  const bounds = React.useMemo(() => collectBounds(spans, nowMs), [spans, nowMs]);
  const effectiveOrigin = originMs ?? bounds.minMs;
  const effectiveTotal = Math.max(1, totalDurationMs ?? Math.max(1, bounds.maxMs - effectiveOrigin));

  const overallStatus: TraceSpanStatus = hasRunning
    ? "running"
    : spans.some((s) => s.status === "error")
      ? "error"
      : "ok";

  return (
    <div className={cn("@container/trace overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--card-shadow)]", className)}>
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-well/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="size-3.5 shrink-0 text-accent-text" />
          <span className="text-xs font-medium text-ink">{title}</span>
          {subtitle && <span className="truncate text-[11px] text-ink-3">{subtitle}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
          <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 uppercase tracking-wide", STATUS_BADGE[overallStatus])}>
            <span className={cn("size-1.5 rounded-full", STATUS_DOT[overallStatus])} />
            {overallStatus}
          </span>
          <span className="rounded border border-line bg-surface px-1.5 py-0.5 text-ink-2">
            {bounds.count} {bounds.count === 1 ? "span" : "spans"}
          </span>
          <span className="rounded border border-line bg-surface px-1.5 py-0.5 text-ink-2">
            {formatTraceDuration(effectiveTotal)}
          </span>
          {bounds.tokens > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-ink-2">
              <Cpu className="size-2.5 text-ink-3" />
              {formatTraceTokens(bounds.tokens)}
            </span>
          )}
          {bounds.cost > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-ink-2">
              <Sparkles className="size-2.5 text-ink-3" />
              ${bounds.cost.toFixed(4)}
            </span>
          )}
        </div>
      </div>

      {/* Column / time ruler */}
      <div className="hidden grid-cols-[minmax(190px,1.25fr)_minmax(120px,1fr)_82px] items-center gap-2 border-b border-line/70 bg-well/30 px-3 py-1 font-mono text-[10px] text-ink-4 @sm/trace:grid">
        <span>Span</span>
        <div className="flex justify-between">
          <span>0ms</span>
          <span>{formatTraceDuration(effectiveTotal * 0.5)}</span>
          <span>{formatTraceDuration(effectiveTotal)}</span>
        </div>
        <span className="text-right">Duration</span>
      </div>

      {/* Rows */}
      <div>
        {spans.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-ink-3">No trace spans recorded yet.</div>
        ) : (
          spans.map((span, i) => (
            <TraceSpanRow
              key={span.id}
              span={span}
              depth={0}
              originMs={effectiveOrigin}
              totalDurationMs={effectiveTotal}
              nowMs={nowMs}
              defaultOpen={i === spans.length - 1 || span.status === "error" || span.status === "running"}
            />
          ))
        )}
      </div>
    </div>
  );
}
