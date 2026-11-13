# Switchyard Lite — Brand Identity & Tactile Capsule Design System (`v2.0`)

> **Style Contract #15:** Atmospheric Cloud Sky & Tactile Pill Telemetry (`Glass & Light + Tactile Capsule Plates`)
> **Declarative Source of Truth:** `brand/switchyard-lite.brand.json`
> **Token Stylesheet:** `web/src/tokens.css` & `web/public/brand/switchyard-lite/switchyard-lite-tokens.css`

---

## 1. Brand Premise & Visual Direction

**Switchyard Lite** is a standalone Go + SQLite + React/Vite control plane for coding agents. Based on the three concept references:
1. **Concept 1 (Tactile Pill & Capsule Micro-UI Kit):** Every interactive trigger—`Ask AI` prism gradient capsule, `Ella M. ×` porcelain avatar pill, `Upload` dashed drop-zone pill, `Filter · 2 | ×` tabular count capsule, 3-way recessed well toggle, `30 mins ⌄ [Book a Call]` compound action stepper, `● Online` mint pill, `◌ In progress` spinning dashed ring pill, and `Search [🔍]` recessed trough—shares a `999px` capsule silhouette with top specular inner highlights (`--lift-inset`).
2. **Concept 2 (Atmospheric Blueprint Sky & Double-Framed Stage):** Cool periwinkle-cloud sky canvas (`#F1F4FB`) with subtle `32px` blueprint hairlines, floating capsule navbar, tilted status stack (`Done`, `Need Review`, `In Progress`, `New Request`), and a double-bezel stage frame.
3. **Concept 3 (Glossy Obsidian Pill & Colored-Bar Kanban Shell):** Deep obsidian pill CTAs (`--grad-obsidian`) paired with crisp white Kanban columns topped by status-coded signal bars.

---

## 2. Three-Role Typography Stack

| Role | Family | Weights | Tracking & Features | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Display (`--font-display`)** | `Space Grotesk` | `600`, `700` | `-0.038em`, `ss01` | Hero headlines, board titles, section headers |
| **UI & Reading (`--font-sans`)** | `Plus Jakarta Sans` | `400`, `500`, `600`, `700` | `-0.011em`, `cv02` | Capsule buttons, select options, Kanban cards, body copy |
| **Telemetry (`--font-mono`)** | `JetBrains Mono` | `400`, `500`, `600`, `700` | `0em`, `tabular-nums`, `zero` | Worktree branches (`sy/<task-id>`), SHA hashes, lease timers, badges |

---

## 3. Layer 1 Primitives (`--sy-*`) & Measured Contrast Ledger

| Token | Hex | Role |
| :--- | :--- | :--- |
| `--sy-ground` | `#F1F4FB` | Atmospheric Cloud Sky canvas |
| `--sy-plate` | `#FFFFFF` | Pure Porcelain capsule & card plate |
| `--sy-well` | `#E4EAF7` | Recessed cool-sky well trough |
| `--sy-ink` | `#0D1526` | Deep Switchyard Obsidian primary ink |
| `--sy-slate` | `#4A5878` | Secondary technical slate ink |
| `--sy-muted` | `#8C9AB8` | Muted telemetry ink (non-text / decorative) |
| `--sy-line` | `#DCE3F4` | Crisp porcelain hairline border |
| `--sy-accent` | `#2F5BFF` | Royal Switch Cobalt primary signal |
| `--sy-coral` | `#FF8B6A` | Prism Warm Coral gradient stop & mark dot |
| `--sy-orchid` | `#D966FF` | Prism Electric Orchid gradient stop |
| `--sy-success` | `#13794B` | Online Emerald status text & lamp |
| `--sy-mint` | `#BCEFD4` | Soft Mint status pill wash |
| `--sy-warning` | `#965600` | Lease Amber review/warning signal |
| `--sy-danger` | `#C8322B` | Fault Crimson blocked/failed signal |
| `--sy-night` | `#080D1A` | Night Control Plane ground |

### Honest Contrast Audit & CVD Gate (`min ΔE_OK = 0.061 >= 0.045`)
- **9 Passing Text Pairs:** `ink on ground` (`16.32:1` AAA), `ink on plate` (`18.15:1` AAA), `slate on plate` (`7.08:1` AAA), `plate on accent` (`4.96:1` AA), `success on mint` (`4.51:1` AA), `warning on plate` (`5.76:1` AA), `danger on plate` (`5.63:1` AA), `plate on night` (`19.34:1` AAA), `accent on night` (`4.12:1` AA Large).
- **3 Published Decorative Fails (Forbidden for Body Text):**
  - `muted on ground` (`2.55:1` FAIL) — placeholder hints & dividers only.
  - `coral on plate` (`2.28:1` FAIL) — gradient stop in `--grad-prism` and signal dot on dark mark tile only.
  - `mint on plate` (`1.24:1` FAIL) — background wash for `Online` status capsule only; always pair with `--sy-success` (`#13794B`).

---

## 4. Mark & 6-Mark Companion Cast

- **Primary Mark ("The Parallel Turnout Switch"):** Constructed on a `64×64` grid (`web/public/brand/switchyard-lite/logo-mark.svg`). Lower through-track (`M10 38 H54 V50 H10 Z`) + upper turnout track (`M10 20 H25 L38 7 H54 V19 H42 L29 32 H10 Z`) separated by a `6-unit` air gap, with a coral lock dot (`cx=50, cy=29, r=3.5`).
- **Compact Favicon (`< 24px`):** Dedicated simplified geometry (`web/public/brand/switchyard-lite/logo-compact.svg`) automatically swapped by `<BrandMark size={16} />` in `web/src/components/ui/brand.tsx`.
- **6-Mark Companion Cast:** `cast-turnout.svg`, `cast-capsule.svg`, `cast-worktree.svg`, `cast-lease.svg`, `cast-diff.svg`, `cast-dag.svg`.

---

## 5. Base UI Components (`web/src/components/ui/`)

1. **`button.tsx` (`Button`, `buttonVariants`):**
   - `999px` capsule geometry (`rounded-full`) with `active:scale-[0.972]`.
   - Variants: `prism` / `gradient` (`Ask AI`), `obsidian` (`Book a Call`), `signal` (Royal Cobalt), `default` (Porcelain Plate), `secondary` (Recessed Well), `outline`, `dashed` (`Upload`), `ghost`, `destructive`, `link`.
   - Sizes: `xs` (`24px`), `sm` (`32px`), `default` (`36px`), `lg` (`44px`), plus icon sizes.
2. **`pill.tsx` (`Pill`, `StatusPill`, `FilterPill`, `AvatarChip`, `SearchField`, `CompoundActionPill`):**
   - Complete implementation of the Concept 1 tactile pill vocabulary.
3. **`select.tsx` & `search-select.tsx` (`Select`, `SearchSelect`):**
   - `999px` capsule trigger (`plate`, `well`, `ghost` variants) + `20px` frosted porcelain popover shell + `8px` viewport pad + `12px` concentric option rows (`R_outer 20 − S_pad 8 = R_inner 12`).
4. **`app-shell.tsx` (`AppShell`, `AppSidebar`, `AppSidebarBrand`, `AppSidebarGroup`, `AppSidebarItem`, `AppSidebarFooter`, `AppInset`, `AppHeader`, `AppMain`):**
   - 2-column collapsible control plane (`236px` / `64px`) over the atmospheric sky + `32px` blueprint grid, with capsule sidebar items and a `52px` glass top header.
