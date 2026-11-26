# ADR-0005: Unified 2-Zone Editorial Shell, Inter + JetBrains Mono Typography & Persisted Board Emojis

- **Status**: Accepted
- **Date**: 2026-11-26

## Context
The previous Studio shell used detached floating glass islands (`gap: 10px`), boxed sidebar pods (`.side-top-pod`, `.nav-group`, `.side-footer`), `Space Grotesk` + `Plus Jakarta Sans` typography, and a 2-column boxed `TaskDialog` rail. To achieve a calmer, sharper editorial workspace inspired by modern tactile productivity apps while preserving full Light and Dark mode contrast and all SVG icons, we need a unified 2-zone window, cleaner sans + mono typographic hierarchy, and persisted per-board emojis.

## Decision
1. **Full-Bleed Unified 2-Zone Shell (`AppShell`)**:
   - Fill `100vw × 100dvh` edge-to-edge with zero outer padding or floating window gaps, split by a crisp `1px` vertical hairline between a `240px` flat navigation sidebar (`64px` collapsed) and the main stage (`AppInset`).
   - Top of the sidebar houses an interactive **Board Switcher Card** (pastel-tinted Board Emoji tile, board title, monospace subtitle, dropdown board switcher + `+ New board` + `Edit board`), followed by a recessed `Search ⌘K` pill, the scenic sky-blue `Compose task` CTA, and borderless hairline-grouped navigation (`General`, `Infrastructure`, `Observe`) with monospace group labels.
   - Every page renders a single shared `<StudioPageHeader />` flush at the top of `<AppMain>` (removing the redundant global breadcrumb bar above page headers).
2. **Typography (`Inter` + `JetBrains Mono`)**:
   - Standardize UI sans on `Inter` (`400`/`500`/`600`, `-0.02em` headings) and pair it with `JetBrains Mono` for counts, segmented tabs, sidebar group labels, subtitles, and timestamps.
3. **Persisted Board Emojis (`boards.emoji`)**:
   - Store `emoji TEXT NOT NULL DEFAULT ''` on `boards` in SQLite (`schema.sql` + additive `ALTER TABLE`), expose it in `GET/POST/PATCH /api/v1/boards`, and render it inside pastel `BoardEmojiTile` badges across the sidebar, `BoardSwitcher`, and Board header while keeping all functional UI icons as crisp SVGs.
4. **Single-Surface Task Composer & Flush Hairline Inspector**:
   - Consolidate `TaskDialog` into a single-canvas composer with a compact bottom routing/execution strip (Workspace, Branch, Executor, Model, Effort, MCPs, `Grill-Me First`).
   - Style `Drawer` and `TaskDetailPage` with flush `1px` hairline surfaces and `emil-design-eng` interaction physics (explicit transitions, `:active` `scale(0.97)`, instant `⌘K` palette, and `prefers-reduced-motion`).

## Consequences
- Cohesive editorial Light mode and high-contrast Dark mode under one token system.
- Every board has a memorable visual anchor via its persisted emoji without cluttering functional SVG navigation icons.
