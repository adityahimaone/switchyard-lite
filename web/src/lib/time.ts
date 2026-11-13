/** Normalise a backend timestamp (seconds or milliseconds) to milliseconds. */
export function toMillis(ts?: number): number {
  if (!ts) return 0;
  return ts > 1e12 ? ts : ts * 1000;
}

export function fmtDateTime(ts?: number): string {
  const ms = toMillis(ts);
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function fmtTime(ts?: number): string {
  const ms = toMillis(ts);
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "just now", "4m ago", "3h ago", "2d ago", then a short date. */
export function relativeTime(ts?: number): string {
  const ms = toMillis(ts);
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "scheduled";
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtBytes(bytes?: number): string {
  const n = bytes ?? 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Two-letter initials for an author name. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
