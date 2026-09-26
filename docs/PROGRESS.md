# JBeam Forge — Progress

Phase status per SPEC §5. Update at the end of every phase: what's done, what's next, known issues, in-game test results.

Status values: `not started` · `in progress` · `awaiting in-game gate` · `done`

| # | Phase | Gate | Status |
|---|---|---|---|
| 1 | Foundations — scaffold, design tokens + component kit, logging/error boundaries, dockview shell, .jbforge versioning/migrations | — | done |
| 2 | Ground truth — install-dir setting, study-vehicle, docs/ format notes, lenient jbeam parser + serializer | — | done |
| 3 | Import + taxonomy — multi-format import, splitting, auto-classification, hierarchical tree, part details/variants, project system + startup | — | done |
| 4 | Proxy generation — proxy engine, nodes/beams/tris, bracing, presets, attachments, refNodes | — | done |
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

### Phase 4 — Proxy generation (done)

Plan recorded here: you asked me to keep going without stopping, so no approval pause. Built in three steps: **4a** proxy engine · **4b** derivation · **4c** UI.

**Ground truth first:**
- New `npm run study-structure -- sunburst2` measures the official Sunburst's structure (aggregates only): beam presets per part kind, node weights, beam lengths, attachment beams, breakGroups, node naming, and parts without own nodes.
- It also calibrates the stability predictor. Findings and design are in **`docs/proxy-generation.md`**.
- Where SPEC §4.4's remembered numbers differ, the measurement wins:
  - the body shell spring is 1.2e6 (SPEC said 2–4M, which is suspension);
  - light nodes are normal (the warning is at 0.25 kg, not 0.5);
  - ω·Δt limits come from official content (ok ≤ 2.5, unstable > 4), not the textbook < 2.

