# ADR-0003: Warm Light Tactile Design System & Studio Shell Redesign

- **Status**: Accepted (Wave 3 Redesign)
- **Date**: 2026-11-26

## Context
The previous dark/glassy theme felt dense and generic. We want a calm, high-craft **Warm Light Tactile** primary design system inspired by modern editorial productivity apps (pure white dual-rail sidebar inside a softly framed atmospheric window, scenic blue CTA button, monospace metadata counters, hairline dividers, pastel illustrated avatars, and crisp light Kanban + Inbox/Triage views) while preserving a clean companion Dark mode.

## Decision
1. **Light-First Token System (`web/src/tokens.css` & `web/src/glass.css`)**:
   - Outer atmospheric backdrop (`/studio/frame-sky.png` with soft blur in light mode, deep obsidian sky in dark mode) framing a floating rounded Studio Shell (`rounded-[20px]` with crisp 1px outer bevel).
   - Dual-rail sidebar: narrow `56px` left icon dock (brand mark + pastel rounded-square mode/workspace shortcuts + `+` quick-create) paired with a crisp `228px` pure white navigation rail (Studio account card, `Search ⌘K` pill, scenic sky-blue `New task` CTA with `/studio/cta-scenic.png`, hairline-grouped `General` / `Workspaces` nav with soft `#F3F4F6` active pill).
   - Monospace metadata counters (`tabular-nums`), hairline `1px` `#EFEFEF` borders, pastel illustrated avatars (`/studio/avatar-agy.png`, `avatar-dsh.png`, `avatar-cmd.png`, `avatar-studio.png`), and light-first Kanban columns + new **Inbox / Triage** grouped feed (`Waiting Input`, `Today`, `Review`, `Earlier`).
2. **Dual-Density Workflow Tree & Single-Canvas Composer**:
   - Theme-adaptive dot-grid Workflow Tree canvas (light dot-grid in light mode, dark dot-grid in dark mode) in Task Detail/Drawer + compact tech-stack/skills/MCP strip on Kanban cards.
   - Streamlined single-canvas bottom-dock Task Composer with `⌘V` image paste, `@file`/`$skill` omnibox, inline subtasks, and bottom pill dock (`agy`/`dsh`/`cmd`, Model, Effort, MCPs, `Grill-Me`).

## Consequences
- Visually cohesive, unmistakable Studio identity that keeps Kanban fast while adding an effortless Inbox/Triage feed for open questions and reviews.
- All existing Vitest smoke assertions (zero native `<select>`, accessible roles/labels) remain strictly preserved.
