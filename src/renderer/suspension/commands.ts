import { Box3 } from 'three';
import { create } from 'zustand';
import type { SuspensionSet } from '@shared/ipc-contract';
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
import { applyPendingClassification, offerAutoClassify } from '@renderer/parts/commands';

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

/** Which axle the picker is choosing for. */
export const useSuspensionUi = create<{ axleId: string | null; pick: (id: string | null) => void }>()((set) => ({ axleId: null, pick: (axleId) => set({ axleId }) }));

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
    { id: newId(), name: 'Front axle', y: (t.at.FL[1] + t.at.FR[1]) / 2, track: track(t.at.FL, t.at.FR), steered: true, fitted: null },
    { id: newId(), name: 'Rear axle', y: (t.at.RL[1] + t.at.RR[1]) / 2, track: track(t.at.RL, t.at.RR), steered: false, fitted: null },
  ];
  projectStore.getState().execute({ label: 'Set up axles', apply: (d) => void (d.axles = axles) });
  useSuspensionUi.getState().pick(axles[0]!.id);
}

/** Another axle behind the last one (trucks, six-wheelers). */
export function addAxle(): void {
  const doc = projectStore.getState().doc;
  const last = doc?.axles.at(-1);
  if (!doc || !last) return setUpAxles();
  const axle: Axle = { id: newId(), name: `Axle ${doc.axles.length + 1}`, y: last.y + 1.3, track: last.track, steered: false, fitted: null };
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
  // Its meshes become parts (arms, hubs, coilovers…) straight away.
  const meshes = useSceneStore.getState().sources[sourceId]?.meshes ?? [];
  offerAutoClassify(set.name, meshes);
  applyPendingClassification();
  projectStore.getState().execute({
    label: `Fit ${set.vehicleName} ${set.name}`,
    apply: (d) => {
      if (old) removeSourceFromDoc(d, old);
      const a = d.axles.find((x) => x.id === axleId);
      if (a) a.fitted = { setId: set.id, name: set.name, vehicle: set.vehicleName, type: set.type, sourceId };
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
