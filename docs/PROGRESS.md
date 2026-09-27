# JBeam Forge — Progress

Phase status per SPEC §5. Update at the end of every phase: what's done, what's next, known issues, in-game test results.

Status values: `not started` · `in progress` · `awaiting in-game gate` · `done`

| # | Phase | Gate | Status |
|---|---|---|---|
| 1 | Foundations — scaffold, design tokens + component kit, logging/error boundaries, dockview shell, .jbforge versioning/migrations | — | done |
| 2 | Ground truth — install-dir setting, study-vehicle, docs/ format notes, lenient jbeam parser + serializer | — | done |
| 3 | Import + taxonomy — multi-format import, splitting, auto-classification, hierarchical tree, part details/variants, project system + startup | — | done |
| 4 | Proxy generation — proxy engine, nodes/beams/tris, bracing, presets, attachments, refNodes | — | done |
| 5 | Export v1 — full mod export with flexbodies + validator + debug-loop docs | **in-game** | awaiting in-game gate |
| 6 | Physics sandbox — solver, pre-checks, predictor, scenarios, real-time mode | — | done |
| 7 | Editing suite + Focus Mode + command palette + jbeam preview + mass overlay | — | done (0.7.0) |
| 8 | Materials — studio, editor, library, merge, drag-drop, game materials/wheels, UV/AO | — | done (0.8.0); UV/AO in 0.8.x |
| 9 | Hinges/latches wizard + sandbox hinge/yank tests | — | in progress (9a model/export, 9b Inspector section in 0.8.5) |
| 10 | Suspension — detection + kits, multi-config/multi-axle, brakes/racks/subframes, suspension-drop scenario | **in-game** | in progress (10a/b in 0.9.0: workshop, sets, transplant, tuning) |
| 11 | Powertrain — engine/dyno, devices, meshes/variants, audio, props tool, cameras | **in-game** | in progress (11a in 0.10.0: engine/gearbox workshop, dyno chart, transplant, tuning) |
| 12 | Capability layer — tuning vars, lights/electrics/plate, glass, aero, skins, hitch, nitrous, global controls | — | not started |
| 13 | Config Manager v2 + previews | — | not started |
| 14 | Publish helper + `npm run dist` installer + full regression script | — | installer done early (see Releases) |

## Roadmap from your feedback (2026-09-27)

You asked to continue past the Phase 5 in-game gate. It stays open: every export-affecting phase still needs your in-game check. Each request below is assigned to the phase that builds it:

| Your request | Phase |
|---|---|
| Node/beam generation still not accurate enough: revisit | 7 (editing suite); proxy tuning continues |
| Selected part focus: all other parts transparent (a setting) | 7 (Part Focus Mode) |
| Slot menus broken into logical categories (Main body → Doors → Front doors → Front right door → FR door card) | 7 (scene tree grouping) + 13 |
| Auto-import every material and texture; export them in BeamNG's format | 8 |
| Materials tab: extreme adjustment and creation, full PBR plus everything BeamNG's material system supports, a library of presets | 8 |
| Hinges: location, pivot range, speed, latch position, handle/button trigger | 9 |
| Suspension: a default library imported from **every** BeamNG vehicle's suspension; place any number of axles/steering sets (trucks with 2 steered front axles + 3 rear axles…); swap any suspension part's mesh for your own | 10 |
| Engine builder: multiple engines, block mesh, NA/turbo/supercharger with their own meshes, animated parts (fans, pulleys), displacement, dyno chart, every official engine sound with preview, run the engine in-app through the rev range, all audio controls BeamNG offers (pitch, whine, backfire…) | 11 |
| Tuning parts: ECUs, bottom ends, turbos, exhausts, flywheels, nitrous, camshafts, pistons…, each with every adjustable setting (weight, power/torque added, torque/HP limits before breaking, thermals, max RPM…) | 11 + 12 |
| Gearbox and driveline builders in the same style | 11 |
| Per-setting "adjustable in game" tick box with min/max | 12 |
| Weights and prices automated to BeamNG-sensible values, user-adjustable | 7 (derived defaults) + 13 (rollups) |
| Part selector laid out like BeamNG's in-game parts menu, so modders see how it will look | 13 |

