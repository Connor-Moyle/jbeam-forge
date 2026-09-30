import { create } from 'zustand';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { confirmImport } from '@renderer/import/importFlow';
import { defaultSettings, stageImport } from '@renderer/import/pipeline';
import { useSetData } from '@renderer/suspension/commands';
import type { SuspensionSet } from '@shared/ipc-contract';
import { removeSourceFromDoc } from '@shared/project/removeSource';

/**
 * Body panel mods (fork): a new hood, bumper, door… for a car in the game.
 * The stock part's jbeam comes from the user's install (the library scan);
 * the new model replaces its mesh, bound to the same nodes.
 */

const logger = rlog('panel-mod');

export const usePanelCatalogue = create<{ sets: SuspensionSet[] | null; error: string | null; load: (fresh?: boolean) => Promise<void> }>()((set, get) => ({
  sets: null,
  error: null,
  /** The panels the library has; `fresh` reads them again (after the library changes). */
  load: async (fresh = false) => {
    if (get().sets && !fresh) return;
    try {
      set({ sets: await call('panels:catalogue'), error: null });
    } catch (err) {
      set({ sets: [], error: err instanceof Error ? err.message : String(err) });
    }
  },
}));

/** Make this mod a new version of a game car's panel (your model stays; a guide of another panel goes). */
export async function pickPanel(s: SuspensionSet): Promise<void> {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  projectStore.getState().execute({
    label: `Panel for ${s.vehicleName}: ${s.name}`,
    apply: (d) => {
      // Another panel: the old guide shows the wrong part, so it goes.
      const oldGuide = d.panel?.guideSourceId;
      if (oldGuide && d.panel?.setId !== s.id) removeSourceFromDoc(d, oldGuide);
      d.panel = { setId: s.id, vehicle: s.vehicle, vehicleName: s.vehicleName, part: s.part, slotType: s.slotType, name: s.name, category: s.type, guideSourceId: d.panel?.setId === s.id ? (oldGuide ?? null) : null };
    },
  });
  await useSetData.getState().ensure([s.id]);
}

/** Import the stock panel's model as a guide to line the new one up against (never exported). */
export async function importGuide(): Promise<void> {
  const doc = projectStore.getState().doc;
  const panel = doc?.panel;
  const s = usePanelCatalogue.getState().sets?.find((x) => x.id === panel?.setId);
  if (!panel || !s) return;
  try {
    const staged = await stageImport(s.mesh, 'dae');
    const sourceId = await confirmImport(staged, defaultSettings('dae'), { gameMaterials: true, classify: false });
    if (!sourceId) return;
    projectStore.getState().execute({ label: 'Stock panel as a guide', apply: (d) => void (d.panel && (d.panel.guideSourceId = sourceId)) });
    useUiStore.getState().pushStatus(`The stock ${s.name} is in as a guide: line your model up with it. It isn't exported.`, 'success');
  } catch (err) {
    logger.warn('guide import failed:', err instanceof Error ? err.message : String(err));
    useUiStore.getState().pushStatus(`The stock panel could not be loaded: ${err instanceof Error ? err.message : String(err)}`, 'danger');
  }
}

/** Show or hide the guide in the viewport. */
export function setGuideVisible(visible: boolean): void {
  const id = projectStore.getState().doc?.panel?.guideSourceId;
  const keys = id ? (useSceneStore.getState().sources[id]?.meshes ?? []).map((m) => m.key) : [];
  if (keys.length) useSceneStore.getState().setHidden(keys, !visible);
}

/** Take the guide out of the project. */
export function removeGuide(): void {
  const id = projectStore.getState().doc?.panel?.guideSourceId;
  if (!id) return;
  projectStore.getState().execute({
    label: 'Remove the stock panel guide',
    apply: (d) => {
      removeSourceFromDoc(d, id);
      if (d.panel) d.panel.guideSourceId = null;
    },
  });
}
