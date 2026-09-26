# JBeam Forge — Progress

Phase status per SPEC §5. Update at the end of every phase: what's done, what's next, known issues, in-game test results.

Status values: `not started` · `in progress` · `awaiting in-game gate` · `done`

| # | Phase | Gate | Status |
|---|---|---|---|
| 1 | Foundations — scaffold, design tokens + component kit, logging/error boundaries, dockview shell, .jbforge versioning/migrations | — | done |
| 2 | Ground truth — install-dir setting, study-vehicle, docs/ format notes, lenient jbeam parser + serializer | — | done |
| 3 | Import + taxonomy — multi-format import, splitting, auto-classification, hierarchical tree, part details/variants, project system + startup | — | in progress (3a, 3b done) |
| 4 | Proxy generation — proxy engine, nodes/beams/tris, bracing, presets, attachments, refNodes | — | not started |
| 5 | Export v1 — full mod export with flexbodies + validator + debug-loop docs | **in-game** | not started |
| 6 | Physics sandbox — solver, pre-checks, predictor, scenarios, real-time mode | — | not started |
| 7 | Editing suite + Focus Mode + command palette + jbeam preview + mass overlay | — | not started |
| 8 | Materials — studio, editor, library, merge, drag-drop, game materials/wheels, UV/AO | — | not started |
| 9 | Hinges/latches wizard + sandbox hinge/yank tests | — | not started |
| 10 | Suspension — detection + kits, multi-config/multi-axle, brakes/racks/subframes, suspension-drop scenario | **in-game** | not started |
| 11 | Powertrain — engine/dyno, devices, meshes/variants, audio, props tool, cameras | **in-game** | not started |
| 12 | Capability layer — tuning vars, lights/electrics/plate, glass, aero, skins, hitch, nitrous, global controls | — | not started |
| 13 | Config Manager v2 + previews | — | not started |
| 14 | Publish helper + `npm run dist` installer + full regression script | — | not started |

## Phase log

### Phase 3 — Import + taxonomy (in progress)

Split into four sub-phases, each committed on its own: **3a** project system ✔ · **3b** import pipeline ✔ · **3c** taxonomy/classify/tree/assignment · **3d** splitting.

Decisions recorded with you:
- **Test model:** the in-game **Hirochi Sunburst** (`sunburst2.zip`). Its jbeam is a reference for how parts link, used only to measure our hierarchy and classifier. All generated data is built from scratch.
- **End goal:** an unpacked mod named **`test`** in the BeamNG mods folder, with a jbeam for every part. That's the Phase 5 target and in-game gate.
- **Import from mod folder** moves to after Phase 5.

**3b — Import pipeline (done)**
- **Formats:** DAE, FBX, OBJ+MTL, glTF (external buffers/images inlined), GLB and STL, all normalised to *loader space*.
  - World matrices are baked per mesh, with winding fixed for mirrored nodes.
  - Everything is converted to **BeamNG space** by the single `src/shared/coords.ts` module (+Z up, −Y forward, +X left).
  - The **Z-up fixture test** (SPEC §2) locks down node matrices, mirroring and duplicate names.
- **Textures** are decoupled from the loaders:
  - Main resolves references: the path as given, then name/stem + extension fallback across the model folder and "Locate folder…" folders. That's needed because official DAEs reference `.png` files while `.dds` ships, and they use absolute paths from BeamNG's build machine.
  - A new **DDS reader** handles BC1–BC5 and **BC7**, which three.js can't read and which every Sunburst texture uses.
- **Import dialog:** units presets or a custom value, up/forward axes, a live size readout, and plausibility advice with a one-click unit suggestion.
- **Viewport:** orbit camera, F/Home framing, BVH-accelerated hover/click picking, selection highlight, and disposal that never touches store-owned geometry.
- **Scene panel:** mesh list per source with filter, visibility, texture-issue popover (Locate folder…) and selection synced with the viewport. The status bar shows the triangle count.
- **Undo/redo and schema:** import is an undoable command. Source sync reloads geometry on open, undo/redo and texture-folder changes. Schema **v3** (per-source `textureDirs`, migrated from v2).
- **Access:** grants for project resources, with reads limited to model/texture extensions.
- **Sunburst smoke test** (local, `npm run extract-reference -- sunburst2` then `run-desktop --model=…`): **418 meshes, 325,961 triangles, 1.3 s import, 83 fps, 11/11 BC7 textures loaded.** Well inside the 15 s / 30 fps budget; no worker parser needed.
  - Known and expected: body paint comes from BeamNG's `materials.json`, not the DAE, so it renders white (Phase 8). Every part variant is shown overlapping until 3c classifies them.