**4a — Proxy engine** (`src/shared/proxy/`, pure, unit-tested):
- **Shapes:**
  - meshoptimizer decimation (WASM; border-locked when the budget allows, then unlocked, pruned, vertex-clustered, and finally a hull, so budgets always hold);
  - convex hull (three's ConvexHull, then decimated);
  - PCA box and cylinder fits.
- **Quality pass:** sliver/duplicate removal, short-edge collapse, conforming long-edge subdivision (longest first, capped), coherent outward winding, inset along normals.
- **Symmetry:** left half → mirror → weld seam, giving exact l/r twins.
- **CSP:** gains `'wasm-unsafe-eval'` (WebAssembly compilation only, no JS eval).

**4b — Derivation:**
- **Nodes:** vertices → nodes named `<prefix><fore tag><n><l|r>`. Mirror twins share `n`, ids are unique vehicle-wide, and variants of one slot share names.
- **Beams and triangles:** edges → beams, faces → collision triangles.
- **Bending braces:** opposite vertices of adjacent triangles; heavy density adds volumetric links.
- **Weights:** spread evenly from the part's target mass (taxonomy × construction material, overridable).
- **Measured beam presets:** a new `mechanical_block` for engine/gearbox/diff and `mechanical_light` for radiators, exhausts and tanks.
- **Attachment styles:** bolted/clipped/rivets/welded, measured.
  - Children attach to their parent's nearest nodes; openables get none (hinges, Phase 9).
  - Parts far from their parent attach minimally, with a warning.
- **Structure roles:** parts that ride on their parent (106 official examples) or that the suspension builds (Phase 10) get no proxy.
- **Mass-capped node counts**, a stability predictor with concrete fixes, and refNodes placed on the body.
- **Schema:** `nodes`/`beams`/`tris`/`proxy` got real schemas. They were always-empty placeholders, so no migration was needed. New projects write `proxy: {parts: {}, refNodes: null}`.

**4c — UI:**
- **Toolbar:** Generate (all parts), plus View toggles for mesh and nodes & beams (persisted).
- **Inspector → Structure:** role, proxy mode, a Detail slider with live node/beam/triangle counts (runs the real build), bracing, attachment, target mass, symmetry, advanced (min feature, max beam, inset), stability verdict, warnings, Generate/Regenerate/Clear.
- **Viewport:** instanced node spheres and colour-coded beam lines.
- **Status bar:** live nodes / beams / collision triangles / kg.
- Deleting or merging a part drops its structure. Generation is one undo step.

**Whole-Sunburst result** (every part and variant):
- 196 parts with own structure → **2,480 nodes, 11,180 beams, 3,227 triangles in 2.2 s**. The official car has 2,773 nodes across all variants.
- **0 unstable, 1 marginal.**
- The first run found 100 unstable parts and 13.5 s. Fixes: structure roles, mass caps, the light-mechanical preset, fragmented-mesh fallbacks, and plain-copy generation.

**Tests:** 426 unit tests. The harness has 17 scenarios (new: generate body/engine/bumper from the merged-boxes fixture, overlay, view toggles, status bar, undo/redo). The Sunburst smoke test now generates the whole car and asserts unique ids and zero dangling references.

**Carried to later phases:** refNodes and nodes are editable in Phase 7; riders' flexbodies use the parent's node group at export (Phase 5); suspension-role parts are built in Phase 10.

### Phase 3 — Import + taxonomy (done)

Split into four sub-phases, each committed on its own: **3a** project system ✔ · **3b** import pipeline ✔ · **3c** taxonomy/classify/tree/assignment ✔ · **3d** splitting ✔.

Decisions recorded with you:
- **Test model:** the in-game **Hirochi Sunburst** (`sunburst2.zip`). Its jbeam is a reference for how parts link, used only to measure our hierarchy and classifier. All generated data is built from scratch.
- **End goal:** an unpacked mod named **`test`** in the BeamNG mods folder, with a jbeam for every part. That's the Phase 5 target and in-game gate.
- **Import from mod folder** moves to after Phase 5.

**3d — Mesh splitting (done)**
- **Non-destructive splits.** Each split carves triangles out of a mesh (which may itself be a split result) into a new mesh.
  - Splits are stored in the document as `[start, count]` triangle runs and re-applied in order whenever sources load, splits change, or you undo/redo.
  - Split meshes **share the source's vertex attributes** and only own an index. UVs, normals, colours and material groups are preserved exactly, with no copies.
  - Their bounds are computed from their own vertices.
  - Disposal detaches shared attributes so GPU buffers aren't freed under the source.
  - A split that no longer fits (model changed on disk) is reported, not fatal.
- **Picking:** the BVH is now built with `indirect: true`, so it never reorders the index. Stored triangle numbers stay valid; a regression test covers this.
- **Algorithms** (`src/shared/mesh/split.ts`, pure, unit-tested):
  - spatial-hash vertex welding (sees through UV seams);
  - edge adjacency and connected components;
  - flood fill with an angle limit and/or radius;
  - plane side;
  - box/lasso point-in-polygon on projected centroids;
  - run encoding.
- **One-click connected-pieces split.** The largest piece keeps the original name. Later pieces are renumbered into the remainder with a Fenwick tree (O(n log n)); this was a bug caught by the harness.
- **Face-selection tool** (floating viewport toolbar):
  - **Fill** (click, angle limit), **Box** and **Lasso** (select through the mesh), **Paint** (brush radius), **Plane cut** (axis, position slider with a live translucent plane, flip).
  - Shift adds, Ctrl subtracts. Right-drag orbits while a gesture tool is active. Enter splits off, Esc cancels.
  - The tool closes by itself if its mesh goes away (undo, close).
- **Split results flow straight into assignment:** the Assign dialog opens on the new mesh, and pieces inherit their parent's part. "Merge back into original" removes a split and every split made from it.
- **Not in 3d:** the DAE writer that converts non-DAE imports and split results for export ships with the exporter in Phase 5, as planned.
- **Tests:** 403 unit tests. The harness has 16 scenarios (new: merged-boxes OBJ fixture → connected split → undo/redo → plane-cut tool → assign prompt → save → reopen with splits re-applied).

**3c — Taxonomy, auto-classify, scene tree, assignment, part details (done)**
- **Taxonomy:** 132 part *kinds*, generated by `npm run build-taxonomy` into `src/shared/taxonomy/taxonomy.json` and zod-validated.
  - Each kind has a position axis (none / F-R / L-R / four corners). The axis resolves BeamNG's ambiguous `R`.
  - Integrity tests: unique ids, slotTypes and node prefixes; parents exist; no cycles; one root (body).
  - **Layers:** shipped < `userData/user-taxonomy.json` (main service; validated against the merged tree before writing) < project `customTaxonomy`.
- **Auto-classify** (`src/shared/taxonomy/tokenize.ts`, `classify.ts`; pure):
  - Tokenising: vehicle-prefix stripping, compound splitting (`lowerarm`, `doorglass`), misspelling synonyms plus one-typo fuzzy matching, and axis-aware positions. Variant words become variants; piece words and glued piece numbers merge.
  - Scoring is IDF-weighted phrase coverage with a head-noun tie-break. Ancestor context counts as explained (`bumper_custom_splitter` → splitter).
  - `proposeParts` groups meshes into parts, links variants to their base, and resolves parents by taxonomy + position compatibility. A mirror goes to the front door, and `R` means rear on a bumper but right on a light.
- **Benchmark** `npm run classify:bench -- sunburst2`:
  - **99 % kind / 98 % kind+position** agreement on 100 hand-labelled Sunburst names. The labels are our own; names only are committed.
  - **98.3 % coverage of all 418 names** (local study).
  - The regression test enforces ≥ 95 %.
- **Import flow:** a summary modal (detected / low confidence / unassigned / per-category counts) appears after each import. Applying it is one undo step.
- **Scene tree:**
  - The part hierarchy is rooted at the body: meshes under their part, variants badged after their base, then *Unassigned* and *Ignored* (greyed) groups.
  - Category colour dots, subtree mesh counts, and search that auto-expands to hits.
  - Drag a part to reparent it (cycle-guarded); drag meshes onto a part or group to assign, unassign or ignore.
  - Hide/show a whole branch, and viewport ↔ tree highlighting: a viewport pick reveals and scrolls to the row.
- **Assignment:**
  - A search-first fuzzy dialog (existing parts + part types; keyboard driven), then position and variant.
  - **Auto position by bounding box** (4 door glasses → FL/FR/RL/RR).
  - A right-click cascading **Category → Subcategory → Part → Position** menu, built lazily.
  - Merge into, duplicate as variant, delete, and ignore/restore.
  - **Add Custom Part** (name, category, parent, positions, beam preset, mass, openable; saved for this project or all projects; unique id and node prefix generated).
- **Inspector part details:** in-game display name, part name, price, description, position, "attached to" (cycle-safe list), construction material (mass multiplier + beam-preset default for Phase 4), variants list, duplicate as variant, delete. Every edit is an undoable command.
- **Docs:** `docs/part-naming-conventions.md`.
- **Sunburst smoke test:** 411 of 418 meshes auto-assigned to **285 parts** (335 confident, 76 low confidence, 7 unassigned); import 1.3 s, 84 fps.
- **Tests:** 383 unit tests (new: tokenizer, classifier + fixture agreement, part ops, tree model, fuzzy matcher, custom kinds, user-taxonomy service, renderer commands/tree/inspector). The harness has 15 scenarios (new: auto-classify · assign dialog · inspector rename · drag-reparent + cycle refusal · undo · parts persisted across relaunch).
- **Review fixes:**
  - A pending auto-classify offer is dropped once its source or project is gone, with a regression test.
  - Moving meshes to Unassigned is one undo step.
  - The large context menu is built only when opened.
  - Inspector drafts refresh after an undo.

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

**Next:** Phase 5 — Export v1 + in-game gate.


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
