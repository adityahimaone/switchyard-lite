import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink outline-none",
        "shadow-[var(--lift-1),var(--lift-inset)]",
        "transition-[border-color,background-color,box-shadow] duration-120 ease-[var(--ease-out-quint)]",
        "placeholder:text-ink-4 selection:bg-accent selection:text-on-accent",
        "hover:border-line-strong",
        "focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus/25",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
