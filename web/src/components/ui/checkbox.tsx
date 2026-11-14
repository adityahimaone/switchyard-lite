import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[5px] border border-line-strong/80 bg-surface shadow-[var(--lift-1),var(--lift-inset)] outline-none transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-[var(--ease-out-expo)]",
        "hover:border-accent/60 hover:bg-well/50",
        "focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus/35",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-white dark:data-[state=checked]:text-ink",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check className="size-3 stroke-[2.75]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
