import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  duration: number;
}

type Listener = (item: ToastItem) => void;
const listeners = new Set<Listener>();
let seq = 0;

/** Fire a transient notification from anywhere (no hook required). */
export function toast(
  title: string,
  opts: { tone?: ToastTone; description?: string; duration?: number } = {}
): number {
  const item: ToastItem = {
    id: ++seq,
    title,
    description: opts.description,
    tone: opts.tone ?? "info",
    duration: opts.duration ?? (opts.tone === "error" ? 6000 : 3200),
  };
  listeners.forEach((l) => l(item));
  return item.id;
}

/** Turn an unknown thrown value into an error toast. */
export function toastError(error: unknown, title = "Something went wrong"): number {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return toast(title, { tone: "error", description: message });
}

const TONE: Record<ToastTone, { icon: typeof Info; ring: string; text: string; wash: string }> = {
  success: {
    icon: CheckCircle2,
    ring: "border-success/35",
    text: "text-success-text",
    wash: "bg-success-tint",
  },
  error: {
    icon: AlertTriangle,
    ring: "border-danger/35",
    text: "text-danger-text",
    wash: "bg-danger-tint",
  },
  info: {
    icon: Info,
    ring: "border-line-strong/70",
    text: "text-accent-text",
    wash: "bg-accent-tint",
  },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const push: Listener = (item) => {
      setItems((prev) => [...prev.slice(-3), item]);
      const t = setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== item.id));
        timers.current.delete(item.id);
      }, item.duration);
      timers.current.set(item.id, t);
    };
    listeners.add(push);
    const map = timers.current;
    return () => {
      listeners.delete(push);
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const dismiss = (id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-5"
      role="region"
      aria-label="Notifications"
    >
      {items.map((item) => {
        const tone = TONE[item.tone];
        const Icon = tone.icon;
        return (
          <div
            key={item.id}
            role="status"
            aria-live="polite"
            className={cn(
              "toast-enter pointer-events-auto flex w-full max-w-[380px] items-start gap-2.5 rounded-card border px-3 py-2.5",
              "glass-dialog shadow-float",
              tone.ring
            )}
          >
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", tone.wash)}>
              <Icon className={cn("size-3.5", tone.text)} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-xs font-semibold text-ink">{item.title}</p>
              {item.description && (
                <p className="mt-0.5 mb-0 break-words text-[11px] leading-relaxed text-ink-3">
                  {item.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="-mt-0.5 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-raised hover:text-ink"
              aria-label="Dismiss notification"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
