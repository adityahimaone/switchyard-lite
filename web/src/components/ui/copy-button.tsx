import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

/** Copy-to-clipboard affordance with transient confirmation. */
export function CopyButton({
  value,
  label = "Copy",
  className,
  size = "xs",
}: {
  value: string;
  label?: string;
  className?: string;
  size?: "xs" | "sm";
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        el.remove();
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  };

  const Icon = copied ? Check : Copy;

  return (
    <Tip label={copied ? "Copied" : label}>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[5px] text-ink-4 transition-colors",
          "hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/40",
          size === "xs" ? "size-5" : "size-6",
          copied && "text-success-text",
          className
        )}
      >
        <Icon className={size === "xs" ? "size-3" : "size-3.5"} />
      </button>
    </Tip>
  );
}
