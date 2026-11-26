# ADR-0004: In-Drawer Interactive Terminal & Tunneled Preview Browser

- **Status**: Accepted (Wave 3)
- **Date**: 2026-11-26

## Context
Inspecting build failures, running quick commands inside a task's `sy/<task-id>` worktree, or visually verifying a running dev server on a remote worker currently requires leaving the Studio UI and SSHing or setting up manual port forwards.

## Decision
1. **Interactive Worktree Terminal**: Add `POST /api/v1/tasks/{id}/terminal/exec` (and streaming session support via `node-agent` Lane A/PTY endpoints) so the Task Drawer's **Terminal** tab provides an interactive command terminal scoped directly to the task worktree (`cwd = worktree_dir`) with history, ANSI color rendering, and quick worktree shortcuts (`git status`, `git diff --stat`, `test`).
2. **Tunneled Preview Browser**: Add `GET/POST/PUT/DELETE /api/v1/preview/{taskId}/{port}/*` in `switchyard-lite` proxying through `node-agent`'s `POST /api/proxy` (forwarding to `http://127.0.0.1:<port>/*` on the target worker node) so the Task Drawer's **Preview** tab renders remote dev servers in a responsive viewport frame (Desktop / Tablet / Mobile) with 1-click "Send Feedback to Agent".

## Consequences
- Zero extra external proxy setup or open firewall ports needed — works across local, macOS, Windows, and Linux workers over the existing `node-agent` link.
