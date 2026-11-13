import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronsUpDown, Filter, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Switchyard Lite Tactile Capsule & Pill Kit
 *
 * Implements the tactile pill vocabulary from Concept 1 & Concept 2:
 *   - `Pill`: Base capsule container (`plate`, `well`, `prism`, `obsidian`, `mint`, `cobalt`, `dashed`).
 *   - `StatusPill`: Lamp-coded status capsule (`online` mint wash `#BCEFD4` + `#13794B`,
 *     `working` / `in_progress` white plate + dashed spinning `#2F5BFF` ring,
 *     `review` amber ring, `blocked` crimson lamp, `done` solid emerald, `idle` hollow slate).
 *   - `FilterPill`: `Filter · 2 | ×` white plate capsule with royal cobalt tabular badge and clear button.
 *   - `AvatarChip`: `Ella M. ×` white plate capsule with avatar circle and dismiss button.
 *   - `SearchField`: Recessed cool-sky well trough (`--c-well`) with raised white circular search lens button.
 *   - `CompoundActionPill`: `30 mins ⌄ [Book a Call]` capsule stepper with embedded prism CTA.
 */
export const pillVariants = cva(
  [
    "inline-flex shrink-0 select-none items-center gap-2 rounded-full font-medium leading-none tracking-[-0.01em]",
    "transition-[background-color,border-color,box-shadow,transform,color] duration-150 ease-[var(--ease-out-expo)]",
  ],
  {
    variants: {
      variant: {
        plate:
          "border border-line bg-surface text-ink shadow-[var(--lift-1),var(--lift-inset)]",
        well:
          "border border-line/70 bg-well text-ink-2 shadow-[var(--well-inset)]",
        prism:
          "sheen border border-white/25 bg-[image:var(--grad-prism)] text-white shadow-[var(--glow-brand),var(--lift-inset)]",
        obsidian:
          "sheen border border-white/15 bg-[image:var(--grad-obsidian)] text-white shadow-[var(--glow-obsidian)]",
        mint:
          "border border-success/20 bg-success-tint text-success-text shadow-[var(--lift-1)]",
        cobalt:
          "border border-accent/25 bg-surface text-accent-text shadow-[var(--lift-1),var(--lift-inset)]",
        amber:
          "border border-warning/25 bg-warning-tint text-warning-text shadow-[var(--lift-1)]",
        danger:
          "border border-danger/25 bg-danger-tint text-danger-text shadow-[var(--lift-1)]",
        dashed:
          "border-[1.5px] border-dashed border-line-strong bg-surface/65 text-ink-2",
      },
      size: {
        xs: "h-6 px-2.5 text-[11px]",
        sm: "h-7 px-3 text-xs",
        default: "h-9 px-3.5 text-[13px]",
        lg: "h-11 px-4 text-sm",
      },
    },
    defaultVariants: {
      variant: "plate",
      size: "default",
    },
  }
);

export type PillProps = React.ComponentProps<"span"> &
  VariantProps<typeof pillVariants>;

export function Pill({ className, variant, size, ...props }: PillProps) {
  return (
    <span
      data-slot="pill"
      data-variant={variant ?? "plate"}
      className={cn(pillVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export type StatusKind =
  | "online"
  | "working"
  | "in_progress"
  | "review"
  | "blocked"
  | "failed"
  | "done"
  | "todo"
  | "backlog"
  | "idle";

const STATUS_META: Record<
  StatusKind,
  {
    label: string;
    variant: NonNullable<PillProps["variant"]>;
    lamp: "solid-emerald" | "spin-cobalt" | "ring-amber" | "solid-crimson" | "hollow-slate";
  }
> = {
  online: { label: "Online", variant: "mint", lamp: "solid-emerald" },
  done: { label: "Done", variant: "mint", lamp: "solid-emerald" },
  working: { label: "In progress", variant: "cobalt", lamp: "spin-cobalt" },
  in_progress: { label: "In progress", variant: "cobalt", lamp: "spin-cobalt" },
  review: { label: "Need Review", variant: "amber", lamp: "ring-amber" },
  blocked: { label: "Blocked", variant: "danger", lamp: "solid-crimson" },
  failed: { label: "Failed", variant: "danger", lamp: "solid-crimson" },
  todo: { label: "To-do", variant: "plate", lamp: "hollow-slate" },
  backlog: { label: "Backlog", variant: "well", lamp: "hollow-slate" },
  idle: { label: "Idle", variant: "well", lamp: "hollow-slate" },
};

export interface StatusPillProps extends Omit<PillProps, "variant"> {
  status: StatusKind;
  label?: string;
}

export function StatusPill({
  status,
  label,
  size = "default",
  className,
  ...props
}: StatusPillProps) {
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  return (
    <Pill
      data-slot="status-pill"
      data-status={status}
      variant={meta.variant}
      size={size}
      className={cn("font-semibold", className)}
      {...props}
    >
      {meta.lamp === "solid-emerald" && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--c-success)_18%,transparent)]"
        />
      )}
      {meta.lamp === "spin-cobalt" && (
        <span
          aria-hidden
          className="size-3.5 shrink-0 rounded-full border-[1.75px] border-dashed border-accent animate-[spin_5s_linear_infinite]"
        />
      )}
      {meta.lamp === "ring-amber" && (
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full border-2 border-warning bg-warning/20"
        />
      )}
      {meta.lamp === "solid-crimson" && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-danger"
        />
      )}
      {meta.lamp === "hollow-slate" && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full border-[1.5px] border-ink-3"
        />
      )}
      <span>{label ?? meta.label}</span>
    </Pill>
  );
}

