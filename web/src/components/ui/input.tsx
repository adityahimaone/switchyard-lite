import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-[10px] border border-line bg-surface px-3 py-1 text-xs font-medium text-ink outline-none",
        "shadow-[var(--lift-1),var(--lift-inset)]",
        "transition-[border-color,background-color,box-shadow] duration-120 ease-[var(--ease-out-quint)]",
        "placeholder:font-normal placeholder:text-ink-4 selection:bg-accent selection:text-on-accent",
        "hover:border-line-strong",
        "focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus/25",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
        "aria-invalid:border-danger aria-invalid:ring-danger/20",
        className
      )}
      {...props}
    />
  );
}

export { Input };