- **Tests:** 332 unit tests. The harness has 14 scenarios (new: import fixture · dialog size readout · row/viewport selection · undo/redo reload from disk · consent-gated reload after relaunch · optional smoke model).
- **Code review fixes** (each with a regression test or harness assertion):
  - **Security:** a shared `.jbforge` could grant itself read access to any folder. Opening a project now auto-grants only folders inside its own folder. Others need a one-time **consent prompt**, remembered per project in `userData/trusted-folders.json`. `locateSource` never probes paths outside grants.
  - **Texture search:** the file budget is now per search root, so a model in a huge folder can't make "Locate folder…" useless. Found-but-unreadable textures (e.g. `../textures`) now count as *missing*, so Locate is offered.
  - **glTF** textures weren't loading under Electron (ImageBitmapLoader). Images now load as elements, and the texture pass honours each slot's `flipY` (glTF: false), including BC7 V-flip.
  - **COLLADA `.tga`** textures now reach the texture pass instead of silently rendering black.
  - Loads that finish after an undo or project close no longer resurrect a ghost source.
  - Reloads free materials and GPU textures, not just geometry.

**3a — Project system & startup (done)**
- `.jbforge` **v2** (first real migration; the v1 fixture still loads):
  - typed `sources` (import scale/axes), `splits` (triangle runs), `parts` (taxonomy id, display name, price, description, construction material, parent, variant);
  - `assignments` (mesh → part), `ignoredMeshes`, `customTaxonomy`.
- **Document store** with command-based **unlimited undo/redo** (immer patches). Dirty state is tracked against the saved history position.
- **Home screen:** New Mod / Open cards and Recent projects (thumbnail, relative time, missing-file badge, right-click Open / Show in folder / Remove).
- **New Mod wizard:** name → auto slug, brand, type, description; the author is remembered in settings.
- **File operations:** Open, Save, Save As, Close. Paths only ever come from dialogs, recents or earlier grants. The unsaved-changes prompt is Save / Don't save / Cancel, plus a native quit guard. The window title shows a • when there are unsaved changes.
- **Menus and toolbar:** the native File/Edit menus drive the renderer; undo/redo route to text fields or to the document. The toolbar File and Edit groups are live.
- **Tests:** 276 unit tests. The harness has 12 scenarios (new: home → wizard → editor · save/undo/redo/dirty · reopen from recents after relaunch · unsaved guard).
- **Code review fixes** (each with a regression test where testable):
  - An edit made while a save dialog was open was marked saved. The save now records the history position when the text is serialized.
  - A recent-list write failure no longer fails an open or save that had already succeeded.
  - Files that fail to parse no longer go into Recent.
  - The dock layout is flushed and detached when the editor unmounts, and an empty layout is never restored.
  - The wizard no longer erases the remembered author when settings load after it opens.
  - A rejected thumbnail keeps the previous one.


### Phase 2 — Ground truth (done 2026-09-26)

**Ground truth used:** BeamNG.drive **0.39.1.0** (build 20972), installed at `I:SteamLibrarysteamappscommonBeamNG.drive`. Reference vehicles: covet, pickup, etk800.

**Delivered**
- **BeamNG locations** (`src/main/beamng/locate.ts`):
  - The install is detected from `%LOCALAPPDATA%BeamNGBeamNG.drive.ini`, then Steam `libraryfolders.vdf`.
  - Validation checks for the exe and `content/vehicles`, and reports version, build and vehicle count.
  - The user folder is detected too.
  - Both are persisted as settings (additive; Phase 1 settings files still load). First run auto-configures when there's exactly one valid install.
