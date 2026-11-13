import { useState, type ReactNode } from "react";
import {
  Apple,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  HardDrive,
  Laptop,
  Maximize2,
  Monitor,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  NEXT,
  platformOfWorkspace,
  type Status,
  type Task,
  type Workspace,
  type WorktreeInfo,
} from "@/api";
import { cn } from "@/lib/utils";
import { LABEL } from "@/ui";
import { relativeTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/ui/copy-button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Tip } from "@/components/ui/tooltip";

export const STATUS_CHIP: Record<Status, string> = {
  backlog: "border-line bg-well text-ink-3",
  todo: "border-line-strong bg-raised/70 text-ink-2",
  blocked: "border-danger/30 bg-danger-tint text-danger-text",
  in_progress: "border-accent/35 bg-accent-tint text-accent-text",
  review: "border-review/35 bg-review-tint text-review-text",
  done: "border-success/35 bg-success-tint text-success-text",
  failed: "border-danger/40 bg-danger-tint text-danger-text",
};

const STATUS_DOT: Record<Status, string> = {
  backlog: "bg-[var(--c-st-backlog)]",
  todo: "bg-[var(--c-st-todo)]",
  blocked: "bg-[var(--c-st-blocked)]",
  in_progress: "bg-[var(--c-st-in_progress)]",
  review: "bg-[var(--c-st-review)]",
  done: "bg-[var(--c-st-done)]",
  failed: "bg-[var(--c-st-failed)]",
};

export function StatusBadge({ status }: { status: Status | string }) {
  const s = status as Status;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 px-2 py-0.5 text-[11px] font-medium capitalize leading-none",
        STATUS_CHIP[s] ?? STATUS_CHIP.todo
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", STATUS_DOT[s] ?? "bg-ink-4", s === "in_progress" && "animate-pulse")}
      />
      {LABEL[status] ?? status.replace("_", " ")}
    </Badge>
  );
}

export function OsIcon({
  ws,
  path,
  className,
}: {
  ws?: Workspace | null;
  path?: string;
  className?: string;
}) {
  const pk = platformOfWorkspace(ws, path);
  if (pk === "windows") return <Laptop className={cn("size-3.5 shrink-0", className)} />;
  if (pk === "mac") return <Apple className={cn("size-3.5 shrink-0", className)} />;
  if (pk === "current") return <Monitor className={cn("size-3.5 shrink-0", className)} />;
  return <HardDrive className={cn("size-3.5 shrink-0", className)} />;
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "m-0 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-ink-3 uppercase",
        className
      )}
    >
      {children}
    </h2>
  );
}

export function Section({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-card border border-line bg-surface/85 p-3.5", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2">
          {title && <SectionTitle>{title}</SectionTitle>}
          {action}
        </div>
      )}
      <div className={cn(title || action ? "mt-2.5" : "", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="m-0 min-w-0 truncate text-right text-ink-2">{children}</dd>
    </div>
  );
}

export function FieldList({ children }: { children: ReactNode }) {
  return <dl className="m-0 divide-y divide-line/60">{children}</dl>;
}

export function EmptyNote({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-control border border-dashed border-line px-3 py-5 text-center">
      {icon && <span className="text-ink-3">{icon}</span>}
      <p className="m-0 text-xs font-medium text-ink-3">{title}</p>
      {hint && <p className="m-0 max-w-[38ch] text-[11px] leading-relaxed text-ink-4">{hint}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

/** Compact metadata chip used in headers and cards. */
export function MetaChip({
  icon,
  children,
  title,
  tone = "default",
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
  tone?: "default" | "accent" | "warn" | "review";
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-[220px] items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11px] leading-none",
        tone === "default" && "border-line bg-well/70 text-ink-2",
        tone === "accent" && "border-accent/30 bg-accent-tint text-accent-text",
        tone === "warn" && "border-warning/30 bg-warning-tint text-warning-text",
        tone === "review" && "border-review/30 bg-review-tint text-review-text",
        className
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Big number + label tile used for the overview facts row. */
export function FactTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "accent" | "success" | "danger" | "review";
}) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-surface/70 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-4 uppercase">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "mt-1 truncate text-[13px] font-semibold",
          tone === "default" && "text-ink",
          tone === "accent" && "text-accent-text",
          tone === "success" && "text-success-text",
          tone === "danger" && "text-danger-text",
          tone === "review" && "text-review-text"
        )}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[10px] text-ink-4">{hint}</div>}
    </div>
  );
}

/** Long text with a clamp + copy affordance. */
export function CollapsibleText({
  text,
  empty = "(empty)",
  clampAt = 420,
  className,
}: {
  text?: string;
  empty?: string;
  clampAt?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const body = text?.trim() ? text : empty;
  const long = body.length > clampAt;

  return (
    <div className={cn("group/text relative", className)}>
      <div className="absolute top-0 right-0 z-10 opacity-0 transition-opacity group-hover/text:opacity-100 focus-within:opacity-100">
        <CopyButton value={body} label="Copy text" />
      </div>
      <pre className={cn("prose-block", long && !open && "clamped")}>{body}</pre>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1.5 inline-flex items-center gap-1 rounded text-[11px] font-medium text-accent-text hover:underline"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {open ? "Show less" : "Show full text"}
        </button>
      )}
    </div>
  );
}

