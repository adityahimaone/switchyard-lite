export const STATUSES = ["backlog", "todo", "blocked", "in_progress", "review", "done", "failed"] as const;
export type Status = (typeof STATUSES)[number];

export interface Task {
  id: string;
  board_id: string;
  parent_id?: string;
  title: string;
  prompt: string;
  acceptance?: string;
  status: Status;
  workspace?: string;
  executor?: string;
  model?: string;
  effort?: string;
  retry_count: number;
  blocked_by: string[];
  run_id?: string;
  stage_id?: string;
  created_at: number;
  updated_at: number;
}

export interface Board {
  id: string;
  name: string;
  default_executor?: string;
  default_model?: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  host?: string;
  os?: string;
  kind?: string;
  labels?: string[];
  note?: string;
  git?: boolean;
  status?: "local" | "connected" | "unreachable" | "unknown";
  latency_ms?: number;
  created_at?: number;
}

export interface WorktreeInfo {
  exists: boolean;
  repo?: string;
  path?: string;
  branch?: string;
  base_sha?: string;
}

export type PlatformKey = "mac" | "windows" | "current" | "linux";

export function platformOfWorkspace(
  w?: Pick<Workspace, "os" | "host" | "path"> | null,
  fallbackPath?: string
): PlatformKey {
  const os = (w?.os || "").toLowerCase();
  const host = (w?.host || "").toLowerCase();
  const path = w?.path || fallbackPath || "";
  const lower = path.toLowerCase();

  if (os === "windows" || host.includes("windows") || lower.startsWith("c:\\") || /^[a-z]:[\\/]/i.test(path)) {
    return "windows";
  }
  if (os === "mac" || os === "darwin" || host.includes("mac") || path.startsWith("/Users/")) {
    return "mac";
  }
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return "current";
  }
  return "linux";
}

export interface Worker {
  id: string;
  name?: string;
  url?: string;
  status?: string;
  executor?: string;
  task_id?: string;
  created_at?: number;
}

export interface Comment {
  id?: string | number;
  author: string;
  body: string;
  created_at?: number;
}

export interface TaskEvent {
  id: number;
  task_id: string;
  kind: string;
  payload?: unknown;
  created_at: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const KEY = "switchyard.token";
export const getToken = () => localStorage.getItem(KEY) ?? "";
export const setToken = (t: string) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

const BOARD_KEY = "switchyard.board";
export const getSavedBoardId = () => localStorage.getItem(BOARD_KEY) ?? "";
export const setSavedBoardId = (id: string) => {
  if (id) localStorage.setItem(BOARD_KEY, id);
  else localStorage.removeItem(BOARD_KEY);
  window.dispatchEvent(new CustomEvent("switchyard:board", { detail: id }));
};

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && path !== "/api/v1/session") {
    window.dispatchEvent(new Event("switchyard:unauth"));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* non-json */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

/** Like api() but returns fallback when the endpoint is not built yet (404/405/501). */
export async function apiOr<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && [404, 405, 501].includes(e.status)) return fallback;
    throw e;
  }
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const put = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });

export const patch = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

export const del = <T,>(path: string) =>
  api<T>(path, { method: "DELETE" });

export const NEXT: Record<Status, Status[]> = {
  backlog: ["todo"],
  todo: ["backlog", "blocked", "in_progress"],
  blocked: ["todo"],
  in_progress: ["review", "todo", "failed"],
  review: ["done", "todo"],
  failed: ["todo"],
  done: [],
};

export interface ModelOpt {
  id: string;
  name: string;
}

export function normalizeModels(raw: unknown): ModelOpt[] {
  const arr = Array.isArray(raw) ? raw : (raw as { models?: unknown[] })?.models ?? [];
  return arr.map((m) =>
    typeof m === "string"
      ? { id: m, name: m }
      : {
          id: String((m as ModelOpt).id ?? (m as ModelOpt).name),
          name: String((m as ModelOpt).name ?? (m as ModelOpt).id),
        }
  );
}
