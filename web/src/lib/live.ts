import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getToken } from "@/api";

/**
 * One live connection replaces the ~13 per-screen polling loops the app used
 * to run. /api/v1/events/stream is the append-only task event log, so a frame
 * means "something changed" and we invalidate the read caches.
 *
 * EventSource cannot send an Authorization header, so this uses fetch + a
 * streaming reader instead. A 30s fallback poll in the individual queries
 * keeps the UI usable if the stream is unavailable.
 */

const INVALIDATE_PREFIXES = [
  "tasks",
  "task",
  "overview",
  "events",
  "comments",
  "attachments",
  "worktree",
  "diff",
  "logs",
  "pipelines",
  "pipeline",
  "flow",
  "review",
];

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleInvalidate(qc: QueryClient) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    for (const key of INVALIDATE_PREFIXES) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  }, 180);
}

export function useLiveEvents(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token || typeof AbortController === "undefined" || typeof fetch === "undefined") return;

    const ctl = new AbortController();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastId = 0;

    const connect = async () => {
      try {
        const res = await fetch(`/api/v1/events/stream?since=${lastId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctl.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let touched = false;
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let cut: number;
          while ((cut = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const lines = frame.split("\n");
            const id = lines.find((l) => l.startsWith("id: "));
            if (id) lastId = Math.max(lastId, Number(id.slice(4)) || 0);
            if (lines.some((l) => l.startsWith("data: "))) {
              touched = true;
              scheduleInvalidate(qc);
            }
          }
        }
        if (!touched && !stopped) {
          // A clean close with no frames should not spin; back off once.
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch {
        if (stopped || ctl.signal.aborted) return;
      }
      if (!stopped && !ctl.signal.aborted) {
        retry = setTimeout(() => void connect(), 3000);
      }
    };

    void connect();
    return () => {
      stopped = true;
      ctl.abort();
      if (retry) clearTimeout(retry);
    };
  }, [enabled, qc]);
}
