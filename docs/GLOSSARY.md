# Switchyard Autonomous Studio V2 — Domain Glossary

| Term | Definition |
| --- | --- |
| **Control Plane (`switchyard-lite`)** | Standalone Go + SQLite + React/Vite server owning boards, tasks, comments, attachments, MCP registry, harness adapters, and the Studio UI. |
| **Worker Runtime (`node-agent`)** | Harness-agnostic transport and execution daemon running on Mac, Windows, and Linux machines. Exposes Lane A (Control RPC) and Lane B (Job Stream + PTY + Preview Tunnel). |
| **Lane A (Control RPC)** | Non-blocking RPC channel (`POST /api/rpc`) running up to 8 concurrent fast operations (`exec`, `stage_files`, `probe_bins`, `git`, `codegraph`) without waiting behind `busy=1` AI jobs. |
| **Lane B (Job Stream)** | Long-running `SpawnSpec` execution lane with raw stdout/stderr chunking over gRPC/HTTP, SQLite journal persistence, and SSE push (`GET /api/events/{task_id}`). |
| **Big-3 Harnesses** | Primary supported autonomous coding CLIs: **AGY** (`agy`), **DSH** (`dsh`), and **CommandCode** (`commandcode` / `cmd`), each managed by `internal/harnesses` with per-harness session IDs and cross-harness handoff. |
| **Waiting Input (`waiting_input`)** | First-class task lifecycle status where an agent paused to ask a structured clarifying or Grill-Me question. Never conflated with `review` or `failed`. |
| **Grill-Me First (`grill_me`)** | Explicit task flag instructing the agent to inspect relevant files and ask one high-leverage clarifying question at a time (with a `(Recommended)` first option) before editing code. |
| **Context Staging** | Pre-dispatch transfer of task attachments (`⌘V` images / files), `SKILL.md` bundles, and selected MCP server configurations into `.switchyard/` inside the task worktree via `stage_files` Control RPC. |
| **CodeGraph** | Local/remote code intelligence indexer queried over Control RPC to power `@symbol`/`@file` omnibox completions and pre-dispatch context packs. |
| **Workflow Tree** | Dual-density visual execution graph connecting Workspace/Branch → Parent Task + Context/Files → Hybrid Child Subtasks (`parent_id`) and Harness Runs. |
| **Inbox / Triage View** | Grouped editorial feed (Waiting Input · Today · Review · Earlier) styled in the Warm Light Tactile design system alongside the primary Kanban Studio board. |
| **PTY Terminal** | Interactive pseudo-terminal multiplexed through `node-agent` into the Task Drawer, scoped directly to the task's git worktree (`sy/<task-id>`). |
| **Preview Tunnel** | Authenticated reverse proxy (`/api/v1/preview/{taskId}/{port}/*`) tunneling a worker's `localhost:<port>` dev server into the Task Drawer Preview Browser. |
