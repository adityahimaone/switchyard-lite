# ADR-0001: Harness-Agnostic Dual-Lane Transport (`node-agent`)

- **Status**: Accepted (Wave 1 Implemented)
- **Date**: 2026-11-26

## Context
Previously, `node-agent` serialized all commands through a single job queue (`busy=1`) and embedded harness-specific CLI flags. Fast workspace probes (`git branch`, file listing, `codegraph`, `agy-auth`) blocked behind 10-minute AI runs, and adding or updating harness flags required redeploying every remote worker binary.

## Decision
1. Split `node-agent` into **Lane A (Control RPC)** (`POST /api/rpc`, 8-goroutine semaphore, 15s default timeout) and **Lane B (Job Stream)** (`SpawnSpec` + SSE `GET /api/events/{task_id}` + SQLite WAL journal).
2. Move all harness CLI flag building, NDJSON unwrapping, and cross-harness handoff generation into `switchyard-studio/internal/harnesses`.
3. Add gRPC auto-reconnect with heartbeat model/health parity and HTTP poll/reply fallback so workers stay resilient across sleep/wake and tailnet switches.

## Consequences
- Workspace inspection, git switching, file staging, and CodeGraph queries stay sub-second even while a worker runs an AI job.
- Updating `agy`, `dsh`, or `commandcode` flags requires only updating `switchyard-studio`.
