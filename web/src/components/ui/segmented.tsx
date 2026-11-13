import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Concept 1 Segmented Trough:
 * 999px recessed well trough (`bg-well border-line shadow-[var(--well-inset)] p-1`)
 * with raised porcelain pill active thumb (`bg-surface text-ink shadow-[var(--lift-1)]`).
 */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex h-8 items-center gap-0.5 rounded-[10px] border border-line bg-well p-0.5 shadow-[var(--well-inset)]",
        className
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-[26px] flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-xs font-semibold whitespace-nowrap transition-[color,background-color,box-shadow,transform] duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 active:scale-[0.972]",
              active
                ? "border border-line/70 bg-surface text-ink shadow-[var(--lift-1),var(--lift-inset)]"
                : "border border-transparent text-ink-3 hover:text-ink"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
