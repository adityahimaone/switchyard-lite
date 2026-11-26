import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Apple,
  AtSign,
  Check,
  ChevronRight,
  CloudUpload,
  HardDrive,
  Laptop,
  Link2,
  Monitor,
  Paperclip,
  Play,
  Plus,
  Send,
  Sparkles,
  Workflow,
  X,
} from "@/components/ui/icons";
import {
  apiOr,
  parseModelCatalog,
  platformOfWorkspace,
  post,
  type Board,
  type MCPServer,
  type PipelineRun,
  type PlatformKey,
  type Task,
  type Workspace,
  type WorkspaceDefaults,
  type WorkspaceInspect,
} from "@/api";
import { cn } from "@/lib/utils";
import { Link } from "@/lib/router";
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
import {
  BranchField,
  Chip,
  PromptOmnibox,
  SaasRulesBanner,
  TaskContextPicker,
} from "@/components/board/TaskContextFields";

import {
  AGY_EFFORTS,
  ALL_EXECUTORS,
  AgyAccountPicker,
  EFFORT_LABELS,
  EFFORTS,
  EXECUTOR_LABELS,
  effortsForExecutor,
  isAgyExecutor,
  useExecutorConfig,
  useWorkspaceExecutors,
} from "@/lib/executors";
import { isPipelinesEnabled } from "@/lib/features";

export {
  AGY_EFFORTS,
  ALL_EXECUTORS as EXECUTORS,
  EFFORT_LABELS,
  EFFORTS,
  EXECUTOR_LABELS,
  effortsForExecutor,
  isAgyExecutor,
};

export const PLATFORM_LABELS: Record<PlatformKey, string> = {
  mac: "macOS",
  windows: "Windows",
  current: "Current machine",
  linux: "Linux",
};

export function PlatformIcon({ platform, className }: { platform: PlatformKey; className?: string }) {
  if (platform === "windows") return <Laptop className={cn("size-3.5 shrink-0", className)} />;
  if (platform === "mac") return <Apple className={cn("size-3.5 shrink-0", className)} />;
  if (platform === "current") return <Monitor className={cn("size-3.5 shrink-0", className)} />;
  return <HardDrive className={cn("size-3.5 shrink-0", className)} />;
}

const DEFAULT_SENTINEL = "__default__";
const SCRATCH_SENTINEL = "__scratch__";

export type StartMode = "manual" | "queue" | "now" | "tracker" | "meta7";

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
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink-4 uppercase">
        <span>{label}</span>
        <span className="h-px flex-1 bg-line" aria-hidden />
      </div>
      {children}
    </div>
  );
}

