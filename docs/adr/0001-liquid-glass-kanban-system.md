# ADR 0001: 3-Level Liquid Glass Kanban Hierarchy & Contrast Tokens

- **Status:** Accepted
- **Date:** 2026-11-22
- **Scope:** `web/src/glass.css`, `web/src/tokens.css`, `web/src/styles.css`, `web/src/Board.tsx`, `web/src/App.tsx`, `web/src/ui.tsx`

## Context

The previous Kanban surface layered translucent white/well fills (`--c-well`, `--c-surface`) over a pale cloud sky background. Because the sidebar, stage inset, column wells, and cards shared similar opacity and blur levels—and the stage container itself applied an opaque-tinted wash—visual hierarchy collapsed:

1. Glass refraction was nearly invisible against a flat pale-blue backdrop.
2. Secondary and metadata copy (`--sy-muted` / `--c-ink-4`, `#8c9ab8`) dropped below WCAG AA contrast on light plates.
3. The pink-purple prism gradient `"New task"` button clashed with the calm palette, and two search triggers (`AppHeader` `⌘K` + Board filter input) created topbar redundancy.
4. Horizontal overflow obscured the `Failed` column without a visual scroll hint, and the empty `In progress` column left a dead blank void.

## Decisions

1. **Strict 3-Level Optical Glass Depth (+ Level 4 Popovers):**
   - **Level 1 (`--glass-1`, `0.80` light / `0.78` dark, `blur(20px) saturate(180%)`):** Sidebar dock and Topbar headers—most solid structural chrome.
   - **Level 2 (`--glass-2`, `0.38` light / `0.42` dark, NO `backdrop-filter`):** Kanban columns—most transparent, sitting directly over the visible mesh gradient (`--app-bg`) and SVG noise grain so depth reads immediately while avoiding expensive per-column blur passes.
   - **Level 3 (`--glass-3`, `0.85` light / `0.82` dark, `blur(16px) saturate(160%)`):** Task cards—crisp, readable plates with `1px` top specular highlight (`--glass-highlight`), `1px` glass edge border (`--glass-border`), and hover lift.
   - **Level 4 (`--glass-4`, `0.92`, `blur(24px) saturate(180%)`):** Popovers, menus, and dialogs.
2. **Performance Guardrails:**
   - Columns intentionally omit `backdrop-filter`.
   - Active drag sets `.is-dragging` and `data-dragging="true"` on `.board`, disabling `backdrop-filter` on cards during drag to keep pointer tracking at 60fps.
   - All motion honors `@media (prefers-reduced-motion: reduce)`.
3. **WCAG AA Text Hierarchy:**
   - Locked primary (`#0F172A` / `#F8FAFC`), secondary (`#475569` / `#CBD5E1`), and muted (`#64748B` / `#94A3B8`) ink tokens; replaced `slate-400` / `--c-ink-4` body text usages on cards.
4. **Topbar Unification & Actionable Kanban Ergonomics:**
   - Hide the duplicate `AppHeader` search button on the `board` route while keeping `⌘K` active globally and displaying `/` + `⌘K` hints in the single board search bar.
   - Replace the gradient `"New task"` button with a solid dark glass-consistent primary CTA (`--glass-btn-primary-bg`), and rename `"Run board with meta7 N"` to `"Run board (N)"`.
   - Add a `5`-task WIP bottleneck indicator on `Review`, an actionable `"Run next task"` CTA + drag hint in empty `In progress`, and a right-edge `.board-scroll` fade mask revealing the `Failed` column.

## Consequences

- `main.bleed` and `.shell-inset` remain transparent on the Board view so `--app-bg` mesh gradient and fine noise refract cleanly through Level 2 columns and Level 3 cards.
- All status headers and badges use icon + label + tinted background (`10%` color) + tinted border (`StatusHeaderPill`), eliminating color-only status cues.
- Dark mode uses dedicated slate-tinted glass alphas (`rgba(15, 23, 42, 0.78)` / `rgba(30, 41, 59, 0.82)`) rather than inverted white fills.
