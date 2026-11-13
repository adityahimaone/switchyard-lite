import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AtSign,
  ChevronDown,
  FileCode2,
  FileSearch,
  GitBranch,
  Hash,
  Info,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "@/components/ui/icons";
import {
  apiOr,
  type FileMatch,
  type SkillMeta,
  type SymbolMatch,
  type Task,
  type WorkspaceBranchResult,
  type WorkspaceFileResult,
  type WorkspaceInspect,
} from "@/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";

const uniq = (list: string[]) => Array.from(new Set(list.map((v) => v.trim()).filter(Boolean)));

/* -------------------------------------------------------------------------- */
/* Fast-8 SAAS rules banner                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The rules themselves are injected server-side at dispatch time, so this is
 * purely an affordance: it tells the author the internal DOCS.md / AGENTS.md
 * guidelines will be attached without putting them in the repository.
 */
export function SaasRulesBanner({ active, compact = false }: { active: boolean; compact?: boolean }) {
  if (!active) return null;
  return (
    <div
      role="status"
      className={cn(
        "mb-3 flex items-start gap-2 rounded-full border border-success/35 bg-[var(--c-mint-wash)] px-3.5 py-2 text-success-text shadow-[var(--lift-1)]",
        compact ? "text-[10px]" : "text-[11px]"
      )}
    >
      <ShieldCheck className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 leading-relaxed">
        <span className="font-semibold">Fast-8 SAAS Rules Active</span>
        <span className="mx-1 opacity-60">·</span>
        <span className="opacity-90">
          Internal DOCS.md &amp; AGENTS.md rules automatically attached (view versioning, module SCSS, minification).
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* @file / $skill omnibox on the prompt                                        */
/* -------------------------------------------------------------------------- */

type Token = { kind: "file" | "skill"; query: string; start: number } | null;

function tokenAt(value: string, caret: number): Token {
  const before = value.slice(0, caret);
  const file = /(?:^|\s)@([a-zA-Z0-9_\-./#\\]*)$/.exec(before);
  if (file) return { kind: "file", query: file[1], start: caret - file[1].length - 1 };
  const skill = /(?:^|\s)\$([a-zA-Z0-9_\-]*)$/.exec(before);
  if (skill) return { kind: "skill", query: skill[1], start: caret - skill[1].length - 1 };
  return null;
}

interface OmniboxProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  workspace: string;
  paths: string[];
  onPathsChange: (v: string[]) => void;
  skills: string[];
  onSkillsChange: (v: string[]) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Board tasks become #card matches, like kanban-board's @ omnibox. */
  boardTasks?: Task[];
  rows?: number;
  placeholder?: string;
  className?: string;
}

type SuggestionKind = "file" | "skill" | "symbol" | "card";
type Suggestion = {
  kind: SuggestionKind;
  key: string;
  insert: string;
  label: string;
  sublabel?: string;
  badge?: string;
  /** Attached to the task's @paths when a file/symbol is chosen. */
  path?: string;
};

export function PromptOmnibox({
  id,
  value,
  onChange,
  workspace,
  paths,
  onPathsChange,
  skills,
  onSkillsChange,
  inputRef,
  boardTasks = [],
  rows = 7,
  placeholder,
  className,
}: OmniboxProps) {
  const [token, setToken] = useState<Token>(null);
  const [index, setIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const fileQuery = useQuery({
    queryKey: ["ws-files", workspace, token?.kind === "file" ? token.query : ""],
    enabled: token?.kind === "file" && !!workspace.trim(),
    staleTime: 30_000,
    queryFn: () =>
      apiOr<WorkspaceFileResult>(
        `/api/v1/workspaces/files?path=${encodeURIComponent(workspace)}&q=${encodeURIComponent(token?.query ?? "")}&limit=10`,
        { path: workspace, files: [], local: false }
      ),
  });

  // Symbol matches are resolved on the owning worker; only fire for a query
  // long enough to be useful so a keystroke doesn't spawn a shell job.
  const symbolQuery = useQuery({
    queryKey: ["ws-symbols", workspace, token?.kind === "file" ? token.query : ""],
    enabled: token?.kind === "file" && (token.query?.length ?? 0) >= 3 && !!workspace.trim(),
    staleTime: 30_000,
    queryFn: () =>
      apiOr<{ symbols: SymbolMatch[] }>(
        `/api/v1/workspaces/symbols?path=${encodeURIComponent(workspace)}&q=${encodeURIComponent(token?.query ?? "")}&limit=6`,
        { symbols: [] }
      ),
  });

  const skillQuery = useQuery({
    queryKey: ["skills", token?.kind === "skill" ? token.query : ""],
    enabled: token?.kind === "skill",
    queryFn: () =>
      apiOr<{ skills: SkillMeta[] }>(`/api/v1/skills?q=${encodeURIComponent(token?.query ?? "")}`, { skills: [] }),
  });

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!token) return [];
    const out: Suggestion[] = [];
    if (token.kind === "file") {
      for (const f of fileQuery.data?.files ?? []) {
        out.push({
          kind: "file", key: `file:${f.path}`, insert: f.path, path: f.path,
          label: f.path, sublabel: f.directory || undefined, badge: "file",
        });
      }
      for (const s of symbolQuery.data?.symbols ?? []) {
        out.push({
          kind: "symbol", key: `symbol:${s.file_path}:${s.line}`, insert: s.name, path: s.file_path,
          label: s.name, sublabel: `${s.file_path}:${s.line}`, badge: "symbol",
        });
      }
      const q = token.query.toLowerCase().replace(/^#/, "");
      if (q.length >= 2) {
        for (const c of boardTasks.filter(
          (t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
        ).slice(0, 4)) {
          out.push({
            kind: "card", key: `card:${c.id}`, insert: c.id,
            label: c.title, sublabel: c.id, badge: "card",
          });
        }
      }
    } else {
      for (const s of (skillQuery.data?.skills ?? []).slice(0, 10)) {
        out.push({
          kind: "skill", key: `skill:${s.name}`, insert: s.name,
          label: s.name, sublabel: s.description,
          badge: s.linked || s.npx ? "npx" : s.origin,
        });
      }
    }
    return out.slice(0, 24);
  }, [token, fileQuery.data, symbolQuery.data, skillQuery.data, boardTasks]);

  useEffect(() => setIndex(0), [token?.kind, token?.query]);

  const sync = () => {
    const el = inputRef.current;
    if (!el) return;
    // Read the live DOM value: onChange schedules this in a rAF, so the `value`
    // captured in the current render may still be one keystroke behind.
    setToken(tokenAt(el.value, el.selectionStart ?? el.value.length));
  };

  const insert = (s: Suggestion) => {
    if (!token) return;
    const el = inputRef.current;
    const current = el?.value ?? value;
    const caret = el?.selectionStart ?? current.length;
    const sigil = s.kind === "skill" ? "$" : s.kind === "card" ? "#" : "@";
    const next = current.slice(0, token.start) + sigil + s.insert + " " + current.slice(caret);
    onChange(next);
    if (s.path) onPathsChange(uniq([...paths, s.path]));
    if (s.kind === "skill") onSkillsChange(uniq([...skills, s.insert]));
    setToken(null);
    requestAnimationFrame(() => {
      el?.focus();
      const p = token.start + s.insert.length + 2;
      el?.setSelectionRange(p, p);
    });
  };

  // Keep the box open while a token is active even when there is no workspace
  // (the file query is disabled there): the manual-path hint is still useful.
  const open = token !== null;
  const busy = token?.kind === "file"
    ? fileQuery.isFetching || symbolQuery.isFetching
    : skillQuery.isFetching;
  const hint = token?.kind === "file" ? fileQuery.data?.hint : undefined;

  return (
    <div ref={boxRef} className="relative">
      <Textarea
        ref={inputRef}
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(sync);
        }}
        onClick={sync}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) sync();
        }}
        onKeyDown={(e) => {
          if (!token || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            insert(suggestions[Math.min(index, suggestions.length - 1)]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setToken(null);
          }
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && (
        <div
          role="listbox"
          aria-label={token?.kind === "file" ? "Workspace file suggestions" : "Agent skill suggestions"}
          className="absolute top-full left-0 z-50 mt-1.5 w-full min-w-[20rem] overflow-hidden rounded-[20px] border border-line-strong/85 bg-raised/96 shadow-[var(--lift-3),var(--lift-inset)] backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line bg-well/45 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
            <span className="inline-flex items-center gap-1.5">
              {token?.kind === "file" ? <FileSearch className="size-3" /> : <Sparkles className="size-3" />}
              {token?.kind === "file" ? "Files · symbols · cards" : "Agent Skills"}
            </span>
            <span className="font-mono text-[9px] font-normal normal-case text-ink-4">↑↓ · ↵ to insert · esc</span>
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5">
            {suggestions.map((s, i) => (
              <button
                key={s.key}
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(s)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors",
                  i === index ? "bg-accent-tint text-accent-text" : "text-ink-2 hover:bg-well"
                )}
              >
                {s.kind === "file" ? (
                  <FileCode2 className="size-3 shrink-0 text-ink-3" />
                ) : s.kind === "symbol" ? (
                  <Hash className="size-3 shrink-0 text-ink-3" />
                ) : s.kind === "card" ? (
                  <Link2 className="size-3 shrink-0 text-ink-3" />
                ) : (
                  <AtSign className="size-3 shrink-0 text-ink-3" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono">{s.label}</span>
                {s.sublabel && <span className="max-w-[45%] truncate text-[10px] text-ink-4">{s.sublabel}</span>}
                {s.badge && <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">{s.badge}</Badge>}
              </button>
            ))}
            {suggestions.length === 0 && (
              <p className="px-2.5 py-2 text-[11px] text-ink-4">
                {busy
                  ? "Searching…"
                  : hint || (token?.kind === "file" ? "No matching files — type a relative path to attach it manually." : "No matching skills.")}
              </p>
            )}
          </div>
        </div>
      )}
      <p className="m-0 mt-1.5 flex items-center gap-1.5 text-[10px] text-ink-4">
        <span>Type</span>
        <kbd className="font-mono text-ink-3">@</kbd>
        <span>to reference a workspace file or</span>
        <kbd className="font-mono text-ink-3">$</kbd>
        <span>to attach an agent skill.</span>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Workspace Context & References picker                                       */
/* -------------------------------------------------------------------------- */

export function TaskContextPicker({
  workspace,
  paths,
  onPathsChange,
  skills,
  onSkillsChange,
}: {
  workspace: string;
  paths: string[];
  onPathsChange: (v: string[]) => void;
  skills: string[];
  onSkillsChange: (v: string[]) => void;
}) {
  const [fileQuery, setFileQuery] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const [showSkills, setShowSkills] = useState(false);

  const files = useQuery({
    queryKey: ["ws-files", workspace, fileQuery],
    enabled: showFiles && !!workspace.trim(),
    queryFn: () =>
      apiOr<WorkspaceFileResult>(
        `/api/v1/workspaces/files?path=${encodeURIComponent(workspace)}&q=${encodeURIComponent(fileQuery)}&limit=20`,
        { path: workspace, files: [], local: false }
      ),
  });

  const catalog = useQuery({
    queryKey: ["skills", skillQuery],
    enabled: showSkills,
    queryFn: () =>
      apiOr<{ skills: SkillMeta[]; count: number }>(
        `/api/v1/skills?q=${encodeURIComponent(skillQuery)}`,
        { skills: [], count: 0 }
      ),
  });

  const addManual = () => {
    const v = manualPath.trim();
    if (!v) return;
    onPathsChange(uniq([...paths, v]));
    setManualPath("");
  };

  const fileList: FileMatch[] = files.data?.files ?? [];

  return (
    <div className="space-y-3 rounded-[20px] border border-line bg-surface p-3.5 shadow-[var(--lift-1),var(--lift-inset)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="m-0 text-xs font-semibold text-ink">Workspace Context &amp; References</h3>
          <p className="m-0 mt-0.5 text-[10px] leading-relaxed text-ink-4">
            Attached files and skills are sent with the task and injected into the agent prompt at dispatch.
          </p>
        </div>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {paths.length + skills.length}
        </Badge>
      </div>

      {/* Files */}
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setShowFiles((v) => !v)}
          aria-expanded={showFiles}
          className="flex w-full items-center gap-1.5 text-[11px] font-medium text-ink-2 hover:text-ink"
        >
          <ChevronDown className={cn("size-3 transition-transform", !showFiles && "-rotate-90")} />
          <FileCode2 className="size-3 text-ink-3" />
          Files
          <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">{paths.length}</Badge>
          <span className="h-px flex-1 bg-line/70" />
        </button>

        {paths.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {paths.map((p) => (
              <Chip key={p} label={p} icon={<FileCode2 className="size-2.5" />} onRemove={() => onPathsChange(paths.filter((x) => x !== p))} />
            ))}
          </div>
        )}

        {showFiles && (
          <div className="space-y-1.5 pl-4">
            <div className="flex items-center gap-1.5">
              <Input
                value={fileQuery}
                onChange={(e) => setFileQuery(e.target.value)}
                placeholder={workspace ? "Search workspace files…" : "Select a workspace first"}
                className="h-7 font-mono text-[11px]"
                aria-label="Search workspace files"
              />
              <Button
                type="button"
                variant="outline"
                size="xs"
                title="Refresh index"
                onClick={() => void files.refetch()}
              >
                <RefreshCw className="size-3" />
              </Button>
            </div>
            {files.data?.hint && (
              <p className="m-0 flex items-start gap-1 text-[10px] leading-relaxed text-ink-4">
                <Info className="mt-px size-2.5 shrink-0" />
                {files.data.hint}
              </p>
            )}
            {fileList.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-[12px] border border-line bg-well/60 p-1">
                {fileList.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    disabled={paths.includes(f.path)}
                    onClick={() => onPathsChange(uniq([...paths, f.path]))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[8px] px-2 py-1 text-left font-mono text-[11px]",
                      paths.includes(f.path) ? "text-ink-4" : "text-ink-2 hover:bg-surface"
                    )}
                  >
                    <Plus className="size-2.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                    <span className="truncate text-[9px] text-ink-4">{f.directory}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManual();
                  }
                }}
                placeholder="Or type a relative path, e.g. src/api/client.ts"
                className="h-7 font-mono text-[11px]"
                aria-label="Attach a file path manually"
              />
              <Button type="button" variant="outline" size="xs" onClick={addManual} disabled={!manualPath.trim()}>
                Add
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Skills */}
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setShowSkills((v) => !v)}
          aria-expanded={showSkills}
          className="flex w-full items-center gap-1.5 text-[11px] font-medium text-ink-2 hover:text-ink"
        >
          <ChevronDown className={cn("size-3 transition-transform", !showSkills && "-rotate-90")} />
          <Sparkles className="size-3 text-ink-3" />
          Agent Skills
          <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">{skills.length}</Badge>
          <span className="h-px flex-1 bg-line/70" />
        </button>

        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <Chip key={s} label={s} icon={<Sparkles className="size-2.5" />} prefix="$" onRemove={() => onSkillsChange(skills.filter((x) => x !== s))} />
            ))}
          </div>
        )}

        {showSkills && (
          <div className="space-y-1.5 pl-4">
            <Input
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder="Search installed skills…"
              className="h-7 text-[11px]"
              aria-label="Search agent skills"
            />
            {(catalog.data?.skills ?? []).length > 0 ? (
              <div className="max-h-44 overflow-y-auto rounded-[12px] border border-line bg-well/60 p-1">
                {catalog.data!.skills.slice(0, 40).map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    disabled={skills.includes(s.name)}
                    onClick={() => onSkillsChange(uniq([...skills, s.name]))}
                    title={s.description}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[8px] px-2 py-1 text-left text-[11px]",
                      skills.includes(s.name) ? "text-ink-4" : "text-ink-2 hover:bg-surface"
                    )}
                  >
                    <Plus className="size-2.5 shrink-0" />
                    <span className="shrink-0 font-mono">${s.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-ink-4">{s.description}</span>
                    {(s.linked || s.npx || s.origin === "npx") && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">linked</Badge>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="m-0 text-[10px] text-ink-4">
                No skills found. Install with <code className="font-mono">npx skills add -g</code>; symlinked skill folders are discovered automatically.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  label,
  icon,
  prefix = "@",
  onRemove,
}: {
  label: string;
  icon: React.ReactNode;
  prefix?: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent/35 bg-accent-tint px-2.5 py-0.5 text-[10px] font-medium text-accent-text">
      {icon}
      <span className="max-w-[220px] truncate font-mono" title={label}>
        {prefix}{label}
      </span>
      <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-surface" aria-label={`Remove ${label}`}>
        <X className="size-2.5" />
      </button>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Base-branch picker                                                          */
/* -------------------------------------------------------------------------- */

/** Matches the backend's "__head" sentinel (REST/MCP contract). */
export const HEAD_SENTINEL = "__head";

export function BranchField({
  workspace,
  isGit,
  inspect,
  value,
  onChange,
  loading = false,
  onRefresh,
}: {
  workspace: string;
  isGit: boolean;
  inspect?: WorkspaceInspect | null;
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const branches = inspect?.branches ?? [];
  const current = inspect?.current ?? "";
  const remote = inspect?.local === false;
  const source = inspect?.source ?? (remote ? "none" : "local");
  const hasList = branches.length > 0;

  const options = useMemo<SearchSelectOption[]>(() => {
    const list: SearchSelectOption[] = [
      {
        value: HEAD_SENTINEL,
        label: "Current HEAD",
        sublabel: current ? `checked out: ${current}` : "use the repository's checked-out commit",
        icon: <GitBranch className="size-3.5" />,
        keywords: ["head", "current", "default", current],
        pinned: true,
      },
    ];
    for (const b of branches) {
      list.push({
        value: b,
        label: b,
        sublabel: b === current ? "current branch" : undefined,
        badge: b === current ? "HEAD" : undefined,
        icon: <GitBranch className="size-3.5" />,
        keywords: [b],
      });
    }
    return list;
  }, [branches, current]);

  // Always render: hiding the field for non-git/remote workspaces was the
  // reason "cannot select branch" was reported. Remote workspaces now get a
  // real list from the owning node; a typed fallback is always available.
  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="task-branch" className="text-[11px] font-medium text-ink-2">
          <GitBranch className="size-3 text-ink-3" />
          Base branch
          {loading && <Loader2 className="size-3 animate-spin text-ink-4" />}
          {!loading && inspect && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-mono">
              {source === "worker" ? `worker · ${branches.length}` : source === "local" ? `local · ${branches.length}` : "unavailable"}
            </Badge>
          )}
        </Label>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || !workspace.trim()}
              className="inline-flex items-center gap-1 text-[10px] text-ink-4 underline-offset-2 hover:text-ink-2 hover:underline disabled:opacity-50"
              aria-label="Refresh branch list"
            >
              <RefreshCw className="size-2.5" />
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={() => setCustom((v) => !v)}
            className="text-[10px] text-ink-4 underline-offset-2 hover:text-ink-2 hover:underline"
          >
            {custom ? "Pick" : "Type"}
          </button>
        </div>
      </div>
      {custom || !hasList ? (
        <Input
          id="task-branch"
          value={value === HEAD_SENTINEL ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={current || "main / develop / (current HEAD)"}
          className="font-mono text-[11px]"
          aria-label="Base branch"
        />
      ) : (
        <SearchSelect
          id="task-branch"
          value={value || HEAD_SENTINEL}
          onValueChange={(v) => onChange(v === HEAD_SENTINEL ? "" : v)}
          options={options}
          placeholder="Select base branch…"
          searchPlaceholder="Search branches…"
          emptyMessage="No branches"
          ariaLabel="Base branch"
          size="sm"
        />
      )}
      {loading && !inspect && (
        <p className="m-0 text-[10px] text-ink-4">Reading branches on the owning node…</p>
      )}
      {inspect?.warning && (
        <p className="m-0 flex items-start gap-1 text-[10px] leading-relaxed text-ink-4">
          <Info className="mt-px size-2.5 shrink-0" />
          {inspect.warning}
        </p>
      )}
      <p className="m-0 flex items-start gap-1 text-[10px] leading-relaxed text-ink-4">
        <Link2 className="mt-px size-2.5 shrink-0" />
        An isolated <code className="font-mono">sy/&lt;task-id&gt;</code> worktree is created from this base on the owning node.
        {isGit ? "" : " This workspace has no git repository; the value is kept for a future checkout."}
      </p>
    </div>
  );
}

export function useBranchInfo(workspace: string, refresh = false) {
  return useQuery({
    queryKey: ["ws-branches", workspace, refresh],
    enabled: workspace.trim().length > 1,
    staleTime: 30_000,
    queryFn: () =>
      apiOr<WorkspaceBranchResult>(
        `/api/v1/workspaces/branches?path=${encodeURIComponent(workspace.trim())}${refresh ? "&refresh=1" : ""}`,
        { path: workspace, branches: [], local: false }
      ),
  });
}
