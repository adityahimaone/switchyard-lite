import { cn } from "@/lib/utils";

/** A small, consistent keyboard hint. Uses ⌘ on Apple platforms, Ctrl elsewhere. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong/70 bg-surface/80 px-1",
        "font-mono text-[10px] leading-none font-medium text-ink-3 shadow-[inset_0_-1px_0_rgb(0_0_0_/_0.08)]",
        className
      )}
    >
      {children}
    </kbd>
  );
}

export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Renders "⌘ K" style combos. */
export function KbdCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}
