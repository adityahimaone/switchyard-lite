import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Switchyard Lite Base Button Primitive
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
    "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-semibold leading-none tracking-[-0.01em] outline-none",
    "transition-[background-color,border-color,box-shadow,transform,color,filter] duration-150 ease-[var(--ease-out-expo)]",
    "active:scale-[0.972] active:duration-[80ms]",
    "focus-visible:ring-[3px] focus-visible:ring-focus/35",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "border border-line bg-surface text-ink shadow-[var(--lift-1),var(--lift-inset)] hover:-translate-y-px hover:border-line-strong hover:bg-well/75 hover:text-ink hover:shadow-[var(--lift-2),var(--lift-inset)] data-[state=open]:shadow-[var(--lift-2),var(--lift-inset)] motion-reduce:transform-none",
        prism:
          "sheen border border-white/25 bg-[image:var(--grad-prism)] text-white shadow-[var(--glow-brand),var(--lift-inset)] hover:-translate-y-px hover:border-white/40 hover:text-white hover:brightness-[1.06] hover:shadow-[var(--glow-brand),var(--lift-2),var(--lift-inset)] motion-reduce:transform-none",
        gradient:
          "sheen border border-white/25 bg-[image:var(--grad-prism)] text-white shadow-[var(--glow-brand),var(--lift-inset)] hover:-translate-y-px hover:border-white/40 hover:text-white hover:brightness-[1.06] hover:shadow-[var(--glow-brand),var(--lift-2),var(--lift-inset)] motion-reduce:transform-none",
        obsidian:
          "border border-white/15 bg-[image:var(--grad-obsidian)] text-white shadow-[var(--glow-obsidian)] hover:-translate-y-px hover:text-white hover:brightness-110 motion-reduce:transform-none",
        signal:
          "border border-accent bg-accent bg-[image:var(--spec-sheen)] text-accent-ink shadow-[var(--glow-accent),var(--lift-inset)] hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--c-accent)_88%,#000)] hover:text-accent-ink hover:shadow-[var(--glow-accent),var(--lift-2),var(--lift-inset)] motion-reduce:transform-none",
        secondary:
          "border border-line/80 bg-well text-ink-2 shadow-[var(--well-inset)] hover:border-line-strong hover:bg-well/70 hover:text-ink",
        outline:
          "border border-line-strong bg-surface text-ink shadow-[var(--lift-1)] hover:border-accent/45 hover:bg-well/80 hover:text-ink hover:shadow-[var(--lift-2)]",
        dashed:
          "border-[1.5px] border-dashed border-line-strong bg-well/50 text-ink-2 hover:border-accent hover:bg-accent-tint hover:text-accent-text",
        ghost:
          "border border-transparent bg-transparent text-ink-2 hover:bg-well hover:text-ink",
        destructive:
          "border border-danger/35 bg-danger-tint text-danger-text shadow-[var(--lift-1)] hover:border-danger/55 hover:bg-danger/20 hover:text-danger-text",
        link: "h-auto rounded-none px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 gap-1 px-2.5 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-9 gap-2 px-4 text-[13px]",
        lg: "h-11 gap-2.5 px-5 text-sm",
        "icon-xs": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 p-0 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-9 p-0",
        "icon-lg": "size-11 p-0",
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
