import { cn } from "@/lib/utils";

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
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("glass-flat inline-flex items-center gap-0.5 rounded-control border border-line p-0.5", className)}
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
              "inline-flex h-6 items-center justify-center rounded-[6px] px-2.5 text-xs font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150",
              active
                ? "glass-flat-strong bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0_/_0.14)]"
                : "text-ink-3 hover:text-ink"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
