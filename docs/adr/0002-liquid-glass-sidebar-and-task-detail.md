# ADR 0002: Sunnyside Contract #19 Design System, Fluid Spring Sidebar Rail & Level 4 Task Detail Sheet

- **Status:** Accepted
- **Date:** 2026-11-22
- **Scope:** `brand/switchyard-lite.brand.json`, `web/public/brand.html`, `web/public/anatomy.html`, `design/`, `web/src/components/ui/app-shell.tsx`, `web/src/Drawer.tsx`, `web/src/components/board/TaskDetailPage.tsx`, `web/src/components/board/TaskDetailContent.tsx`, `web/src/components/board/taskDetailParts.tsx`

## Context

Following the Kanban board Liquid Glass upgrade ([ADR 0001](./0001-liquid-glass-kanban-system.md)), three remaining gaps created visual inconsistency across the control plane:

1. **Brand Spec Drift:** `brand/switchyard-lite.brand.json`, the Sunnyside showcase (`brand.html`), and the dimensional anatomy sheet (`anatomy.html`) still described the older v2.0 flat porcelain plates, prism gradient buttons, and `#8C9AB8` muted ink.
2. **Sidebar Collapse/Expand Friction:** Collapsing the left rail only lived in the outer header (`ShellToggle`), used an abrupt 180ms linear transition, hid pending badge counts completely in `64px` mode, and lacked a keyboard shortcut.
3. **Task Detail Popup & Page Contrast/Depth:** `TaskDrawer` used a narrow 560px opaque-ish container (`--glass-tint-dialog`), hid the `LifecycleStepper` inside the drawer, used a pink-purple prism gradient button for `"Dispatch now"`, and rendered detail sections as flat `12px` porcelain blocks rather than 3-level Liquid Glass cards.

## Decisions

1. **Sunnyside Contract #19 Alignment:**
   - Updated `brand/switchyard-lite.brand.json` to **Contract #19 Liquid Glass** (Rail A · Hero C · Dual Light/Dark polarity), recomputed 13 WCAG contrast pairs (including `4.76:1` AA for `#64748B` on `#FFFFFF` and 3 explicit graphic-only failing pairs), and verified CVD safety (`min ΔE_OK = 0.084 >= 0.045`).
   - Re-ran `forge.mjs` and `brand/render-board.mjs` (`3000×2250` 6-panel brandkit PNG) and synced `web/public/brand.html`, `design/brand.html`, `web/public/anatomy.html`, and `design/anatomy.html`.
2. **Fluid Spring Sidebar Rail (`220px ↔ 64px`):**
   - Added an in-rail `<AppSidebarToggle />` inside `.side-top-pod` and a global `⌘B` / `Ctrl+B` shortcut inside `AppShell`.
   - Upgraded grid transition to `260ms cubic-bezier(0.22, 1, 0.36, 1)` with fixed-axis `x = 32px` icon alignment, staggered label/badge clip-fade (`110ms` exit, `180ms + 45ms` enter), a `7px` collapsed badge dot indicator (`.nav-badge-dot`) on items with active counts, and a Level 3 active capsule with a `3px` progress indicator bar.
3. **Level 4 Task Detail Sheet & Unified Detail Stage:**
   - Upgraded `.drawer-panel` to `--glass-4` (`blur(24px) saturate(180%)`, `width: min(600px, 100%)`, `20px` radius) with spring slide-in animation.
   - Unified `TaskHeader` (`--glass-1` sticky glass + `.badge-retry` `retry X/3` + compact `LifecycleStepper` in both drawer and full page) and `TaskActions` (solid dark `#0F172A` / `#F8FAFC` `.btn.primary` replacing the prism gradient).
   - Upgraded `Section`, `FactTile`, and `TabsList` across `TaskDetailContent` and `TaskDetailPage` to Level 2/3 Liquid Glass depth and WCAG AA slate text tokens (`--text-primary`, `--text-secondary`, `--text-muted`).

## Consequences

- `brand/switchyard-lite.brand.json`, `web/src/glass.css`, `web/public/brand.html`, `web/public/anatomy.html`, and all live React views now share one single source of truth.
- Users can toggle the sidebar via the in-rail button, top header button, or `⌘B` without losing visibility into `Review` badge counts.
- Both Task Detail Popup (`Drawer`) and Full Detail Page present identical status semantics, lifecycle progress, and primary action contrast.
