import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiOr, post } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ShieldCheck } from "@/components/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast, toastError } from "@/components/ui/toast";

export const ALL_EXECUTORS = [
  "agy",
  "claude",
  "codex",
  "commandcode",
  "omp",
  "dsh",
] as const;

export const EFFORTS = ["low", "medium", "high"] as const;
export const AGY_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const EXECUTOR_LABELS: Record<string, string> = {
  agy: "Antigravity CLI (agy)",
  claude: "Claude Code",
  codex: "Codex",
  commandcode: "Command Code",
  omp: "omp (oh-my-pi)",
  dsh: "DeepSeek Harness",
};

export const EXECUTOR_DESCRIPTIONS: Record<string, string> = {
  agy: "Antigravity CLI with auto-approve, extended thinking & agy-auth switching",
  claude: "Anthropic Claude Code agent harness",
  codex: "OpenAI Codex agent harness",
  commandcode: "Command Code autonomous agent",
  omp: "oh-my-pi continuous agent harness",
  dsh: "DeepSeek Harness",
};

export const EFFORT_LABELS: Record<string, string> = {
  minimal: "minimal (maps to low)",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

export function isAgyExecutor(executor?: string | null): boolean {
  const e = (executor ?? "").trim().toLowerCase();
  return e === "agy" || e === "antigravity";
}

export function effortsForExecutor(executor?: string | null): readonly string[] {
  return isAgyExecutor(executor) ? AGY_EFFORTS : EFFORTS;
}

export interface ExecutorConfig {
  order: string[];
  hidden: string[];
}

export const EXECUTORS_STORAGE_KEY = "switchyard.executors.config";

export function normalizeExecutorConfig(raw: unknown): ExecutorConfig {
  const known = new Set<string>(ALL_EXECUTORS);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { order: [...ALL_EXECUTORS], hidden: [] };
  }
  const obj = raw as { order?: unknown; hidden?: unknown };
  const rawOrder = Array.isArray(obj.order) ? obj.order : [];
  const rawHidden = Array.isArray(obj.hidden) ? obj.hidden : [];

  const order: string[] = [];
  const seenOrder = new Set<string>();
  for (const item of rawOrder) {
    const id = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (!id || !known.has(id) || seenOrder.has(id)) continue;
    seenOrder.add(id);
    order.push(id);
  }
  for (const id of ALL_EXECUTORS) {
    if (!seenOrder.has(id)) {
      seenOrder.add(id);
      order.push(id);
    }
  }

  const hidden: string[] = [];
  const seenHidden = new Set<string>();
  for (const item of rawHidden) {
    const id = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (!id || !known.has(id) || seenHidden.has(id)) continue;
    seenHidden.add(id);
    hidden.push(id);
  }

  // Never allow every executor to be hidden simultaneously.
  const visible = order.filter((id) => !seenHidden.has(id));
  if (visible.length === 0) {
    return { order, hidden: hidden.filter((id) => id !== order[0]) };
  }
  return { order, hidden };
}

function readCachedExecutorConfig(): ExecutorConfig | undefined {
  try {
    const raw = window.localStorage.getItem(EXECUTORS_STORAGE_KEY);
    if (!raw) return undefined;
    return normalizeExecutorConfig(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function writeCachedExecutorConfig(cfg: ExecutorConfig) {
  try {
    window.localStorage.setItem(EXECUTORS_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage quota errors
  }
}

export function visibleExecutorsFromConfig(cfg: ExecutorConfig): string[] {
  const hiddenSet = new Set(cfg.hidden);
  const visible = cfg.order.filter((id) => !hiddenSet.has(id));
  return visible.length > 0 ? visible : [...ALL_EXECUTORS];
}

export function useExecutorConfig() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["settings", "executors"],
    staleTime: 30_000,
    queryFn: async () => {
      const raw = await apiOr<unknown>("/api/v1/settings/executors", null);
      if (raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as { order?: unknown }).order)) {
        const normalized = normalizeExecutorConfig(raw);
        writeCachedExecutorConfig(normalized);
        return normalized;
      }
      return readCachedExecutorConfig() ?? normalizeExecutorConfig(null);
    },
  });

  const config = query.data ?? readCachedExecutorConfig() ?? normalizeExecutorConfig(null);
  const visibleExecutors = visibleExecutorsFromConfig(config);

  const save = useMutation({
    mutationFn: async (next: ExecutorConfig) => {
      const normalized = normalizeExecutorConfig(next);
      const saved = await post<ExecutorConfig>("/api/v1/settings/executors", normalized);
      return normalizeExecutorConfig(saved);
    },
    onSuccess: (saved) => {
      writeCachedExecutorConfig(saved);
      qc.setQueryData(["settings", "executors"], saved);
      qc.invalidateQueries({ queryKey: ["settings", "executors"] });
    },
    onError: (e) => toastError(e, "Failed to save executor settings"),
  });

  return {
    config,
    visibleExecutors,
    isLoading: query.isLoading,
    saveConfig: save.mutate,
    saveConfigAsync: save.mutateAsync,
    isSaving: save.isPending,
  };
}

