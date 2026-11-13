import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw, ScrollText, Search, Terminal } from "@/components/ui/icons";
import {
  apiOr,
  LIVE_FALLBACK_MS,
  type LogSource,
  type LogTail,
  type TaskEvent,
} from "@/api";
import { cn } from "@/lib/utils";
import { ErrorBox, Lamp, Panel } from "@/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";

const TAILS = ["100", "200", "500", "1000"] as const;

const FALLBACK_SOURCES: LogSource[] = [
  { key: "activity", label: "Live Activity Stream", available: true },
  { key: "service", label: "switchyard-lite.service", available: false, hint: "journalctl is not available on this host" },
];

function lineTone(line: string) {
  const l = line.toLowerCase();
  if (/(error|traceback|failed|fatal|panic)/.test(l)) return "border-l-danger/70 text-danger-text";
  if (/(warn|retry|timeout)/.test(l)) return "border-l-review/70 text-review-text";
  return "border-l-transparent text-ink-2";
}

function when(unix: number) {
  return new Date(unix * (unix > 1e12 ? 1 : 1000)).toLocaleTimeString();
}

/**
 * Log page: runtime log tails plus the Live Activity Stream that used to live
 * on Overview. The activity card is always visible; the terminal below can
 * switch between structured events, the systemd journal and hermes log files.
 */
export function LogsPage() {
  const [file, setFile] = useState("activity");
  const [tail, setTail] = useState<string>("200");
  const [filter, setFilter] = useState("");
  const [live, setLive] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);

  const sources = useQuery({
    queryKey: ["log-sources"],
    queryFn: () =>
      apiOr<{ sources: LogSource[] }>("/api/v1/logs/sources", { sources: FALLBACK_SOURCES }),
  });

  const sourceList = sources.data?.sources?.length ? sources.data.sources : FALLBACK_SOURCES;

  const sourceOptions = useMemo<SearchSelectOption[]>(
    () =>
      sourceList.map((s) => ({
        value: s.key,
        label: s.label,
        sublabel: s.hint,
        badge: s.key === "activity" ? "db" : s.available ? "ready" : "unavailable",
        icon: s.key === "activity" ? <Activity className="size-3.5" /> : <Terminal className="size-3.5" />,
        keywords: [s.key, s.label],
      })),
    [sourceList]
  );

  const logs = useQuery({
    queryKey: ["logs", file, tail, filter],
    refetchInterval: live ? LIVE_FALLBACK_MS : false,
    queryFn: () => {
      const p = new URLSearchParams({ file, tail });
      if (filter.trim()) p.set("q", filter.trim());
      return apiOr<LogTail>(`/api/v1/logs?${p.toString()}`, {
        file,
        label: file,
        tail: Number(tail),
        lines: [],
        total_bytes: 0,
        kind: "activity",
      });
    },
  });

  /** The Live Activity Stream, moved here from the Overview screen. */
  const events = useQuery({
    queryKey: ["logs", "activity-events"],
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () => apiOr<TaskEvent[]>("/api/v1/logs/events?limit=8", []),
  });

  useEffect(() => {
    if (live && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [logs.data, live]);

  return (
    <div>
      <div className="bar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }} className="inline-flex items-center gap-2">
            <ScrollText className="size-4" /> Logs
          </h2>
          <span className="bar-sub">
            Live activity, service journal and agent runtime output — read-only.
          </span>
        </div>
        <div className="bar-spacer" />
        <Button
          type="button"
          variant={live ? "default" : "outline"}
          size="sm"
          onClick={() => setLive((v) => !v)}
          title="Auto-refresh every 5 seconds"
        >
          <Activity className={cn("size-3.5", live && "text-success-text")} />
          {live ? "Live" : "Paused"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void logs.refetch();
            void events.refetch();
            void sources.refetch();
          }}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {/* Live Activity Stream (moved from Overview) */}
      <Panel title={<><Activity className="size-3.5" /> Live Activity Stream</>}>
        {events.data && events.data.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Task / Run</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    <span className="badge mono">{ev.kind}</span>
                  </td>
                  <td>
                    <code>{ev.task_id || "—"}</code>
                  </td>
                  <td className="muted">{when(ev.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted m-0 text-xs">No events recorded yet. Task, dispatch and review activity will appear here.</p>
        )}
      </Panel>

      <Panel title={<><Terminal className="size-3.5" /> Log tail</>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchSelect
            value={file}
            onValueChange={setFile}
            options={sourceOptions}
            ariaLabel="Log source"
            size="sm"
            className="w-56"
            contentClassName="min-w-[20rem]"
            placeholder="Select log source…"
            searchPlaceholder="Search log sources…"
          />
          <SearchSelect
            value={tail}
            onValueChange={setTail}
            options={TAILS.map((t) => ({ value: t, label: `last ${t} lines`, keywords: [t] }))}
            ariaLabel="Number of lines"
            size="sm"
            className="w-36"
            placeholder="Tail…"
          />
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter lines (case-insensitive)…"
              className="h-8 pl-8 font-mono text-[11px]"
              aria-label="Filter log lines"
            />
          </div>
          <span className="muted text-[11px]">
            {logs.data?.lines.length ?? 0} lines
            {logs.data?.total_bytes ? ` · ${Math.round(logs.data.total_bytes / 1024)} KB` : ""}
          </span>
        </div>

        <ErrorBox error={logs.error} />
        {logs.data?.hint && <p className="muted mt-0 mb-2 text-[11px]">{logs.data.hint}</p>}

        <pre
          ref={preRef}
          className="m-0 max-h-[460px] min-h-[220px] overflow-auto rounded-control border border-line bg-well p-3 font-mono text-[11px] leading-relaxed"
          aria-label={`${logs.data?.label ?? file} log output`}
        >
          {logs.isLoading ? (
            <span className="text-ink-3">Loading log…</span>
          ) : logs.data?.lines.length ? (
            logs.data.lines.map((l, i) => (
              <div key={i} className={cn("border-l-2 pl-2 break-all", lineTone(l))}>
                {l || " "}
              </div>
            ))
          ) : (
            <span className="text-ink-3">No lines matched. Try another source or clear the filter.</span>
          )}
        </pre>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-ink-4">
          <Lamp status={live ? "in_progress" : "backlog"} />
          <span>{live ? "Auto-refreshing every 5s" : "Auto-refresh paused"}</span>
          <span>·</span>
          <span>Log files are whitelisted on the server; only read operations are exposed.</span>
        </div>
      </Panel>
    </div>
  );
}
