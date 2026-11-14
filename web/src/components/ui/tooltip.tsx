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
  delayDuration = 150,
  children,
  className,
}: {
  label: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
  children: React.ReactElement;
  className?: string;
}) {
  if (!label) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={10}
            className={cn(
              "z-[220] max-w-[240px] rounded-[8px] border border-line-strong/90 bg-raised/98 px-2.5 py-1 text-xs font-medium leading-snug",
              "text-ink shadow-[var(--lift-2),var(--lift-inset)] backdrop-blur-md",
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
