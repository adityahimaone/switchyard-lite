import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Apple,
  Check,
  ChevronRight,
  GitBranch,
  HardDrive,
  Laptop,
  Link2,
  Monitor,
  Paperclip,
  Play,
  Plus,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  apiOr,
  normalizeModels,
  platformOfWorkspace,
  post,
  type Board,
  type PlatformKey,
  type Task,
  type Workspace,
} from "@/api";
import { cn } from "@/lib/utils";
import { fmtBytes } from "@/lib/time";
import { ErrorBox } from "@/ui";
import { toast, toastError } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { MetaChip } from "@/components/board/taskDetailParts";

export const EXECUTORS = ["claude", "codex", "commandcode", "omp", "dsh"] as const;
export const EFFORTS = ["low", "medium", "high"] as const;

const EXECUTOR_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  commandcode: "Command Code",
  omp: "omp (oh-my-pi)",
  dsh: "DeepSeek Harness",
};

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  mac: "macOS",
  windows: "Windows",
  current: "Current machine",
  linux: "Linux",
};

function PlatformIcon({ platform, className }: { platform: PlatformKey; className?: string }) {
  if (platform === "windows") return <Laptop className={cn("size-3.5 shrink-0", className)} />;
  if (platform === "mac") return <Apple className={cn("size-3.5 shrink-0", className)} />;
  if (platform === "current") return <Monitor className={cn("size-3.5 shrink-0", className)} />;
  return <HardDrive className={cn("size-3.5 shrink-0", className)} />;
}

const DEFAULT_SENTINEL = "__default__";
const CURRENT_BRANCH_SENTINEL = "__current__";
const SCRATCH_SENTINEL = "__scratch__";

export type StartMode = "manual" | "queue" | "now";

interface PendingFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
}

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

function RailGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-4 uppercase">
        <span>{label}</span>
        <span className="h-px flex-1 bg-line" aria-hidden />
      </div>
      {children}
    </div>
  );
}

function CollapsibleSection({
  title,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon?: ReactNode;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 rounded py-1 text-left text-xs font-medium text-ink-3 transition-colors hover:text-ink"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-ink-4 transition-transform duration-150",
            open && "rotate-90 text-ink-2"
          )}
        />
        {icon}
        <span>{title}</span>
        {typeof count === "number" && count > 0 && (
          <Badge variant="default" className="px-1.5 py-0 text-[10px]">
            {count}
          </Badge>
        )}
        <span className="h-px flex-1 bg-line/70" />
      </button>
      {open && <div className="mt-2.5 pl-1">{children}</div>}
    </div>
  );
}

