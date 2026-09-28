import type { SetChoices } from '@shared/suspension/options';
import { Box3 } from 'three';
import { create } from 'zustand';
import type { SuspensionSet } from '@shared/ipc-contract';
import type { SuspensionSetData } from '@shared/export/jbeam';
import type { Axle } from '@shared/project/schema';
import { removeSourceFromDoc } from '@shared/project/removeSource';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { confirmImport } from '@renderer/import/importFlow';
import { setPlacement } from '@renderer/import/PlacementDialog';
import { defaultSettings, stageImport } from '@renderer/import/pipeline';
import { cornerTargets } from '@renderer/objects/placeObject';
import { assignToNewPart } from '@renderer/parts/commands';

/**
 * Suspension workshop (Phase 10): the car's axles, and complete suspensions
 * from the stock vehicles fitted to them.
 */

/** The catalogue of complete suspensions (from the BeamNG install; reloaded after a library scan). */
export const useSuspensionCatalogue = create<{ sets: SuspensionSet[] | null; load: (force?: boolean) => Promise<void> }>()((set, get) => ({
  sets: null,
  load: async (force = false) => {
    if (get().sets && !force) return;
    set({ sets: await call('suspension:catalogue') });
  },
}));

/** Sets' jbeam and attachment points, loaded on demand (the exporter and the tuning page read them). */
export const useSetData = create<{ data: Record<string, SuspensionSetData>; ensure: (ids: readonly string[]) => Promise<void> }>()((set, get) => ({
  data: {},
  ensure: async (ids) => {
    const missing = ids.filter((id) => !get().data[id]);
    for (const id of missing) {
      const d = await call('suspension:set', { id });
      if (d) set((s) => ({ data: { ...s.data, [id]: d } }));
    }
  },
}));

/** Load the jbeam of every suspension, engine and gearbox fitted in the project. */
export async function loadFittedSets(): Promise<void> {
  const doc = projectStore.getState().doc;
  const pt = doc?.powertrain;
  const ids = [...(doc?.axles ?? []).flatMap((a) => (a.fitted ? [a.fitted.setId] : [])), ...(pt?.engine ? [pt.engine.setId] : []), ...(pt?.gearbox ? [pt.gearbox.setId] : [])];
  if (ids.length) await useSetData.getState().ensure(ids);
}

/** Which axle the picker is choosing for. */
export const useSuspensionUi = create<{ axleId: string | null; tuneId: string | null; pick: (id: string | null) => void; tune: (id: string | null) => void }>()((set) => ({
  axleId: null,
  tuneId: null,
  pick: (axleId) => set({ axleId, tuneId: null }),
  tune: (tuneId) => set({ tuneId, axleId: null }),
}));

/** Which sets suit an axle: front sets for the first, rear for the others; "any" fits both. */
export function axleKind(axles: readonly Axle[], axle: Axle): 'front' | 'rear' {
  return axles[0]?.id === axle.id ? 'front' : 'rear';
}

const newId = () => `axle_${crypto.randomUUID().slice(0, 8)}`;

/** Front and rear axles where the car's wheels are (or would be, for a body that size). */
export function setUpAxles(): void {
  const t = cornerTargets('');
  if (!t) {
    useUiStore.getState().pushStatus('Import the car first: axles are placed from its wheels or its size.', 'warning');
    return;
  }
  const track = (fl: number[], fr: number[]) => Math.max(0.5, Math.abs(fl[0]! - fr[0]!));
  const axles: Axle[] = [
    { id: newId(), name: 'Front axle', y: (t.at.FL[1] + t.at.FR[1]) / 2, track: track(t.at.FL, t.at.FR), steered: true, tuning: {}, ownMeshes: [], fitted: null },
    { id: newId(), name: 'Rear axle', y: (t.at.RL[1] + t.at.RR[1]) / 2, track: track(t.at.RL, t.at.RR), steered: false, tuning: {}, ownMeshes: [], fitted: null },
  ];
  projectStore.getState().execute({ label: 'Set up axles', apply: (d) => void (d.axles = axles) });
  useSuspensionUi.getState().pick(axles[0]!.id);
}

