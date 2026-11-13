import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  CircleDot,
  Cpu,
  FileCode2,
  GitBranch,
  History,
  Link2,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
} from "@/components/ui/icons";
import {
  api,
  apiOr,
  del,
  getToken,
  LIVE_FALLBACK_MS,
  parseModelCatalog,
  patch,
  platformOfWorkspace,
  post,
  type Comment,
  type Status,
  type Task,
  type TaskEvent,
  type Workspace,
  type WorktreeInfo,
} from "@/api";
import { EFFORTS, EXECUTORS, useBoardId } from "@/Board";
import { cn } from "@/lib/utils";
import { ErrorBox } from "@/ui";
import { fmtBytes, fmtDateTime, fmtTime, initials, relativeTime } from "@/lib/time";
import { toast, toastError } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CollapsibleText,
  EmptyNote,
  FactTile,
  Field,
  FieldList,
  OsIcon,
  Section,
  StatusBadge,
  TaskActions,
  WorktreeDiffPanel,
} from "@/components/board/taskDetailParts";

export interface AttachmentMeta {
  id: number;
  name: string;
  size: number;
  mime?: string;
  created_at?: number;
}

const DEFAULT_SENTINEL = "__default__";
const SCRATCH_SENTINEL = "__scratch__";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

const EVENT_META: Record<string, { label: string; tone: "default" | "success" | "danger" | "accent" | "review" }> = {
  created: { label: "Task created", tone: "accent" },
  moved: { label: "Status changed", tone: "accent" },
  status_changed: { label: "Status changed", tone: "accent" },
  dispatched: { label: "Dispatched to worker", tone: "accent" },
  claimed: { label: "Claimed by worker", tone: "accent" },
  lease_renewed: { label: "Lease renewed", tone: "default" },
  completed: { label: "Run completed", tone: "success" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Changes requested", tone: "danger" },
  failed: { label: "Run failed", tone: "danger" },
  retried: { label: "Retry scheduled", tone: "review" },
  dependency_added: { label: "Dependency added", tone: "default" },
  dependency_removed: { label: "Dependency removed", tone: "default" },
  comment_added: { label: "Comment added", tone: "default" },
};

export function TaskDetailPanels({
  id,
  variant,
  editing,
  setEditing,
  onDeleted,
  onReviewPage,
  showActions = true,
}: {
  id: string;
  variant: "drawer" | "page";
  editing: boolean;
  setEditing: (next: boolean) => void;
  onDeleted: () => void;
  onReviewPage?: (id: string) => void;
  showActions?: boolean;
}) {
  const qc = useQueryClient();
  const { boardId } = useBoardId();
  const [tab, setTab] = useState("overview");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const task = useQuery({
    queryKey: ["task", id],
    queryFn: () => api<Task>(`/api/v1/tasks/${id}`),
    refetchInterval: LIVE_FALLBACK_MS,
  });

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiOr<Workspace[]>("/api/v1/workspaces", []),
  });

  const boardTasks = useQuery({
    queryKey: ["tasks", task.data?.board_id || boardId],
    enabled: !!(task.data?.board_id || boardId),
    queryFn: () => api<Task[]>(`/api/v1/boards/${task.data?.board_id || boardId}/tasks`),
  });

  const comments = useQuery({
    queryKey: ["comments", id],
    queryFn: () => api<Comment[]>(`/api/v1/tasks/${id}/comments`),
    refetchInterval: tab === "discussion" ? LIVE_FALLBACK_MS : false,
  });

  const events = useQuery({
    queryKey: ["events", id],
    refetchInterval: LIVE_FALLBACK_MS,
    queryFn: () => api<TaskEvent[]>(`/api/v1/events?task_id=${id}`),
  });

  const attachments = useQuery({
    queryKey: ["attachments", id],
    queryFn: () => apiOr<AttachmentMeta[]>(`/api/v1/tasks/${id}/attachments`, []),
  });

  const worktree = useQuery({
    queryKey: ["worktree", id],
    queryFn: () => apiOr<WorktreeInfo>(`/api/v1/tasks/${id}/worktree`, { exists: false }),
  });

  const diffQuery = useQuery({
    queryKey: ["diff", id],
    enabled: tab === "diff" || task.data?.status === "review",
    retry: false,
    queryFn: () => api<{ diff: string }>(`/api/v1/tasks/${id}/diff`),
  });

  const [editDraft, setEditDraft] = useState({
    title: "",
    prompt: "",
    acceptance: "",
    workspace: "",
    executor: "",
    model: "",
    effort: "",
  });

  const [commentBody, setCommentBody] = useState("");
  const [depId, setDepId] = useState("");
  const [showNoteAtt, setShowNoteAtt] = useState(false);
  const [attName, setAttName] = useState("");
  const [attContent, setAttContent] = useState("");
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  const t = task.data;

  useEffect(() => {
    if (!editing || !t) return;
    setEditDraft({
      title: t.title,
      prompt: t.prompt || "",
      acceptance: t.acceptance || "",
      workspace: t.workspace || "",
      executor: t.executor || "",
      model: t.model || "",
      effort: t.effort || "",
    });
  }, [editing, t, workspaces.data]);

  const models = useQuery({
    queryKey: ["models", editing ? editDraft.executor : t?.executor],
    enabled: !!(editing ? editDraft.executor : t?.executor),
    queryFn: async () =>
      parseModelCatalog(
        await apiOr<unknown>(
          `/api/v1/models?executor=${encodeURIComponent((editing ? editDraft.executor : t?.executor) || "")}`,
          {}
        )
      ),
  });
  const modelList = models.data?.models ?? [];

  const inval = () => qc.invalidateQueries();

  const move = useMutation({
    mutationFn: (to: Status) => post(`/api/v1/tasks/${id}/move`, { status: to }),
    onSuccess: (_d, to) => {
      inval();
      toast(`Moved to ${to.replace("_", " ")}`, { tone: "success" });
    },
    onError: (e) => toastError(e, "Could not move task"),
  });

  const dispatch = useMutation({
    mutationFn: () => post(`/api/v1/tasks/${id}/dispatch`),
    onSuccess: () => {
      inval();
      toast("Task dispatched", { tone: "success", description: "A worker will pick this up shortly." });
    },
    onError: (e) => toastError(e, "Dispatch failed"),
  });

  const approve = useMutation({
    mutationFn: () => post(`/api/v1/tasks/${id}/approve`),
    onSuccess: () => {
      inval();
      toast("Task approved", { tone: "success", description: "Changes were accepted and the task is done." });
    },
    onError: (e) => toastError(e, "Approval failed"),
  });

  const reject = useMutation({
    mutationFn: (feedback: string) => post(`/api/v1/tasks/${id}/reject`, { feedback }),
    onSuccess: () => {
      inval();
      toast("Changes requested", { tone: "info", description: "Task requeued to Todo with your feedback." });
    },
    onError: (e) => toastError(e, "Could not request changes"),
  });

  const updateTask = useMutation({
    mutationFn: () => patch(`/api/v1/tasks/${id}`, editDraft),
    onSuccess: () => {
      setEditing(false);
      inval();
      toast("Task updated", { tone: "success" });
    },
    onError: (e) => toastError(e, "Could not save task"),
  });

  const deleteTask = useMutation({
    mutationFn: () => del(`/api/v1/tasks/${id}`),
    onSuccess: () => {
      inval();
      toast("Task deleted", { tone: "info" });
      onDeleted();
    },
    onError: (e) => toastError(e, "Could not delete task"),
  });

  const addComment = useMutation({
    mutationFn: () => post(`/api/v1/tasks/${id}/comments`, { author: "web", body: commentBody }),
    onSuccess: () => {
      setCommentBody("");
      inval();
    },
    onError: (e) => toastError(e, "Could not post comment"),
  });

  const addDep = useMutation({
    mutationFn: (blocked_by: string) => post(`/api/v1/tasks/${id}/dependencies`, { blocked_by }),
    onSuccess: () => {
      setDepId("");
      inval();
      toast("Dependency added", { tone: "success" });
    },
    onError: (e) => toastError(e, "Could not add dependency"),
  });

  const removeDep = useMutation({
    mutationFn: (dep: string) => del(`/api/v1/tasks/${id}/dependencies/${dep}`),
    onSuccess: () => {
      inval();
      toast("Dependency removed", { tone: "info" });
    },
    onError: (e) => toastError(e, "Could not remove dependency"),
  });

  const uploadTextAtt = useMutation({
    mutationFn: () =>
      post(`/api/v1/tasks/${id}/attachments`, {
        name: attName.trim(),
        content: attContent,
        mime: "text/plain",
      }),
    onSuccess: () => {
      setAttName("");
      setAttContent("");
      setShowNoteAtt(false);
      inval();
      toast("Attachment saved", { tone: "success" });
    },
    onError: (e) => toastError(e, "Upload failed"),
  });

  const uploadBinaryAtt = useMutation({
    mutationFn: async (files: FileList) => {
      for (const file of Array.from(files)) {
        const dataBase64 = await fileToBase64(file);
        await post(`/api/v1/tasks/${id}/attachments`, {
          name: file.name,
          mime: file.type || "application/octet-stream",
          data_base64: dataBase64,
        });
      }
    },
    onSuccess: () => {
      inval();
      toast("Files uploaded", { tone: "success" });
    },
    onError: (e) => toastError(e, "Upload failed"),
  });

  const deleteAtt = useMutation({
    mutationFn: (attId: number) => del(`/api/v1/tasks/${id}/attachments/${attId}`),
    onSuccess: () => {
      inval();
      toast("Attachment removed", { tone: "info" });
    },
    onError: (e) => toastError(e, "Could not remove attachment"),
  });

  const openAttachment = async (att: AttachmentMeta) => {
    setDownloadErr(null);
    try {
      const res = await fetch(`/api/v1/tasks/${id}/attachments/${att.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(res.statusText || "Failed to load attachment");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.download = att.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setDownloadErr((e as Error).message);
    }
  };

  const matchedWs = useMemo(
    () => (workspaces.data ?? []).find((w) => w.path === t?.workspace),
    [workspaces.data, t?.workspace]
  );

  const groupedWorkspaces = useMemo(() => {
    const order = ["mac", "windows", "current", "linux"] as const;
    const map = new Map<string, Workspace[]>();
    for (const w of workspaces.data ?? []) {
      const pk = platformOfWorkspace(w);
      map.set(pk, [...(map.get(pk) ?? []), w]);
    }
    return order.filter((k) => (map.get(k)?.length ?? 0) > 0).map((k) => [k, map.get(k)!] as const);
  }, [workspaces.data]);

  /** Select-only: workspace creation lives on the Workspaces page. */
  const workspaceOptions = useMemo<SearchSelectOption[]>(() => {
    const opts: SearchSelectOption[] = [
      {
        value: SCRATCH_SENTINEL,
        label: "No workspace (scratch)",
        sublabel: "no repository · no branch · no diff",
        keywords: ["scratch", "none", "empty"],
      },
    ];
    for (const [pk, items] of groupedWorkspaces) {
      for (const w of items) {
        opts.push({
          value: w.path,
          label: w.name,
          sublabel: w.path,
          badge: w.host ? "ssh" : (w.node ?? "local"),
          badgeNode: (
            <span className="font-mono text-[9px] text-ink-3">{w.host || w.node || "local"}</span>
          ),
          keywords: [w.name, w.path, w.host ?? "", w.os ?? "", w.kind ?? "", pk, ...(w.labels ?? [])],
        });
      }
    }
    const current = editDraft.workspace.trim();
    if (current && !opts.some((o) => o.value === current)) {
      opts.splice(1, 0, {
        value: current,
        label: current.split(/[\\/]/).filter(Boolean).pop() || current,
        sublabel: current,
        badge: "unsaved",
        keywords: [current, "unsaved"],
      });
    }
    return opts;
  }, [groupedWorkspaces, editDraft.workspace]);

  const depChoices = useMemo(
    () => (boardTasks.data ?? []).filter((b) => b.id !== id && !t?.blocked_by?.includes(b.id)),
    [boardTasks.data, id, t?.blocked_by]
  );

  const anyErr =
    task.error ??
    updateTask.error ??
    deleteTask.error ??
    addComment.error ??
    addDep.error ??
    uploadTextAtt.error ??
    uploadBinaryAtt.error ??
    (downloadErr ? new Error(downloadErr) : null);

  const eventCount = events.data?.length ?? 0;
  const commentCount = comments.data?.length ?? 0;

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-0">
      <TabsList
        variant="default"
        className={cn(
          "h-8 w-full justify-start overflow-x-auto rounded-[10px] border border-line bg-well/80 p-0.5 shadow-[var(--well-inset)]",
          "[&_[data-slot=tabs-trigger]]:h-[26px] [&_[data-slot=tabs-trigger]]:rounded-[8px] [&_[data-slot=tabs-trigger]]:px-2.5 [&_[data-slot=tabs-trigger]]:py-0 [&_[data-slot=tabs-trigger]]:after:hidden",
          "[&_[data-slot=tabs-trigger][data-state=active]]:bg-surface [&_[data-slot=tabs-trigger][data-state=active]]:text-ink [&_[data-slot=tabs-trigger][data-state=active]]:shadow-[var(--lift-1)]",
          variant === "page" && "sticky top-[104px] z-10 backdrop-blur-md"
        )}
      >
        <TabsTrigger value="overview">
          <CircleDot className="size-3.5" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="diff">
          <FileCode2 className="size-3.5" />
          Diff &amp; worktree
          {worktree.data?.exists && <span className="size-1.5 rounded-full bg-accent" aria-hidden />}
        </TabsTrigger>
        <TabsTrigger value="discussion">
          <MessageSquare className="size-3.5" />
          Discussion
          {commentCount > 0 && (
            <span className="rounded bg-well px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-2">
              {commentCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="history">
          <History className="size-3.5" />
          History
          {eventCount > 0 && (
            <span className="rounded bg-well px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-3">
              {eventCount}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      {anyErr && (
        <div className="pt-3">
          <ErrorBox error={anyErr} />
        </div>
      )}

      {/* ---------------------------------------------------------- Overview */}
      <TabsContent value="overview" className="space-y-3 pt-3">
        {t && (
          <>
            {showActions && (
              <Section>
                <TaskActions
                  task={t}
                  onDispatch={() => dispatch.mutate()}
                  dispatchPending={dispatch.isPending}
                  onMove={(to) => move.mutate(to)}
                  movePending={move.isPending}
                  onOpenReview={() => (onReviewPage ? onReviewPage(id) : setTab("diff"))}
                  onDelete={() => deleteTask.mutate()}
                  deletePending={deleteTask.isPending}
                />
              </Section>
            )}

            {editing ? (
              <Section
                title={
                  <>
                    <Pencil className="size-3" /> Edit task
                  </>
                }
                action={
                  <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                }
              >
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateTask.mutate();
                  }}
                >
                  <div className="space-y-1">
                    <Label htmlFor="edit-task-title">Title</Label>
                    <Input
                      id="edit-task-title"
                      required
                      value={editDraft.title}
                      onChange={(e) => setEditDraft((p) => ({ ...p, title: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-task-prompt">Prompt</Label>
                    <Textarea
                      id="edit-task-prompt"
                      rows={6}
                      value={editDraft.prompt}
                      onChange={(e) => setEditDraft((p) => ({ ...p, prompt: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-task-acceptance">Acceptance criteria</Label>
                    <Textarea
                      id="edit-task-acceptance"
                      rows={2}
                      value={editDraft.acceptance}
                      onChange={(e) => setEditDraft((p) => ({ ...p, acceptance: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="edit-task-ws">Workspace</Label>
                    <SearchSelect
                      id="edit-task-ws"
                      value={editDraft.workspace.trim() || SCRATCH_SENTINEL}
                      onValueChange={(v) =>
                        setEditDraft((p) => ({ ...p, workspace: v === SCRATCH_SENTINEL ? "" : v }))
                      }
                      options={workspaceOptions}
                      placeholder="Select workspace…"
                      searchPlaceholder="Search workspaces by name, path, host…"
                      emptyMessage="No matching workspaces"
                      ariaLabel="Workspace"
                      size="sm"
                      showTriggerBadge
                    />
                    <p className="m-0 text-[10px] leading-relaxed text-ink-4">
                      Add or edit workspaces on the{" "}
                      <a href="#/workspaces" className="text-accent-text underline-offset-2 hover:underline">
                        Workspaces page
                      </a>
                      .
                    </p>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="edit-task-exec">Executor</Label>
                      <Select
                        value={editDraft.executor || DEFAULT_SENTINEL}
                        onValueChange={(v) =>
                          setEditDraft((p) => ({
                            ...p,
                            executor: v === DEFAULT_SENTINEL ? "" : v,
                            model: "",
                          }))
                        }
                      >
                        <SelectTrigger id="edit-task-exec" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_SENTINEL}>(board default)</SelectItem>
                          {EXECUTORS.map((x) => (
                            <SelectItem key={x} value={x}>
                              {x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-task-model">Model</Label>
                      {modelList.length ? (
                        <SearchSelect
                          id="edit-task-model"
                          value={editDraft.model || DEFAULT_SENTINEL}
                          onValueChange={(v) =>
                            setEditDraft((p) => ({ ...p, model: v === DEFAULT_SENTINEL ? "" : v }))
                          }
                          options={[
                            { value: DEFAULT_SENTINEL, label: "(executor default)" },
                            ...modelList.map((m) => ({
                              value: m.id,
                              label: m.name,
                              sublabel: m.sublabel ?? (m.id === m.name ? undefined : m.id),
                              badge: m.badge,
                              keywords: [m.id, m.name, m.badge ?? "", m.sublabel ?? ""],
                            })),
                          ]}
                          placeholder="Select model…"
                          searchPlaceholder="Search models…"
                          ariaLabel="Model"
                          size="sm"
                          contentClassName="min-w-[22rem]"
                        />
                      ) : (
                        <Input
                          id="edit-task-model"
                          value={editDraft.model}
                          onChange={(e) => setEditDraft((p) => ({ ...p, model: e.target.value }))}
                          placeholder="(executor default)"
                          className="font-mono text-xs"
                        />
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-task-effort">Effort</Label>
                      <Select
                        value={editDraft.effort || DEFAULT_SENTINEL}
                        onValueChange={(v) =>
                          setEditDraft((p) => ({ ...p, effort: v === DEFAULT_SENTINEL ? "" : v }))
                        }
                      >
                        <SelectTrigger id="edit-task-effort" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_SENTINEL}>(default)</SelectItem>
                          {EFFORTS.filter(Boolean).map((x) => (
                            <SelectItem key={x} value={x}>
                              {x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="outline" size="xs" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="signal" size="xs" loading={updateTask.isPending}>
                      Save changes
                    </Button>
                  </div>
                </form>
              </Section>
            ) : (
              <>
                <div
                  className={cn(
                    "grid gap-2",
                    variant === "page" ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"
                  )}
                >
                  <FactTile label="Status" value={<StatusBadge status={t.status} />} />
                  <FactTile
                    label="Executor"
                    icon={<Cpu className="size-3" />}
                    value={t.executor || "board default"}
                    hint={t.model || "executor default model"}
                    tone="accent"
                  />
                  <FactTile
                    label="Workspace"
                    value={
                      t.workspace ? (
                        <span className="inline-flex items-center gap-1.5">
                          <OsIcon ws={matchedWs} path={t.workspace} className="size-3" />
                          {matchedWs?.name ?? (t.workspace.split(/[\\/]/).filter(Boolean).pop() || t.workspace)}
                        </span>
                      ) : (
                        "scratch"
                      )
                    }
                    hint={t.workspace ? (matchedWs?.host ?? "local") : "no repository"}
                  />
                  <FactTile
                    label="Retries"
                    value={t.retry_count}
                    hint={`created ${relativeTime(t.created_at)}`}
                    tone={t.retry_count > 0 ? "danger" : "default"}
                  />
                </div>

                <Section
                  title="Prompt"
                  action={<CopyButton value={t.prompt || ""} label="Copy prompt" />}
                >
                  <CollapsibleText text={t.prompt} empty="(no prompt provided)" />
                </Section>

                {t.acceptance && (
                  <Section
                    title="Acceptance criteria"
                    action={<CopyButton value={t.acceptance} label="Copy acceptance criteria" />}
                  >
                    <CollapsibleText text={t.acceptance} clampAt={320} />
                  </Section>
                )}

                {(t.paths?.length || t.skills?.length || t.branch) ? (
                  <Section title={<><Paperclip className="size-3" /> Context &amp; references</>}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.branch && (
                        <span className="inline-flex h-5 items-center gap-1 rounded-md border border-line bg-well px-1.5 font-mono text-[10.5px] leading-none text-ink-2">
                          <GitBranch className="size-2.5" /> base: {t.branch}
                        </span>
                      )}
                      {(t.paths ?? []).map((p) => (
                        <span key={p} className="inline-flex h-5 max-w-full items-center gap-1 rounded-md border border-accent/35 bg-accent/12 px-1.5 font-mono text-[10.5px] leading-none text-accent-text">
                          <FileCode2 className="size-2.5 shrink-0" />
                          <span className="max-w-[240px] truncate">@{p}</span>
                        </span>
                      ))}
                      {(t.skills ?? []).map((s) => (
                        <span key={s} className="inline-flex h-5 items-center gap-1 rounded-md border border-line bg-well px-1.5 font-mono text-[10.5px] leading-none text-ink-2">
                          ${s}
                        </span>
                      ))}
                    </div>
                  </Section>
                ) : null}

                {variant === "drawer" && (
                  <Section title="Details">
                    <FieldList>
                      {worktree.data?.exists && (
                        <Field label="Worktree branch">
                          <span className="font-mono text-[11px]">{worktree.data.branch}</span>
                        </Field>
                      )}
                      {t.branch && (
                        <Field label="Base branch">
                          <span className="font-mono text-[11px]">{t.branch}</span>
                        </Field>
                      )}
                      {t.run_id && (
                        <Field label="Pipeline">
                          <span className="font-mono text-[11px]">
                            {t.run_id}
                            {t.stage_id ? ` / ${t.stage_id}` : ""}
                          </span>
                        </Field>
                      )}
                      <Field label="Created">{fmtDateTime(t.created_at)}</Field>
                      <Field label="Updated">{fmtDateTime(t.updated_at)}</Field>
                    </FieldList>
                  </Section>
                )}

                <div className={cn("grid gap-3", variant === "page" && "md:grid-cols-2")}>
                  <Section
                    title={
                      <>
                        <Link2 className="size-3" /> Dependencies ({t.blocked_by?.length ?? 0})
                      </>
                    }
                  >
                    <div className="space-y-1.5">
                      {t.blocked_by?.length ? (
                        t.blocked_by.map((dep) => {
                          const found = boardTasks.data?.find((b) => b.id === dep);
                          return (
                            <div
                              key={dep}
                              className="flex h-8 items-center gap-2 rounded-[8px] border border-line bg-well/40 px-2.5"
                            >
                              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2">
                                {found ? `${found.id} · ${found.title}` : dep}
                              </span>
                              {found && <StatusBadge status={found.status} />}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Remove dependency ${dep}`}
                                onClick={() => removeDep.mutate(dep)}
                                className="text-danger-text hover:bg-danger/10"
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </div>
                          );
                        })
                      ) : (
                        <EmptyNote
                          icon={<GitBranch className="size-4" />}
                          title="No dependencies"
                          hint="This task is not blocked by any prerequisite card."
                        />
                      )}

                      {depChoices.length > 0 && (
                        <div className="flex items-center gap-1.5 pt-1">
                          <SearchSelect
                            value={depId}
                            onValueChange={setDepId}
                            options={depChoices.map((c) => ({
                              value: c.id,
                              label: c.title,
                              sublabel: c.id,
                              badge: c.status,
                              keywords: [c.id, c.title, c.status],
                            }))}
                            placeholder="Add dependency…"
                            searchPlaceholder="Search tasks by title or id…"
                            emptyMessage="No matching tasks"
                            ariaLabel="Add blocker"
                            size="sm"
                            className="min-w-0 flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!depId || addDep.isPending}
                            onClick={() => depId && addDep.mutate(depId)}
                          >
                            Add
                          </Button>
                        </div>
                      )}
                    </div>
                  </Section>

                  <Section
                    title={
                      <>
                        <Paperclip className="size-3" /> Attachments ({attachments.data?.length ?? 0})
                      </>
                    }
                  action={
                    <div className="flex items-center gap-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) uploadBinaryAtt.mutate(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        loading={uploadBinaryAtt.isPending}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="size-3" />
                        Upload
                      </Button>
                      <Button type="button" variant="ghost" size="xs" onClick={() => setShowNoteAtt((v) => !v)}>
                        + Note
                      </Button>
                    </div>
                  }
                >
                  {showNoteAtt && (
                    <form
                      className="mb-2.5 space-y-2 rounded-[10px] border border-line bg-well/40 p-2.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (attName.trim()) uploadTextAtt.mutate();
                      }}
                    >
                      <Input
                        required
                        value={attName}
                        onChange={(e) => setAttName(e.target.value)}
                        placeholder="Filename (e.g. spec.md)"
                        className="h-7 rounded-[8px] text-xs"
                      />
                      <Textarea
                        rows={2}
                        value={attContent}
                        onChange={(e) => setAttContent(e.target.value)}
                        placeholder="Paste text / context…"
                        className="min-h-14 rounded-[8px] text-xs"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button type="button" variant="ghost" size="xs" onClick={() => setShowNoteAtt(false)}>
                          Cancel
                        </Button>
                        <Button type="submit" variant="signal" size="xs" loading={uploadTextAtt.isPending}>
                          Save
                        </Button>
                      </div>
                    </form>
                  )}

                  {attachments.data?.length ? (
                    <div className="space-y-1.5">
                      {attachments.data.map((a) => (
                        <div
                          key={a.id}
                          className="group flex h-8 items-center gap-2 rounded-[8px] border border-line bg-well/40 px-2.5"
                        >
                          <Paperclip className="size-3.5 shrink-0 text-ink-3" />
                          <button
                            type="button"
                            onClick={() => void openAttachment(a)}
                            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-accent-text hover:underline"
                            title="Download / view attachment"
                          >
                            {a.name}
                          </button>
                          <span className="font-mono text-[10px] text-ink-3">{fmtBytes(a.size)}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete ${a.name}`}
                            onClick={() => deleteAtt.mutate(a.id)}
                            className="text-danger-text opacity-0 transition-opacity group-hover:opacity-100 hover:bg-danger/10 focus-visible:opacity-100"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyNote
                      icon={<Paperclip className="size-4" />}
                      title="No attachments"
                      hint="Upload files or specs directly onto this task."
                    />
                  )}
                  </Section>
                </div>
              </>
            )}
          </>
        )}
      </TabsContent>

      {/* ---------------------------------------------------- Diff & Worktree */}
      <TabsContent value="diff" className="pt-3">
        {t && (
          <WorktreeDiffPanel
            task={t}
            worktree={worktree.data}
            diffText={diffQuery.data?.diff}
            diffError={diffQuery.error}
            loading={diffQuery.isLoading}
            onApprove={() => approve.mutate()}
            onReject={(fb) => reject.mutate(fb)}
            approvePending={approve.isPending}
            rejectPending={reject.isPending}
          />
        )}
      </TabsContent>

      {/* -------------------------------------------------------- Discussion */}
      <TabsContent value="discussion" className="space-y-3 pt-3">
        <Section title={`Comments${commentCount ? ` (${commentCount})` : ""}`}>
          {comments.data?.length ? (
            <div className="space-y-2.5">
              {comments.data.map((c, idx) => (
                <div key={c.id ?? idx} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-well text-[10px] font-semibold text-ink-2"
                  >
                    {initials(c.author)}
                  </span>
                  <div className="min-w-0 flex-1 rounded-[10px] border border-line bg-well/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-ink">{c.author}</span>
                      <span className="text-ink-3" title={fmtDateTime(c.created_at)}>
                        {relativeTime(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 mb-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-2">
                      {c.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyNote
              icon={<MessageSquare className="size-4" />}
              title="No comments yet"
              hint="Discussion notes and review feedback appear here."
            />
          )}

          <form
            className="mt-3 space-y-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (commentBody.trim()) addComment.mutate();
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && commentBody.trim()) {
                e.preventDefault();
                addComment.mutate();
              }
            }}
          >
            <Textarea
              rows={2}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Write a comment or feedback… (⌘↵ to send)"
              className="min-h-14"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-ink-4">
                {commentBody.trim().length > 0
                  ? `${commentBody.trim().length} characters`
                  : "⌘↵ to send · Esc to dismiss"}
              </span>
              <Button
                type="submit"
                variant="signal"
                size="xs"
                loading={addComment.isPending}
                disabled={!commentBody.trim()}
              >
                <Send className="size-3" />
                Comment
              </Button>
            </div>
          </form>
        </Section>
      </TabsContent>

      {/* ----------------------------------------------------------- History */}
      <TabsContent value="history" className="pt-3">
        <Section
          title={`Activity${eventCount ? ` (${eventCount})` : ""}`}
          action={eventCount > 0 ? <span className="text-[10px] text-ink-4">newest first</span> : undefined}
        >
          {events.data?.length ? (
            <div className="timeline">
              {[...events.data].reverse().map((ev) => {
                const meta =
                  EVENT_META[ev.kind] ?? {
                    label: ev.kind.charAt(0).toUpperCase() + ev.kind.slice(1).replace(/_/g, " "),
                    tone: "default" as const,
                  };
                const payloadText =
                  ev.payload == null || JSON.stringify(ev.payload) === "{}"
                    ? ""
                    : typeof ev.payload === "string"
                      ? ev.payload
                      : JSON.stringify(ev.payload, null, 2);
                return (
                  <div key={ev.id} className="timeline-item" data-tone={meta.tone}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-ink">{meta.label}</span>
                      <span
                        className="font-mono text-[10px] text-ink-4"
                        title={fmtDateTime(ev.created_at)}
                      >
                        {fmtTime(ev.created_at)} · {relativeTime(ev.created_at)}
                      </span>
                    </div>
                    {payloadText && (
                      <details className="group mt-1">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[10px] text-ink-4 hover:text-ink-2">
                          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                          payload
                        </summary>
                        <pre className="mt-1 mb-0 max-h-52 overflow-auto rounded border border-line bg-well/60 p-2 font-mono text-[10px] leading-relaxed text-ink-3">
                          {payloadText}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyNote
              icon={<History className="size-4" />}
              title="No recorded events yet"
              hint="Lifecycle events appear here as the task moves or executes."
            />
          )}
        </Section>
      </TabsContent>
    </Tabs>
  );
}
