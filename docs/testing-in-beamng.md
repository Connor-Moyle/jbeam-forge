# Testing in BeamNG — the in-game gate (SPEC §3.3)

The app's physics sandbox is not BeamNG's solver, and Claude Code can't run the game. **Any phase that changes export output is only done after you confirm an in-game spawn.** The first such phase is 5; phases 10 and 11 have gates too.

## Locations on this machine (detected, 0.39.1)

| What | Path |
|---|---|
| Game install | `I:\SteamLibrary\steamapps\common\BeamNG.drive` |
| User folder | `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current` |
| Mods folder | `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current\mods` |
| Game log | `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current\beamng.log` (older runs: `beamng.1.log` …) |

The app detects both folders; see **Settings → BeamNG**. Never install mods into the game's `content/` folder: BeamNG's own README there says so.

## The loop

1. **Export** from JBeam Forge. The zip lands wherever you choose. From Phase 5 there is also a one-click "Install to mods".
2. **Install:** copy `<slug>.zip` into the mods folder, and delete any previous version of the same mod first.
3. **Clear the log's noise:** fully quit BeamNG before launching, so `beamng.log` starts fresh.
4. **Spawn:** launch the game, load *Gridmap* (fast), open the vehicle selector and pick the mod.
5. **Check, in order:**
   1. It appears in the selector with its name and preview.
   2. It spawns without a red error or console popup.
   3. The body is **visible** (flexbodies bound) and isn't exploding or sagging through the floor.
   4. The parts menu (Ctrl+W) lists the slots, and swapping a variant works.
   5. It drives (Phase 5 bar: "drives as a prop", so the minimum is that it rolls and doesn't disintegrate).
6. **Report back:**
   - which of the checks above passed;
   - `beamng.log` from the start of the session to after the spawn. Paste the whole file if it's under ~2,000 lines; otherwise paste every line containing `E ` (error), `W ` (warning) or the mod's slug;
   - a screenshot if something looks wrong.
7. **Fix and repeat.** The phase stays open until a spawn passes checks 1–5.

## What to paste when it fails

- The lines around the **first** error mentioning the mod or `jbeam`. Later errors are often consequences of it.
- The exported jbeam file the error names. It's in the zip under `vehicles/<slug>/`.
- The app's diagnostics: **Help → Copy Diagnostic Info**.
