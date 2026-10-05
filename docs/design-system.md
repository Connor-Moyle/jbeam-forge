# Design system (SPEC §4.17)

Dark, professional 3D-tool aesthetic (references: Blender 4, Linear, Figma). Anti-goals: glassmorphism, decorative gradients, glows.

## Tokens

`src/renderer/ui/tokens.css` is the **only** renderer file allowed to contain raw colours, sizes, radii, durations or easings. `npm run lint` runs `scripts/lint-tokens.mjs`, which fails the build on any hardcoded value elsewhere. The escape hatch is a trailing `token-lint-ignore: <reason>` comment; the reason is mandatory.

| Group | Tokens |
|---|---|
| Surfaces | `--bg-0` `#0e0f12` (app/viewport) → `--bg-4` `#2a2f38` (active, popovers) |
| Lines | `--border-0` hairline, `--border-1` controls, `--border-2` hover/strong |
| Text | `--text-0` primary, `--text-1` secondary, `--text-2` tertiary/disabled, `--text-on-accent` |
| Accent | `--accent` `#4f8ef7`, `-hover`, `-press`, `-dim`, `-ring` |
| Semantic | `--success`, `--warning`, `--danger` (+ `-dim`) |
| Spacing | `--space-1..8` = 4, 8, 12, 16, 20, 24, 32, 40 px (+ `--space-half`) |
| Radius | `--radius-sm` 4, `--radius-md` 6, `--radius-lg` 10, `--radius-full` |
| Shadow | `--shadow-float`, `--shadow-modal`: **floating elements only**. Panels use borders. |
| Motion | `--dur-fast` 100, `--dur-base` 160, `--dur-slow` 240 ms, `--ease` `cubic-bezier(0.2,0,0,1)`; zeroed under `prefers-reduced-motion` |
| Type | Inter (bundled Latin woff2) + mono stack; `--text-label` 11 (caps), `--text-control` 12, `--text-panel-title` 13, `--text-modal-title` 15 |
| Sizes | control 28, tree row 26, toolbar 40, panel header 32, status bar 26 |

From TS: `cssVar('accent')` gives inline-style references. `resolveToken()` / `numericToken()` give concrete values for three.js, canvas, Lucide `size` and Radix delays. The native window background (`src/shared/window-chrome.ts`) is test-locked to `--bg-0`.

## Components — one canonical component each (`src/renderer/ui`)

| Component | Notes |
|---|---|
| `Button` | 28 px; `default` / `primary` (**one per view**) / `ghost` / `danger`; `sm` size; optional Lucide icon |
| `IconButton` | Always tooltipped + `aria-label` (label is required); `active` → `aria-pressed` |
| `Input`, `NumberInput` | 28 px, accent focus ring; `NumberInput` is mono/tabular, commits on Enter/blur, Esc reverts, ↑/↓ step (Shift ×10) |
| `Select` | Radix select on a floating surface |
| `Checkbox`, `Toggle` | Custom-drawn; labels are clickable |
| `Slider` | Accent track, value bubble while dragging, `onCommit` for undo-friendly commits |
| `Tabs` + `TabPanel` | Accent underline |
| `CollapsibleSection` | Caps header; open state remembered per `id` |
| `TreeRow` | 26 px; hover-reveal actions; accent-dim selection + left bar; ←/→ collapse/expand, Enter activates |
| `Modal` | Scale-in + backdrop fade; focuses the dialog itself on open |
| `Popover`, `Tooltip` | Tooltip delay 300 ms; shortcut hint in mono |
| `Badge` | Tones: neutral/accent/success/warning/danger; `mono` for counts |
| `Callout` | Accent-dim left border; long text behind "ⓘ more"; `danger` uses `role="alert"` |
| `ScrollArea` | Overlay-style thin scrollbars (global styling in `base.css`) |
| `EmptyState` | Icon + one line + at most one action. Use it for every empty panel. |

The **Component Kit** panel (dev/harness only: toolbar grid icon) renders every component in every state. The run-desktop harness screenshots it on every run.

## Chrome

The window keeps one shape in every workspace: the 3D view in the middle, what you pick from on the left, what you change on the right.

- 40 px toolbar, grouped with dividers. Left: File (new, open, import, save), Edit (undo, redo), Build (Generate with its options, Test). Right: the output panels (JBeam file, test results), Finish (Configurations, primary Export), App (downloads, help, settings). The steps of a mod (Generate, Test, Configurations, Export) keep their words; everything else is an icon with a tooltip.
- Workspace tabs under the toolbar, in the order a car comes together: Parts, Modelling, Materials, JBeam, Suspension, Engine, Moving parts, Triggers, Scripts, Testing.
- The 3D view has its own header strip: Edit nodes on the left; mesh, nodes and beams, X-ray and the material channel on the right. Nothing that changes what the view draws lives on the main toolbar.
- The Properties column (`src/renderer/shell/PropertiesPanel.tsx`, tabs in `propertyTabs.ts`) is one dock panel with a strip of icon tabs down its side, like Blender's: Inspector · Materials, Paints, Skin studio · Suspension, Engine & gearbox · Configurations, Extras · Objects, Reference car. A tool that works on the car or the picked part is a tab here, never a panel of its own, so opening one can't squeeze another. The column widens to what the tab needs. Picking the tab that's showing goes back to the Inspector.
- Output panels (JBeam file, test results, script test) open under the 3D view and share one strip.
- dockview themed entirely from tokens (`src/renderer/shell/DockShell.css`), with 32 px panel headers.
- 26 px mono status bar: nodes / beams / tris / mass / mode, plus a sliding status-message slot.
- Floating viewport pills (e.g. "Graphics context lost — recovering…").
- Lucide icons only. No unicode-glyph buttons.
