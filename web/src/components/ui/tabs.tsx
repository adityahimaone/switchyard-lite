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
          ? "inline-flex items-center gap-1 border-b border-line"
          : "glass-flat inline-flex h-9 w-fit items-center justify-center rounded-control p-1",
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
        "relative inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap text-ink-3 outline-none transition-colors",
        "hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/40 disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:text-accent-text data-[state=active]:font-semibold",
        "after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent",
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
