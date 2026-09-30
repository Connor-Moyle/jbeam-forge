import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { call } from '@renderer/diagnostics/ipc';
import { EMPTY_ARR } from '@shared/empty';
import { reloadSource } from './importFlow';
import { modelledMeshes } from '@renderer/modelling/commands';

/**
 * Auto-reimport (fork): while a mod is open, its model files are watched;
 * saving one again (a fix in Blender) reloads it here with the parts,
 * materials and everything else kept. On per mod (New Mod, or the
 * Inspector with nothing picked) with Settings → Files for the default.
 */

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();

/** Is it on for this mod? */
export function autoReimportOn(meta: { autoReimport?: boolean } | undefined): boolean {
  return meta?.autoReimport ?? useSettingsStore.getState().settings?.autoReimport ?? true;
}

export function useAutoReimport(): void {
  const paths = useProjectStore(useShallow((s) => s.doc?.sources.map((x) => x.absolutePath) ?? EMPTY_ARR));
  const perMod = useProjectStore((s) => s.doc?.meta.autoReimport);
  const byDefault = useSettingsStore((s) => s.settings?.autoReimport ?? true);
  const textures = useSettingsStore((s) => s.settings?.autoReimportTextures ?? true);
  const on = perMod ?? byDefault;

  useEffect(() => {
    call('sources:watch', { paths: on ? [...paths] : [], textures }).catch(() => undefined);
  }, [paths, on, textures]);
  useEffect(() => () => void call('sources:watch', { paths: [], textures: false }).catch(() => undefined), []);

  useEffect(
    () =>
      window.forge.on('sources:changed', ({ path, kind }) => {
        const doc = projectStore.getState().doc;
        if (!doc || !autoReimportOn(doc.meta)) return;
        const source = doc.sources.find((s) => norm(s.absolutePath) === norm(path));
        if (!source) return;
        const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
        // Reshaped meshes: reloadSource asks which version to keep instead.
        if (useSettingsStore.getState().settings?.autoReimportAsk && !(kind === 'model' && modelledMeshes(source.id).length)) {
          void useDialogStore
            .getState()
            .askConfirm(`${name} changed`, `${kind === 'texture' ? 'A texture next to it was saved again.' : 'It was saved again.'} Reload it now? Parts, materials and your other work stay.`, 'Reload')
            .then((yes) => {
              if (yes) void reloadSource(source.id, kind);
            });
        } else void reloadSource(source.id, kind);
      }),
    [],
  );
}