export interface FilterPillProps extends Omit< React.ComponentProps<"div">, "onChange"> {
  label?: string;
  count?: number;
  active?: boolean;
  onToggle?: () => void;
  onClear?: () => void;
}

export function FilterPill({
  label = "Filter",
  count = 0,
  active = false,
  onToggle,
  onClear,
  className,
  ...props
}: FilterPillProps) {
  return (
    <div
      data-slot="filter-pill"
      data-active={active || count > 0 || undefined}
      className={cn(
        "inline-flex h-9 shrink-0 select-none items-center rounded-full border border-line bg-surface pl-3 pr-1.5 text-[13px] font-medium text-ink shadow-[var(--lift-1),var(--lift-inset)] transition-[border-color,box-shadow] duration-150",
        (active || count > 0) && "border-accent/35",
        className
      )}
      {...props}
    >
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 pr-2 text-ink outline-none"
      >
        <Filter className="size-3.5 text-ink-3" aria-hidden />
        <span>{label}</span>
        {count > 0 && (
          <>
            <span className="text-ink-4" aria-hidden>
              ·
            </span>
            <span className="font-mono font-bold tabular text-accent">
              {count}
            </span>
          </>
        )}
      </button>
      {count > 0 && onClear && (
        <>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label} filters`}
            className="inline-flex size-6 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-well hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

export interface AvatarChipProps extends React.ComponentProps<"div"> {
  name: string;
  avatarUrl?: string;
  initials?: string;
  onRemove?: () => void;
}

export function AvatarChip({
  name,
  avatarUrl,
  initials,
  onRemove,
  className,
  ...props
}: AvatarChipProps) {
  const fallback =
    initials ??
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  return (
    <div
      data-slot="avatar-chip"
      className={cn(
        "inline-flex h-9 shrink-0 select-none items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1.5 pr-2.5 text-[13px] font-semibold text-ink shadow-[var(--lift-1),var(--lift-inset)]",
        className
      )}
      {...props}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="size-6 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="inline-flex size-6 items-center justify-center rounded-full bg-[image:var(--grad-prism)] font-mono text-[10px] font-bold text-white"
        >
          {fallback}
        </span>
      )}
      <span>{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="inline-flex size-5 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-well hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export interface SearchFieldProps
  extends Omit<React.ComponentProps<"input">, "size"> {
  onSubmitSearch?: (value: string) => void;
  containerClassName?: string;
}

/**
 * Concept 1 "Search [🔍]" well trough with raised porcelain circular action button.
 */
export function SearchField({
  value,
  onChange,
  onSubmitSearch,
  placeholder = "Search…",
  containerClassName,
  className,
  ...props
}: SearchFieldProps) {
  return (
    <div
      data-slot="search-field"
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border border-line/80 bg-well pl-4 pr-1.5 shadow-[var(--well-inset)] transition-[border-color,box-shadow] focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/25",
        containerClassName
      )}
    >
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(
          "field-flat h-full min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink placeholder:text-ink-3 outline-none",
          className
        )}
        {...props}
      />
      <button
        type="button"
        aria-label="Run search"
        onClick={() =>
          onSubmitSearch?.(typeof value === "string" ? value : "")
        }
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-2 shadow-[var(--lift-1)] transition-transform hover:text-ink active:scale-95"
      >
        <Search className="size-3.5" />
      </button>
    </div>
  );
}

export interface CompoundActionPillProps extends React.ComponentProps<"div"> {
  valueLabel?: string;
  unitLabel?: string;
  actionLabel?: string;
  onStep?: () => void;
  onAction?: () => void;
}

/**
 * Concept 1 "30 mins ⌄ [Book a Call]" compound stepper + prism CTA capsule.
 */
export function CompoundActionPill({
  valueLabel = "30",
  unitLabel = "mins",
  actionLabel = "Dispatch Agent",
  onStep,
  onAction,
  className,
  ...props
}: CompoundActionPillProps) {
  return (
    <div
      data-slot="compound-action-pill"
      className={cn(
        "inline-flex h-11 shrink-0 select-none items-center gap-2 rounded-full border border-line bg-surface p-1 pl-3.5 text-[13px] shadow-[var(--lift-1),var(--lift-inset)]",
        className
      )}
      {...props}
    >
      <button
        type="button"
        onClick={onStep}
        className="inline-flex items-center gap-1 font-medium text-ink outline-none"
      >
        <span className="font-mono font-bold tabular text-ink">
          {valueLabel}
        </span>
        <span className="text-ink-3">{unitLabel}</span>
        <ChevronsUpDown className="size-3.5 text-ink-3" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onAction}
        className="sheen inline-flex h-8.5 items-center gap-1.5 rounded-full border border-white/25 bg-[image:var(--grad-prism)] px-3.5 text-xs font-semibold text-white shadow-[var(--glow-brand)] transition-transform hover:brightness-105 active:scale-[0.97]"
      >
        <Sparkles className="size-3" aria-hidden />
        <span>{actionLabel}</span>
      </button>
    </div>
  );
}
