import * as React from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Overflow action menu.
 * `<Menu trigger={<button/>}><MenuItem onSelect={...}>Label</MenuItem></Menu>`
 */
export function Menu({
  trigger,
  children,
  align = "end",
  side = "bottom",
  label = "Actions",
}: {
  trigger: React.ReactElement;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  label?: string;
}) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger asChild>
        <span
          className="contents"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {trigger}
        </span>
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          align={align}
          side={side}
          sideOffset={6}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "z-[220] min-w-[188px] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-[12px] border border-line-strong/80 bg-raised/97 p-1",
            "text-ink shadow-[var(--lift-3),var(--lift-inset)] backdrop-blur-xl",
            "transition-[opacity,transform] duration-140 ease-[var(--ease-out-expo)]",
            "data-[state=closed]:scale-[0.97] data-[state=closed]:opacity-0 data-[state=open]:scale-100 data-[state=open]:opacity-100"
          )}
        >
          {children}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <MenuPrimitive.Label className="px-2.5 pt-1.5 pb-1 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink-4 uppercase">
      {children}
    </MenuPrimitive.Label>
  );
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="my-1 h-px bg-line" />;
}

export function MenuItem({
  children,
  icon: Icon,
  onSelect,
  danger,
  disabled,
  hint,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <MenuPrimitive.Item
      disabled={disabled}
      onSelect={(e) => {
        e.preventDefault();
        onSelect?.();
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-xs font-medium outline-none select-none",
        "transition-colors data-[highlighted]:bg-well data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        danger ? "text-danger-text data-[highlighted]:bg-danger-tint" : "text-ink-2 data-[highlighted]:text-ink"
      )}
    >
      {Icon && <Icon className={cn("size-3.5 shrink-0", danger ? "text-danger-text" : "text-ink-3")} />}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 font-mono text-[10px] text-ink-4">{hint}</span>}
    </MenuPrimitive.Item>
  );
}
