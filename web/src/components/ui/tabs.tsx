import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: "default" | "line";
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        variant === "line"
          ? "inline-flex h-8 items-center gap-1 border-b border-line"
          : "inline-flex h-9 w-fit items-center justify-center gap-1 rounded-[10px] border border-line/70 bg-well p-1",
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[26px] items-center justify-center gap-1.5 rounded-[8px] px-2.5 py-0 text-xs font-medium whitespace-nowrap text-ink-3 outline-none transition-[color,background-color,box-shadow] duration-150",
        "hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/40 disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:font-semibold data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
