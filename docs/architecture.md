# Architecture

Electron + React 19 + TypeScript + Vite (electron-vite). Zustand for state. No backend: the filesystem is reached only through the main process over typed IPC.

```
src/main/       Electron main: window, menu, logging, crash hooks, IPC handlers, services,
                beamng/ (install detection/validation, lazy zip reader)
src/preload/    contextBridge → window.forge (allowlisted invoke/on). Sandboxed, CommonJS output.
src/shared/     Pure code used by both sides: IPC contract, zod schemas, .jbforge io/migrations,
                jbeam/ (lenient parser, idiomatic serializer, table model)
src/renderer/   React app: app/ (App, stores, test bus), shell/ (dock, toolbar, status bar),
                ui/ (tokens + component kit), panels/, diagnostics/ (logging, boundaries, IPC client)
src/workers/    Web Worker code + worker log bridge
scripts/        run-desktop harness, token lint, study-vehicle + jbeam-corpus (tsx, ground truth)
eslint-rules/   forge/no-fresh-selector-fallback
tests/          vitest: node project (main/shared/scripts) + jsdom project (renderer/workers)
```

## Security

- `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity` on.
- CSP meta: `script-src 'self'`, no remote origins.
- `window.open` is denied (https links go to the OS browser). Navigation away from the app is blocked. All web permission requests are denied.
- IPC channels are declared once in `src/shared/ipc-contract.ts`. Both the preload allowlist and the main handlers derive from it.
- Main rejects calls from any frame that isn't our renderer, and zod-validates every request with a payload.
- Handlers never throw across the bridge. They return `{ ok: false, error }`, and the renderer's `call()` unwraps it and logs the failure once.
- **Project files:** the renderer never supplies a path it chose itself. Paths come from native dialogs (`project:open`/`saveAs`), the main-owned recent list (`project:openRecent`), or an earlier grant (`project:save`). `ProjectFiles` only reads `.jbforge`, and it validates with `parseProject` before every write. Harness runs script dialog answers through `harness:queueDialog`, which is only registered when `JBFORGE_HARNESS=1`.

## Error handling & logging (SPEC §3.6)

