import { projectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';

/**
 * The game version a mod was exported for. Game updates are what quietly break mods (a part it
 * borrows changes or moves), so a project opened with another version than its last export says so.
 */

let cached: { dir: string; version: string | null } | null = null;

export async function installedGameVersion(): Promise<string | null> {
  const dir = useSettingsStore.getState().settings?.beamngInstallDir;
  if (!dir) return null;
  if (cached?.dir === dir) return cached.version;
  try {
    const v = await call('beamng:validate', { dir });
    cached = { dir, version: v.ok ? (v.version ?? null) : null };
  } catch {
    cached = { dir, version: null };
  }
  return cached.version;
}

const short = (v: string) => v.replace(/(\.0)+$/, '');

/** After an export: note the version it was made for. */
export async function stampGameVersion(): Promise<void> {
  const version = await installedGameVersion();
  const doc = projectStore.getState().doc;
  if (!version || !doc || doc.meta.gameVersion === version) return;
  projectStore.getState().execute({ label: `Exported for BeamNG.drive ${short(version)}`, apply: (d) => void (d.meta.gameVersion = version) });
}

/** On opening a project: say if the game has changed since its last export. */
export async function checkGameVersion(): Promise<void> {
  const doc = projectStore.getState().doc;
  const was = doc?.meta.gameVersion;
  if (!was) return;
  const now = await installedGameVersion();
  if (!now || now === was) return;
  useUiStore.getState().pushStatus(`This mod was last exported for BeamNG.drive ${short(was)}; you have ${short(now)}. Game updates can change the parts it borrows: export it again, spawn it, and read what the game says.`, 'warning', 15000);
}
