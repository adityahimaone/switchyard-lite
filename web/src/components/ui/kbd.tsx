import { cn } from "@/lib/utils";

/** A small, consistent capsule keyboard hint. Uses ⌘ on Apple platforms, Ctrl elsewhere. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full border border-line bg-surface px-1.5",
        "font-mono text-[10px] leading-none font-semibold text-ink-3 shadow-[var(--lift-1)]",
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
