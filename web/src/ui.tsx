import { useState, type ReactNode } from "react";
import { ApiError, STATUSES } from "./api";

export const LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  blocked: "Blocked",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  failed: "Failed",
  running: "Running",
  pending: "Pending",
  succeeded: "Succeeded",
  completed: "Completed",
  queued: "Queued",
  needs_human: "Needs human",
  cancelled: "Cancelled",
  evolved: "Evolved",
};

const HOLLOW_STATUS = new Set(["backlog", "todo", "pending", "queued"]);
const PULSE_STATUS = new Set(["in_progress", "running"]);

export function statusColor(status: string): string {
  if ((STATUSES as readonly string[]).includes(status)) return `var(--c-st-${status})`;
  if (status === "running") return "var(--c-st-in_progress)";
  if (status === "succeeded" || status === "completed") return "var(--c-st-done)";
  if (status === "needs_human" || status === "evolved") return "var(--c-st-review)";
  return "var(--c-ink-4)";
}

/** Lamp + label: colour and shape (hollow vs filled + pulse) carry status so colour is never the only signal. */
export function Lamp({ status, showLabel = true }: { status: string; showLabel?: boolean }) {
  const color = statusColor(status);
  const hollow = HOLLOW_STATUS.has(status);
  const pulse = PULSE_STATUS.has(status);
  const label = LABEL[status] ?? status;
  return (
    <span className="lamp" style={{ ["--lamp" as string]: color }}>
      <span
        aria-hidden
        className={`lamp-dot${hollow ? " hollow" : ""}${pulse ? " pulse" : ""}`}
      />
      {showLabel ? <span>{label}</span> : <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>{label}</span>}
    </span>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as Error;
  return (
    <div className="err" role="alert">
      {e instanceof ApiError && e.status === 404
        ? "Not available yet (backend returned 404)."
        : e.message}
    </div>
  );
}

export function Unavailable({ what }: { what: string }) {
  return (
    <p className="muted">
      {what} is not available — the backend endpoint is not implemented yet.
    </p>
  );
}

export function useToggle(initial = false): [boolean, () => void] {
  const [v, s] = useState(initial);
  return [v, () => s((x) => !x)];
}

export function Panel({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="bar" style={{ marginBottom: 10 }}>
          {title && <h3 style={{ margin: 0, flex: 1 }}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