export interface WorkspaceExecutorProbe {
  workspace: string;
  machine: string;
  machineLabel: string;
  isLocal: boolean;
  probed: boolean;
  nodeId?: string;
  hostname?: string;
  installed: Record<string, boolean>;
  availableExecutors: string[];
  error?: string;
}

export function normalizeWorkspaceProbe(raw: unknown, workspace = ""): WorkspaceExecutorProbe {
  const fallbackInstalled: Record<string, boolean> = {};
  for (const id of ALL_EXECUTORS) {
    fallbackInstalled[id] = true;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      workspace,
      machine: "",
      machineLabel: "",
      isLocal: true,
      probed: false,
      installed: fallbackInstalled,
      availableExecutors: [...ALL_EXECUTORS],
    };
  }
  const obj = raw as Record<string, unknown>;
  const rawInstalled =
    obj.installed && typeof obj.installed === "object" && !Array.isArray(obj.installed)
      ? (obj.installed as Record<string, unknown>)
      : null;

  const installed: Record<string, boolean> = {};
  for (const id of ALL_EXECUTORS) {
    installed[id] = rawInstalled && typeof rawInstalled[id] === "boolean" ? Boolean(rawInstalled[id]) : true;
  }
  const probed = Boolean(obj.probed);
  const available = Array.isArray(obj.available_executors)
    ? obj.available_executors.filter((v): v is string => typeof v === "string")
    : ALL_EXECUTORS.filter((id) => installed[id]);

  return {
    workspace: typeof obj.workspace === "string" ? obj.workspace : workspace,
    machine: typeof obj.machine === "string" ? obj.machine : "",
    machineLabel: typeof obj.machine_label === "string" ? obj.machine_label : "",
    isLocal: obj.is_local !== false,
    probed,
    nodeId: typeof obj.node_id === "string" ? obj.node_id : undefined,
    hostname: typeof obj.hostname === "string" ? obj.hostname : undefined,
    installed,
    availableExecutors: available,
    error: typeof obj.error === "string" ? obj.error : undefined,
  };
}

export function useWorkspaceExecutors(workspace?: string) {
  const ws = (workspace ?? "").trim();
  const query = useQuery({
    queryKey: ["executors-probe", ws],
    staleTime: 30_000,
    queryFn: async () => {
      const qs = ws ? `?workspace=${encodeURIComponent(ws)}` : "";
      const raw = await apiOr<unknown>(`/api/v1/executors/probe${qs}`, null);
      return normalizeWorkspaceProbe(raw, ws);
    },
  });

  const probe = query.data ?? normalizeWorkspaceProbe(null, ws);
  const isExecutorInstalled = (id: string) => {
    if (!probe.probed) return true;
    return probe.installed[id] !== false;
  };
  const installedCount = ALL_EXECUTORS.filter((id) => probe.installed[id]).length;

  return {
    probe,
    isLoading: query.isLoading,
    refetch: query.refetch,
    isExecutorInstalled,
    installedCount,
    totalCount: ALL_EXECUTORS.length,
  };
}

export interface AgyAccount {
  id: string;
  email: string;
  name: string;
  alias?: string;
  plan?: string;
  quota_5h?: string;
  quota_weekly?: string;
  tags?: string[];
  active: boolean;
}

export interface AgyAccountsState {
  available: boolean;
  machine: string;
  machineLabel: string;
  accounts: AgyAccount[];
  active: string;
  error?: string;
}

export function normalizeAgyAccounts(raw: unknown): AgyAccountsState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { available: false, machine: "", machineLabel: "", accounts: [], active: "" };
  }
  const obj = raw as Record<string, unknown>;
  const accountsRaw = Array.isArray(obj.accounts) ? obj.accounts : [];
  const accounts: AgyAccount[] = accountsRaw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      id: typeof a.id === "string" ? a.id : "",
      email: typeof a.email === "string" ? a.email : "",
      name: typeof a.name === "string" ? a.name : "",
      alias: typeof a.alias === "string" ? a.alias : undefined,
      plan: typeof a.plan === "string" ? a.plan : undefined,
      quota_5h: typeof a.quota_5h === "string" ? a.quota_5h : undefined,
      quota_weekly: typeof a.quota_weekly === "string" ? a.quota_weekly : undefined,
      tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === "string") : undefined,
      active: Boolean(a.active),
    }))
    .filter((a) => a.id || a.email || a.alias || a.name);
  return {
    available: obj.available !== false,
    machine: typeof obj.machine === "string" ? obj.machine : "",
    machineLabel: typeof obj.machine_label === "string" ? obj.machine_label : "",
    accounts,
    active: typeof obj.active === "string" ? obj.active : "",
    error: typeof obj.error === "string" ? obj.error : undefined,
  };
}

