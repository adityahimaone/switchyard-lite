export const STATUSES = ["backlog", "todo", "blocked", "in_progress", "review", "done", "failed"] as const;
export type Status = (typeof STATUSES)[number];

export interface Task {
  id: string; board_id: string; title: string; prompt: string; acceptance?: string; status: Status;
  workspace?: string; executor?: string; model?: string; effort?: string; retry_count: number;
  blocked_by: string[]; run_id?: string; stage_id?: string; created_at: number; updated_at: number;
}
export interface Board { id: string; name: string }
export interface Comment { id?: string; author: string; body: string; created_at?: number }
export interface TaskEvent { id: number; task_id: string; kind: string; payload?: unknown; created_at: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const KEY = "switchyard.token";
export const getToken = () => localStorage.getItem(KEY) ?? "";
export const setToken = (t: string) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401 && path !== "/api/v1/session") window.dispatchEvent(new Event("switchyard:unauth"));
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* non-json */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

/** Like api() but returns fallback when the endpoint is not built yet (404/405/501). */
export async function apiOr<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  try { return await api<T>(path, init); }
  catch (e) {
    if (e instanceof ApiError && [404, 405, 501].includes(e.status)) return fallback;
    throw e;
  }
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const NEXT: Record<Status, Status[]> = {
  backlog: ["todo"], todo: ["backlog", "in_progress"], blocked: ["todo"],
  in_progress: ["review", "todo", "failed"], review: ["done", "todo"], failed: ["todo"], done: [],
};

export interface ModelOpt { id: string; name: string }
export function normalizeModels(raw: unknown): ModelOpt[] {
  const arr = Array.isArray(raw) ? raw : (raw as { models?: unknown[] })?.models ?? [];
  return arr.map((m) => typeof m === "string" ? { id: m, name: m } :
    { id: String((m as ModelOpt).id ?? (m as ModelOpt).name), name: String((m as ModelOpt).name ?? (m as ModelOpt).id) });
}