export function TaskDialog({
  open = true,
  boardId,
  board,
  candidates = [],
  onClose,
  onCreated,
  initialStartMode = "queue",
}: {
  open?: boolean;
  boardId: string;
  board?: Board;
  candidates?: Task[];
  onClose: () => void;
  onCreated?: (task: Task) => void;
  initialStartMode?: StartMode;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [wsUserEdited, setWsUserEdited] = useState(false);
  const [branch, setBranch] = useState("");
  const [executor, setExecutor] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [startMode, setStartMode] = useState<StartMode>(initialStartMode);
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [depId, setDepId] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [depsOpen, setDepsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const savedWorkspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiOr<Workspace[]>("/api/v1/workspaces", []),
  });

  // Match kanban-board: auto-default workspace from the most recent task on this board
  // or the first live saved workspace.
  useEffect(() => {
    if (wsUserEdited || workspace) return;
    const list = savedWorkspaces.data ?? [];
    const recentWs = candidates.find((c) => c.workspace)?.workspace;
    if (recentWs) {
      setWorkspace(recentWs);
      return;
    }
    if (list.length > 0) {
      const live = list.find((w) => w.status === "local" || w.status === "connected");
      setWorkspace((live ?? list[0]).path);
    }
  }, [candidates, savedWorkspaces.data, workspace, wsUserEdited]);

  const effectiveExecutor = executor || board?.default_executor || "";

  const models = useQuery({
    queryKey: ["models", effectiveExecutor],
    enabled: !!effectiveExecutor,
    queryFn: async () =>
      normalizeModels(await apiOr<unknown>(`/api/v1/models?executor=${encodeURIComponent(effectiveExecutor)}`, [])),
  });

  const wsInspect = useQuery({
    queryKey: ["ws", workspace],
    enabled: workspace.trim().length > 1,
    queryFn: () =>
      apiOr<{ is_git?: boolean; branches?: string[] }>(
        `/api/v1/workspaces/inspect?path=${encodeURIComponent(workspace.trim())}`,
        {}
      ),
  });

  const isGit = wsInspect.data?.is_git === true;

  const selectedWsObj = useMemo(
    () => (savedWorkspaces.data ?? []).find((w) => w.path === workspace),
    [savedWorkspaces.data, workspace]
  );

  const groupedWorkspaces = useMemo(() => {
    const order: PlatformKey[] = ["mac", "windows", "current", "linux"];
    const map = new Map<PlatformKey, Workspace[]>();
    for (const w of savedWorkspaces.data ?? []) {
      const pk = platformOfWorkspace(w);
      map.set(pk, [...(map.get(pk) ?? []), w]);
    }
    return order.filter((k) => (map.get(k)?.length ?? 0) > 0).map((k) => [k, map.get(k)!] as const);
  }, [savedWorkspaces.data]);

  /** Workspaces are select-only here — creation lives on the Workspaces page. */
  const workspaceOptions = useMemo<SearchSelectOption[]>(() => {
    const opts: SearchSelectOption[] = [
      {
        value: SCRATCH_SENTINEL,
        label: "No workspace (scratch)",
        sublabel: "no repository · no branch · no diff",
        icon: <Sparkles className="size-3.5" />,
        keywords: ["scratch", "none", "empty", "no workspace"],
      },
    ];

    for (const [pk, list] of groupedWorkspaces) {
      for (const w of list) {
        const live = w.status === "local" || w.status === "connected";
        opts.push({
          value: w.path,
          label: w.name,
          sublabel: w.path,
          icon: <PlatformIcon platform={pk} />,
          badge: w.host ? "ssh" : "local",
          badgeNode: (
            <span className="inline-flex items-center gap-1">
              <span
                className={cn("size-1.5 rounded-full", live && "animate-pulse")}
                style={{ background: live ? "var(--c-success)" : "var(--c-line-strong)" }}
                aria-hidden
              />
              <span className="font-mono text-[9px] text-ink-3">{w.host || "local"}</span>
            </span>
          ),
          keywords: [
            w.name,
            w.path,
            w.host ?? "",
            w.os ?? "",
            w.kind ?? "",
            w.status ?? "",
            PLATFORM_LABELS[pk],
            ...(w.labels ?? []),
            w.host ? "ssh remote" : "local",
          ],
        });
      }
    }

    // Keep a task's existing (unsaved) path selectable instead of silently dropping it.
    const trimmed = workspace.trim();
    if (trimmed && !opts.some((o) => o.value === trimmed)) {
      opts.splice(1, 0, {
        value: trimmed,
        label: trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed,
        sublabel: trimmed,
        badge: "unsaved",
        keywords: [trimmed, "unsaved", "custom"],
      });
    }

    return opts;
  }, [groupedWorkspaces, workspace]);

  const create = useMutation({
    mutationFn: async () => {
      const created = await post<Task>("/api/v1/tasks", {
        board_id: boardId,
        title: title.trim(),
        prompt,
        acceptance,
        status: startMode === "manual" ? "backlog" : "todo",
        workspace: workspace.trim(),
        executor,
        model: model.trim(),
        effort,
        branch: isGit ? branch : "",
        blocked_by: blockedBy.length ? blockedBy : undefined,
      });

      if (created?.id && pendingFiles.length > 0) {
        for (const pf of pendingFiles) {
          await post(`/api/v1/tasks/${created.id}/attachments`, {
            name: pf.name,
            mime: pf.mime,
            data_base64: pf.dataBase64,
          });
        }
      }

      if (created?.id && startMode === "now" && created.status === "todo") {
        await post(`/api/v1/tasks/${created.id}/dispatch`);
      }
      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast(
        startMode === "now" ? "Task created & dispatched" : startMode === "manual" ? "Saved to backlog" : "Task created",
        { tone: "success", description: title.trim() }
      );
      onClose();
      if (created?.id) onCreated?.(created);
    },
    onError: (e) => toastError(e, "Could not create task"),
  });

  const submitReady = title.trim().length > 0 && !create.isPending;

  const activeCandidates = useMemo(
    () => candidates.filter((c) => c.status !== "done").slice(0, 18),
    [candidates]
  );

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!submitReady) return;
    create.mutate();
  };

  const applyFastTemplate = () => {
    const t = title.trim() || "<task>";
    const block = [
      `Goal: ${t}`,
      "",
      "Requirements:",
      "- ",
      "",
      "Verification:",
      "- Run tests and confirm clean build",
    ].join("\n");
    setPrompt((cur) => (cur.trim() ? `${cur.trim()}\n\n${block}` : block));
    promptRef.current?.focus();
  };

  const handleFilePick = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: PendingFile[] = [];
    for (const file of Array.from(files)) {
      const dataBase64 = await fileToBase64(file);
      added.push({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        dataBase64,
      });
    }
    setPendingFiles((prev) => [...prev, ...added]);
    setAdvancedOpen(true);
  };

  const summaryExecutor = executor
    ? EXECUTOR_LABELS[executor] ?? executor
    : board?.default_executor
      ? `Default (${board.default_executor})`
      : "Board default";
  const summaryModel = model || board?.default_model || "";
  const wsLabel = workspace.trim()
    ? (selectedWsObj?.name ?? (workspace.split(/[\\/]/).filter(Boolean).pop() || workspace))
    : "Scratch";

  const selectValue = workspace.trim() ? workspace.trim() : SCRATCH_SENTINEL;

  const startLabel =
    startMode === "now" ? "Start now" : startMode === "manual" ? "Backlog" : "Todo";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-3xl p-0" showClose>
        <form
          onSubmit={submit}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && submitReady) {
              e.preventDefault();
              submit();
            }
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle id="task-dialog-title">New task</DialogTitle>
              {board && (
                <Badge variant="secondary" className="font-mono text-[11px]">
                  {board.name}
                </Badge>
              )}
            </div>
            <DialogDescription>
              Describe the work, choose where it runs, and how it should start. Press ⌘↵ to create.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col">
            <ErrorBox error={create.error} />

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_268px]">
              {/* -------------------------------------------------- content */}
              <div className="min-w-0 space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="task-title">Title</Label>
                  <Input
                    id="task-title"
                    required
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        promptRef.current?.focus();
                      }
                    }}
                    placeholder="Short, imperative summary — e.g. Add CSV export to reports"
                    aria-invalid={title.trim().length === 0 && title.length > 0}
                  />
                  {title.length > 0 && title.trim().length === 0 && (
                    <p className="m-0 text-[11px] text-danger-text">Title cannot be blank.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="task-prompt">Prompt</Label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-ink-4">{prompt.length} chars</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={applyFastTemplate}
                        title="Insert a structured prompt template"
                        className="h-6 border-accent/35 text-[11px] text-accent-text hover:bg-accent/10"
                      >
                        <Sparkles className="size-3" />
                        Template
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    ref={promptRef}
                    id="task-prompt"
                    rows={7}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Detailed instructions for the agent — context, constraints, files to touch…"
                    className="min-h-[160px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="task-acceptance">Acceptance criteria</Label>
                    <span className="font-mono text-[10px] text-ink-4">{acceptance.length} chars</span>
                  </div>
                  <Textarea
                    id="task-acceptance"
                    rows={2}
                    value={acceptance}
                    onChange={(e) => setAcceptance(e.target.value)}
                    placeholder="How should we verify this is done? Tests, checks, expected output…"
                    className="min-h-14"
                  />
                </div>
              </div>

              {/* --------------------------------------------------- routing */}
              <aside className="space-y-3.5 rounded-card border border-line bg-well/25 p-3" aria-label="Task routing">                <RailGroup label="Workspace">
                  <SearchSelect
                    id="task-workspace"
                    value={selectValue}
                    onValueChange={(v) => {
                      setWsUserEdited(true);
                      setBranch("");
                      setWorkspace(v === SCRATCH_SENTINEL ? "" : v);
                    }}
                    options={workspaceOptions}
                    placeholder="Select workspace…"
                    searchPlaceholder="Search workspaces by name, path, host…"
                    emptyMessage="No matching workspaces"
                    ariaLabel="Workspace"
                    size="sm"
                    showTriggerBadge
                  />

                  {selectedWsObj ? (
                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-ink-3">
                      <PlatformIcon platform={platformOfWorkspace(selectedWsObj)} className="size-3" />
                      <span className="min-w-0 flex-1 truncate font-mono" title={selectedWsObj.path}>
                        {selectedWsObj.path}
                      </span>
                    </div>
                  ) : (
                    <p className="m-0 text-[10px] leading-relaxed text-ink-4">
                      {(savedWorkspaces.data?.length ?? 0) === 0
                        ? "No saved workspaces yet — add one from the Workspaces page."
                        : "Scratch runs have no repository, branch, or diff."}
                      {" "}
                      <a href="#/workspaces" className="text-accent-text underline-offset-2 hover:underline">
                        Manage workspaces
                      </a>
                    </p>
                  )}

                  {isGit && (
                    <div className="space-y-1.5 pt-1">
                      <Label htmlFor="task-branch" className="text-[11px]">
                        <GitBranch className="size-3 text-ink-3" />
                        Base branch
                      </Label>
                      {wsInspect.data?.branches?.length ? (
                        <SearchSelect
                          id="task-branch"
                          value={branch || CURRENT_BRANCH_SENTINEL}
                          onValueChange={(v) => setBranch(v === CURRENT_BRANCH_SENTINEL ? "" : v)}
                          options={[
                            { value: CURRENT_BRANCH_SENTINEL, label: "(current HEAD)" },
                            ...wsInspect.data.branches.map((b) => ({ value: b, label: b })),
                          ]}
                          placeholder="Select branch…"
                          searchPlaceholder="Search branches…"
                          ariaLabel="Base branch"
                          size="sm"
                        />
                      ) : (
                        <Input
                          id="task-branch"
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                          placeholder="(current HEAD)"
                          className="font-mono text-[11px]"
                        />
                      )}
                    </div>
                  )}
                </RailGroup>

                <RailGroup label="Execution">
                  <Select
                    value={executor || DEFAULT_SENTINEL}
                    onValueChange={(v) => {
                      setExecutor(v === DEFAULT_SENTINEL ? "" : v);
                      setModel("");
                    }}
                  >
                    <SelectTrigger id="task-executor" size="sm" aria-label="Executor">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_SENTINEL}>
                        {board?.default_executor ? `Board default (${board.default_executor})` : "(board default)"}
                      </SelectItem>
                      {EXECUTORS.map((ex) => (
                        <SelectItem key={ex} value={ex}>
                          {EXECUTOR_LABELS[ex] ?? ex}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {models.data && models.data.length > 0 ? (
                    <SearchSelect
                      id="task-model"
                      value={model || DEFAULT_SENTINEL}
                      onValueChange={(v) => setModel(v === DEFAULT_SENTINEL ? "" : v)}
                      disabled={!effectiveExecutor}
                      options={[
                        {
                          value: DEFAULT_SENTINEL,
                          label: "(executor default)",
                          sublabel: board?.default_model || undefined,
                        },
                        ...models.data.map((m) => ({
                          value: m.id,
                          label: m.name,
                          sublabel: m.id === m.name ? undefined : m.id,
                          keywords: [m.id, m.name],
                        })),
                      ]}
                      placeholder="Select model…"
                      searchPlaceholder="Search models…"
                      ariaLabel="Model"
                      size="sm"
                    />
                  ) : (
                    <Input
                      id="task-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={!effectiveExecutor}
                      placeholder="(executor default)"
                      className="font-mono text-[11px]"
                      aria-label="Model"
                    />
                  )}

                  <Select
                    value={effort || DEFAULT_SENTINEL}
                    onValueChange={(v) => setEffort(v === DEFAULT_SENTINEL ? "" : v)}
                  >
                    <SelectTrigger id="task-effort" size="sm" aria-label="Effort">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_SENTINEL}>(default effort)</SelectItem>
                      {EFFORTS.map((ef) => (
                        <SelectItem key={ef} value={ef}>
                          {ef.charAt(0).toUpperCase() + ef.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </RailGroup>

                <RailGroup label="Start">
                  <Segmented
                    label="Start mode"
                    value={startMode}
                    onChange={setStartMode}
                    options={[
                      { value: "manual", label: "Manual" },
                      { value: "queue", label: "Todo" },
                      { value: "now", label: "Now" },
                    ]}
                    className="w-full justify-between"
                  />
                  <p className="m-0 text-[10px] leading-relaxed text-ink-4">
                    {startMode === "now"
                      ? "Created in Todo and dispatched immediately."
                      : startMode === "manual"
                        ? "Parked in Backlog until you triage it."
                        : "Queued in Todo for the next worker poll."}
                  </p>
                </RailGroup>
              </aside>
            </div>

            {/* ------------------------------------------------- supporting */}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-3 transition-colors hover:text-ink"
              >
                <SlidersHorizontal className="size-3" />
                {advancedOpen ? "Hide" : "Show"} advanced
              </button>
              <span className="text-ink-4">·</span>
              <span className="text-[11px] text-ink-4">
                {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} · {blockedBy.length} blocker
                {blockedBy.length === 1 ? "" : "s"}
              </span>
            </div>

            {advancedOpen && (
              <div className="mt-2 rounded-card border border-line bg-surface/60 p-3">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleFilePick(e.target.files);
                    e.target.value = "";
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                    <Paperclip className="size-3.5 text-ink-3" />
                    Attachments
                  </span>
                  <Button type="button" variant="outline" size="xs" onClick={() => fileRef.current?.click()}>
                    <Plus className="size-3" />
                    Choose files
                  </Button>
                </div>
                {pendingFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pendingFiles.map((pf) => (
                      <span
                        key={pf.id}
                        className="inline-flex items-center gap-1 rounded-full border border-line bg-well px-2.5 py-0.5 text-[11px] text-ink-2"
                      >
                        <Paperclip className="size-3 text-ink-3" />
                        <span className="max-w-[160px] truncate">{pf.name}</span>
                        <span className="font-mono text-[10px] text-ink-4">{fmtBytes(pf.size)}</span>
                        <button
                          type="button"
                          onClick={() => setPendingFiles((p) => p.filter((x) => x.id !== pf.id))}
                          className="ml-0.5 rounded-full p-0.5 hover:bg-raised"
                          aria-label={`Remove ${pf.name}`}
                        >
                          <X className="size-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {activeCandidates.length > 0 && (
                  <CollapsibleSection
                    title="Dependencies (blocked by)"
                    icon={<Link2 className="size-3 text-ink-3" />}
                    count={blockedBy.length}
                    open={depsOpen}
                    onToggle={() => setDepsOpen((v) => !v)}
                  >
                    <SearchSelect
                      value={depId}
                      onValueChange={(v) => {
                        if (!v) return;
                        setBlockedBy((prev) => (prev.includes(v) ? prev : [...prev, v]));
                        setDepId("");
                      }}
                      options={activeCandidates
                        .filter((c) => !blockedBy.includes(c.id))
                        .map((c) => ({
                          value: c.id,
                          label: c.title,
                          sublabel: c.id,
                          badge: c.status,
                          keywords: [c.id, c.title, c.status],
                        }))}
                      placeholder="Add blocker…"
                      searchPlaceholder="Search tasks by title or id…"
                      emptyMessage="No matching tasks"
                      ariaLabel="Add blocker"
                      size="sm"
                    />
                    {blockedBy.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {blockedBy.map((id) => {
                          const c = candidates.find((x) => x.id === id);
                          return (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/14 px-2.5 py-1 text-[11px] font-medium text-accent-text"
                            >
                              <Check className="size-3" />
                              <span className="max-w-[200px] truncate">{c?.title ?? id}</span>
                              <button
                                type="button"
                                onClick={() => setBlockedBy((prev) => prev.filter((x) => x !== id))}
                                className="ml-0.5 rounded-full p-0.5 hover:bg-raised"
                                aria-label={`Remove blocker ${c?.title ?? id}`}
                              >
                                <X className="size-2.5" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </CollapsibleSection>
                )}
              </div>
            )}
          </DialogBody>

          <DialogFooter className="sm:items-center">
            <div className="mr-auto hidden flex-wrap items-center gap-1.5 text-[11px] text-ink-3 sm:flex">
              <MetaChip title="Board">{board?.name ?? "board"}</MetaChip>
              <MetaChip title="Workspace">{wsLabel}</MetaChip>
              <MetaChip tone="accent" title="Executor">
                {summaryExecutor}
                {summaryModel ? ` · ${summaryModel}` : ""}
              </MetaChip>
              <MetaChip tone={startMode === "now" ? "review" : "default"}>
                {startMode === "now" && <Play className="size-2.5" />}
                {startLabel}
              </MetaChip>
            </div>

            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="signal" size="sm" loading={create.isPending} disabled={!submitReady}>
              {startMode === "now" ? (
                <Play className="size-3" />
              ) : startMode === "manual" ? (
                <Plus className="size-3" />
              ) : (
                <Send className="size-3" />
              )}
              {startMode === "now" ? "Create & dispatch" : startMode === "manual" ? "Save to backlog" : "Create task"}
              <Kbd className="ml-1 border-black/20 bg-black/10 text-current">⌘↵</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
