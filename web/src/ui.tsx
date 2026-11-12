import { useState, type ReactNode } from "react";
import { ApiError, STATUSES } from "./api";

const LABEL: Record<string, string> = {
  backlog: "Backlog", todo: "Todo", blocked: "Blocked", in_progress: "In progress", review: "Review", done: "Done", failed: "Failed",
  running: "Running", pending: "Pending", succeeded: "Succeeded", queued: "Queued",
};
/** Lamp + label: colour is never the only status signal. */
export function Lamp({ status }: { status: string }) {
  const known = (STATUSES as readonly string[]).includes(status);
  const color = known ? `var(--c-st-${status})`
    : status === "running" ? "var(--c-st-in_progress)" : status === "succeeded" ? "var(--c-st-done)" : "var(--c-ink-4)";
  return <span className="lamp" style={{ ["--lamp" as string]: color }}>{LABEL[status] ?? status}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as Error;
  return <div className="err" role="alert">{e instanceof ApiError && e.status === 404 ? "Not available yet (backend returned 404)." : e.message}</div>;
}

export function Unavailable({ what }: { what: string }) {
  return <p className="muted">{what} is not available — the backend endpoint is not implemented yet.</p>;
}

export function useToggle(): [boolean, () => void] {
  const [v, s] = useState(false);
  return [v, () => s((x) => !x)];
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="panel">{title && <h3 style={{ marginTop: 0 }}>{title}</h3>}{children}</section>;
}
