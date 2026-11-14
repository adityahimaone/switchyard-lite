export interface BuiltinDocSection {
  id: string;
  heading: string;
  paragraphs?: string[];
  callout?: {
    tone: "info" | "warn" | "success";
    title: string;
    body: string;
  };
  code?: {
    label: string;
    lang: string;
    snippet: string;
  };
  table?: {
    headers: string[];
    rows: string[][];
  };
  bullets?: { label: string; detail: string }[];
}

export interface BuiltinDocArticle {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  badge: string;
  summary: string;
  sections: BuiltinDocSection[];
}

export const BUILTIN_DOCS: BuiltinDocArticle[] = [
  {
    slug: "overview",
    title: "Switchyard-Lite Control Plane",
    subtitle: "Go + SQLite WAL + React/Vite autonomous task & agent orchestration.",
    category: "Core Architecture",
    badge: "Architecture",
    summary:
      "Switchyard-Lite coordinates coding agents across isolated git worktrees, passive external MCP mirrors, deterministic pipelines (including meta7), interactive card clarification questions, and a review gate backed by a single SQLite database.",
    sections: [
      {
        id: "system-pillars",
        heading: "Control Plane Building Blocks",
        paragraphs: [
          "All durable state lives in a single SQLite database opened in WAL mode across boards, tasks, dependencies, comments, attachments, task_questions, knowledge_docs, events, and dispatch/pipeline tables.",
          "An embedded dispatcher claims eligible managed tasks, provisions per-task git worktrees (sy/<task-id>), streams incremental logs from node-agent, detects clarification prompts, and enforces a diff-first review gate before Done.",
        ],
        bullets: [
          {
            label: "internal/tasks",
            detail: "Boards, status machine, DAG dependency cycle checks, execution modes, and task_questions.",
          },
          {
            label: "internal/dispatch",
            detail: "Lease-based worker claims, node-agent HTTP execution, dsh/commandcode continuity, and DetectOpenQuestion parser.",
          },
          {
            label: "internal/pipeline",
            detail: "Deterministic DAG orchestrator supporting design-thinking and meta7 autonomous coordinator templates.",
          },
          {
            label: "internal/mcp",
            detail: "Stdio and HTTP (/mcp) Model Context Protocol server exposing all 62 control-plane operations.",
          },
        ],
      },
      {
        id: "verification-loop",
        heading: "Standard Verification Loop",
        code: {
          label: "Build & Test Commands",
          lang: "bash",
          snippet: "make lint\nmake test\nmake build",
        },
      },
    ],
  },
  {
    slug: "task-modes",
    title: "Dual Modes: Managed vs Tracker",
    subtitle: "Run tasks through switchyard workers OR passively monitor external sessions without duplicate runs.",
    category: "Core Architecture",
    badge: "Workflow",
    summary:
      "Every card carries an execution_mode field ('managed' or 'tracker'). Managed tasks are claimed and executed by switchyard's dispatcher with retry support; Tracker tasks are strictly monitor-only so external harnesses (dsh, commandcode, Antigravity) can report progress cleanly.",
    sections: [
      {
        id: "mode-comparison",
        heading: "Mode Comparison",
        table: {
          headers: ["Behavior", "managed (Default)", "tracker (Monitor-only)"],
          rows: [
            ["Dispatcher Tick / Claim", "Automatically claimed & executed", "Always skipped (COALESCE(execution_mode,'managed') <> 'tracker')"],
            ["Retry Support", "POST /api/v1/tasks/{id}/retry & retry_task MCP", "Manual/external lifecycle updates only"],
            ["Status Transitions", "Strict managed gate (Review before Done)", "Direct external updates via track/complete"],
            ["Logs & Agent Progress", "Streamed from node-agent + WorkerLogTail", "Pushed incrementally via report_task_progress"],
          ],
        },
      },
      {
        id: "passive-tracker-flow",
        heading: "Passive Mirroring Flow via MCP",
        paragraphs: [
          "When you run an agent session directly inside dsh, commandcode, or Antigravity, create a tracker card so the board reflects live progress and tracer history without spawning a second competing worker.",
        ],
        code: {
          label: "Passive Monitor Lifecycle (MCP JSON args)",
          lang: "json",
          snippet:
            "// 1. Start passive monitor card\nstart_tracked_task: { \"board_id\": \"default\", \"title\": \"Refactor Auth\", \"executor\": \"dsh\", \"session_id\": \"dsh_s_123\" }\n\n// 2. Push incremental steps\nreport_task_progress: { \"id\": \"t_...\", \"step\": \"Updating middleware\", \"percent\": 65, \"comment\": true }\n\n// 3. Complete cleanly\ncomplete_tracked_task: { \"id\": \"t_...\", \"status\": \"done\", \"output\": \"Tests pass.\" }",
        },
      },
      {
        id: "managed-retry-flow",
        heading: "Managed Execution & Retry",
        paragraphs: [
          "External orchestrators can also create managed tasks, dispatch them immediately, tail worker logs/runs, and invoke retry_task with targeted feedback if a run stalls or fails.",
        ],
        callout: {
          tone: "info",
          title: "Explicit Retry Endpoint",
          body: "POST /api/v1/tasks/{id}/retry clears stale claims and error signatures, resets retry counters if requested, appends feedback comments, moves the card to todo, and immediately dispatches unless dispatch_now=false.",
        },
      },
    ],
  },
  {
    slug: "grill-me-questions",
    title: "Open Questions & Grill-Me Cards",
    subtitle: "Answer clarification choices inline on Kanban cards with session resume for dsh and commandcode.",
    category: "Agent Coordination & Harness",
    badge: "dsh · commandcode",
    summary:
      "Agents frequently need architectural decisions mid-task (e.g., grill-me prompts or ambiguity checks). Switchyard captures structured questions via MCP or automatic output detection, displays clickable choice pills right on the card, and resumes managed runs with session continuity.",
    sections: [
      {
        id: "hybrid-capture",
        heading: "Two Ways Questions Appear on Cards",
        bullets: [
          {
            label: "Explicit MCP / REST Call",
            detail: "Agents call ask_task_question (or POST /api/v1/tasks/{id}/questions) with question, options[], multi_select, and context.",
          },
          {
            label: "Auto-Detect Parser (DetectOpenQuestion)",
            detail: "Dispatcher scans worker output for ```question JSON blocks, [QUESTION]...[/QUESTION] tags, or trailing numbered/lettered dsh & commandcode choices.",
          },
        ],
      },
      {
        id: "dsh-commandcode-resume",
        heading: "Session Continuity & Auto-Resume",
        paragraphs: [
          "When you pick an option or enter a custom reply in the card UI, Switchyard records the decision on the task, appends an answer block, and calls ResumeWithAnswer for managed tasks.",
          "Bound session metadata (session_id, dsh_session_id, dsh_workspace_id, commandcode_session_id, last_turn_seq, and session_continuation: true) is forwarded to node-agent so dsh and commandcode resume in the same conversation context.",
        ],
        code: {
          label: "Fenced Question Convention for Workers",
          lang: "markdown",
          snippet:
            "```question\n{\n  \"question\": \"Which cache backend should we target?\",\n  \"options\": [\"In-memory LRU\", \"SQLite cache table\", \"Redis\"],\n  \"context\": \"Needed for model catalog responses\"\n}\n```",
        },
      },
    ],
  },
  {
    slug: "meta7-pipelines",
    title: "Pipelines & meta7 Coordinator",
    subtitle: "Deterministic multi-stage DAG workflows with formal design & verification gates.",
    category: "Agent Coordination & Harness",
    badge: "meta7",
    summary:
      "Switchyard pipelines expand structured YAML templates into parent/child tasks with strict dependency edges, optional workspace bindings, context files, skills, and automated retry/restart controls.",
    sections: [
      {
        id: "built-in-templates",
        heading: "Built-in Pipeline Templates",
        table: {
          headers: ["Template", "Focus", "Trigger Options"],
          rows: [
            ["design-thinking", "Research -> Empathize -> Ideate -> Prototype -> Validate", "Board action, TaskDialog, start_pipeline MCP"],
            ["meta7", "explore -> cross_examine -> synthesize -> design -> verify -> review -> impl (+ gate:*)", "TaskDialog (meta7 mode), Board menu, start_pipeline MCP"],
          ],
        },
      },
      {
        id: "launching-via-mcp",
        heading: "Launching meta7 via MCP",
        code: {
          label: "start_pipeline Full Context Payload",
          lang: "json",
          snippet:
            "{\n  \"template\": \"meta7\",\n  \"board_id\": \"default\",\n  \"goal\": \"Design and implement token rotation\",\n  \"project_name\": \"auth-rotation\",\n  \"workspace\": \"/path/to/repo\",\n  \"context\": \"Preserve backward compatibility with existing Bearer tokens.\",\n  \"executor\": \"claude\"\n}",
        },
      },
    ],
  },
  {
    slug: "flow-map",
    title: "Global Flow Map & Live Ping Telemetry",
    subtitle: "Cross-board live execution topology, dependency edges, and low-overhead workspace ping telemetry.",
    category: "Agent Coordination & Harness",
    badge: "Observability",
    summary:
      "The Flow Map (/api/v1/flow/active) aggregates live active runs, recent task transitions, pipelines, workspaces, and worker queues across every board into an interactive node graph with lightweight EKG ping status.",
    sections: [
      {
        id: "flow-windows",
        heading: "Time Windows & MCP Querying",
        paragraphs: [
          "Filter globally or scope to a single board using window values ('smart', '30m', '24h', '7d', 'all').",
          "MCP callers can inspect the exact topology returned to the UI via get_flow_map.",
        ],
        code: {
          label: "Query Global Flow Topology via REST",
          lang: "bash",
          snippet: "curl -H \"Authorization: Bearer $TOKEN\" \"http://localhost:8090/api/v1/flow/active?window=smart\"",
        },
      },
    ],
  },
  {
    slug: "mcp-server-setup",
    title: "MCP Server Setup & Auth Scopes",
    subtitle: "Connect Claude Code, dsh, commandcode, or Antigravity via stdio or HTTP /mcp.",
    category: "MCP & API Reference",
    badge: "MCP",
    summary:
      "Switchyard-Lite bundles both a local stdio MCP server (`switchyard-lite mcp`) and an authenticated Streamable HTTP endpoint (`POST/GET /mcp`). All 62 tools proxy straight through Switchyard's token-scoped REST handlers.",
    sections: [
      {
        id: "stdio-setup",
        heading: "1. Stdio Client Config (Local CLI Harnesses)",
        paragraphs: [
          "Create an API token with write or admin scope first, then point your MCP client configuration at the binary or HTTP endpoint.",
        ],
        code: {
          label: "Create Token & Stdio MCP Config",
          lang: "json",
          snippet:
            "// Terminal: switchyard-lite token create --name local-agent --scope write\n{\n  \"mcpServers\": {\n    \"switchyard-lite\": {\n      \"command\": \"switchyard-lite\",\n      \"args\": [\"mcp\"],\n      \"env\": {\n        \"SWITCHYARD_URL\": \"http://127.0.0.1:8090\",\n        \"SWITCHYARD_TOKEN\": \"syl_...\"\n      }\n    }\n  }\n}",
        },
      },
      {
        id: "http-setup",
        heading: "2. Streamable HTTP Endpoint (/mcp)",
        code: {
          label: "HTTP Transport Config",
          lang: "json",
          snippet:
            "{\n  \"mcpServers\": {\n    \"switchyard-lite\": {\n      \"type\": \"http\",\n      \"url\": \"http://127.0.0.1:8090/mcp\",\n      \"headers\": {\n        \"Authorization\": \"Bearer syl_...\"\n      }\n    }\n  }\n}",
        },
        callout: {
          tone: "warn",
          title: "Token Scopes Apply",
          body: "Tokens carry 'read', 'write', or 'admin' scopes. Worker registration/deletion tools require 'admin'; mutating task/pipeline/knowledge tools require 'write'.",
        },
      },
    ],
  },
  {
    slug: "mcp-tools-catalog",
    title: "Complete 62 MCP Tools Reference",
    subtitle: "Full feature parity across boards, tasks, passive tracking, retry, Grill-Me Q&A, pipelines, workspaces, and knowledge.",
    category: "MCP & API Reference",
    badge: "62 Tools",
    summary:
      "Every control-plane feature available in the Switchyard web UI is directly invokable by coding agents over MCP.",
    sections: [
      {
        id: "boards-tasks-tools",
        heading: "Boards, Tasks & Attachments",
        table: {
          headers: ["Tool", "Method & Endpoint", "Purpose"],
          rows: [
            ["list_boards / create_board", "GET/POST /api/v1/boards", "List or create boards"],
            ["update_board / delete_board", "PATCH/DELETE /api/v1/boards/{id}", "Rename board, set defaults, or remove board"],
            ["list_tasks / get_task", "GET /boards/{id}/tasks, /tasks/{id}", "List board tasks (by status) or inspect one card"],
            ["create_task / update_task / delete_task", "POST/PATCH/DELETE /api/v1/tasks", "Full CRUD including branch, execution_mode, paths, skills"],
            ["move_task / dispatch_task / retry_task", "POST /tasks/{id}/{move|dispatch|retry}", "Move columns, dispatch immediately, or reset & retry"],
            ["add_dependency / remove_dependency", "POST/DELETE /tasks/{id}/dependencies", "Wire or unwire DAG blockers with cycle checks"],
            ["list_comments / add_comment", "GET/POST /tasks/{id}/comments", "Read or post comments on a card"],
            ["list_attachments / add_attachment / delete_attachment", "GET/POST/DELETE /tasks/{id}/attachments", "Inspect or upload text/base64 attachments"],
          ],
        },
      },
      {
        id: "tracker-question-tools",
        heading: "Passive Tracker Mode & Grill-Me Questions",
        table: {
          headers: ["Tool", "Method & Endpoint", "Purpose"],
          rows: [
            ["start_tracked_task", "POST /api/v1/tasks/track/start", "Create/bind monitor-only tracker card (skipped by dispatcher)"],
            ["report_task_progress", "POST /api/v1/tasks/{id}/track/progress", "Append worker output, percent step, and optional comment"],
            ["complete_tracked_task", "POST /api/v1/tasks/{id}/track/complete", "Mark tracked card done, review, or failed with output"],
            ["ask_task_question", "POST /api/v1/tasks/{id}/questions", "Post interactive choice/grill-me prompt onto a card"],
            ["get_task_questions", "GET /api/v1/tasks/{id}/questions", "Poll for human answers chosen in Kanban UI"],
            ["answer_task_question", "POST /api/v1/tasks/{id}/questions/answer", "Record choice/reply and auto-resume managed sessions"],
            ["get_task_logs / get_task_runs / get_task_worktree", "GET /tasks/{id}/{logs|runs|worktree}", "Inspect live log stream, tracer runs, and git worktree"],
          ],
        },
      },
      {
        id: "review-pipeline-infra-tools",
        heading: "Review, Pipelines (meta7), Workspaces, Telemetry & Knowledge",
        table: {
          headers: ["Tool", "Method & Endpoint", "Purpose"],
          rows: [
            ["get_diff / approve_task / reject_task", "GET/POST /tasks/{id}/{diff|approve|reject}", "Review git diff against base SHA, approve, or requeue"],
            ["get_review_settings / set_review_settings", "GET/POST /api/v1/settings/review", "Toggle auto_merge on approval"],
            ["list_templates / get_default_template / set_default_template", "GET/POST /api/v1/pipelines/*", "Manage design-thinking vs meta7 default template"],
            ["list_pipelines / start_pipeline / get_pipeline_run / cancel_pipeline / retry_pipeline_node / restart_pipeline", "GET/POST /api/v1/pipelines/*", "Full lifecycle control of deterministic DAG pipelines"],
            ["list_workspaces / create_workspace / update_workspace / delete_workspace / sync_workspaces", "GET/POST/PATCH/DELETE /api/v1/workspaces*", "Manage and sync local/remote workspaces"],
            ["inspect_workspace / search_workspace_files / list_skills / list_models", "GET /workspaces/*, /skills, /models", "Git branches, file omnibox search, skills, and model catalogs"],
            ["list_workers / create_worker / delete_worker", "GET/POST/DELETE /api/v1/workers*", "Inspect or register node-agent workers (admin write/delete)"],
            ["get_flow_map / get_overview / read_logs / tail_events", "GET /flow/active, /overview, /logs, /events", "Global live graph topology, counters, server logs, event stream"],
            ["list_knowledge / get_knowledge / upsert_knowledge / delete_knowledge", "GET/POST/DELETE /api/v1/knowledge*", "Query and curate SQLite-backed custom Knowledge articles"],
          ],
        },
      },
    ],
  },
  {
    slug: "review-gate-worktrees",
    title: "Worktree Isolation & Review Gate",
    subtitle: "Per-task sy/<task-id> branches, diff inspection, and opt-in auto-merge.",
    category: "Operations & Security",
    badge: "Review",
    summary:
      "Every managed task targeting a git repository runs inside an isolated worktree so concurrent agents never stomp each other's working directory.",
    sections: [
      {
        id: "worktree-review",
        heading: "Approval vs Rejection Flow",
        bullets: [
          {
            label: "GET /api/v1/tasks/{id}/diff",
            detail: "Computes git diff from the recorded base SHA up to the task's sy/<task-id> worktree HEAD.",
          },
          {
            label: "Approve (approve_task)",
            detail: "Moves task to Done while preserving the branch, or merges into target when auto_merge is enabled.",
          },
          {
            label: "Reject (reject_task)",
            detail: "Appends reviewer feedback comment and requeues the card to Todo for the next worker run.",
          },
        ],
      },
    ],
  },
];
