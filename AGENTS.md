# AGENTS.md — switchyard-lite

## Overview

`switchyard-lite` is a standalone Go + SQLite + React/Vite control plane for coding agents.

## Package Map

- `cmd/switchyard-lite` — CLI entrypoint (`serve`, `mcp`, `token create`).
- `internal/store` — Single SQLite database (`modernc.org/sqlite`, WAL mode) + embedded schemas (`schema.sql`, `schema_dispatch.sql`, `schema_pipeline.sql`).
- `internal/tasks` — Boards, tasks, comments, dependency DAG with cycle detection, execution modes (`managed`, `tracker`), interactive `task_questions`, status machine (`backlog`, `todo`, `blocked`, `in_progress`, `review`, `done`, `failed`), and append-only `events`.
- `internal/dispatch` — Atomic task claims (skipping `tracker` cards), lease renewal/reaping, per-task git worktrees (`sy/<task-id>`), `dsh`/`commandcode` session continuity, `DetectOpenQuestion`, `ResumeWithAnswer`, and `node-agent` HTTP client (`POST /api/dispatch`, `GET /api/results/{id}`).
- `internal/models` — Cached proxy for `node-agent` `GET /api/models?executor=`.
- `internal/review` — Git worktree diff vs base SHA, approve (keeps branch; opt-in `auto_merge`), and reject (records feedback comment + requeues to `todo`).
- `internal/pipeline` — Deterministic DAG coordinator and built-in `design-thinking.yaml` + `meta7.yaml` templates. The active flow is the `pipeline.default_template` setting (`GET`/`POST /api/v1/pipelines/default`), seeded by `SWITCHYARD_PIPELINE_DEFAULT`; `POST /api/v1/pipelines` with no `template` uses it.
- `internal/mcp` — MCP server (stdio + `/mcp` streamable HTTP) with 62 tools covering full control-plane parity (boards, tasks/attachments, passive tracker, retry, Grill-Me Q&A, pipelines/`meta7`, workspaces, workers, telemetry, and knowledge).
- `internal/api` — REST `/api/v1/*` handlers (including `/tasks/{id}/retry`, `/tasks/track/*`, `/tasks/{id}/questions*`, `/knowledge*`), token scope middleware (`read`, `write`, `admin`), admin password session login, and SPA static handler.
- `internal/webui` + `web/` — Embedded React + Vite + TanStack Query UI (Kanban board with inline question choices & retry controls, Global Flow Map, and 3-column Knowledge Center).

## Verification Commands

```bash
make test
make lint
make build
```
