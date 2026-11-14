import * as React from "react";
import type { Task, TaskEvent, TaskRun } from "@/api";
import { AlertTriangle, CheckCircle2, Cpu, ExternalLink, Radio, ScrollText } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export function useElapsed(startedAtSec?: number, endedAtSec?: number, active = false): number {
  const [nowSec, setNowSec] = React.useState(() => Math.floor(Date.now() / 1000));

  React.useEffect(() => {
    if (!active) return;
    setNowSec(Math.floor(Date.now() / 1000));
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  if (!startedAtSec || startedAtSec <= 0) return 0;
  const end = active ? nowSec : endedAtSec && endedAtSec > 0 ? endedAtSec : startedAtSec;
  return Math.max(0, end - startedAtSec);
}

export function fmtElapsed(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function LoaderGrid({
  active = true,
  tone = "accent",
  className,
}: {
  active?: boolean;
  tone?: "accent" | "success" | "danger" | "neutral";
  className?: string;
}) {
  const dotColor =
    tone === "danger"
      ? "bg-danger"
      : tone === "success"
        ? "bg-success"
        : tone === "neutral"
          ? "bg-ink-3"
          : "bg-accent";
  const delays = [0, 120, 240, 120, 240, 360, 240, 360, 480];

  return (
    <span
      className={cn("inline-grid grid-cols-3 gap-[2px]", className)}
      aria-hidden="true"
    >
      {delays.map((delay, idx) => (
        <span
          key={idx}
          className={cn(
            "size-[3.5px] rounded-[1px]",
            dotColor,
            active ? "animate-pulse" : "opacity-60"
          )}
          style={active ? { animationDelay: `${delay}ms`, animationDuration: "1.1s" } : undefined}
        />
      ))}
    </span>
  );
}

export function ProgressRing({
  value = 0,
  size = 18,
  strokeWidth = 2.2,
  indeterminate = false,
  tone = "accent",
}: {
  value?: number;
  size?: number;
  strokeWidth?: number;
  indeterminate?: boolean;
  tone?: "accent" | "success" | "danger";
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = indeterminate ? circumference * 0.68 : circumference * (1 - clamped / 100);
  const strokeClass =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-accent";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(indeterminate && "animate-spin", strokeClass)}
      style={indeterminate ? { animationDuration: "1.2s" } : undefined}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export function ToneBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "accent" | "success" | "danger" | "warning" | "neutral";
  children: React.ReactNode;
  className?: string;
}) {
  const styles: Record<string, string> = {
    accent: "bg-accent-tint text-accent-text border-accent/30",
    success: "bg-success-tint text-success-text border-success/30",
    danger: "bg-danger-tint text-danger-text border-danger/30",
    warning: "bg-warning-tint text-warning-text border-warning/30",
    neutral: "bg-well text-ink-2 border-line",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] leading-none",
        styles[tone] ?? styles.neutral,
        className
      )}
    >
      {children}
    </span>
  );
}

export function RunningIndicator({
  task,
  compact = false,
  className,
}: {
  task: Pick<Task, "status" | "started_at" | "updated_at" | "executor">;
  compact?: boolean;
  className?: string;
}) {
  const active = task.status === "in_progress";
  const elapsed = useElapsed(task.started_at || task.updated_at, undefined, active);
  if (!active) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[5px] border border-accent/30 bg-accent-tint px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-accent-text",
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-accent animate-pulse" />
      <span>{compact ? fmtElapsed(elapsed) : `Running · ${fmtElapsed(elapsed)}`}</span>
    </span>
  );
}

export function splitAgentResult(
  task: Pick<Task, "error_sig" | "result" | "status">,
  latestRun?: TaskRun
): { summaryError: string; isQuotaOrBilling: boolean; cleanSummary: string } {
  const summaryError = (task.error_sig || latestRun?.error || "").trim();
  const combined = `${summaryError}\n${task.result || latestRun?.output || ""}`.toLowerCase();
  const isQuotaOrBilling =
    combined.includes("quota") ||
    combined.includes("[402]") ||
    combined.includes("402") ||
    combined.includes("balance too low") ||
    combined.includes("deposit usdc") ||
    combined.includes("insufficient_balance");

  let cleanSummary = "";
  const raw = (task.result || latestRun?.output || "").trim();
  if (raw) {
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i].trim();
      if (!l.startsWith("{")) {
        cleanSummary = l;
        break;
      }
      try {
        const obj = JSON.parse(l) as Record<string, unknown>;
        if (typeof obj.content === "string" && obj.content.trim()) {
          cleanSummary = obj.content.trim();
          break;
        }
        if (typeof obj.text === "string" && obj.text.trim()) {
          cleanSummary = obj.text.trim();
          break;
        }
      } catch {
        // ignore
      }
    }
  }
  return { summaryError, isQuotaOrBilling, cleanSummary };
}

function inferLivePhase(events: TaskEvent[] = []): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const k = events[i].kind;
    if (k === "worker_output") return "Streaming worker output";
    if (k === "remote_dispatched") return "Running on node-agent";
    if (k === "worktree_ready") return "Worktree ready, starting worker";
    if (k === "claimed") return "Claimed, preparing git worktree";
  }
  return "Running agent";
}