- **Settings modal** (toolbar gear): install folder with Browse, Detect and live validation; the detected user folder; the debug-logging toggle. Main refuses to save an invalid install folder.
- **Lazy zip reader** (yauzl): zip64, streaming, traversal-safe extraction. `common.zip` is 4.2 GB and is never buffered.
- **Lenient jbeam parser, idiomatic serializer and table model** (`src/shared/jbeam/`).
  - The parser handles every quirk found in official content, including stray commas around colons and trailing commas after the root.
  - The serializer writes aligned, official-looking output that is strict JSON plus comments.
  - The table model covers header, option rows, per-row options and resets.
- **`npm run study-vehicle -- <name> [--common]`**: text files, DAE node names and `summary.json`, written to `scratch/` (gitignored).
- **`npm run jbeam:corpus`**: **5062/5062 official jbeam files** parse, round-trip exactly through lenient → serialize → strict, and serialize idempotently. 68,286 tables were read. It also generates `docs/beamng-section-catalogue.md` (344 sections, header variants).
- **Docs** (all evidence-based and re-verifiable):
  - `beamng-jbeam-syntax.md`
  - `beamng-vehicle-layout.md`
  - `beamng-reference-vehicle-notes.md` (old-build claims marked ✔/✘/➕)
  - `beamng-section-catalogue.md`
  - `testing-in-beamng.md` (in-game gate protocol for Phase 5)

**Key findings that change later phases**
- Write `slots2`, not `slots`. Legacy `slots` still ships in 52 vehicles, so the importer must read both.
- Flexbody meshes resolve against the vehicle's DAEs **and** `common.zip`, and can be `$=` expressions. The Phase 5 validator must handle both. Our own meshes must still resolve in our own DAE.
- `info.json` and `.pc` are not strict JSON, so parse everything leniently. A legacy flat `.pc` format still ships.
- `refNodes`: write the 6-column form. `slotType` may be an array.

**Code review fixes** (`/code-review`, before commit; each has a regression test):
- **Serializer:** commas were dropped when an earlier array element equalled the last one, which broke strict JSON. The comma is now decided by position.
- **Parser:** numbers longer than 64 characters were split into two values.
- **Zip reader:** concurrent first calls ran the central directory twice. The pending read is now cached.
- **Settings:** auto-detect could overwrite a folder the user saved during detection, and overlapping saves could lose fields. Updates are now serialized, with a read-modify-write step (`updateWith`).
- **Settings modal:** a stale validation could enable Save for a new path. Each result is now tied to the path it checked.
- **study-vehicle:** the output folder is created before the first write.
- **Startup:** the status message is skipped if the window has already closed.

**Verification:** `npm run typecheck` ✔ · `npm run lint` ✔ · `npm test` 225/225 ✔ · `npm run run-desktop` 9/9 ✔ (new: BeamNG auto-detect + Settings modal against a fake install) · `npm run jbeam:corpus` 5062/5062 ✔. No in-game gate: export output is unchanged.

**Next:** Phase 3 — Import + taxonomy.


### Phase 1 — Foundations (done 2026-09-26)

**Delivered**
- **Scaffold:** electron-vite (main/preload/renderer), Electron 44, React 19, TS 5.9 strict, Vite 7.
  - The renderer is sandboxed with context isolation and a strict CSP. `window.open` and navigation are blocked, and all permission requests are denied.
  - A typed IPC contract (`src/shared/ipc-contract.ts`) drives both the preload allowlist and the main handlers. Handlers check the sender and validate requests with zod.
- **Design system:**
  - `tokens.css`: every §4.17 token.
  - `tokens.ts`: typed access plus numeric resolution for three.js, Lucide and Radix.
  - `scripts/lint-tokens.mjs`: fails `npm run lint` on any hardcoded colour, size, duration or easing.
