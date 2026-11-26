# ADR-0002: Context Engine (Staging, Skills, MCP Registry, CodeGraph & Git Switcher)

- **Status**: Accepted (Wave 2)
- **Date**: 2026-11-26

## Context
Autonomous runs on remote Mac/Windows/Linux workers need access to uploaded screenshots (`⌘V`), workspace files, `SKILL.md` bundles, MCP servers, CodeGraph symbol context, and accurate git branch targets without manual SSH copying.

## Decision
1. **Attachment & Skill Staging**: Before dispatching a task, `dispatcher.go` stages uploaded task attachments into `.switchyard/attachments/<task-id>/` and selected `SKILL.md` folders into `.switchyard/skills/<name>/` via `worker.Client.StageFiles` (`POST /api/rpc` `stage_files`).
2. **Unified MCP Registry**: Persist MCP server definitions (`id`, `name`, `transport`, `command`, `args_json`, `url`, `env_json`, `enabled`) in SQLite `mcp_servers` table and bind per-task `mcps` JSON arrays on `tasks`. Inject selected MCP servers into `SpawnSpec` / `.switchyard/mcp.json`.
3. **CodeGraph & Git Switcher**: Expose `/api/v1/workspaces/{id}/git/*` (`branches`, `checkout`, `pull`, `create-branch`) and `/api/v1/workspaces/{id}/codegraph/*` (`status`, `query`, `sync`) backed by Lane A Control RPC. Fix `review.Approve()` to merge into `task.Branch` when `auto_merge` is enabled.

## Consequences
- Remote workers receive exact image attachments, skills, and MCP configs automatically in the task worktree.
- Developers can switch branches and query/sync CodeGraph directly from the Studio UI without blocking active jobs.
