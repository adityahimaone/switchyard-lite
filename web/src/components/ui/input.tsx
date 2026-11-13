import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "glass-flat h-8 w-full min-w-0 rounded-control border border-line px-3 py-1 text-sm text-ink outline-none",
        "shadow-[inset_0_1px_2px_rgb(0_0_0_/_0.08)] dark:shadow-[inset_0_1px_2px_rgb(0_0_0_/_0.25)]",
        "transition-[border-color,background-color] duration-100",
        "placeholder:text-ink-3 selection:bg-accent selection:text-on-accent",
        "focus-visible:border-accent focus-visible:shadow-[inset_0_1px_2px_rgb(0_0_0_/_0.12),0_0_0_3px_rgb(from_var(--c-focus)_r_g_b_/_0.18)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
        "aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  );
}

export { Input };
