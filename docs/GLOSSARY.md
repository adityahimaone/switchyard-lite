# Switchyard LITE — Domain & Design System Glossary

## UI & Liquid Glass Architecture

- **3-Level Glass Hierarchy:** Optical layering rule distinguishing structural chrome (`--glass-1` sidebar/topbar), transparent lane containers (`--glass-2` unblurred columns), and interactive work items (`--glass-3` frosted cards with specular top highlights). Popovers and modals occupy a fourth elevation tier (`--glass-4`).
- **Specular Highlight (`--glass-highlight`):** A `1px` inset top edge (`rgba(255, 255, 255, 0.80)` light / `0.14` dark) simulating light catching the chamfered top lip of glass cards and toolbars.
- **Mesh + Noise Ground (`--app-bg`):** A multi-stop radial + linear gradient paired with a subtle fractal SVG grain (`opacity: 0.032`) behind the stage so translucent surfaces remain perceptually distinct.
- **Board Scroll Mask (`.board-scroll`):** A right-edge CSS `mask-image` fade (`92% → 100%`) signaling horizontally off-screen columns (such as `Failed`), automatically cleared once scrolled to the end (`.at-end`).

## Kanban & Agent Dispatch Domain

- **Status Semantics (`StatusHeaderPill`):** Accessible status representation pairing a semantic icon, text label, `10%` tinted background, and tinted border across `Backlog`, `Todo`, `Blocked`, `In progress`, `Review`, `Done`, and `Failed`.
- **WIP Limit / Bottleneck (`REVIEW_WIP_LIMIT = 5`):** Soft concurrency threshold on the `Review` column (`5` tasks). Reaching or exceeding the limit surfaces an amber `X/5 WIP` bottleneck warning badge and column border tint.
- **Managed vs. Tracker Execution (`execution_mode`):**
  - `managed`: Task is eligible for automated dispatch (`POST /api/v1/tasks/{id}/dispatch`) and retry (`POST /api/v1/tasks/{id}/retry`).
  - `tracker`: Passive MCP monitor card (`monitor` badge) skipped by the dispatcher.
- **Meta7 Board Run (`Run board (N)`):** Launches an autonomous `meta7` pipeline coordinating all `N` eligible `todo`/`backlog` tasks on the active board that are not already part of a pipeline run.
- **Effort Priority Dot:** Card footer indicator derived from `task.effort` (`high` = red, `medium` = blue, `low` = slate), omitted when unset.
- **Retry Badge (`.badge-retry`):** Distinct amber telemetry pill (`retry X/3` with `RotateCcw` icon) separated from executor/workspace tags.

## Sidebar & Task Detail Ergonomics

- **Fluid Spring Rail (`220px ↔ 64px`):** Collapsible Level 1 glass sidebar dock animated via `260ms cubic-bezier(0.22, 1, 0.36, 1)` with fixed `x = 32px` icon centering, staggered label clip-fade, in-rail toggle (`AppSidebarToggle`), and `⌘B` keyboard shortcut.
- **Collapsed Badge Dot (`.nav-badge-dot`):** A `7px` status dot anchored to the top-right corner of `.nav-icon-wrap` that springs in when the sidebar collapses so pending counts (such as `Review`) remain visible without overflowing the `64px` rail.
- **Level 4 Detail Sheet (`.drawer-panel`):** Slide-over task popup (`--glass-4`, `0.92` alpha, `blur(24px)`, `min(600px, 100%)`, `20px` radius) housing a sticky Level 1 `TaskHeader`, compact `LifecycleStepper`, Level 2 tab trough, and Level 3 glass `Section` / `FactTile` plates.
- **Lifecycle Stepper (`LifecycleStepper`):** Inline 5-stage progress strip (`Backlog → Todo → In progress → Review → Done`, plus off-track `Blocked` / `Failed` pill) rendered in both the slide-over Task Drawer and the full Task Detail Page.

