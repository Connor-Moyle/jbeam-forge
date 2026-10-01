import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@shared/settings-schema';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { engineSpot } from './commands';

/**
 * The Engine workspace's stage: the camera glides to the engine (or to where
 * one will go), the rest of the car turns see-through (a setting), and the
 * camera turns slowly round it until the user moves it.
 */

export const SHOWCASE_DEGREES_PER_SECOND = 8;

export const useEngineStage = create<{ active: boolean; orbiting: boolean; setOrbiting: (on: boolean) => void }>()((set) => ({
  active: false,
  orbiting: false,
  setOrbiting: (orbiting) => set({ orbiting }),
}));

/** Parts of the car that are the engine: their taxonomy, or their name. */
const ENGINE_TAXONOMY = new Set(['engine', 'engine_set', 'intake', 'exhaust_manifold', 'turbo', 'supercharger', 'radiator', 'gearbox', 'gearbox_set']);
const ENGINE_NAME = /\b(engine|motor|intake|manifold|exhaust manifold|turbo|supercharger|radiator)\b/i;
const NOT_ENGINE = /\b(bay|mount|cover|hood|bonnet)\b/i;

/** The meshes to show solid: the fitted engine and gearbox, else the car's own engine meshes. */
export function engineMeshKeys(): string[] {
  const doc = projectStore.getState().doc;
  const sources = useSceneStore.getState().sources;
  if (!doc) return [];
  const fitted = [doc.powertrain.engine, doc.powertrain.gearbox].flatMap((f) => (f ? (sources[f.sourceId]?.meshes ?? []).map((m) => m.key) : []));
  if (fitted.length) return fitted;
  const partOf = new Map(doc.parts.map((p) => [p.id, p]));
  const own: string[] = [];
  for (const src of Object.values(sources))
    for (const m of src.meshes) {
      const part = partOf.get(doc.assignments[m.key] ?? '');
      if ((part?.taxonomyId && ENGINE_TAXONOMY.has(part.taxonomyId)) || (ENGINE_NAME.test(m.name.replace(/[_.-]/g, ' ')) && !NOT_ENGINE.test(m.name.replace(/[_.-]/g, ' ')))) own.push(m.key);
    }
  return own;
}

function settings() {
  return useSettingsStore.getState().settings ?? DEFAULT_SETTINGS;
}

/** Frame the engine (or where it goes) and ghost the rest, as the settings say. */
export function showEngine(glide = true, xray = settings().engineViewXray): void {
  const scene = useSceneStore.getState();
  const keys = engineMeshKeys();
  if (xray) scene.setFocus({ partId: null, parts: [], meshKeys: keys });
  else if (scene.focus) scene.setFocus(null);
  if (keys.length) scene.requestFrame(keys, glide);
  else {
    const spot = engineSpot();
    if (spot) scene.requestFrame([], glide, spot);
  }
}

export function enterEngineStage(): void {
  useEngineStage.setState({ active: true, orbiting: settings().engineViewOrbit });
  showEngine();
}

export function leaveEngineStage(): void {
  if (!useEngineStage.getState().active) return;
  useEngineStage.setState({ active: false, orbiting: false });
  useSceneStore.getState().setFocus(null);
}
