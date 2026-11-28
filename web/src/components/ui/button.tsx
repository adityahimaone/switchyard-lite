import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "@/components/ui/icons";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Switchyard Studio Base Button Primitive
 *
 * Built directly from the 3 concept references:
 *   - `prism` / `gradient`: Concept 1 ("Ask AI" & "Book a Call") — warm coral -> orchid -> royal cobalt capsule
 *     with top specular inner sheen and ambient bloom (`--glow-brand`).
 *   - `obsidian`: Concept 3 ("Book a Call") — glossy obsidian pill (`--grad-obsidian`) with top edge reflection.
 *   - `default` / `plate`: Concept 1 ("Ella M. ×", "Filter · 2") — tactile white porcelain capsule plate
 *     with `1px solid var(--c-line)` and soft physical elevation (`--lift-1`).
 *   - `signal` / `primary`: Concept 2 ("Get Started", "Filter (1)") — solid Royal Switch Cobalt (`#2F5BFF`).
 *   - `dashed`: Concept 1 ("Upload") — `1.5px dashed` capsule drop-zone button.
 *   - `well` / `secondary`: Concept 1 ("Search" trough) — recessed cool-sky well surface.
 *   - `ghost`, `destructive`, `link`.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[10px] font-medium leading-none tracking-[-0.01em] outline-none",
    "transition-[background-color,border-color,box-shadow,transform,color,filter] duration-150 ease-[var(--ease-out)]",
    "active:scale-[0.97] active:duration-[80ms]",
    "focus-visible:ring-[3px] focus-visible:ring-focus/30",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  ],
  {
    variants: {
      variant: {
        default:
          "border border-line bg-surface text-ink shadow-[var(--lift-1)] hover:border-line-strong hover:bg-well/75 hover:text-ink data-[state=open]:bg-well/75",
        prism:
          "sheen border border-white/20 bg-[image:var(--grad-prism)] text-white shadow-[var(--lift-1)] hover:brightness-[1.04]",
        gradient:
          "sheen border border-white/20 bg-[image:var(--grad-prism)] text-white shadow-[var(--lift-1)] hover:brightness-[1.04]",
        obsidian:
          "border border-white/15 bg-[image:var(--grad-obsidian)] text-white shadow-[var(--lift-1)] hover:brightness-110",
        signal:
          "border border-accent bg-accent text-accent-ink shadow-[var(--lift-1)] hover:bg-[color-mix(in_srgb,var(--c-accent)_88%,#000)] hover:text-accent-ink",
        secondary:
          "border border-line bg-well text-ink-2 hover:border-line-strong hover:text-ink",
        outline:
          "border border-line-strong bg-surface text-ink shadow-[var(--lift-1)] hover:bg-well/80 hover:text-ink",
        dashed:
          "border-[1.5px] border-dashed border-line-strong bg-well/45 text-ink-2 hover:border-accent hover:bg-accent-tint hover:text-accent-text",
        ghost:
          "border border-transparent bg-transparent text-ink-2 hover:bg-well hover:text-ink",
        destructive:
          "border border-danger/35 bg-danger-tint text-danger-text hover:border-danger/55 hover:bg-danger/20",
        link: "h-auto rounded-none px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 gap-1 rounded-[8px] px-2.5 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-8 gap-1.5 px-3 text-xs",
        lg: "h-9 gap-2 px-4 text-[13px]",
        "icon-xs": "size-7 rounded-[8px] p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 p-0 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8 p-0",
        "icon-lg": "size-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export type ButtonProps = React.ComponentProps<"button"> &
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
      data-kubai-trigger
      data-tone={
        variant && ["signal", "prism", "gradient", "obsidian", "destructive"].includes(variant)
          ? "inherit"
          : undefined
      }
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