| Layer | Mechanism |
|---|---|
| Main | electron-log (`userData/logs/main.log`, 5 MB rotation, scoped), `uncaughtException` / `unhandledRejection` / `render-process-gone` / `child-process-gone`, renderer console errors |
| Renderer | electron-log/renderer (forwarded via electron-log's injected preload), `window.onerror` / `unhandledrejection`, React root `onUncaughtError` / `onRecoverableError` |
| React | `RootErrorBoundary` (full-window card: reload window, reset layout) + `PanelErrorBoundary` in every dock panel (reload panel, reset layout). Both cards offer "Copy diagnostics" |
| Workers | `createWorkerLogger` posts records; `attachWorkerLogRelay` forwards them and logs worker `error`/`messageerror`. **Every Worker must be attached.** |
| Viewport | `GuardedLoop`: survives transient frame errors, stops after 3 consecutive ones and surfaces the panel error card. WebGL context loss pauses the loop, shows a pill and resumes on restore |
| Help menu | Open Log Folder, Copy Diagnostic Info (versions, GPU status, last 200 log lines), Debug Logging toggle (persisted) |

## Persistence

| File | Owner | Notes |
|---|---|---|
| `userData/settings.json` | `SettingsService` | Defaults < file, validated per field. A corrupt file is backed up and replaced by defaults |
| `userData/layouts/current.json` | `LayoutService` | dockview JSON + preset. Written debounced (500 ms) and on unload. A layout with unknown panels falls back to the preset |
| `*.jbforge` | `src/shared/project/` | See below |
| localStorage `jbforge.ui` | ui store | Per-machine UI conveniences only (collapsed sections) |

All file writes go through `atomicWrite`: temp file, fsync, rename. It retries on Windows EPERM/EBUSY and serializes writes to the same path.

## `.jbforge` versioning

- `formatVersion` is an integer. `CURRENT_PROJECT_VERSION` lives in `schema.ts`.
- `parseProject` checks the format tag, rejects future versions with a clear "update the app" error, runs `MIGRATIONS` step by step, then zod-validates.
- `serializeProject` is deterministic: schema key order, 2-space indent, trailing newline. It is covered by a snapshot test.
- **Rule:** every persisted-shape change bumps the version, adds a pure migration `{ from: n, migrate }`, and adds a fixture under `tests/fixtures/jbforge/` that must load forever. Never edit an existing fixture.

## Layout presets

Presets (`Editing` (id `modelling`), `Modelling` (id `model`), `Materials`, `Testing`, …) are data in `src/renderer/shell/presets.ts`. Panels are registered in `panelRegistry.ts`, and each is wrapped in `PanelFrame` (error boundary + harness crash probe).

## Testing

- `npm test`: vitest. The node project covers main/shared/scripts. The jsdom project covers renderer and workers.
- `npm run lint`: ESLint (type-checked, react-hooks as errors, selector rule) + token lint.
- `npm run typecheck`: node and web tsconfigs.
- `npm run run-desktop`: builds, then drives the real app via Playwright's Electron driver. It uses an isolated temp userData and screenshots to `artifacts/run-desktop/<timestamp>/`. It fails on any unexpected console error or `[error]` line in `main.log`. Deliberate crashes carry the `[harness-triggered]` marker. Hooks are exposed on `window.__jbforgeTest` only in dev/harness runs.

## Ground truth (SPEC §3.1, Phase 2)

- `npm run study-vehicle -- <name> [--common]` streams an official vehicle's text files, DAE node names and a `summary.json` into `scratch/vehicle-study/<name>/` (gitignored: game content never enters the repo).
- `npm run jbeam:corpus [-- --catalogue=docs/beamng-section-catalogue.md]` parses, round-trips and table-reads every official `.jbeam`. Re-run it after every BeamNG update.
- Both scripts find the install via `--dir`, then the app's saved setting, then auto-detect (`scripts/lib/installDir.ts`).
- Official zips are read lazily with yauzl (`src/main/beamng/zip.ts`). `common.zip` is ~4 GB, so nothing ever buffers a whole archive.
- Verified format notes: `docs/beamng-jbeam-syntax.md`, `docs/beamng-vehicle-layout.md`, `docs/beamng-reference-vehicle-notes.md`, `docs/beamng-section-catalogue.md`, `docs/testing-in-beamng.md`.

## Project lifecycle & undo (Phase 3a)

- **Home screen** when no project is open (`src/renderer/home/`); the dock editor otherwise (`App.tsx → Root`).
- **Document store** `src/renderer/app/stores/project.ts`:
  - Every edit is a `Command` run through `execute`, and immer records forward/inverse patches, so undo/redo is unlimited.
  - "Dirty" compares the history position with the one at the last save, so undoing back to the saved state is clean.
  - Save-time stamps (`modifiedAt`) use `markSaved` and never enter history.
- **Lifecycle actions** `src/renderer/project/actions.ts` (new / open / recent / save / save as / close).
  - Anything that could lose work first calls `confirmDiscardOrSave()` (Save / Don't save / Cancel).
  - The renderer mirrors dirtiness to main (`window:setDirty`) for the window-close guard.
- **Menu → renderer:** File and Edit items send `menu:command`. Undo/redo go to text fields when one is focused, and to the document history otherwise.
- **Recent projects** `userData/recent-projects.json`: max 12, JPEG thumbnails in `userData/thumbnails/` captured from the viewport on save, missing files flagged.

## Import pipeline (Phase 3b)

`src/renderer/import/`, measured on the official Sunburst DAE (77 MB, 418 meshes, 326k triangles): import 1.3 s, 83 fps orbiting, 11/11 BC7 textures.

1. **Pick** (`import:pickSource`): a native dialog; the file's folder is granted for side files and textures.
2. **Stage** (`pipeline.stageImport`): bytes over IPC, then three.js loaders (DAE/FBX/OBJ+MTL/glTF/GLB/STL) produce *loader space*. Every mesh's `matrixWorld` is baked into its own geometry copy (SPEC §2), with winding fixed for mirrored nodes. Duplicate names get " (2)".
3. **Dialog** (`ImportDialog`): units and axes, a live BeamNG-space size readout, and plausibility advice ("looks like centimetres", "wider than long — check the forward axis").
4. **Finish** (`pipeline.finishImport`): the texture pass, then conversion to BeamNG space via `src/shared/coords.ts`, the only conversion module.
   - Loaders never fetch images. Each request becomes a placeholder tagged with its reference. Main resolves references (`src/main/import/textures.ts`): the path as given, then the same file name or the same stem with another image extension, indexed across the model folder and "Locate folder…" folders. This is needed because official DAEs name `x.png` while the game ships `x.dds`, and use absolute paths from BeamNG's build machine.
   - `dds.ts` reads BC1–BC5/BC7 (BeamNG ships DX10 BC7 sRGB). Formats the GPU lacks are reported as unsupported.
5. **Record:** an undoable "Import <file>" command adds the `Source` (path relative to the project when possible, import settings, `textureDirs`). `useSourceSync` loads/unloads geometry whenever `doc.sources` changes: open, undo/redo, adding a texture folder.

**Security:** `import:readFile` only reads model, side-file and image extensions under granted folders.
- Opening a project grants the project's own folder, plus source folders inside it.
- Folders outside it (other source folders, `textureDirs`) need a one-time consent prompt, remembered per project in `userData/trusted-folders.json`. A shared `.jbforge` therefore can't grant itself access to arbitrary folders.
- `import:locateSource` never checks existence outside granted folders.

**Local reference model:** `npm run extract-reference -- sunburst2` streams the DAE and its textures into `scratch/test-models/` (never committed). `npm run run-desktop -- --model=scratch/test-models/sunburst2/sunburst2.dae` adds a smoke scenario that reports import time, fps and texture results.
