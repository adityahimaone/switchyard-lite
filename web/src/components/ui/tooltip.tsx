import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/**
 * Lightweight tooltip: `<Tip label="Copy id"><button /></Tip>`.
 * The child must be a single element that forwards refs (button/a).
 */
export function Tip({
  label,
  side = "bottom",
  children,
  className,
}: {
  label: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactElement;
  className?: string;
}) {
  if (!label) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              "z-[220] max-w-[240px] rounded-md border border-line-strong/80 bg-raised px-2 py-1 text-[11px] leading-snug",
              "text-ink-2 shadow-float",
              "data-[state=closed]:opacity-0 data-[state=delayed-open]:opacity-100",
              "transition-opacity duration-100",
              className
            )}
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
