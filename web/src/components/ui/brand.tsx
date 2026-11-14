import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * BrandMark — The authentic Switchyard "S" brand icon.
 *
 * Rounded-square tile: Royal Signal Blue field with the signature white "S" turnout curve.
 * Sourced directly from `/brand/switchyard-favicon-blue-512.png` (identical to kanban-board).
 */
export function BrandMark({
  size = 26,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <img
      src="/brand/switchyard-favicon-blue-512.png"
      alt={title || "Switchyard"}
      width={size}
      height={size}
      draggable={false}
      className={cn(
        "shrink-0 object-contain select-none rounded-[7px] shadow-[var(--lift-1)]",
        className
      )}
      style={{ width: size, height: size }}
    />
  );
}

export function BrandLockup({
  size = 26,
  suffix = "LITE",
  className,
}: {
  size?: number;
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <BrandMark size={size} />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: size * 0.68,
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        Switchyard
      </span>
      {suffix && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: Math.max(9, size * 0.36),
            fontWeight: 600,
            letterSpacing: "0.06em",
            padding: "2px 6px",
            borderRadius: 999,
            background: "var(--c-accent-tint)",
            color: "var(--c-accent-text)",
            lineHeight: 1,
          }}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
