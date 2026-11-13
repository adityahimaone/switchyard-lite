import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium leading-none outline-none",
    "transition-[background-color,border-color,box-shadow,transform,color] duration-150 ease-out",
    "active:scale-[0.97]",
    "focus-visible:ring-[3px] focus-visible:ring-focus/40",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "glass-flat rounded-control border border-line text-ink-2 hover:-translate-y-px hover:shadow-lift data-[state=open]:shadow-lift motion-reduce:transform-none",
        signal:
          "rounded-control border border-accent bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255_/_0.18),0_1px_2px_rgb(0_0_0_/_0.25)] hover:brightness-95",
        secondary:
          "glass-flat rounded-control border border-line text-ink",
        outline:
          "rounded-control border-[0.8px] border-line-strong bg-transparent text-ink hover:bg-raised",
        ghost: "rounded-control text-ink-2 hover:bg-raised hover:text-ink",
        destructive:
          "rounded-control border-[0.8px] border-danger/30 bg-danger-tint text-danger-text hover:bg-danger/20",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 text-xs",
        default: "h-8 gap-1.5 px-2.5 text-[13px]",
        lg: "h-10 gap-2 px-4 text-sm",
        "icon-xs": "size-6 p-1 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-6 p-1",
        icon: "size-8 p-2",
        "icon-lg": "size-10 p-2",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button };