/** Shared task header used by the drawer and the full page. */
export function TaskHeader({
  id,
  task,
  matchedWs,
  variant,
  editing,
  onToggleEdit,
  onBack,
  onClose,
  onOpenPage,
  actions,
  sticky = false,
}: {
  id: string;
  task?: Task;
  matchedWs?: Workspace | null;
  variant: "page" | "drawer";
  editing: boolean;
  onToggleEdit: () => void;
  onBack?: () => void;
  onClose?: () => void;
  onOpenPage?: () => void;
  actions?: ReactNode;
  sticky?: boolean;
}) {
  const TitleTag = variant === "page" ? "h1" : "h2";
  return (
    <header
      className={cn(
        "shrink-0 border-b border-line bg-surface/70 backdrop-blur-xl",
        sticky && "sticky top-0 z-20",
        variant === "page" ? "px-4 pt-3 pb-2.5 sm:px-6" : "px-5 py-3.5"
      )}
    >
      <div className="flex items-start gap-2.5">
        {onBack && (
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to board" title="Back to board" className="mt-0.5">
            <ArrowLeft className="size-4" />
          </Button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <TitleTag
              className={cn(
                "m-0 min-w-0 max-w-full truncate font-semibold tracking-[-0.01em] text-ink",
                variant === "page" ? "text-lg" : "text-base"
              )}
              title={task?.title ?? id}
            >
              {task?.title ?? "Loading task…"}
            </TitleTag>
            {task && <StatusBadge status={task.status} />}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-1 rounded-[5px] border border-line bg-well/60 py-0.5 pr-0.5 pl-1.5 font-mono text-[11px] text-ink-2">
              {id}
              <CopyButton value={id} label="Copy task id" />
            </span>

            {task?.workspace && (
              <MetaChip
                icon={<OsIcon ws={matchedWs} path={task.workspace} className="size-3" />}
                title={task.workspace}
              >
                {matchedWs?.name ?? (task.workspace.split(/[\\/]/).filter(Boolean).pop() || task.workspace)}
              </MetaChip>
            )}

            {task?.executor && (
              <MetaChip tone="accent">
                {task.executor}
                {task.model ? ` · ${task.model}` : ""}
              </MetaChip>
            )}

            {task?.effort && <MetaChip>{task.effort} effort</MetaChip>}

            {task?.updated_at && (
              <span className="inline-flex items-center gap-1 text-ink-4" title="Last updated">
                <span className="size-1 rounded-full bg-ink-4/60" aria-hidden />
                {relativeTime(task.updated_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Tip label={editing ? "Close editor" : "Edit task fields"}>
            <Button
              type="button"
              variant={editing ? "secondary" : "ghost"}
              size="sm"
              onClick={onToggleEdit}
              disabled={!task}
              aria-pressed={editing}
            >
              <Pencil className="size-3.5" />
              <span className="hidden sm:inline">{editing ? "Editing" : "Edit"}</span>
            </Button>
          </Tip>
          {onOpenPage && (
            <Tip label="Open full detail page">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onOpenPage}
                aria-label="Open full detail page"
              >
                <Maximize2 className="size-4" />
              </Button>
            </Tip>
          )}
          {onClose && (
            <Tip label="Close (Esc)">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="Close task drawer"
              >
                <X className="size-4" />
              </Button>
            </Tip>
          )}
        </div>
      </div>
    </header>
  );
}

export function TaskActions({
  task,
  onDispatch,
  dispatchPending,
  onMove,
  movePending,
  onOpenReview,
  onDelete,
  deletePending,
}: {
  task: Task;
  onDispatch: () => void;
  dispatchPending?: boolean;
  onMove: (to: Status) => void;
  movePending?: boolean;
  onOpenReview?: () => void;
  onDelete: () => void;
  deletePending?: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const next = NEXT[task.status];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {task.status === "todo" && (
        <Button type="button" variant="signal" size="xs" loading={dispatchPending} onClick={onDispatch}>
          <Play className="size-3" />
          Dispatch now
        </Button>
      )}
      {task.status === "review" && onOpenReview && (
        <Button type="button" variant="signal" size="xs" onClick={onOpenReview}>
          <CheckCircle2 className="size-3" />
          Review diff
        </Button>
      )}

      {next.length > 0 && (
        <Menu
          label="Move task"
          trigger={
            <Button type="button" variant="outline" size="xs" disabled={movePending}>
              <ArrowRight className="size-3" />
              Move to
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          }
        >
          <MenuLabel>Move task to</MenuLabel>
          {next.map((to) => (
            <MenuItem key={to} icon={ArrowRight} onSelect={() => onMove(to)}>
              {LABEL[to] ?? to}
            </MenuItem>
          ))}
        </Menu>
      )}

      <div className="ml-auto flex items-center gap-1">
        {confirmDelete ? (
          <>
            <span className="text-[11px] text-danger-text">Delete permanently?</span>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              loading={deletePending}
              onClick={onDelete}
            >
              Confirm
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Tip label="Delete task">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setConfirmDelete(true)}
              className="text-danger-text hover:bg-danger/10"
              aria-label="Delete task"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </Tip>
        )}
      </div>
    </div>
  );
}

function diffStats(text: string) {
  let add = 0;
  let del = 0;
  let files = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git")) files++;
    else if (line.startsWith("+") && !line.startsWith("+++")) add++;
    else if (line.startsWith("-") && !line.startsWith("---")) del++;
  }
  return { add, del, files };
}

export function WorktreeDiffPanel({
  task,
  worktree,
  diffText,
  diffError,
  loading,
  onApprove,
  onReject,
  approvePending,
  rejectPending,
}: {
  task: Task;
  worktree?: WorktreeInfo;
  diffText?: string;
  diffError?: unknown;
  loading?: boolean;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  approvePending?: boolean;
  rejectPending?: boolean;
}) {
  const [feedback, setFeedback] = useState("");
  const stats = diffText ? diffStats(diffText) : null;
  let lineNo = 0;

  return (
    <div className="space-y-3">
      {task.status === "review" && (
        <Section
          title={
            <>
              <CheckCircle2 className="size-3 text-review-text" /> Review gate
            </>
          }
          className="border-review/30 bg-review-tint/25"
        >
          <div className="space-y-2.5">
            <p className="m-0 text-xs leading-relaxed text-ink-2">
              Approving keeps the branch and marks the task done. Requesting changes records your
              feedback as a comment and requeues the task to Todo.
            </p>
            <Button type="button" variant="signal" size="sm" loading={approvePending} onClick={onApprove}>
              <CheckCircle2 className="size-3.5" />
              Approve &amp; mark done
            </Button>
            <div className="space-y-1.5 border-t border-review/25 pt-2.5">
              <Textarea
                rows={2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What needs to change before this can land?"
                className="min-h-14"
              />
              <Button
                type="button"
                variant="destructive"
                size="xs"
                loading={rejectPending}
                disabled={!feedback.trim()}
                onClick={() => {
                  onReject(feedback.trim());
                  setFeedback("");
                }}
              >
                <RotateCcw className="size-3" />
                Request changes &amp; requeue
              </Button>
            </div>
          </div>
        </Section>
      )}

      {worktree?.exists && (
        <Section
          title={
            <>
              <GitBranch className="size-3" /> Worktree
            </>
          }
        >
          <FieldList>
            <Field label="Branch">
              <span className="font-mono text-[11px]">{worktree.branch}</span>
            </Field>
            <Field label="Base SHA">
              <span className="font-mono text-[11px]">{worktree.base_sha?.slice(0, 12)}</span>
            </Field>
            <Field label="Path">
              <span className="font-mono text-[11px]" title={worktree.path}>
                {worktree.path}
              </span>
            </Field>
            <Field label="Repo">
              <span className="font-mono text-[11px]" title={worktree.repo}>
                {worktree.repo}
              </span>
            </Field>
          </FieldList>
        </Section>
      )}

      <Section
        title="Changes"
        action={
          stats ? (
            <div className="flex items-center gap-2 font-mono text-[10px]">
              {stats.files > 0 && <span className="text-ink-3">{stats.files} files</span>}
              <span className="text-success-text">+{stats.add}</span>
              <span className="text-danger-text">−{stats.del}</span>
            </div>
          ) : undefined
        }
        bodyClassName="mt-2.5"
      >
        {loading ? (
          <div className="space-y-1.5" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-well" style={{ width: `${90 - i * 12}%` }} />
            ))}
          </div>
        ) : diffError ? (
          <EmptyNote
            icon={<GitBranch className="size-4" />}
            title="No git worktree diff available"
            hint={(diffError as Error).message || "This task has not produced a worktree diff yet."}
          />
        ) : !diffText?.trim() ? (
          <EmptyNote
            icon={<GitBranch className="size-4" />}
            title="Clean working tree"
            hint="No uncommitted or diverged changes detected against the base commit."
          />
        ) : (
          <div className="diff-shell">
            <div className="diff-scroll" tabIndex={0} role="region" aria-label="diff">
              {diffText.split("\n").map((line, i) => {
                const kind = line.startsWith("@@")
                  ? "hunk"
                  : line.startsWith("+") && !line.startsWith("+++")
                    ? "add"
                    : line.startsWith("-") && !line.startsWith("---")
                      ? "del"
                      : "";
                if (kind !== "hunk") lineNo++;
                return (
                  <div key={i} className={cn("diff-line", kind)}>
                    <span className="ln">{kind === "hunk" ? "··" : lineNo}</span>
                    <span className="tx">{line || " "}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