function RailField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium text-ink-3 select-none"
      >
        {label}
      </label>
      {children}
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
  const [branchRefresh, setBranchRefresh] = useState(0);
  const [executor, setExecutor] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [startMode, setStartMode] = useState<StartMode>(initialStartMode);
  const [grillMe, setGrillMe] = useState(false);
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [depId, setDepId] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [mcps, setMcps] = useState<string[]>([]);
  const [depsOpen, setDepsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const savedWorkspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiOr<Workspace[]>("/api/v1/workspaces", []),
  });

  const savedMcps = useQuery({
    queryKey: ["mcps"],
    queryFn: () => apiOr<MCPServer[]>("/api/v1/mcps", []),
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

  const { visibleExecutors } = useExecutorConfig();
  const {
    probe: wsExecutorProbe,
    isExecutorInstalled,
    installedCount: wsInstalledCount,
    totalCount: wsExecutorTotal,
  } = useWorkspaceExecutors(workspace);
  const effectiveExecutor = executor || board?.default_executor || "";
  const selectableExecutors = useMemo(() => {
    if (!executor || visibleExecutors.includes(executor)) return visibleExecutors;
    return [executor, ...visibleExecutors];
  }, [executor, visibleExecutors]);
  const effortChoices = useMemo(
    () => effortsForExecutor(effectiveExecutor),
    [effectiveExecutor]
  );

  // Auto-select the first available executor if switching workspaces makes the
  // current executor (or board default) unavailable on the target machine.
  useEffect(() => {
    if (!wsExecutorProbe.probed) return;
    const current = executor || board?.default_executor || "";
    if (!current || isExecutorInstalled(current)) return;
    const firstAvail = visibleExecutors.find((ex) => isExecutorInstalled(ex));
    if (firstAvail && firstAvail !== executor) {
      setExecutor(firstAvail);
      setModel("");
      const nextEfforts = effortsForExecutor(firstAvail);
      if (effort && !nextEfforts.includes(effort)) {
        setEffort("");
      }
    }
  }, [wsExecutorProbe, executor, board?.default_executor, visibleExecutors, effort, isExecutorInstalled]);

  const models = useQuery({
    queryKey: ["models", effectiveExecutor, workspace.trim()],
    enabled: !!effectiveExecutor,
    queryFn: async () => {
      const wsParam = workspace.trim() ? `&workspace=${encodeURIComponent(workspace.trim())}` : "";
      return parseModelCatalog(
        await apiOr<unknown>(`/api/v1/models?executor=${encodeURIComponent(effectiveExecutor)}${wsParam}`, {})
      );
    },
  });
  const modelList = models.data?.models ?? [];
  const modelHint = models.data?.detail ?? "";

  const wsInspect = useQuery({
    queryKey: ["ws", workspace, branchRefresh],
    enabled: workspace.trim().length > 1,
    staleTime: 30_000,
    queryFn: () =>
      apiOr<WorkspaceInspect>(
        `/api/v1/workspaces/inspect?path=${encodeURIComponent(workspace.trim())}${branchRefresh ? "&refresh=1" : ""}`,
        { path: workspace, is_git: false, branches: [], local: false, source: "none" }
      ),
  });

  const wsDefaults = useQuery({
    queryKey: ["ws-defaults", workspace],
    enabled: workspace.trim().length > 1,
    staleTime: 60_000,
    queryFn: () =>
      apiOr<WorkspaceDefaults>(`/api/v1/workspaces/defaults?path=${encodeURIComponent(workspace.trim())}`, {
        path: workspace,
      }),
  });

  const isGit = wsInspect.data?.is_git === true;

  const applyDefaultGate = () => {
    const gate = wsDefaults.data?.suggested_gate_command;
    if (!gate || gate === "manual review") return;
    setAcceptance((v) => (v.includes(gate) ? v : `${v.trim()}${v.trim() ? "\n" : ""}Verify: ${gate}`.trim()));
  };

  const selectedWsObj = useMemo(
    () => (savedWorkspaces.data ?? []).find((w) => w.path === workspace),
    [savedWorkspaces.data, workspace]
  );

  /** The backend owns the rule; the path check is a graceful fallback. */
  const saasActive =
    wsInspect.data?.saas === true ||
    /gadjian|hadirr|baktiku|\/saas\//i.test(workspace.replace(/\\/g, "/")) ||
    (selectedWsObj?.labels ?? []).some((l) => ["work", "saas", "fast-8", "fast8"].includes(l.toLowerCase()));

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
          badge: w.host ? "ssh" : (w.node ?? "local"),
          badgeNode: (
            <span className="inline-flex items-center gap-1">
              <span
                className={cn("size-1.5 rounded-full", live && "animate-pulse")}
                style={{ background: live ? "var(--c-success)" : "var(--c-line-strong)" }}
                aria-hidden
              />
              <span className="font-mono text-[9px] text-ink-3">{w.host || w.node || "local"}</span>
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
            w.host ? "ssh remote" : (w.node ?? "local"),
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
    mutationFn: async (): Promise<{ task?: Task; pipeline?: PipelineRun }> => {
      if (startMode === "meta7") {
        const ctxBody = [
          prompt.trim(),
          acceptance.trim() ? `Acceptance:\n${acceptance.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const pipeline = await post<PipelineRun>("/api/v1/pipelines", {
          template: "meta7",
          board_id: boardId,
          goal: title.trim(),
          context: ctxBody || undefined,
          workspace: workspace.trim(),
          branch: branch.trim(),
          executor,
          model: model.trim(),
          effort,
          context_paths: paths.length ? paths : undefined,
          skills: skills.length ? skills : undefined,
        });
        if (pipeline?.goal_task_id && pendingFiles.length > 0) {
          for (const pf of pendingFiles) {
            await post(`/api/v1/tasks/${pipeline.goal_task_id}/attachments`, {
              name: pf.name,
              mime: pf.mime,
              data_base64: pf.dataBase64,
            });
          }
        }
        return { pipeline };
      }

      const created = await post<Task>("/api/v1/tasks", {
        board_id: boardId,
        title: title.trim(),
        prompt,
        acceptance,
        status: startMode === "manual" ? "backlog" : startMode === "tracker" ? "in_progress" : "todo",
        execution_mode: startMode === "tracker" ? "tracker" : "managed",
        grill_me: grillMe,
        workspace: workspace.trim(),
        executor,
        model: model.trim(),
        effort,
        branch: branch.trim(),
        paths: paths.length ? paths : undefined,
        skills: skills.length ? skills : undefined,
        mcps: mcps.length ? mcps : undefined,
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
      return { task: created };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast(
        startMode === "meta7"
          ? "meta7 pipeline launched"
          : startMode === "tracker"
            ? "Monitor-only tracker card created"
            : startMode === "now"
              ? "Task created & dispatched"
              : startMode === "manual"
                ? "Saved to backlog"
                : "Task created",
        {
          tone: "success",
          description:
            startMode === "meta7"
              ? `${title.trim()} — 7-stage coordinator active on Pipelines`
              : title.trim(),
        }
      );
      onClose();
      if (res.task?.id) onCreated?.(res.task);
    },
    onError: (e) => toastError(e, startMode === "meta7" ? "Could not start meta7 pipeline" : "Could not create task"),
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
    startMode === "meta7"
      ? "meta7 pipeline"
      : startMode === "tracker"
        ? "Monitor only"
        : startMode === "now"
          ? "Start now"
          : startMode === "manual"
            ? "Backlog"
            : "Todo";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-4xl p-0" showClose>
        <form
          onSubmit={submit}
          onPaste={(e) => {
            const items = Array.from(e.clipboardData?.items ?? []);
            const imgFiles: File[] = [];
            for (const it of items) {
              if (it.kind === "file" && it.type.startsWith("image/")) {
                const f = it.getAsFile();
                if (f) imgFiles.push(f);
              }
            }
            if (imgFiles.length > 0) {
              e.preventDefault();
              void (async () => {
                const added: PendingFile[] = [];
                for (const f of imgFiles) {
                  const buf = await f.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let bin = "";
                  for (let i = 0; i < bytes.length; i += 0x8000) {
                    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                  }
                  added.push({
                    id: `paste_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name: f.name && f.name !== "image.png" ? f.name : `paste-${Date.now()}.png`,
                    mime: f.type || "image/png",
                    size: f.size,
                    dataBase64: btoa(bin),
                  });
                }
                setPendingFiles((prev) => [...prev, ...added]);
                toast(`Pasted ${added.length} image${added.length === 1 ? "" : "s"} to task attachments`, { tone: "info" });
              })();
            }
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && submitReady) {
              e.preventDefault();
              submit();
            }
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader className="border-b border-line bg-surface/80 px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle id="task-dialog-title" className="text-[16px] font-bold tracking-[-0.02em]">
                New task
              </DialogTitle>
              {board && (
                <Badge variant="default" className="font-mono text-[10.5px]">
                  {board.name}
                </Badge>
              )}
              {wsExecutorProbe.machineLabel && (
                <Badge variant="outline" className="font-mono text-[10.5px] text-ink-3">
                  {wsExecutorProbe.machineLabel}
                </Badge>
              )}
              <Badge
                variant={startMode === "now" ? "default" : "secondary"}
                className="font-mono text-[10.5px]"
              >
                {startLabel}
              </Badge>
            </div>
            <DialogDescription className="text-xs text-ink-3">
              Draft the task brief, mention <span className="font-mono text-blue-700 dark:text-blue-200">@files</span> or{" "}
              <span className="font-mono text-violet-700 dark:text-violet-200">$skills</span> inline, bind target &amp; agent, and press ⌘↵.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-3 bg-canvas/35 p-4 sm:p-5">
            <ErrorBox error={create.error} />
            <SaasRulesBanner active={saasActive} />

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_304px]">
              {/* ------------------------------------------ left composer brief */}
              <div className="min-w-0 space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="task-title" className="text-xs font-semibold text-ink-2">
                      Title
                    </Label>
                    <span className="font-mono text-[10px] text-ink-4">Required</span>
                  </div>
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
                    className="h-10 rounded-[12px] bg-surface text-[14px] font-semibold tracking-[-0.01em] placeholder:font-normal"
                    aria-invalid={title.trim().length === 0 && title.length > 0}
                  />
                  {title.length > 0 && title.trim().length === 0 && (
                    <p className="m-0 text-[11px] text-danger-text">Title cannot be blank.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="task-prompt" className="text-xs font-semibold text-ink-2">
                      Prompt
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] tabular-nums text-ink-4">{prompt.length} chars</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={applyFastTemplate}
                        title="Insert a structured prompt template"
                        className="border border-accent/30 bg-accent-tint text-accent-text hover:border-accent hover:bg-accent hover:text-accent-ink"
                      >
                        <Sparkles className="size-3" />
                        Template
                      </Button>
                    </div>
                  </div>
                  <PromptOmnibox
                    id="task-prompt"
                    inputRef={promptRef}
                    rows={6}
                    value={prompt}
                    onChange={setPrompt}
                    workspace={workspace.trim()}
                    paths={paths}
                    onPathsChange={setPaths}
                    skills={skills}
                    onSkillsChange={setSkills}
                    boardTasks={candidates}
                    placeholder="Describe goals, constraints, @files to inspect, or $skills to apply…"
                    className="min-h-[148px]"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
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
                      <Button
                        type="button"
                        variant="dashed"
                        size="xs"
                        onClick={() => fileRef.current?.click()}
                      >
                        <CloudUpload className="size-3" />
                        Upload files
                        {pendingFiles.length > 0 && (
                          <span className="rounded bg-accent-tint px-1 font-mono text-[10px] text-accent-text">
                            {pendingFiles.length}
                          </span>
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant={contextOpen ? "secondary" : "outline"}
                        size="xs"
                        aria-expanded={contextOpen}
                        onClick={() => setContextOpen((v) => !v)}
                      >
                        <AtSign className="size-3" />
                        Context
                        {paths.length + skills.length > 0 && (
                          <span className="rounded bg-accent-tint px-1 font-mono text-[10px] text-accent-text">
                            {paths.length + skills.length}
                          </span>
                        )}
                      </Button>

                      {activeCandidates.length > 0 && (
                        <Button
                          type="button"
                          variant={depsOpen ? "secondary" : "outline"}
                          size="xs"
                          aria-expanded={depsOpen}
                          onClick={() => setDepsOpen((v) => !v)}
                        >
                          <Link2 className="size-3" />
                          Dependencies
                          {blockedBy.length > 0 && (
                            <span className="rounded bg-accent-tint px-1 font-mono text-[10px] text-accent-text">
                              {blockedBy.length}
                            </span>
                          )}
                        </Button>
                      )}
                    </div>

                    <span className="font-mono text-[10px] tabular-nums text-ink-4">
                      {paths.length} ref · {skills.length} skill · {pendingFiles.length} file · {blockedBy.length} dep
                    </span>
                  </div>

                  {pendingFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {pendingFiles.map((pf) => (
                        <span
                          key={pf.id}
                          className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[11px] font-medium text-ink-2 shadow-[var(--lift-1)]"
                        >
                          <Paperclip className="size-3 text-ink-3" />
                          <span className="max-w-[160px] truncate">{pf.name}</span>
                          <span className="font-mono text-[10px] text-ink-4">{fmtBytes(pf.size)}</span>
                          <button
                            type="button"
                            onClick={() => setPendingFiles((p) => p.filter((x) => x.id !== pf.id))}
                            className="ml-0.5 rounded-[4px] p-0.5 hover:bg-well"
                            aria-label={`Remove ${pf.name}`}
                          >
                            <X className="size-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {contextOpen && (
                    <div className="pt-1">
                      <TaskContextPicker
                        workspace={workspace.trim()}
                        paths={paths}
                        onPathsChange={setPaths}
                        skills={skills}
                        onSkillsChange={setSkills}
                      />
                    </div>
                  )}

                  {depsOpen && activeCandidates.length > 0 && (
                    <div className="space-y-2 rounded-[10px] border border-line bg-surface/80 p-2.5">
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
                        placeholder="Add blocker task…"
                        searchPlaceholder="Search tasks by title or id…"
                        emptyMessage="No matching tasks"
                        ariaLabel="Add blocker"
                        size="sm"
                      />
                      {blockedBy.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {blockedBy.map((id) => {
                            const c = candidates.find((x) => x.id === id);
                            return (
                              <Chip
                                key={id}
                                tone="card"
                                prefix="#"
                                label={c?.title ?? id}
                                icon={<Check className="size-2.5" />}
                                onRemove={() => setBlockedBy((prev) => prev.filter((x) => x !== id))}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 border-t border-line/70 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="task-acceptance" className="text-xs font-semibold text-ink-2">
                      Acceptance criteria
                    </Label>
                    <div className="flex items-center gap-2">
                      {wsDefaults.data?.suggested_gate_command &&
                        wsDefaults.data.suggested_gate_command !== "manual review" && (
                          <button
                            type="button"
                            onClick={applyDefaultGate}
                            className="inline-flex h-5 items-center gap-1 rounded-[6px] border border-accent/35 bg-accent-tint px-2 font-mono text-[10px] text-accent-text hover:border-accent"
                            title="Inferred from marker files in this workspace"
                          >
                            <Sparkles className="size-2.5" />
                            {wsDefaults.data.suggested_gate_command}
                          </button>
                        )}
                      <span className="font-mono text-[10px] tabular-nums text-ink-4">
                        {acceptance.length} chars
                      </span>
                    </div>
                  </div>
                  <Textarea
                    id="task-acceptance"
                    rows={2}
                    value={acceptance}
                    onChange={(e) => setAcceptance(e.target.value)}
                    placeholder="How should we verify this is done? Tests, checks, expected output…"
                    className="min-h-[58px] rounded-[12px]"
                  />
                </div>
              </div>

              {/* ------------------------------------------ right routing rail */}
              <aside
                className="space-y-3.5 rounded-[14px] border border-line bg-surface p-3.5 shadow-[var(--lift-1),var(--lift-inset)] self-start"
                aria-label="Task routing"
              >
                <RailGroup label="Target Workspace">
                  <RailField label="Repository / Checkout">
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
                  </RailField>

                  {selectedWsObj ? (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-[8px] border border-line bg-well/70 px-2.5 py-1 text-[10px] text-ink-3">
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
                      <Link href="/workspaces" className="font-medium text-accent-text underline-offset-2 hover:underline">
                        Manage workspaces
                      </Link>
                    </p>
                  )}

                  <BranchField
                    workspace={workspace.trim()}
                    isGit={isGit}
                    inspect={wsInspect.data}
                    value={branch}
                    onChange={setBranch}
                    loading={wsInspect.isFetching}
                    onRefresh={() => {
                      setBranchRefresh((n) => n + 1);
                      qc.invalidateQueries({ queryKey: ["ws-files", workspace.trim()] });
                      qc.invalidateQueries({ queryKey: ["ws-symbols", workspace.trim()] });
                    }}
                  />
                </RailGroup>

                <div className="border-t border-line/70 pt-3">
                  <RailGroup label="Agent Execution">
                    <RailField label="Executor" htmlFor="task-executor">
                      {wsExecutorProbe.machineLabel && (
                        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]" data-testid="task-executor-machine-badge">
                          <span>Target: {wsExecutorProbe.machineLabel}</span>
                          <span className="font-mono tabular-nums">
                            {wsExecutorProbe.probed
                              ? `${wsInstalledCount}/${wsExecutorTotal} installed`
                              : "offline / unprobed"}
                          </span>
                        </div>
                      )}
                      <Select
                        value={executor || DEFAULT_SENTINEL}
                        onValueChange={(v) => {
                          const nextExec = v === DEFAULT_SENTINEL ? "" : v;
                          setExecutor(nextExec);
                          setModel("");
                          const nextChoices = effortsForExecutor(nextExec || board?.default_executor);
                          if (effort && !nextChoices.includes(effort)) {
                            setEffort("");
                          }
                        }}
                      >
                        <SelectTrigger id="task-executor" size="sm" aria-label="Executor">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_SENTINEL}>
                            {board?.default_executor ? `Board default (${board.default_executor})` : "(board default)"}
                          </SelectItem>
                          {selectableExecutors.map((ex) => {
                            const installed = isExecutorInstalled(ex);
                            return (
                              <SelectItem key={ex} value={ex} disabled={!installed}>
                                {EXECUTOR_LABELS[ex] ?? ex}
                                {!installed
                                  ? ` (not installed on ${wsExecutorProbe.machineLabel || "machine"})`
                                  : ""}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </RailField>

                    {isAgyExecutor(effectiveExecutor) && (
                      <AgyAccountPicker id="task-agy-account" workspace={workspace} compact />
                    )}

                    <RailField label="Model" htmlFor="task-model">
                      {modelList.length > 0 ? (
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
                          id="task-model"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          disabled={!effectiveExecutor}
                          placeholder="(executor default)"
                          className="font-mono text-xs"
                          aria-label="Model"
                        />
                      )}
                    </RailField>

                    {effectiveExecutor && modelList.length === 0 && (
                      <p className="m-0 text-[10px] leading-relaxed text-ink-4">
                        {modelHint
                          ? `No catalog yet — ${modelHint}`
                          : `No model catalog reported for ${EXECUTOR_LABELS[effectiveExecutor] ?? effectiveExecutor}. Type a model id, or leave blank for the executor default.`}
                      </p>
                    )}

                    <RailField
                      label={isAgyExecutor(effectiveExecutor) ? "Thinking Effort" : "Reasoning Effort"}
                      htmlFor="task-effort"
                    >
                      <Select
                        value={effort || DEFAULT_SENTINEL}
                        onValueChange={(v) => setEffort(v === DEFAULT_SENTINEL ? "" : v)}
                      >
                        <SelectTrigger id="task-effort" size="sm" aria-label="Effort">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_SENTINEL}>(default effort)</SelectItem>
                          {effortChoices.map((ef) => (
                            <SelectItem key={ef} value={ef}>
                              {EFFORT_LABELS[ef] ?? (ef.charAt(0).toUpperCase() + ef.slice(1))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </RailField>
                  </RailGroup>
                </div>

                <div className="border-t border-line/70 pt-3">
                  <RailGroup label="Dispatch Mode">
                    <Segmented
                      label="Start mode"
                      value={startMode}
                      onChange={setStartMode}
                      options={[
                        { value: "manual", label: "Manual" },
                        { value: "queue", label: "Todo" },
                        { value: "now", label: "Now" },
                        { value: "tracker", label: "Monitor" },
                        ...(isPipelinesEnabled() ? [{ value: "meta7" as const, label: "meta7" }] : []),
                      ]}
                      className="w-full justify-between [&>button]:px-1.5 [&>button]:text-[11px]"
                    />
                    {startMode !== "tracker" && startMode !== "meta7" && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={grillMe}
                        onClick={() => setGrillMe((v) => !v)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors",
                          grillMe
                            ? "border-[var(--status-waiting)]/50 bg-[var(--status-waiting-soft)] text-ink"
                            : "border-line bg-surface-2/50 text-ink-3 hover:border-line-strong hover:text-ink"
                        )}
                      >
                        <span className="font-medium">Grill-Me First</span>
                        <span className="font-mono text-[10px] uppercase tracking-wider">
                          {grillMe ? "ON" : "OFF"}
                        </span>
                      </button>
                    )}
                    {(savedMcps.data ?? []).filter((m) => m.enabled).length > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">MCP Servers</div>
                        <div className="flex flex-wrap gap-1">
                          {(savedMcps.data ?? [])
                            .filter((m) => m.enabled)
                            .map((m) => {
                              const active = mcps.includes(m.id);
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() =>
                                    setMcps((prev) =>
                                      prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]
                                    )
                                  }
                                  className={cn(
                                    "rounded-md border px-2 py-0.5 font-mono text-[10.5px] transition-colors",
                                    active
                                      ? "border-accent bg-accent-tint text-accent-text font-semibold"
                                      : "border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink"
                                  )}
                                >
                                  {m.name}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                    <p className="m-0 text-[10px] leading-relaxed text-ink-4">
                      {startMode === "meta7"
                        ? "Runs the autonomous 7-stage coordinator (explore → cross_examine → synthesize → design → verify → review → impl + gate:*) on this board."
                        : startMode === "tracker"
                          ? "Passive monitor card — skipped by worker dispatch so external agents (dsh, commandcode, Antigravity) update status via MCP."
                          : startMode === "now"
                            ? "Created in Todo and dispatched immediately."
                            : startMode === "manual"
                              ? "Parked in Backlog until you triage it."
                              : "Queued in Todo for the next worker poll."}
                    </p>
                  </RailGroup>
                </div>
              </aside>
            </div>
          </DialogBody>

          <DialogFooter className="border-t border-line bg-surface/85 px-5 py-3 sm:items-center">
            <div className="mr-auto hidden flex-wrap items-center gap-1.5 text-[11px] text-ink-3 sm:flex">
              <MetaChip title="Board">{board?.name ?? "board"}</MetaChip>
              <ChevronRight className="size-3 text-ink-4" />
              <MetaChip title="Workspace">{wsLabel}</MetaChip>
              <ChevronRight className="size-3 text-ink-4" />
              <MetaChip tone="accent" title="Executor">
                {summaryExecutor}
                {summaryModel ? ` · ${summaryModel}` : ""}
              </MetaChip>
              <ChevronRight className="size-3 text-ink-4" />
              <MetaChip tone={startMode === "now" ? "review" : "default"}>
                {startMode === "now" && <Play className="size-2.5" />}
                {startLabel}
              </MetaChip>
            </div>

            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={startMode === "now" || startMode === "meta7" ? "prism" : "signal"}
              size="sm"
              loading={create.isPending}
              disabled={!submitReady}
            >
              {startMode === "meta7" ? (
                <Workflow className="size-3" />
              ) : startMode === "now" ? (
                <Play className="size-3 fill-current" />
              ) : startMode === "manual" ? (
                <Plus className="size-3" />
              ) : (
                <Send className="size-3" />
              )}
              {startMode === "meta7"
                ? "Launch meta7 pipeline"
                : startMode === "tracker"
                  ? "Create tracker card"
                  : startMode === "now"
                    ? "Create & dispatch"
                    : startMode === "manual"
                      ? "Save to backlog"
                      : "Create task"}
              <Kbd className="ml-1 border-white/25 bg-white/15 text-white shadow-none">⌘↵</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
