-- Dispatch tables, loaded additively via store.EnsureDispatch.
CREATE TABLE IF NOT EXISTS dispatch_claims (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  claimed_at INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task_worktrees (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  -- "local" (control plane can see the repo) or "worker" (node-agent owns it).
  transport TEXT NOT NULL DEFAULT 'local'
);
CREATE TABLE IF NOT EXISTS dispatch_workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dispatch_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'dir',
  labels TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dispatch_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
