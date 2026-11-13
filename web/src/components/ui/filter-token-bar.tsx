import * as React from "react";
import { Plus, Search } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Compact token filter bar.
 *
 * Each filter is one inline pill: [field | operator | value | ×]. Clicking a
 * segment opens a small searchable picker; multi-value operators keep the
 * picker open so several values can be toggled in one pass. The whole bar is
 * one row tall (27px tokens), which is the compact replacement for the old
 * status strip + dropdown chips.
 */

export interface FilterOption {
  value: string;
  label: string;
  glyph?: React.ReactNode;
  count?: number;
}

export interface FilterOperatorDef {
  value: string;
  label: string;
  multi?: boolean;
}

export interface FilterFieldDef {
  id: string;
  label: string;
  icon?: React.ReactNode;
  operators: FilterOperatorDef[];
  options?: FilterOption[];
}

export interface Filter {
  id: string;
  field: string;
  operator: string;
  values: string[];
}

export interface FilterBarProps {
  fields: FilterFieldDef[];
  value: Filter[];
  onChange: (filters: Filter[]) => void;
  addLabel?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `f_${Math.random().toString(36).slice(2, 9)}`;

function fieldById(fields: FilterFieldDef[], id: string) {
  return fields.find((f) => f.id === id);
}

function operatorByValue(field: FilterFieldDef | undefined, value: string) {
  return field?.operators.find((o) => o.value === value);
}

function summarize(options: FilterOption[] | undefined, values: string[]) {
  if (!values.length) return { text: "Choose…", empty: true, glyphs: [] as React.ReactNode[] };
  const find = (v: string) => options?.find((o) => o.value === v);
  const label = (v: string) => find(v)?.label ?? v;
  const glyphs = values
    .map((v) => find(v)?.glyph)
    .filter(Boolean)
    .slice(0, 3) as React.ReactNode[];
  if (values.length === 1) return { text: label(values[0]), empty: false, glyphs };
  if (values.length <= 3) return { text: values.map(label).join(", "), empty: false, glyphs };
  return { text: `${label(values[0])} +${values.length - 1}`, empty: false, glyphs };
}

/* -------------------------------------------------------------------------- */
/* Picker                                                                     */
/* -------------------------------------------------------------------------- */

interface PickerItem {
  value: string;
  label: string;
  glyph?: React.ReactNode;
  count?: number;
  selected?: boolean;
}

function PickerList({
  items,
  multi,
  placeholder = "Filter…",
  empty = "No matches",
  onPick,
}: {
  items: PickerItem[];
  multi?: boolean;
  placeholder?: string;
  empty?: string;
  onPick: (value: string) => void;
}) {
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => i.label.toLowerCase().includes(needle));
  }, [items, q]);

  React.useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  React.useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  React.useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[active];
      if (item) onPick(item.value);
    }
  };

  return (
    <div className="overflow-hidden">
      <div className="border-b border-line/70 p-1.5">
        <div className="relative flex h-7 items-center rounded-full border border-line/80 bg-well px-2.5">
          <Search className="size-3 shrink-0 text-ink-4" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="ml-1.5 w-full bg-transparent text-[11px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-4"
          />
        </div>
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-multiselectable={multi || undefined}
        className="max-h-56 overflow-y-auto p-1"
      >
        {filtered.length === 0 && (
          <p className="m-0 px-2 py-2 text-[11px] text-ink-4">{empty}</p>
        )}
        {filtered.map((item, i) => {
          const isActive = i === active;
          return (
            <button
              key={item.value}
              id={`${listId}-${i}`}
              data-idx={i}
              type="button"
              role="option"
              aria-selected={multi ? !!item.selected : isActive}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(item.value)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[11px] transition-colors",
                isActive ? "bg-well text-ink" : "text-ink-2 hover:bg-well/70"
              )}
            >
              {multi && (
                <span
                  aria-hidden
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                    item.selected
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line-strong"
                  )}
                >
                  {item.selected && <span className="text-[9px] leading-none font-bold">✓</span>}
                </span>
              )}
              {item.glyph && (
                <span className="flex shrink-0 items-center text-ink-3" aria-hidden>
                  {item.glyph}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {typeof item.count === "number" && (
                <span className="font-mono text-[9px] tabular-nums text-ink-4">{item.count}</span>
              )}
              {!multi && item.selected && <span className="shrink-0 text-[10px] leading-none font-bold text-accent">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Token                                                                      */
/* -------------------------------------------------------------------------- */

interface SegmentProps extends Omit<React.ComponentProps<"button">, "onClick"> {
  ariaLabel: string;
  muted?: boolean;
  active?: boolean;
}

/**
 * Must forward ref + props: Radix's `PopoverTrigger asChild` clones this button
 * with its own onClick/aria/ref. Without forwarding, clicking a token segment
 * silently did nothing (the "cannot click the select" bug).
 */
const Segment = React.forwardRef<HTMLButtonElement, SegmentProps>(function Segment(
  { children, ariaLabel, muted, active, className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      data-kubai-trigger
      className={cn(
        "flex min-w-0 items-center gap-1 whitespace-nowrap px-1.5 transition-colors",
        "focus-visible:outline-none focus-visible:bg-well",
        muted ? "text-ink-3" : "text-ink",
        active ? "bg-well" : "hover:bg-well/70",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function FilterBar({
  fields,
  value,
  onChange,
  addLabel = "Filter",
  emptyLabel = "Add filter",
  disabled,
  className,
  "aria-label": ariaLabel = "Filters",
}: FilterBarProps) {
  const [open, setOpen] = React.useState<
    { kind: "add" } | { kind: "field" | "operator" | "value"; id: string } | null
  >(null);
  const [flash, setFlash] = React.useState<string | null>(null);


  const addFilter = (fieldId: string) => {
    const field = fieldById(fields, fieldId);
    if (!field) return;
    const filter: Filter = {
      id: uid(),
      field: fieldId,
      operator: field.operators[0]?.value ?? "is",
      values: [],
    };
    onChange([...value, filter]);
    setOpen(null);
  };

  const changeField = (id: string, fieldId: string) => {
    const field = fieldById(fields, fieldId);
    onChange(
      value.map((f) =>
        f.id === id
          ? { ...f, field: fieldId, operator: field?.operators[0]?.value ?? f.operator, values: [] }
          : f
      )
    );
    setOpen(null);
  };

  const changeOperator = (id: string, opValue: string) => {
    const filter = value.find((f) => f.id === id);
    const field = fieldById(fields, filter?.field ?? "");
    const nextOp = operatorByValue(field, opValue);
    onChange(
      value.map((f) =>
        f.id === id
          ? { ...f, operator: opValue, values: nextOp?.multi ? f.values : f.values.slice(0, 1) }
          : f
      )
    );
    setOpen(null);
  };

  const toggleValue = (id: string, optionValue: string, multi: boolean) => {
    onChange(
      value.map((f) => {
        if (f.id !== id) return f;
        if (!multi) return { ...f, values: [optionValue] };
        const has = f.values.includes(optionValue);
        return {
          ...f,
          values: has ? f.values.filter((v) => v !== optionValue) : [...f.values, optionValue],
        };
      })
    );
    setFlash(id);
    window.setTimeout(() => setFlash((c) => (c === id ? null : c)), 520);
    if (!multi) setOpen(null);
  };

  const remove = (id: string) => {
    onChange(value.filter((f) => f.id !== id));
    setOpen(null);
  };

  const isOpen = (id: string, kind: "field" | "operator" | "value") =>
    open?.kind === kind && "id" in open && open.id === id;

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      {value.map((filter) => {
        const field = fieldById(fields, filter.field);
        const op = operatorByValue(field, filter.operator);
        const summary = summarize(field?.options, filter.values);
        const multi = !!op?.multi;
        return (
          <div
            key={filter.id}
            className={cn(
              "flex h-[27px] items-stretch overflow-hidden rounded-full border border-line bg-surface/90 text-[11px] shadow-[var(--lift-1)] transition-colors",
              flash === filter.id && "border-accent/60 bg-accent-tint"
            )}
          >
            <Popover
              open={isOpen(filter.id, "field")}
              onOpenChange={(o) => setOpen(o ? { kind: "field", id: filter.id } : null)}
            >
              <PopoverTrigger asChild>
                <Segment
                  ariaLabel={`Field: ${field?.label ?? filter.field}. Change field.`}
                  active={isOpen(filter.id, "field")}
                  className="rounded-l-full pl-2 font-medium"
                >
                  {field?.icon && (
                    <span className="text-ink-3" aria-hidden>
                      {field.icon}
                    </span>
                  )}
                  <span className="truncate">{field?.label ?? filter.field}</span>
                </Segment>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[220px] p-0">
                <PickerList
                  items={fields.map((f) => ({
                    value: f.id,
                    label: f.label,
                    glyph: f.icon,
                    selected: f.id === filter.field,
                  }))}
                  onPick={(v) => changeField(filter.id, v)}
                />
              </PopoverContent>
            </Popover>

            <span aria-hidden className="w-px bg-line" />

            <Popover
              open={isOpen(filter.id, "operator")}
              onOpenChange={(o) => setOpen(o ? { kind: "operator", id: filter.id } : null)}
            >
              <PopoverTrigger asChild>
                <Segment
                  ariaLabel={`Operator: ${op?.label ?? filter.operator}. Change operator.`}
                  active={isOpen(filter.id, "operator")}
                  muted
                >
                  {op?.label ?? filter.operator}
                </Segment>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[180px] p-0">
                <PickerList
                  items={field?.operators.map((o) => ({
                    value: o.value,
                    label: o.label,
                    selected: o.value === filter.operator,
                  })) ?? []}
                  onPick={(v) => changeOperator(filter.id, v)}
                />
              </PopoverContent>
            </Popover>

            <span aria-hidden className="w-px bg-line" />

            <Popover
              open={isOpen(filter.id, "value")}
              onOpenChange={(o) => setOpen(o ? { kind: "value", id: filter.id } : null)}
            >
              <PopoverTrigger asChild>
                <Segment
                  ariaLabel={`Value: ${summary.empty ? "none selected" : summary.text}. Change value.`}
                  active={isOpen(filter.id, "value")}
                  muted={summary.empty}
                  className="max-w-[170px]"
                >
                  {!summary.empty && summary.glyphs.length > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                      {summary.glyphs.map((g, i) => (
                        <span key={i} className="flex items-center">
                          {g}
                        </span>
                      ))}
                    </span>
                  )}
                  <span
                    className={cn(
                      "truncate",
                      summary.empty ? "text-ink-4" : "font-medium text-ink"
                    )}
                  >
                    {summary.text}
                  </span>
                  <span aria-hidden className="shrink-0 text-[9px] leading-none text-ink-4">▾</span>
                </Segment>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[236px] p-0">
                <PickerList
                  items={(field?.options ?? []).map((o) => ({
                    value: o.value,
                    label: o.label,
                    glyph: o.glyph,
                    count: o.count,
                    selected: filter.values.includes(o.value),
                  }))}
                  multi={multi}
                  onPick={(v) => toggleValue(filter.id, v, multi)}
                />
              </PopoverContent>
            </Popover>

            <button
              type="button"
              onClick={() => remove(filter.id)}
              aria-label={`Remove ${field?.label ?? filter.field} filter`}
              data-kubai-trigger
              className="flex items-center px-1.5 text-ink-4 transition-colors hover:bg-danger-tint hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/50"
            >
              <span aria-hidden className="text-[13px] leading-none">×</span>
            </button>
          </div>
        );
      })}

      <Popover
        open={open?.kind === "add"}
        onOpenChange={(o) => setOpen(o ? { kind: "add" } : null)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={value.length === 0 ? emptyLabel : addLabel}
            data-kubai-trigger
            className="inline-flex h-[27px] items-center gap-1 rounded-full border border-line bg-surface/70 px-2.5 text-[11px] font-medium text-ink-3 shadow-[var(--lift-1)] transition-colors hover:border-accent/45 hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:bg-well"
          >
            <Plus className="size-3" />
            {value.length === 0 ? emptyLabel : addLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[220px] p-0">
          <PickerList
            items={fields.map((f) => ({ value: f.id, label: f.label, glyph: f.icon }))}
            onPick={(v) => addFilter(v)}
          />
        </PopoverContent>
      </Popover>

      {value.length > 1 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-0.5 rounded-full px-2 py-1 text-[11px] text-ink-4 transition-colors hover:bg-well hover:text-ink-2"
        >
          Clear
        </button>
      )}
    </div>
  );
}

export default FilterBar;