export function formatAgyAccountLabel(acc: AgyAccount): string {
  const title = acc.alias || acc.name;
  const email = acc.email;
  let base = "";
  if (title && email && title.toLowerCase() !== email.toLowerCase()) {
    base = `${title} (${email})`;
  } else {
    base = email || title || acc.id;
  }
  const extra: string[] = [];
  if (acc.plan) extra.push(acc.plan);
  if (acc.quota_5h) extra.push(`5h ${acc.quota_5h}`);
  if (acc.active) extra.push("active");
  return extra.length > 0 ? `${base} · ${extra.join(" · ")}` : base;
}

export function useAgyAccounts(workspace?: string, enabled = true) {
  const qc = useQueryClient();
  const ws = (workspace ?? "").trim();
  const query = useQuery({
    queryKey: ["agy", "accounts", ws],
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const qs = ws ? `?workspace=${encodeURIComponent(ws)}` : "";
      const raw = await apiOr<unknown>(`/api/v1/agy/accounts${qs}`, null);
      return normalizeAgyAccounts(raw);
    },
  });

  const switchMutation = useMutation({
    mutationFn: (account: string) =>
      post<{ ok: boolean; active: string; machine_label?: string; accounts?: AgyAccount[] }>(
        "/api/v1/agy/accounts/switch",
        { account, workspace: ws }
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["agy", "accounts"] });
      const where = res.machine_label ? ` on ${res.machine_label}` : "";
      toast(`AGY account switched to ${res.active}${where}`, { tone: "success" });
    },
    onError: (e) => toastError(e, "Could not switch AGY account"),
  });

  return {
    state: query.data ?? { available: false, machine: "", machineLabel: "", accounts: [], active: "" },
    isLoading: query.isLoading,
    refetch: query.refetch,
    switchAccount: switchMutation.mutate,
    isSwitching: switchMutation.isPending,
  };
}

export function AgyAccountPicker({
  id = "agy-account-select",
  workspace,
  compact = false,
}: {
  id?: string;
  workspace?: string;
  compact?: boolean;
}) {
  const { state, isLoading, refetch, switchAccount, isSwitching } = useAgyAccounts(workspace, true);
  const currentValue =
    state.active ||
    state.accounts.find((a) => a.active)?.email ||
    state.accounts.find((a) => a.active)?.alias ||
    state.accounts.find((a) => a.active)?.id ||
    "";

  return (
    <div
      className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-well/40 p-2.5"
      data-testid="agy-account-picker"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">
          AGY Account (agy-auth)
          {state.machineLabel ? ` · ${state.machineLabel}` : ""}
        </span>
        <div className="flex items-center gap-1.5">
          {state.accounts.length > 0 && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] tabular-nums text-[var(--text-secondary)]">
              {state.accounts.length} accts
            </Badge>
          )}
          <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] text-[var(--status-done)] border-[color-mix(in_srgb,var(--status-done)_35%,transparent)]">
            <ShieldCheck className="h-3 w-3" />
            auto-approve
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="Refresh AGY accounts"
            onClick={() => refetch()}
            disabled={isLoading || isSwitching}
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {state.accounts.length > 0 ? (
        <Select
          value={currentValue || "__none__"}
          onValueChange={(v) => {
            if (v && v !== "__none__" && v !== currentValue) {
              switchAccount(v);
            }
          }}
          disabled={isSwitching}
        >
          <SelectTrigger id={id} size={compact ? "sm" : "default"} aria-label="AGY account">
            <SelectValue placeholder="Select AGY account" />
          </SelectTrigger>
          <SelectContent>
            {!currentValue && (
              <SelectItem value="__none__">(select agy-auth account)</SelectItem>
            )}
            {state.accounts.map((acc) => {
              const val = acc.email || acc.alias || acc.id;
              return (
                <SelectItem key={acc.id || val} value={val}>
                  {formatAgyAccountLabel(acc)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-[11px] text-[var(--text-muted)]">
          {state.error
            ? `${state.machineLabel || "Host"}: ${state.error}`
            : currentValue
              ? `Active account: ${currentValue}`
              : "No agy-auth accounts found — using default CLI session"}
        </p>
      )}
    </div>
  );
}