/** Another axle behind the last one (trucks, six-wheelers). */
export function addAxle(): void {
  const doc = projectStore.getState().doc;
  const last = doc?.axles.at(-1);
  if (!doc || !last) return setUpAxles();
  const axle: Axle = { id: newId(), name: `Axle ${doc.axles.length + 1}`, y: last.y + 1.3, track: last.track, steered: false, tuning: {}, ownMeshes: [], fitted: null };
  projectStore.getState().execute({ label: 'Add axle', apply: (d) => void d.axles.push(axle) });
}

export function updateAxle(id: string, patch: Partial<Omit<Axle, 'id' | 'fitted'>>): void {
  projectStore.getState().execute({
    label: 'Change axle',
    coalesce: `axle:${id}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      const a = d.axles.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    },
  });
}

/** Remove an axle and the suspension fitted to it. */
export function removeAxle(id: string): void {
  projectStore.getState().execute({
    label: 'Remove axle',
    apply: (d) => {
      const a = d.axles.find((x) => x.id === id);
      if (a?.fitted) removeSourceFromDoc(d, a.fitted.sourceId);
      d.axles = d.axles.filter((x) => x.id !== id);
    },
  });
}

export function removeSuspension(axleId: string): void {
  projectStore.getState().execute({
    label: 'Remove suspension',
    apply: (d) => {
      const a = d.axles.find((x) => x.id === axleId);
      if (a?.fitted) removeSourceFromDoc(d, a.fitted.sourceId);
    },
  });
}

function boxOfSource(sourceId: string, only?: RegExp): Box3 {
  const box = new Box3();
  for (const m of useSceneStore.getState().sources[sourceId]?.meshes ?? []) {
    if (only && !only.test(m.name)) continue;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
  }
  return box;
}

/**
 * Fit a complete suspension to an axle: it comes in as its own model (the
 * game's materials, its parts classified), centred on the car, its hubs on
 * the axle line at wheel-centre height. Replaces what was on the axle.
 */
export async function fitSuspension(axleId: string, set: SuspensionSet): Promise<void> {
  const doc = projectStore.getState().doc;
  const axle = doc?.axles.find((a) => a.id === axleId);
  if (!doc || !axle) return;
  const wheelZ = cornerTargets('')?.at.FL[2] ?? 0.3;
  const body = new Box3();
  for (const src of Object.values(useSceneStore.getState().sources)) {
    for (const m of src.meshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) body.union(m.geometry.boundingBox);
    }
  }
  const carX = body.isEmpty() ? 0 : (body.min.x + body.max.x) / 2;
  const old = axle.fitted?.sourceId;
  const staged = await stageImport(set.mesh, 'dae');
  const sourceId = await confirmImport(staged, defaultSettings('dae'), { gameMaterials: true, classify: false });
  if (!sourceId) return;
  // Hubs (or the whole set) onto the axle line.
  let hubs = boxOfSource(sourceId, /hub|knuckle|upright/i);
  if (hubs.isEmpty()) hubs = boxOfSource(sourceId);
  const all = boxOfSource(sourceId);
  const at = [(all.min.x + all.max.x) / 2, (hubs.min.y + hubs.max.y) / 2, (hubs.min.z + hubs.max.z) / 2];
  const src = projectStore.getState().doc?.sources.find((s) => s.id === sourceId);
  if (src) {
    const p = src.placement;
    setPlacement(sourceId, { ...p, position: [p.position[0] + carX - at[0]!, p.position[1] + axle.y - at[1]!, p.position[2] + wheelZ - at[2]!] });
  }
  // The whole set is one part: on export its meshes go with the game's own jbeam for them.
  const keys = (useSceneStore.getState().sources[sourceId]?.meshes ?? []).map((m) => m.key);
  const axles = projectStore.getState().doc?.axles ?? [];
  assignToNewPart(keys, { taxonomyId: 'suspension_set', position: axleKind(axles, axle) === 'front' ? 'F' : 'R' });
  projectStore.getState().execute({
    label: `Fit ${set.vehicleName} ${set.name}`,
    apply: (d) => {
      if (old) removeSourceFromDoc(d, old);
      const a = d.axles.find((x) => x.id === axleId);
      if (a) {
        a.fitted = { setId: set.id, name: set.name, vehicle: set.vehicleName, type: set.type, sourceId };
        a.tuning = {};
      }
    },
  });
  const setTrack = all.max.x - all.min.x;
  useUiStore
    .getState()
    .pushStatus(
      `Fitted the ${set.vehicleName} ${set.name} (${set.type}) to the ${axle.name.toLowerCase()}. It's ${(setTrack * 1000).toFixed(0)} mm wide against your ${(axle.track * 1000).toFixed(0)} mm track: fine-tune with the arrows (M).`,
      'success',
      10000,
    );
}

/** A tuning value for the fitted suspension (null = back to the game's default). */
export function setTuning(axleId: string, name: string, value: number | null): void {
  projectStore.getState().execute({
    label: 'Tune suspension',
    coalesce: `tune:${axleId}:${name}`,
    apply: (d) => {
      const a = d.axles.find((x) => x.id === axleId);
      if (!a) return;
      if (value === null) delete a.tuning[name];
      else a.tuning[name] = value;
    },
  });
}

/** The game's other parts for an axle's suspension: fitted defaults and in-game choices. */
export function setSuspensionChoices(axleId: string, choices: SetChoices): void {
  projectStore.getState().execute({
    label: 'Choose suspension parts',
    apply: (d) => {
      const a = d.axles.find((x) => x.id === axleId);
      if (a?.fitted) a.fitted.choices = choices;
    },
  });
}

/**
 * Show the user's own meshes for an axle's suspension: the game's set keeps
 * doing the physics (its jbeam), its meshes are hidden and left out of the
 * export, and the user's meshes ride on its nodes instead.
 */
export function showOwnMeshes(axleId: string, keys: readonly string[]): void {
  const doc = projectStore.getState().doc;
  const axle = doc?.axles.find((a) => a.id === axleId);
  if (!doc || !axle?.fitted) return;
  const setSource = axle.fitted.sourceId;
  const own = keys.filter((k) => !k.startsWith(`${setSource}:`));
  if (!own.length) {
    useUiStore.getState().pushStatus('Select your suspension meshes first (arms, hubs, springs…), then choose Use my meshes.', 'warning');
    return;
  }
  const setKeys = (useSceneStore.getState().sources[setSource]?.meshes ?? []).map((m) => m.key);
  const partId = doc.assignments[setKeys[0] ?? ''];
  projectStore.getState().execute({
    label: 'Use my own suspension meshes',
    apply: (d) => {
      const a = d.axles.find((x) => x.id === axleId);
      if (!a) return;
      a.ownMeshes = own;
      d.ignoredMeshes = [...new Set([...d.ignoredMeshes, ...setKeys])];
      if (partId) for (const k of own) d.assignments[k] = partId;
    },
  });
  useSceneStore.getState().setHidden(setKeys, true);
  useUiStore.getState().pushStatus(`${own.length} of your meshes now ride on the ${axle.fitted.vehicle} suspension; its own meshes are hidden and won't be exported.`, 'success', 8000);
}

/** Back to the game's meshes for an axle's suspension. */
export function showGameMeshes(axleId: string): void {
  const doc = projectStore.getState().doc;
  const axle = doc?.axles.find((a) => a.id === axleId);
  if (!doc || !axle?.fitted) return;
  const setKeys = new Set((useSceneStore.getState().sources[axle.fitted.sourceId]?.meshes ?? []).map((m) => m.key));
  const own = axle.ownMeshes;
  projectStore.getState().execute({
    label: 'Use the game’s suspension meshes',
    apply: (d) => {
      const a = d.axles.find((x) => x.id === axleId);
      if (!a) return;
      a.ownMeshes = [];
      d.ignoredMeshes = d.ignoredMeshes.filter((k) => !setKeys.has(k));
      for (const k of own) delete d.assignments[k];
    },
  });
  useSceneStore.getState().setHidden([...setKeys], false);
}
