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
  -- JSON arrays of @file references and $skill names attached at creation.
  paths TEXT NOT NULL DEFAULT '[]',
  skills TEXT NOT NULL DEFAULT '[]',
  -- Base branch used when creating the isolated worktree (empty = HEAD).
  branch TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_sig TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER NOT NULL DEFAULT 0,
  execution_mode TEXT NOT NULL DEFAULT 'managed',
  question_json TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  dsh_workspace_id TEXT NOT NULL DEFAULT '',
  last_turn_seq INTEGER NOT NULL DEFAULT -1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_board_status ON tasks(board_id, status);

CREATE TABLE IF NOT EXISTS task_questions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  multi_select INTEGER NOT NULL DEFAULT 0,
  context TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT 'agent',
  status TEXT NOT NULL DEFAULT 'pending',
  answer TEXT NOT NULL DEFAULT '',
  selected_options TEXT NOT NULL DEFAULT '[]',
  answered_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  answered_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS task_questions_task ON task_questions(task_id, created_at);

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Custom Knowledge',
  badge TEXT NOT NULL DEFAULT 'Custom',
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  sections_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  content BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
