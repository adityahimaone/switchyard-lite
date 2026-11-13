import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0 text-[10.5px] font-semibold leading-none whitespace-nowrap transition-[color,box-shadow,background-color] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-accent/30 bg-accent-tint text-accent-text",
        secondary: "border-line bg-well text-ink-2",
        destructive: "border-danger/30 bg-danger-tint text-danger-text",
        success: "border-success/30 bg-[var(--c-mint-wash)] text-success-text",
        review: "border-review/30 bg-review-tint text-review-text",
        outline: "border-line bg-surface text-ink-2 shadow-[var(--lift-1)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
