-- Pipeline projections. The append-only `events` table (kinds "pipeline.*",
-- task_id = run id) is the source of truth; these tables are indexes only.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  board_id TEXT NOT NULL,
  goal_task_id TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_nodes (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  node_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pipeline_nodes_run ON pipeline_nodes(run_id);