export function AgentTaskStatus({
  task,
  runs = [],
  events = [],
  onOpenOutput,
  onOpenHistory,
}: {
  task: Task;
  runs?: TaskRun[];
  events?: TaskEvent[];
  onOpenOutput?: () => void;
  onOpenHistory?: () => void;
}) {
  const latestRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
  const isRunning = task.status === "in_progress";
  const isFailed = task.status === "failed" || Boolean(task.error_sig && task.status !== "done" && task.status !== "review");
  const startSec = task.started_at || latestRun?.started_at || (isRunning ? task.updated_at : 0);
  const endSec = task.completed_at || latestRun?.ended_at || 0;
  const elapsed = useElapsed(startSec, endSec, isRunning);
  const { summaryError, isQuotaOrBilling } = splitAgentResult(task, latestRun);

  if (isRunning) {
    const phase = inferLivePhase(events);
    const execLabel = latestRun?.executor || task.executor || "auto";
    const modelLabel = latestRun?.model || task.model || "";
    return (
      <div className="rounded-[10px] border border-accent/35 bg-accent-tint/60 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <LoaderGrid active tone="accent" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <Radio className="size-3.5 text-accent-text" />
                <span>{phase}</span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-2">
                {execLabel}
                {modelLabel ? ` · ${modelLabel}` : ""}
                {latestRun?.session_id ? ` · ${latestRun.session_id}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-[6px] border border-accent/30 bg-surface px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-accent-text">
              {fmtElapsed(elapsed)}
            </span>
            {onOpenOutput && (
              <button
                type="button"
                onClick={onOpenOutput}
                className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-well"
              >
                <ScrollText className="size-3" />
                Live log
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isFailed) {
    const durStr = latestRun?.duration_ms
      ? `${(latestRun.duration_ms / 1000).toFixed(1)}s`
      : elapsed > 0
        ? fmtElapsed(elapsed)
        : "";
    return (
      <div className="rounded-[10px] border border-danger/35 bg-danger-tint/70 px-3.5 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger-text" />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-danger-text">
                  {task.status === "failed" ? "Execution failed" : "Last attempt failed"}
                </span>
                {task.retry_count > 0 && (
                  <ToneBadge tone="danger">retry {task.retry_count}</ToneBadge>
                )}
                {isQuotaOrBilling && (
                  <ToneBadge tone="warning">QUOTA / 402</ToneBadge>
                )}
                {durStr && (
                  <span className="font-mono text-[10.5px] tabular-nums text-ink-3">{durStr}</span>
                )}
                {(latestRun?.executor || task.executor) && (
                  <span className="font-mono text-[10.5px] text-ink-3">
                    {latestRun?.executor || task.executor}
                    {latestRun?.model || task.model ? ` · ${latestRun?.model || task.model}` : ""}
                  </span>
                )}
              </div>

              <p className="break-words font-mono text-[11.5px] leading-relaxed text-ink">
                {summaryError || "Worker reported an error without details."}
              </p>

              {isQuotaOrBilling && (
                <p className="text-[11px] text-ink-2">
                  Inference quota / balance exhausted on provider. Top up balance or switch to another model before retrying.
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onOpenOutput && (
              <button
                type="button"
                onClick={onOpenOutput}
                className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-well"
              >
                <ScrollText className="size-3" />
                Output
              </button>
            )}
            {onOpenHistory && (
              <button
                type="button"
                onClick={onOpenHistory}
                className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-well"
              >
                <ExternalLink className="size-3" />
                Trace
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (latestRun) {
    const durStr = latestRun.duration_ms
      ? `${(latestRun.duration_ms / 1000).toFixed(1)}s`
      : elapsed > 0
        ? fmtElapsed(elapsed)
        : "";
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <CheckCircle2 className="size-3.5 shrink-0 text-success-text" />
          <span className="font-medium text-ink">
            Run #{latestRun.run} {latestRun.status}
          </span>
          {(latestRun.executor || task.executor) && (
            <ToneBadge tone="neutral">
              <Cpu className="size-2.5" />
              {latestRun.executor || task.executor}
            </ToneBadge>
          )}
          {(latestRun.model || task.model) && (
            <span className="font-mono text-[11px] text-ink-3">{latestRun.model || task.model}</span>
          )}
          {durStr && (
            <span className="font-mono text-[11px] tabular-nums text-ink-2">{durStr}</span>
          )}
          {latestRun.usage?.turns ? (
            <span className="font-mono text-[11px] text-ink-3">{latestRun.usage.turns} turn(s)</span>
          ) : null}
          {latestRun.usage?.total_tokens ? (
            <span className="font-mono text-[11px] text-ink-3">
              {latestRun.usage.total_tokens.toLocaleString()} tok
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {onOpenOutput && (
            <button
              type="button"
              onClick={onOpenOutput}
              className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-well/60 px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-well hover:text-ink"
            >
              <ScrollText className="size-3" />
              Output
            </button>
          )}
          {onOpenHistory && (
            <button
              type="button"
              onClick={onOpenHistory}
              className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-well/60 px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-well hover:text-ink"
            >
              Trace
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