- **Component kit** (Radix primitives underneath): Button, IconButton, Input, NumberInput, Select, Checkbox, Toggle, Slider, Tabs, CollapsibleSection, TreeRow, Modal, Popover, Tooltip, Badge, Callout, ScrollArea, EmptyState. A dev-only Component Kit panel renders them all.
- **Logging and errors (§3.6):**
  - electron-log in main and renderer: 5 MB rotation, scoped loggers, persisted debug toggle.
  - Workers log through `logBridge` + `attachWorkerLogRelay`.
  - Global error hooks in main, renderer and workers. IPC failures are logged.
  - Root and per-panel ErrorBoundary. The error card offers copy diagnostics, reload and reset layout.
  - Guarded render loop and WebGL context-loss recovery.
  - Help menu: Open Log Folder, Copy Diagnostic Info, Debug Logging.
- **Shell:**
  - dockview themed from tokens with 32 px headers.
  - 40 px grouped toolbar. Actions from later phases are shown inert with a "coming in phase N" tooltip.
  - 26 px mono status bar with a sliding status message.
  - Presets Modelling / Materials / Testing, defined as data.
  - Layout persisted to `userData/layouts/current.json` (debounced, atomic), with fallback when a stored layout is corrupt or has unknown panels.
  - Viewport placeholder (three.js grid).
- **`.jbforge`:** zod schema v1 containing every §2 section, a migration runner, and deterministic serialization. Also a frozen fixture `tests/fixtures/jbforge/v1-empty.jbforge`, and `project:read`/`project:write` IPC. Writes are atomic and validated first.
- **Zustand discipline:** `EMPTY_ARR`/`EMPTY_OBJ`, `docs/zustand-rules.md`, and a custom ESLint rule `forge/no-fresh-selector-fallback`. react-hooks rules are errors.
- **Tooling:**
  - vitest: node + jsdom projects, 125 tests, snapshots for the project, settings and layout writers.
  - ESLint 9 with type-checked rules.
  - `npm run run-desktop`: Playwright Electron harness with 7 scenarios, screenshots in `artifacts/run-desktop/`. It fails on any unexpected console error or `[error]` line in main.log.

**Code review fixes** (`/code-review`, before commit):
- A second launch now exits before any startup: no settings load, IPC or window.
- Viewport remounts release their WebGL context (`forceContextLoss`), and the WebGL probe context is released and cached. A harness scenario (24 preset switches) proves Chromium's context cap is never hit. It failed before the fix.
- `SettingsService.update` persists before adopting the new value. A failed write leaves memory, listeners and the Debug Logging checkbox on the saved value.
- `NumberInput`: Enter without an edit no longer re-rounds the value.
- The review also flagged the CSP blocking React Refresh in dev. `npm run dev` was run and rendered normally, so no change.

**Verification:** `npm run typecheck` ✔ · `npm run lint` ✔ · `npm test` 127/127 ✔ · `npm run run-desktop` 8/8 ✔ (shell, kit, presets, panel-crash isolation, WebGL loss + fatal loop, WebGL context churn, worker logging, layout persistence across relaunch). Single-instance behaviour was checked manually. No in-game gate: export output is unchanged.

**Next:** Phase 2 — Ground truth (BeamNG install-dir setting, `npm run study-vehicle`, docs/ format notes, lenient jbeam parser + serializer with snapshot/round-trip tests).

## Known issues

- **Repo file layout (needs the user):** root `SPEC.md` and `docs/SPEC.md` both contain the Claude Code project instructions, which belong in `CLAUDE.md`. The full rebuild spec is at `%USERPROFILE%\Downloads\SPEC.md` and needs copying to `docs/SPEC.md`. Both files were left out of the Phase 1 commit until this is fixed.
- **npm 11 allow-scripts:** `package.json` → `allowScripts` approves Electron and esbuild. A `postinstall` (`install-electron`) fetches the Electron binary on a fresh clone.
- **Renderer bundle is ~3 MB** (three.js, Radix, dockview). That's acceptable for a desktop app. Revisit with code-splitting if startup becomes slow.
- The `project:*` IPC channels accept any absolute `*.jbforge` path. Phase 3 should route paths through native dialogs.
- The toolbar's Settings button is inert until Phase 2 adds the settings UI (install dir).
