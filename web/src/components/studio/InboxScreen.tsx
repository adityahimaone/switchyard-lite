import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, GitBranch, Plus } from "@/components/ui/icons";
import { type Task } from "@/api";
import { TaskQuestionCard } from "@/components/board/TaskQuestionCard";
import { EmptyHorizonArt, HarnessAvatar } from "@/components/studio/StudioAssets";
import { StudioPageHeader } from "@/components/studio/StudioPageHeader";
import { StatusHeaderPill } from "@/ui";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type InboxFilter = "all" | "waiting" | "review" | "active";

function greetingForHour(h: number): string {
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

export function InboxScreen({
  boardName,
  tasks,
  onOpenTask,
  onNewTask,
}: {
  boardName?: string;
  tasks: Task[];
  onOpenTask: (id: string) => void;
  onNewTask?: () => void;
}) {
  const [tab, setTab] = useState<InboxFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => {
    let waiting = 0;
    let review = 0;
    let active = 0;
    for (const t of tasks) {
      if (t.status === "waiting_input" || t.question?.status === "pending") waiting++;
      if (t.status === "review") review++;
      if (t.status === "in_progress" || t.status === "todo") active++;
    }
    return { all: tasks.length, waiting, review, active };
  }, [tasks]);

  const visible = useMemo(() => {
    return tasks.filter((t) => {
      if (tab === "waiting") return t.status === "waiting_input" || t.question?.status === "pending";
      if (tab === "review") return t.status === "review";
      if (tab === "active") return t.status === "in_progress" || t.status === "todo";
      return true;
    });
  }, [tasks, tab]);

  const sections = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const waiting = visible.filter((t) => t.status === "waiting_input" || t.question?.status === "pending");
    const waitingIds = new Set(waiting.map((t) => t.id));
    const review = visible.filter((t) => !waitingIds.has(t.id) && t.status === "review");
    const reviewIds = new Set(review.map((t) => t.id));
    const today = visible.filter(
      (t) => !waitingIds.has(t.id) && !reviewIds.has(t.id) && nowSec - (t.updated_at || t.created_at || 0) < 86400
    );
    const todayIds = new Set(today.map((t) => t.id));
    const earlier = visible.filter((t) => !waitingIds.has(t.id) && !reviewIds.has(t.id) && !todayIds.has(t.id));

    return [
      { id: "waiting", label: "Waiting Input", items: waiting },
      { id: "review", label: "Ready for Review", items: review },
      { id: "today", label: "Today", items: today },
      { id: "earlier", label: "Earlier", items: earlier },
    ].filter((s) => s.items.length > 0);
  }, [visible]);

  const greeting = greetingForHour(new Date().getHours());

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="studio-inbox-view">
      <StudioPageHeader
        title={`${greeting}${boardName ? `, ${boardName}` : ""}`}
        count={`${tasks.length.toLocaleString()} ${tasks.length === 1 ? "Task" : "Tasks"}`}
        center={
          <div
            role="tablist"
            aria-label="Inbox filter"
            className="inline-flex flex-wrap items-center gap-0.5 rounded-[10px] border border-line/70 bg-well p-0.5"
          >
            {(
              [
                { id: "all", label: "All tasks", count: counts.all },
                { id: "waiting", label: "Waiting", count: counts.waiting },
                { id: "review", label: "Review", count: counts.review },
                { id: "active", label: "Active", count: counts.active },
              ] as const
            ).map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "rounded-[8px] px-3 py-1 font-mono text-[11.5px] transition-colors",
                    active
                      ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                      : "text-ink-3 hover:text-ink"
                  )}
                >
                  {item.label}
                  {item.id !== "all" && <span className="ml-1 opacity-75">({item.count})</span>}
                </button>
              );
            })}
          </div>
        }
        actions={
          onNewTask && (
            <button
              type="button"
              onClick={onNewTask}
              className="btn studio-scenic-cta sm"
            >
              <Plus className="size-3.5" />
              <span>New task</span>
            </button>
          )
        }
      />

      <div className="mx-auto w-full max-w-4xl px-5 py-5">

      {/* Grouped Feed */}
      {sections.length === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-[18px] border border-line bg-surface px-6 py-12 text-center shadow-[var(--glass-shadow-sm)]">
          <EmptyHorizonArt className="mb-4" />
          <p className="m-0 text-[14px] font-semibold text-ink">All caught up</p>
          <p className="mt-1 max-w-sm text-[12.5px] text-ink-3">
            No tasks match this filter. Launch a new autonomous task or switch back to the full Kanban board.
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-[18px] border border-line bg-surface shadow-[var(--glass-shadow-sm)]">
          {sections.map((sec, sIdx) => {
            const isClosed = !!collapsed[sec.id];
            return (
              <section key={sec.id} className={cn(sIdx > 0 && "border-t border-line")}>
                <button
                  type="button"
                  onClick={() => setCollapsed((p) => ({ ...p, [sec.id]: !p[sec.id] }))}
                  className="flex w-full items-center gap-2 bg-well/40 px-4 py-2 text-left text-[12px] font-medium text-ink-3 hover:bg-well/70 hover:text-ink"
                >
                  {isClosed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  <span>{sec.label}</span>
                  <span className="font-mono text-[11px] tabular-nums opacity-75">({sec.items.length})</span>
                </button>

                {!isClosed && (
                  <div className="divide-y divide-line">
                    {sec.items.map((t) => {
                      const files = t.paths ?? [];
                      const skills = t.skills ?? [];
                      return (
                        <div
                          key={t.id}
                          onClick={() => onOpenTask(t.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpenTask(t.id);
                            }
                          }}
                          className="group flex cursor-pointer items-start gap-3.5 px-4 py-3.5 transition-colors hover:bg-well/45"
                        >
                          <HarnessAvatar harness={t.executor || "studio"} size={34} className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[13.5px] font-semibold text-ink">{t.title}</span>
                                <StatusHeaderPill status={t.status} />
                              </div>
                              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-4">
                                {relativeTime(t.updated_at || t.created_at)}
                              </span>
                            </div>

                            <p className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-3">
                              {t.prompt || t.result || `Workspace: ${t.workspace || "unassigned"}`}
                            </p>

                            {(files.length > 0 || skills.length > 0 || t.branch) && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {files.slice(0, 2).map((f) => (
                                  <span
                                    key={f}
                                    className="inline-flex items-center gap-1 rounded-[7px] border border-danger/25 bg-danger-tint/70 px-2 py-0.5 font-mono text-[11px] text-danger-text"
                                  >
                                    <FileCode2 className="size-3" />
                                    <span className="max-w-[160px] truncate">{f.split("/").pop()}</span>
                                  </span>
                                ))}
                                {files.length > 2 && (
                                  <span className="rounded-[7px] border border-line bg-well px-1.5 py-0.5 font-mono text-[11px] text-ink-3">
                                    +{files.length - 2}
                                  </span>
                                )}
                                {skills.slice(0, 2).map((sk) => (
                                  <span
                                    key={sk}
                                    className="rounded-[7px] border border-line bg-well/80 px-2 py-0.5 font-mono text-[11px] text-ink-2"
                                  >
                                    ${sk}
                                  </span>
                                ))}
                                {t.branch && (
                                  <span className="inline-flex items-center gap-1 rounded-[7px] border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink-3">
                                    <GitBranch className="size-3" />
                                    {t.branch}
                                  </span>
                                )}
                              </div>
                            )}

                            {t.question?.status === "pending" && <TaskQuestionCard task={t} variant="card" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
