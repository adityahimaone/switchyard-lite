import { useId, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bklit-inspired composable React + SVG data visualization suite for Switchyard Studio.
 * Zero heavy runtime dependencies, full light/dark token fidelity, tabular figures,
 * smooth Catmull-Rom splines, pointer-tracked crosshairs, and reduced-motion friendly transitions.
 */

export interface AreaSeries {
  id: string;
  label: string;
  color: string;
  data: number[];
}

export interface StudioAreaChartProps {
  labels: string[];
  series: AreaSeries[];
  height?: number;
  className?: string;
  unit?: string;
}

function catmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function StudioAreaChart({
  labels,
  series,
  height = 196,
  className,
  unit = "",
}: StudioAreaChartProps) {
  const uid = useId().replace(/:/g, "");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const count = labels.length;
  const vbW = 560;
  const vbH = height;
  const padL = 32;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const plotW = vbW - padL - padR;
  const plotH = vbH - padT - padB;

  const maxVal = useMemo(() => {
    let m = 1;
    for (const s of series) {
      for (const v of s.data) {
        if (v > m) m = v;
      }
    }
    return Math.ceil(m * 1.15);
  }, [series]);

  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const ratio = i / steps;
      const val = Math.round(maxVal * (1 - ratio));
      const y = padT + plotH * ratio;
      return { val, y };
    });
  }, [maxVal, plotH]);

  const xFor = (i: number) =>
    count <= 1 ? padL + plotW / 2 : padL + (i / (count - 1)) * plotW;
  const yFor = (v: number) => padT + plotH - (Math.max(0, v) / maxVal) * plotH;

  const computed = useMemo(
    () =>
      series.map((s) => {
        const pts = labels.map((_, i) => ({
          x: xFor(i),
          y: yFor(s.data[i] ?? 0),
          v: s.data[i] ?? 0,
        }));
        const lineD = catmullRomPath(pts);
        const areaD =
          pts.length > 0
            ? `${lineD} L ${pts[pts.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`
            : "";
        return { ...s, pts, lineD, areaD };
      }),
    [series, labels, maxVal, plotW, plotH]
  );

  const activeX = hoverIdx !== null ? xFor(hoverIdx) : null;

  return (
    <div className={cn("relative w-full select-none", className)}>
      {/* Interactive Legend Header */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
              <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
        {hoverIdx !== null && (
          <div className="inline-flex items-center gap-2.5 rounded-[8px] border border-line bg-well/80 px-2.5 py-1 font-mono text-[11px] tabular-nums text-ink">
            <span className="text-ink-3">{labels[hoverIdx]}</span>
            {series.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 font-semibold">
                <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                {s.data[hoverIdx] ?? 0}
                {unit}
              </span>
            ))}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label="Time series area chart"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          {computed.map((s) => (
            <linearGradient key={s.id} id={`${uid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.24" />
              <stop offset="92%" stopColor={s.color} stopOpacity="0.02" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Horizontal dashed gridlines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={t.y}
              x2={vbW - padR}
              y2={t.y}
              stroke="var(--c-line)"
              strokeDasharray={i === yTicks.length - 1 ? undefined : "3 3"}
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={t.y + 3.5}
              textAnchor="end"
              className="fill-ink-4 font-mono text-[9.5px] tabular-nums"
            >
              {t.val}
            </text>
          </g>
        ))}

        {/* Area fills + spline strokes */}
        {computed.map((s) => (
          <g key={s.id}>
            <path d={s.areaD} fill={`url(#${uid}-${s.id})`} />
            <path
              d={s.lineD}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {/* Crosshair + active dots */}
        {hoverIdx !== null && activeX !== null && (
          <g>
            <line
              x1={activeX}
              y1={padT}
              x2={activeX}
              y2={padT + plotH}
              stroke="var(--c-line-strong)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            {computed.map((s) => {
              const pt = s.pts[hoverIdx];
              if (!pt) return null;
              return (
                <g key={s.id}>
                  <circle cx={pt.x} cy={pt.y} r="6" fill={s.color} opacity="0.18" />
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="3.5"
                    fill="var(--c-surface)"
                    stroke={s.color}
                    strokeWidth="2"
                  />
                </g>
              );
            })}
          </g>
        )}

        {/* X-axis labels */}
        {labels.map((lbl, i) => {
          const showEvery = count > 8 ? 2 : 1;
          if (i % showEvery !== 0 && i !== count - 1) return null;
          return (
            <text
              key={i}
              x={xFor(i)}
              y={vbH - 6}
              textAnchor="middle"
              className={cn(
                "font-mono text-[9.5px] tabular-nums transition-colors",
                hoverIdx === i ? "fill-ink font-semibold" : "fill-ink-4"
              )}
            >
              {lbl}
            </text>
          );
        })}

        {/* Invisible pointer hit columns for smooth scrubbing */}
        {labels.map((_, i) => {
          const colW = count > 1 ? plotW / (count - 1) : plotW;
          const x = Math.max(padL, xFor(i) - colW / 2);
          return (
            <rect
              key={i}
              x={x}
              y={padT}
              width={colW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}
      </svg>
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function StudioBarChart({
  data,
  height = 176,
  className,
}: {
  data: BarDatum[];
  height?: number;
  className?: string;
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const maxVal = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className={cn("flex w-full flex-col gap-2 select-none", className)}>
      <div
        className="grid items-end gap-2.5 pt-4"
        style={{
          height: `${height}px`,
          gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))`,
        }}
      >
        {data.map((d) => {
          const pct = Math.max(d.value > 0 ? 8 : 2, Math.round((d.value / maxVal) * 100));
          const isHovered = hoverKey === d.key;
          const isDimmed = hoverKey !== null && !isHovered;
          return (
            <div
              key={d.key}
              className="group flex h-full flex-col items-center justify-end gap-1.5"
              onMouseEnter={() => setHoverKey(d.key)}
              onMouseLeave={() => setHoverKey(null)}
            >
              <span
                className={cn(
                  "font-mono text-[11px] font-semibold tabular-nums transition-opacity duration-150",
                  isHovered ? "text-ink opacity-100" : "text-ink-3 opacity-85"
                )}
              >
                {d.value}
              </span>
              <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-[9px] bg-well/65 p-0.5">
                <div
                  className="w-full rounded-[7px] transition-[height,opacity,filter] duration-220 ease-[var(--ease-out)]"
                  style={{
                    height: `${pct}%`,
                    background: d.color,
                    opacity: isDimmed ? 0.32 : d.value === 0 ? 0.18 : 0.92,
                  }}
                />
              </div>
              <span className="max-w-full truncate font-mono text-[10px] text-ink-3">
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface RingSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function StudioRingChart({
  segments,
  total,
  centerLabel,
  centerValue,
  size = 152,
  className,
}: {
  segments: RingSegment[];
  total: number;
  centerLabel: string;
  centerValue: ReactNode;
  size?: number;
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const cx = size / 2;
  const cy = size / 2;
  const strokeW = 9;
  const gap = 4;

  const activeSeg = segments.find((s) => s.key === hovered);

  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {segments.map((seg, idx) => {
            const r = Math.max(18, size / 2 - strokeW / 2 - idx * (strokeW + gap) - 2);
            const circ = 2 * Math.PI * r;
            const ratio = total > 0 ? Math.min(1, Math.max(0, seg.value / total)) : 0;
            const dash = circ * ratio;
            const isActive = hovered === seg.key;
            const isDim = hovered !== null && !isActive;
            return (
              <g
                key={seg.key}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(seg.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="var(--c-well)"
                  strokeWidth={strokeW}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeW}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${circ}`}
                  style={{
                    opacity: isDim ? 0.28 : 1,
                    transition: "stroke-dasharray 320ms var(--ease-out), opacity 150ms ease",
                  }}
                />
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-[var(--font-display)] text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
            {activeSeg
              ? `${total > 0 ? Math.round((activeSeg.value / total) * 100) : 0}%`
              : centerValue}
          </span>
          <span className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-4">
            {activeSeg ? activeSeg.label : centerLabel}
          </span>
        </div>
      </div>

      <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
          const isActive = hovered === seg.key;
          return (
            <button
              key={seg.key}
              type="button"
              onMouseEnter={() => setHovered(seg.key)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-[8px] px-2 py-1 text-left transition-colors",
                isActive ? "bg-well" : "hover:bg-well/60"
              )}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-ink-2">
                <span className="size-2 rounded-full" style={{ background: seg.color }} />
                {seg.label}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-3">
                <strong className="font-semibold text-ink">{seg.value}</strong> · {pct}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StudioSparkline({
  values,
  color = "var(--c-accent)",
  width = 76,
  height = 24,
  className,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const pts = useMemo(() => {
    const src = values.length > 1 ? values : [0, values[0] ?? 0];
    const min = Math.min(...src);
    const max = Math.max(...src);
    const span = Math.max(1, max - min);
    return src.map((v, i) => ({
      x: (i / (src.length - 1)) * width,
      y: height - 3 - ((v - min) / span) * (height - 6),
    }));
  }, [values, width, height]);

  const d = catmullRomPath(pts);
  const area = pts.length ? `${d} L ${width} ${height} L 0 ${height} Z` : "";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`sp-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sp-${uid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StudioMetricCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  icon,
  spark,
  sparkColor,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: "neutral" | "positive" | "warning" | "danger";
  icon?: ReactNode;
  spark?: number[];
  sparkColor?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-2 rounded-[14px] border border-line bg-surface p-3.5 shadow-[var(--lift-1)] transition-[border-color,box-shadow] duration-150 hover:border-line-strong",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-ink-3 uppercase">
          {label}
        </span>
        {icon && (
          <span className="inline-flex size-6 items-center justify-center rounded-[7px] border border-line bg-well/70 text-ink-3">
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="font-[var(--font-display)] text-[24px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
            {value}
          </div>
          {delta && (
            <div
              className={cn(
                "mt-1.5 font-mono text-[10.5px] leading-none tabular-nums",
                deltaTone === "positive" && "text-success-text",
                deltaTone === "warning" && "text-warning-text",
                deltaTone === "danger" && "text-danger-text",
                deltaTone === "neutral" && "text-ink-4"
              )}
            >
              {delta}
            </div>
          )}
        </div>
        {spark && spark.length > 1 && (
          <StudioSparkline values={spark} color={sparkColor} />
        )}
      </div>
    </div>
  );
}
