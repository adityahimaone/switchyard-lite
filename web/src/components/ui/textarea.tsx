import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content max-h-52 min-h-16 w-full rounded-control border border-line-strong bg-well/60 px-3 py-2 text-sm text-ink outline-none",
        "transition-[border-color,background-color,box-shadow] duration-100 ease-[var(--ease-out-quint)]",
        "placeholder:text-ink-3 selection:bg-accent selection:text-on-accent",
        "focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_rgb(from_var(--c-focus)_r_g_b_/_0.18)]",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
