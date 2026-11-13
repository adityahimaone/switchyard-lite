import * as React from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  variant = "plate",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default" | "lg";
  variant?: "plate" | "well" | "ghost";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      data-variant={variant}
      className={cn(
        /* Switchyard Lite Capsule Select Trigger:
           999px pill radius (`rounded-full`) with porcelain plate elevation or recessed well trough. */
        "flex w-full items-center justify-between gap-2 whitespace-nowrap overflow-hidden rounded-full px-3.5 py-2 text-[13px] font-medium text-ink tracking-[-0.01em] outline-none",
        "transition-[border-color,background-color,box-shadow,transform] duration-150 ease-[var(--ease-out-expo)]",
        variant === "plate" &&
          "border border-line bg-surface shadow-[var(--lift-1),var(--lift-inset)] hover:border-accent/45 hover:bg-well/55 hover:shadow-[var(--lift-2),var(--lift-inset)]",
        variant === "well" &&
          "border border-line/80 bg-well text-ink-2 shadow-[var(--well-inset)] hover:border-line-strong hover:bg-surface hover:text-ink",
        variant === "ghost" &&
          "border border-transparent bg-transparent text-ink-2 hover:bg-well/80 hover:text-ink",
        "focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus/35",
        "active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-danger aria-invalid:ring-danger/20",
        "data-[placeholder]:text-ink-3",
        "data-[size=sm]:h-8 data-[size=sm]:px-3 data-[size=sm]:text-xs",
        "data-[size=default]:h-9",
        "data-[size=lg]:h-11 data-[size=lg]:px-4 data-[size=lg]:text-sm",
        "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:truncate *:data-[slot=select-value]:whitespace-nowrap *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-ink-3 [&[data-state=open]>svg]:rotate-180",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-70 transition-transform duration-200 ease-[var(--ease-out-expo)]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className={cn(
          /* Concentric Geometry:
             Outer shell radius = 20px (`rounded-[20px]`), viewport padding = 8px (`p-2`),
             Inner option item radius = 20 - 8 = 12px (`rounded-[12px]`). */
          "relative z-[110] max-h-[min(320px,calc(100dvh-4rem))] max-w-[calc(100vw-1rem)] min-w-[10rem] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-[20px] border border-line bg-raised/96 text-ink shadow-[var(--lift-3),var(--lift-inset)] backdrop-blur-2xl saturate-150 outline-none",
          "transition-[transform,opacity] duration-180 ease-[var(--ease-out-expo)]",
          "data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
          "data-[side=bottom]:data-[state=closed]:translate-y-[-4px] data-[side=bottom]:data-[state=open]:translate-y-0",
          "data-[side=top]:data-[state=closed]:translate-y-[4px] data-[side=top]:data-[state=open]:translate-y-0",
          "data-[side=left]:data-[state=closed]:translate-x-[-4px] data-[side=left]:data-[state=open]:translate-x-0",
          "data-[side=right]:data-[state=closed]:translate-x-[4px] data-[side=right]:data-[state=open]:translate-x-0",
          "data-[state=closed]:scale-[0.97] data-[state=open]:scale-100",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{ touchAction: "pan-y" }}
          className={cn(
            "min-h-0 max-h-[min(300px,var(--radix-select-content-available-height))] overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line-strong/40",
            position === "popper" &&
              "w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        "px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3",
        className
      )}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-[12px] py-2 pr-8 pl-3 text-xs font-medium text-ink outline-none select-none transition-colors duration-100",
        "focus:bg-accent-tint focus:text-accent-text hover:bg-accent-tint/70 data-[state=checked]:bg-accent-tint/60 data-[state=checked]:font-semibold data-[state=checked]:text-accent-text data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-accent *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2.5 flex size-4 items-center justify-center rounded-full bg-accent/15 text-accent"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-3" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1.5 h-px bg-line", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn("flex cursor-default items-center justify-center py-1 text-ink-3", className)}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn("flex cursor-default items-center justify-center py-1 text-ink-3", className)}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};

export { SearchSelect, type SearchSelectOption, type SearchSelectProps } from "./search-select";