## Releases

Every finished phase ships as a Windows installer and a portable exe on GitHub Releases (`npm run release`, notes in `docs/releases/`).

| Version | Contents |
|---|---|
| 0.6.0 | Phases 1–6 plus the grouped scene tree |
| 0.10.0 | G/R/S gizmo; engine & gearbox workshop (Phase 11a, format v12) with jbeam transplant; own meshes on fitted suspensions; textures on game parts; Test Mode car mesh + isolate |
| 0.9.0 | Suspension workshop (Phase 10a/b): axles (format v11), Type → Brand → Car picker over 145 sets cut from the install, fit complete sets, jbeam transplant on export, tuning page |
| 0.8.5 | Per-mesh move/turn/resize + mirror copies + per-mesh texture mapping (format v10), Inspector material quick edits, objects placed by corner, hinge section (9b), AC helper meshes hidden + gloss maps |
| 0.8.4 | Library folders scanned at startup (your own materials and objects); 1,030 suspension/brake/steering parts cut from your BeamNG install into the objects library |
| 0.8.3 | Assetto Corsa import: kn5 models, whole car folders (skins, data/ or data.acd, ui, extension), Reference car panel, painted liveries; kn5 dashes in the objects library |
| 0.8.2 | Objects library (58 calipers and discs, rendered previews, separate download); model placement (position/rotation/scale) |
| 0.8.1 | Materials pack built in (284 materials from the user's library, consistent names, textures) + separate pack download; viewport reflections; pack import |
| 0.8.0 | Phase 8: materials in the project, full editor, 34 presets + personal library + .jbmat, duplicate merge, drag-and-drop |
| 0.7.1 | Friendly mesh names from parts, model re-export (.glb/.dae), centre-line split, name-vs-position check, fix for pre-0.7.1 FBX projects |
| 0.7.0 | Phase 7: editing, focus mode, palette, jbeam preview, balance, undo across saves, automatic prices, better FBX/Blender import |

## Phase log

### Between phases: objects library and Assetto Corsa import (0.8.2–0.8.3)

**Objects library (0.8.2):**
- `npm run build-object-pack -- "Objects Libary"` builds `packs/objects/` (bundled as `resources/objects-pack`) and `JBeam-Forge-Objects-<version>.zip`.
  - Keeps LOD0 and splits packed NAO/ORM textures into separate maps.
  - Untextured calipers get gloss red and discs cast iron.
  - Names follow one pattern: `Brembo 03`, `AP Lockheed 01`.
- **Objects panel:** rendered previews, search and category filter. **Add** brings an object in as its own model with its material.
- **Placement** (project format v8): position, rotation and scale per model, from the Scene tree's right-click menu. It moves the loaded geometry directly, with no reload, and is undoable.

**Assetto Corsa (0.8.3):**
- **kn5 reader** (`src/shared/kn5/parse.ts`):
  - Reads textures, materials (shader, properties and samplers) and the node tree, including skinned meshes.
  - Works on 181 installed cars and the three dashes. The E30's 180 MB kn5 parses in 41 ms.
  - Coordinates need no mirroring: dash text reads the right way round.
- **kn5 import:**
  - Embedded textures are extracted once to `userData/kn5-textures/<hash>/`.
  - AC material properties map to PBR: ambient+diffuse → brightness, specular exponent → roughness, emissive, alpha blend and alpha test.
  - Multi-map materials are baked on the GPU into a single texture (the diffuse colour mixed with the detail texture by alpha), which is where a Kunos car's paint lives.
- **Car folders** (File → Import Assetto Corsa Car…):
  - Picks the LOD_0 model from `lods.ini`, with a biggest-kn5 fallback. Offers the skins; a chosen skin overrides the embedded textures.
  - Reads `data/` or `data.acd`. The key is derived from the folder name, and all 178 installed `data.acd` files unpack.
  - Project format v9 keeps the text of the data files, `ui_car.json` and `extension/` as `reference`.
  - The **Reference car panel** shows the spec sheet (mass, weight split, wheelbase, track, tyres, power/torque curve peaks clipped at the limiter, gearing, diff, brakes, steering) and every file. The skin can be switched there.
- Tested on the user's E30 (306 meshes, 1.24M triangles, 65 textures, 3.7 s) and the MX5 Cup (livery matches its preview).

**Library folders (0.8.4):**
- Settings → Library folders lists your own material and object folders.
  - They're scanned at startup, when the list changes, or on Scan now, with the pack builders' rules. That code moved to `src/main/library/` and is shared with the scripts.
  - Each folder is scanned in a worker thread into `userData/library-scan/`, and scanned again only when its files change (a path+size+date fingerprint).
- `three` is now bundled into the main process: electron-builder strips `examples/` from packaged dependencies, which removed the EXRLoader.

**BeamNG parts (0.8.4):**
- With the install folder set, every stock vehicle's jbeam is read for suspension-area parts (slot types → Front/Rear Suspension, Springs & Dampers, Brakes, Steering, Sway Bars, Axles & Differentials, Strut Braces, Hubcaps).
- Each part's flexbody nodes are cut from the car's DAE (or common.zip's) into a small DAE with plain materials that keep the game's material names. Tuned variants with the same meshes are merged.
- Vehicle names come from the game's English translations ("ETK 800-Series").
- The current game gives 1,030 objects in about 20 s, cached in `userData/library-scan/beamng` and redone when the vehicle zips change. Nothing is redistributed.
- Added parts reference the game's materials by name (`gameMaterial`), so exports use the real ones.

**Next:** objects offered when picking a suspension (Phase 10), then the rest of Phase 9 (hinge wizard).

### Phase 8 — Materials (done, 0.8.0)

**Studied first:** 2,179 materials from the stock vehicles. All are format 1.5 with four "Stages", and most do their work in stage 0. Paint puts a colour palette mask with clear coat and an orange-peel detail normal on layer 0, with the real textures on layer 1. Glass is translucent PreMulAlpha with shadows off.

**8a — materials in the project (done):**
- **Project format v6:** `materials` (typed) and `materialSlots` (mesh → material per slot; split pieces use their base mesh's).
- **Auto-import:** every material of an imported model becomes a project material with its texture files, in the same undo step as the import. Projects from before v6 get theirs the first time the model loads. The Sunburst6 FBX brings in 53.
- **Viewport:** draws from the project materials, using MeshPhysicalMaterial with clear coat, emissive and alpha test. Textures the import already decoded are reused, and others load on demand.
- **Export:** writes main.materials.json from the project materials, in the stock v1.5 shape (only non-default fields), and copies their textures. Game materials are referenced by name and nothing is written for them. Raw fields merge over everything.
- **Materials panel:**
  - Search, a colour swatch per material, how many meshes use it, and paint/glass/game badges. Picking a mesh jumps to its material.
  - Editor: layers 1–4, colour, metallic, roughness, opacity, normal strength, clear coat, glow colour and nits, a file per texture slot with a UV2 switch, and detail normal scale/strength.
  - Transparency (blend op, depth write, receive shadows), alpha cut-out and threshold, double-sided, shadows, reflections, vertex colours, glow, per-pixel specular, anisotropic, paint-from-instance.
  - Raw BeamNG fields per layer and per material.
  - Apply to the selected meshes, duplicate, delete.
- Slider drags merge into one undo step (commands can carry a coalesce key).
- The Materials layout shows the Inspector under the Materials panel.
- Export Model uses the project materials too.

**8b — library (done):**
- **34 built-in presets:**
  - Paints: gloss, metallic, pearl, matte, satin. These use the stock paint layout: a clear-coated paint layer over a base.
  - Metals: chrome, brushed/polished aluminium, bare/dark steel, cast iron, gold anodised, burnt titanium.
  - Plastics, rubber and carbon.
  - Glass and lenses: clear/tinted glass, headlight, taillight and indicator lenses, mirror.
  - Interior: leather, fabric, alcantara, carpet, soft-touch dash.
  - Lamp glows.
  - Values follow the stock materials.
- **Your library:** saved in `userData/material-library` with its own copies of the textures, so an item outlives its project.
- **`.jbmat` sharing:** a zip of `material.json` plus `textures/`. Importing unpacks it into the library with zip-slip-safe paths.
- **The library dialog:** Presets / My library, search, apply to the selected meshes or add to the project, share, remove, and import a `.jbmat`. The editor has Save to library and Share.

**8c — merge and drag-and-drop (done):**
- **Merge duplicates:** materials with identical settings and textures are grouped.
  - Names that are only copies of each other (Aluminum-1 / Aluminum-1.001, Chrome_02, "Glass copy") merge with confidence.
  - Identical materials with unrelated names are offered, unticked.
  - Chained merges resolve to the one kept.
  - On the Sunburst6 FBX: 53 → 42 materials from the confident merges alone. Its FBX materials carry so little data that Chrome, redGlass, Grey_Plastic and friends look identical, which is exactly why those stay unticked.
- **Drag and drop:** drag a material from the list onto a mesh or part row in the Scene tree (a part takes it on all its meshes), or onto a mesh in the viewport (onto the whole selection if the mesh is part of it).
- **Game materials:** type a BeamNG material name in the editor and nothing is exported for it; the DAE references it by name.
- **Paint:** the paint switch on a material, with the palette mask (R/G/B = paint slots 1/2/3) on layer 1.

**Materials pack (0.8.1):**
- `npm run build-material-pack -- "Materials Libary"` scans the user's material folder.
  - MaterialX files give the values and texture roles; otherwise roles come from file names (Poly Haven, ambientCG, BeamNG-style `_nm`/`_nmp`).
  - Names are made consistent: spelling, title case, Aluminium, Matte. Textures are renamed `<material>_<role>`.
  - EXR is converted to PNG, a folder of colour-only images (flags) becomes one material per image, and grilles become alpha cut-outs.
  - It writes `MATERIALS.md`, listing every file used or skipped.
- Output: `packs/materials/` (bundled into the installer as `resources/materials-pack`) and `release/JBeam-Forge-Materials-<version>.zip` (a separate release download).
- The app reads the bundled pack at startup as a read-only "Materials pack" library tab.

**Carried to 0.8.x:** UV island view, auto-unwrap and projection, AO baking, the viewport's single-channel views (roughness/metallic/normals/UV checker), a game-wheel picker (it fits better with suspension in Phase 10), and a list of the game's shared materials to pick from.

### Phase 7 — Editing suite (done, 0.7.0)

**Carried to 0.7.x:** camera bookmarks, snap to grid/surface, bulk scale/rotate/align/redistribute, triangle add/delete/flip, per-node friction/material/collision, named selection sets, add node on surface/plane, per-part mass heatmap.

**Grouped scene tree:** children of each part are gathered into Doors, Glass, Lights, Interior, Engine and so on. Corner families with four or more parts split again into front and rear (Doors → Front doors → Front left door). A group only exists when it would hold at least two parts, and groups open by themselves when they hold the selection or a search hit.

**Focus mode:**
- Double-click a part (in the tree or the viewport), press **F** with it selected, or use the focus icon on its tree row.
- The part and everything attached to it stays solid (a door keeps its glass, card and handles). The rest of the car turns into a see-through ghost, and the camera glides to the part.
- The structure overlay only shows the focused parts' nodes and beams.
- A root part like the body shell focuses on its own, since the whole car hangs off it.
- Clicks go to the focused part first, so the ghost never gets in the way. Double-clicking a ghosted part jumps straight to it.
- **Esc**, the pill's close button or double-clicking empty space leaves focus.
- Ghost opacity is in Settings → Viewport (0–60%, default 12%; 0 hides the rest).

**Structure editing** (edit mode: toolbar pointer button or **Tab**):
- **Selecting:** click a node or beam; drag a box on empty space. Shift adds, Ctrl removes. **L** selects connected, **Ctrl+A** all, **Ctrl+I** inverts, and double-clicking a node takes its whole part. In focus mode only the focused parts' nodes can be picked.
- **Moving:**
  - Drag the gizmo; it uses BeamNG axes: X left, Y rear, Z up.
  - Arrow keys nudge 5 mm along the screen direction snapped to the nearest axis (Shift 25 mm, Alt 1 mm).
  - Or type exact X/Y/Z in the inspector. With several nodes selected, the typed value places the selection's centre.
  - Symmetry is on by default: partners are found by mirrored position, and centre-line nodes stay on the centre line.
  - Soft-move drags nearby nodes of the same parts with a smooth falloff, with an adjustable radius.
  - Drags preview live and commit as one undo step. Moved nodes are marked as moved by hand.
- **Inspector:** node id rename (every beam, triangle and reference node follows), weight for one or many nodes, and delete.
- **Delete** removes nodes along with their beams and triangles, or deletes selected beams.
- While editing, orbit moves to the right mouse button and pan to the middle button, the same as the split tool.
- **Topology:** **B** chains the picked nodes with beams in the order picked (beams across parts become attachments), **M** merges nodes into the first one picked (centre position, summed weight, references follow, collapsed beams and triangles dropped), and **D** splits selected beams at the midpoint.
- **Regenerating keeps hand-moved nodes:** each one takes the place of the regenerated node with the same id, or else the nearest one within 15 cm, and inherits its beams. Anything further away stays as it is, with a warning.

**Power tools:**
- **Ctrl+K command palette:** type a part name to focus it, or run any action, panel or layout.
- **F1 keyboard shortcut sheet.**
- **jbeam panel:** the exact text Export writes for the selected part, updating live.
- **Balance:** F/R and L/R weight split in the status bar, with the centre of gravity in its tooltip and as a marker in the viewport. Front/rear is measured about the structure's middle until there are axles.

**Undo survives saving:** saving writes the undo/redo history next to the project (`car.jbforge.history`). It keeps the last 300 steps, trimmed to about 32 MB, and is stamped with a SHA-256 of the saved text. Reopening restores it only when the project file is byte-for-byte the one it was saved with, so edits made elsewhere never replay onto the wrong document.

**Automatic prices and weights** (`npm run study-prices`):
- Every part of the 28 official cars and 10 trucks was classified with our own classifier. For each kind the study records its in-game price (`information.value`) and its node-weight sum.
- Taxonomy defaults now use the median wherever there are enough samples: at least 3 prices or 5 masses.
- Samples that measure something else are skipped: EV battery packs, wheel+tyre+hub assemblies, cargo loads, and strut/spring parts whose nodes carry the hub. Kinds without data got hand estimates.
- Glass keeps its old, lighter masses. Official glass weighs about three times more, and our brittle-glass beams broke in the 1 m drop at those masses.
- Prices scale by construction material: aluminium ×1.6, carbon ×3, fibreglass ×1.3, plastic ×0.8. They are rounded to shop-looking steps.
- A part's price is automatic until you type one; "reset to automatic" brings it back. Target mass got the same reset.
- The project format is now v4 (`price: null` = automatic). Older files migrate their untouched `0` prices to automatic.
- Sunburst body-shell sandbox with the new masses: settles, the 1 m drop breaks nothing, and the 50 km/h pole crushes 84 mm (was 329 mm). The crush number moves a lot with mass distribution: 145 mm with the old bumper mass alone. Worth a look once suspension exists.


### Phase 6 — Physics sandbox (done)

**Semantics checked against BeamNG's beam documentation:**
- `beamSpring` (N/m) and `beamDamp` (N/m/s).
- `beamDeform` (N): the force at which a beam permanently deforms.
- `beamStrength` (N): the force at which it breaks.
- `deformLimit` / `deformLimitExpansion`: plastic change as a ratio of the original length.
- `SUPPORT`: compression only.
- `breakGroup`: one beam breaking breaks the whole group.

**Solver** (`src/shared/sim/solver.ts`, flat typed arrays):
- Symplectic Euler at 2,000 Hz.
- Beam values come from the same function the exporter uses (`proxy/beamValues.ts`), so the sandbox and the jbeam can't drift apart.
- Plastic yield with limits; breaking with breakGroup propagation; support beams.
- Ground plane with penalty contact and Coulomb friction.
- Rigid obstacles: poles collide with beams as well as nodes, so a car can't slip between nodes; walls.
- Mass 0 = fixed node; anchors (jack stands); external forces (dragging, yanks).
- Divergence detection with the first offending node.
- Deterministic, and never mutates the authored data (reset restores it exactly).

**Adaptive sub-stepping:** found by running the Sunburst structure.
- Light panel nodes on stiff beams (0.31 kg on 6 MN/m, ω·Δt ≈ 2.2) sit inside the range BeamNG handles in official content, but they blow up a plain 2,000 Hz Euler integrator from round-off alone (1e-13 m/s grew to 100 m/s in 40 steps).
- The solver now picks sub-steps from the stiffest node (√(2Σk/m)·h ≤ 1.6). Forces and values are unchanged; only integration is finer.

**Worker:** runs the solver in real time or slow motion, streams positions and per-beam stress as transferable buffers, runs scenarios on demand, and logs through the worker log relay.

**Scenarios:**
- Settle on four jack stands under the wheel positions, with a sag report. Without suspension a car otherwise rests on its skirts and tears them off.
- 1 m drop and 20° corner drop.
- Attachment yank: does the selected part come off at its breakGroup or tear its own skin?
- 50 km/h (adjustable) crashes into a pole, a full-width wall and a 40% offset barrier, with front-crush measurement.

**Static pre-checks** (instant, no simulation): orphans, near-orphans, disconnected islands, zero-length and duplicate beams, and the calibrated stability predictor.

**Test Mode UI:**
- Toolbar Test Mode button.
- Test panel: run/pause/reset, speed (1×, ½×, 0.1×), gravity toggle, live simulated time, achieved real-time factor and broken count, divergence banner, scenario buttons, results with broken beams grouped by part (click to select the part), and pre-checks.
- A standing note that the sandbox checks structure and is not BeamNG's solver.
- Viewport: live structure coloured by stress (green → yellow → red, broken beams hidden); drag a node with the left mouse button; obstacles drawn.

**Sunburst body-shell check** (`node scripts/visual-structure.mjs --sim`, 556 nodes / 2,819 beams):
- Settles on stands and comes to rest.
- 1 m drop: nothing breaks.
- 50 km/h pole: 329 mm of front crush.
- Live at 1.00× real time.

**Tests:** 460 unit tests (solver physics, plasticity, breakGroups, support beams, ground and friction, pole tunnelling, sub-stepping, divergence, determinism, scenarios, pre-checks). The harness generate scenario now also runs Test Mode, a drop and a pole crash.

**Benchmark** (`npm run bench:solver`): 2,000 nodes / 21,736 beams on a stiff lattice needing two sub-steps runs at 0.74× real time; typical cars (hundreds of nodes) run in real time.

**Later phases:** a hinge swing test (Phase 9) and a suspension drop (Phase 10) plug into the same scenario runner.

### Phase 5 — Export v1 + in-game gate (built; waiting for your in-game test)

**Node/beam generation revised** (your feedback: the structure didn't follow the mesh). Measured against the official Sunburst jbeam with the new `proxy-bench` and the in-app official-structure overlay. A new `surface` remesher is now the default for shells, with feature-line nodes, a cross-car cage on bodies, and real symmetry tests. Across 131 official parts: empty parts 10 → 0, coverage vs official 1.21× → 0.63×, parts clearly worse than official 55 → 2. Details and the full table are in `docs/proxy-generation.md`. The `test` mod was regenerated (1,343 nodes, lint clean).

**Ground truth:** read from the official Sunburst's jbeam, materials and DAE:
- part sections, and the option rows on nodes, beams and triangles (`groundModel` metal/plastic/glass);
- the main part with its `coreSlot` body, and the body's `refNodes` and `cameraExternal`;
- material entries keyed by name with `mapTo` = the DAE material name, and textures referenced as `/vehicles/<slug>/…`.

**Export pipeline:**
- **jbeam** (`src/shared/export/jbeam.ts`):
  - A main part `<slug>` (slotType `main`, `slots2` with the body as a `coreSlot`), plus **one jbeam file per project part**.
  - slotType = the slot, i.e. the base part's name, which variants share. `slots2` declares children per slot, so every variant of a parent offers them.
  - **Node groups are per slot**: parts that ride on a parent (badges, gauges…) and suspension-role parts (until Phase 10) bind their flexbodies to the nearest slot with nodes, and keep working whichever variant is installed.
  - Measured presets drive beam values: edges, softer braces, and attach beams with a `<part>_attach` breakGroup.
  - Readable, stable output (nodes sorted `b1, b1l, b1r…`, commented sections), covered by snapshot tests.
- **Attachments:** they only use parent node names common to every variant of the parent slot, so swapping a bumper variant in-game never leaves dangling beams. Openable parts are **bolted shut with breakable bolts** until Phase 9 hinges. Mirrors are no longer "openable" (taxonomy fix).
- **DAE writer** (`src/renderer/export/dae.ts`):
  - COLLADA 1.4.1, `Z_UP`, BeamNG-space vertices and identity node matrices, so flexbodies line up with the nodes.
  - It keeps normals, both UV sets (V flipped for glTF sources) and material groups, and writes only the vertices each split subset uses.
  - Round-trip tested through our own importer.
- **Names:** the source's vehicle prefix is replaced by the mod slug (`sunburst2_hood` → `test_hood`). Material names are always slug-prefixed, since BeamNG material names are global.
- **Files:** `main.materials.json` (v1.5 stage 0: colour/metallic/roughness factors plus every resolved map, textures copied), `info.json`, `default.pc` (format 2) + `info_default.json`, `default.jpg` preview.
- **Validator** (hard-fails, per SPEC §3.2):
  - a meshed part without structure;
  - a flexbody whose mesh isn't in the DAE, or with no node group to bind to;
  - orphan or duplicate nodes, dangling beams or triangles;
  - missing or dangling refNodes, missing textures, orphaned variants and slots.
  - Warnings: unhinged openables, unassigned meshes, empty parts. The dialog offers **Generate missing**.
- **Main process writer:**
  - **Install to BeamNG** writes `mods/unpacked/<slug>`: staged, then swapped in. It replaces only a folder carrying our `jbforge-export.json` marker. Paths are confined to `vehicles/<slug>/`, and only granted image files are copied.
  - **Save .zip…** is the alternative.
- **Empty proxies** (thin or fragmented shapes) fall back to a fitted box, so every meshed part gets structure.

**The reference mod (your "test" car):**
- `node scripts/export-reference.mjs --name=Test` drives the real app: new mod "Test" → import the Sunburst → auto-classify → generate → validate → **installed unpacked at `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current\mods\unpacked\test`** (117.7 MB).
- `npm run lint-mod` on the installed folder reports **no errors**:
  - 286 parts in 286 jbeam files (one per part, plus the main part);
  - the default config installs 142 parts: 1,055 nodes, 4,751 beams, 235 flexbodies;
  - the DAE has 411 meshes and 66 materials.
- The project is saved at `scratch/reference-project/test.jbforge`.
- An older `mods/unpacked/Test` folder from July (loose `sunburst_6_*` files with no `vehicles/` folder, so not loadable) was **moved, not deleted**, to `scratch/beamng-backups/unpacked-Test-2026-07-18/`.

**Tests:** 443 unit tests. The harness has 17 scenarios; the generate scenario now also exports into the harness's fake BeamNG folder and checks the files, `.pc` and flexbody↔DAE link.

**Gate status:** not done until you spawn it in-game (steps in `docs/testing-in-beamng.md`).

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

**Next:** Phase 7: editing suite, focus mode, and category-grouped part slots.


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

- Structure generation is very slow on small, dense meshes: the 130k-triangle uC-10 dash took 131 s and made no beams. Imports aren't affected. To look at alongside proxy tuning.

- **Repo file layout (needs the user):** root `SPEC.md` and `docs/SPEC.md` both contain the Claude Code project instructions, which belong in `CLAUDE.md`. The full rebuild spec is at `%USERPROFILE%\Downloads\SPEC.md` and needs copying to `docs/SPEC.md`. Both files were left out of the Phase 1 commit until this is fixed.
- **npm 11 allow-scripts:** `package.json` → `allowScripts` approves Electron and esbuild. A `postinstall` (`install-electron`) fetches the Electron binary on a fresh clone.
- **Renderer bundle is ~3 MB** (three.js, Radix, dockview). That's acceptable for a desktop app. Revisit with code-splitting if startup becomes slow.
- The `project:*` IPC channels accept any absolute `*.jbforge` path. Phase 3 should route paths through native dialogs.
- The toolbar's Settings button is inert until Phase 2 adds the settings UI (install dir).
