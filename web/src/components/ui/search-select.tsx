import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export interface SearchSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeNode?: React.ReactNode;
  keywords?: string[];
  icon?: React.ReactNode;
  pinned?: boolean;
  disabled?: boolean;
}

export interface SearchSelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  showTriggerBadge?: boolean;
  options: SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  size?: "sm" | "default" | "lg";
  variant?: "plate" | "well" | "ghost";
  id?: string;
  ariaLabel?: string;
  title?: string;
}

/**
 * Switchyard Lite Tactile Capsule SearchSelect Picker
 *
 * Uses a `999px` porcelain capsule trigger (`rounded-full`) and opens a `20px`
 * frosted porcelain popover plate with a `999px` recessed well search trough
 * and `12px` concentric option items (`R_outer 20 - S_pad 8 = R_inner 12`).
 */
export function SearchSelect({
  value: controlledValue,
  defaultValue,
  onValueChange,
  open: controlledOpen,
  onOpenChange,
  modal = true,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  showTriggerBadge = false,
  options,
  placeholder = "Select an option…",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches found",
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
  size = "default",
  variant = "plate",
  id,
  ariaLabel,
  title,
}: SearchSelectProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const isControlledOpen = controlledOpen !== undefined;
  const open = isControlledOpen ? controlledOpen : internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlledOpen) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlledOpen, onOpenChange]
  );

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const selectedOption = React.useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const filteredOptions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      const matchLabel = opt.label.toLowerCase().includes(q);
      const matchValue = opt.value.toLowerCase().includes(q);
      const matchSub = opt.sublabel?.toLowerCase().includes(q);
      const matchBadge = opt.badge?.toLowerCase().includes(q);
      const matchKeywords = opt.keywords?.some((k) => k.toLowerCase().includes(q));
      return matchLabel || matchValue || matchSub || matchBadge || matchKeywords;
    });
  }, [options, query]);

  // Reset search + active row whenever the panel opens.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = filteredOptions.findIndex((opt) => opt.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  // Keep the active row visible while arrowing through a long list.
  React.useEffect(() => {
    if (!open || filteredOptions.length === 0) return;
    const frame = requestAnimationFrame(() => {
      itemRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, open, filteredOptions.length]);

  const selectOption = React.useCallback(
    (val: string) => {
      if (!isControlled) setInternalValue(val);
      onValueChange?.(val);
      setOpen(false);
    },
    [isControlled, onValueChange, setOpen]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (filteredOptions.length === 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      let next = activeIndex + 1;
      while (next < filteredOptions.length && filteredOptions[next]?.disabled) next++;
      if (next >= filteredOptions.length) {
        next = 0;
        while (next < activeIndex && filteredOptions[next]?.disabled) next++;
      }
      if (next < filteredOptions.length && !filteredOptions[next]?.disabled) setActiveIndex(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      let prev = activeIndex - 1;
      while (prev >= 0 && filteredOptions[prev]?.disabled) prev--;
      if (prev < 0) {
        prev = filteredOptions.length - 1;
        while (prev > activeIndex && filteredOptions[prev]?.disabled) prev--;
      }
      if (prev >= 0 && !filteredOptions[prev]?.disabled) setActiveIndex(prev);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      const target = Math.min(filteredOptions.length - 1, activeIndex + 6);
      let next = target;
      while (next < filteredOptions.length && filteredOptions[next]?.disabled) next++;
      if (next >= filteredOptions.length) next = target;
      if (!filteredOptions[next]?.disabled) setActiveIndex(next);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      const target = Math.max(0, activeIndex - 6);
      let prev = target;
      while (prev >= 0 && filteredOptions[prev]?.disabled) prev--;
      if (prev < 0) prev = target;
      if (!filteredOptions[prev]?.disabled) setActiveIndex(prev);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = filteredOptions[activeIndex];
      if (current && !current.disabled) selectOption(current.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={cn("relative w-full", className)}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={modal}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            data-slot="search-select-trigger"
            data-size={size}
            data-variant={variant}
            aria-label={ariaLabel || placeholder}
            title={title}
            aria-expanded={open}
            onKeyDown={handleKeyDown}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-full px-3.5 text-[13px] font-medium text-ink tracking-[-0.01em] outline-none",
              "transition-[border-color,background-color,box-shadow,transform] duration-150 ease-[var(--ease-out-expo)]",
              variant === "plate" &&
                "border border-line bg-surface shadow-[var(--lift-1),var(--lift-inset)] hover:border-line-strong hover:bg-raised hover:shadow-[var(--lift-2),var(--lift-inset)]",
              variant === "well" &&
                "border border-line/80 bg-well text-ink-2 shadow-[var(--well-inset)] hover:border-line-strong hover:bg-surface hover:text-ink",
              variant === "ghost" &&
                "border border-transparent bg-transparent text-ink-2 hover:bg-well/80 hover:text-ink",
              "focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus/35",
              "active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" && "h-8 px-3 py-1 text-xs",
              size === "default" && "h-9 py-2",
              size === "lg" && "h-11 px-4 py-2.5 text-sm",
              triggerClassName
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-left whitespace-nowrap">
              {selectedOption ? (
                <>
                  {selectedOption.icon && (
                    <span className="shrink-0 text-ink-3 [&_svg]:size-3.5">{selectedOption.icon}</span>
                  )}
                  <span className="truncate">{selectedOption.label}</span>
                  {showTriggerBadge &&
                    (selectedOption.badge ? (
                      <span className="shrink-0 rounded-full border border-line bg-well px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-2">
                        {selectedOption.badge}
                      </span>
                    ) : selectedOption.badgeNode ? (
                      <span className="shrink-0">{selectedOption.badgeNode}</span>
                    ) : null)}
                </>
              ) : (
                <span className="truncate text-ink-3">{placeholder}</span>
              )}
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-ink-3 opacity-70 transition-transform duration-200 ease-[var(--ease-out-expo)]",
                open && "rotate-180"
              )}
            />
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            collisionPadding={12}
            avoidCollisions
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            className={cn(
              "z-[110] flex max-h-[min(26rem,calc(100dvh-5rem))] w-[var(--radix-popover-trigger-width)] min-w-[15rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[20px]",
              "border border-line bg-raised/96 text-ink shadow-[var(--lift-3),var(--lift-inset)] backdrop-blur-2xl saturate-150 outline-none",
              "transition-[opacity,transform] duration-180 ease-[var(--ease-out-expo)]",
              "data-[state=closed]:scale-[0.97] data-[state=closed]:opacity-0",
              "data-[state=open]:scale-100 data-[state=open]:opacity-100",
              "data-[side=bottom]:data-[state=closed]:translate-y-[-4px] data-[side=bottom]:data-[state=open]:translate-y-0",
              "data-[side=top]:data-[state=closed]:translate-y-[4px] data-[side=top]:data-[state=open]:translate-y-0",
              contentClassName
            )}
          >
            {/* Capsule search trough inside popover header */}
            <div className="shrink-0 border-b border-line/60 p-2">
              <div className="relative flex h-8 items-center rounded-full border border-line/80 bg-well px-3 shadow-[var(--well-inset)]">
                <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={searchPlaceholder}
                  autoFocus
                  aria-activedescendant={
                    filteredOptions[activeIndex] ? `search-select-opt-${activeIndex}` : undefined
                  }
                  className="field-flat ml-2 w-full bg-transparent text-xs font-medium text-ink placeholder:text-ink-3 outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setActiveIndex(0);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full p-0.5 text-ink-3 hover:bg-surface hover:text-ink"
                    aria-label="Clear search"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Concentric 12px options list */}
            <div
              role="listbox"
              tabIndex={-1}
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              style={{ touchAction: "pan-y" }}
              className="max-h-64 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line-strong/40"
            >
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-ink-3">{emptyMessage}</div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value;
                  const isActive = idx === activeIndex;
                  return (
                    <div
                      key={opt.value}
                      id={`search-select-opt-${idx}`}
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={opt.disabled}
                      onClick={() => !opt.disabled && selectOption(opt.value)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={cn(
                        "relative flex w-full cursor-pointer items-center justify-between gap-2 rounded-[12px] px-3 py-2 text-xs font-medium outline-none select-none",
                        "transition-colors duration-100",
                        isActive && "bg-accent-tint/80 text-ink",
                        isSelected && "bg-accent-tint font-semibold text-accent-text",
                        opt.disabled && "pointer-events-none opacity-40"
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
                        {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                        <div className="flex min-w-0 flex-1 flex-col truncate">
                          <span className="truncate">{opt.label}</span>
                          {opt.sublabel && (
                            <span className="truncate font-mono text-[10px] text-ink-3">{opt.sublabel}</span>
                          )}
                        </div>
                        {opt.badgeNode ? (
                          <span className="shrink-0">{opt.badgeNode}</span>
                        ) : opt.badge ? (
                          <span className="shrink-0 rounded-full border border-line bg-well px-2 py-0.5 font-mono text-[10px] text-ink-2">
                            {opt.badge}
                          </span>
                        ) : null}
                      </div>
                      {isSelected && (
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                          <Check className="size-3" aria-hidden />
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
