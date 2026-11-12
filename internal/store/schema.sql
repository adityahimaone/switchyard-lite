CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_executor TEXT NOT NULL DEFAULT '',
  default_model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL DEFAULT '',
  stage_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  acceptance TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  workspace TEXT NOT NULL DEFAULT '',
  executor TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  effort TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_sig TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_board_status ON tasks(board_id, status);

CREATE TABLE IF NOT EXISTS task_deps (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_by TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocked_by)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- append-only
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('read','write','admin')),
  created_at INTEGER NOT NULL
);
