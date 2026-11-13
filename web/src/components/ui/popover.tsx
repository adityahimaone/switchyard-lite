import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        /* Viewport-relative max-height instead of a fixed one: the portal escapes
           every `overflow: hidden` ancestor, so content past the viewport edge is
           genuinely unreachable. Letting the panel shrink keeps it on screen. */
        className={cn(
          "z-[110] max-h-[calc(100dvh-2rem)] w-72 origin-(--radix-popover-content-transform-origin) rounded-panel p-1.5 text-ink outline-none",
          "border border-line/60 bg-raised/95 shadow-float backdrop-blur-2xl saturate-150 dark:bg-raised/90",
          "transition-[opacity,transform] duration-180 ease-[var(--ease-out-expo)]",
          "data-[state=closed]:scale-[0.96] data-[state=closed]:opacity-0 data-[state=open]:scale-100 data-[state=open]:opacity-100",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
