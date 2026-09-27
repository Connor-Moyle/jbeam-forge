import { applyAutoMeshNames, meshNameProblem, renameMesh as setMeshName, tidyDisplayNames } from '@shared/parts/meshNames';
import { DEFAULT_SETTINGS } from '@shared/settings-schema';
import { addDocumentHook, projectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';

/** Friendly mesh and part names: the automatic rules and the commands behind them. */

function settings() {
  return useSettingsStore.getState().settings ?? DEFAULT_SETTINGS;
}

/** Keep names in step with assignments on every edit, when the settings say so. */
export function installNamingRules(): () => void {
  return addDocumentHook((draft) => {
    const s = settings();
    if (s.autoRenameDisplayNames) tidyDisplayNames(draft);
    if (s.autoRenameMeshes) applyAutoMeshNames(draft);
  });
}

/** One-off: name every assigned mesh after its part and tidy display names (typed names stay). */
export function renameFromParts(): void {
  const before = projectStore.getState().doc?.meshNames ?? {};
  const changed = projectStore.getState().execute({
    label: 'Rename meshes from their parts',
    apply: (d) => {
      tidyDisplayNames(d);
      applyAutoMeshNames(d);
    },
  });
  const after = projectStore.getState().doc?.meshNames ?? {};
  const renamed = Object.keys(after).filter((k) => before[k]?.name !== after[k]?.name).length;
  useUiStore.getState().pushStatus(changed ? `Renamed ${renamed} mesh${renamed === 1 ? '' : 'es'} after their parts` : 'Every mesh already has its part’s name', 'success');
}

/** A typed name (never auto-overwritten). Empty goes back to automatic/original. Returns a problem or null. */
export function renameMesh(key: string, name: string): string | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const problem = meshNameProblem(doc, key, name);
  if (problem) return problem;
  projectStore.getState().execute({ label: name.trim() ? `Rename mesh to ${name.trim()}` : 'Reset mesh name', apply: (d) => setMeshName(d, key, name) });
  return null;
}
