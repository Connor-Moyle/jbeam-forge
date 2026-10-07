import { startPlacing } from '@renderer/scene/placeFitted';
import type { SetChoices } from '@shared/suspension/options';
import { emptyEdits } from '@shared/project/schema';
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
import { IDENTITY_EDIT } from '@shared/mesh/meshEdit';
import { setWheels } from '@shared/suspension/wheels';

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
  const ids = [
    ...(doc?.axles ?? []).flatMap((a) => (a.fitted ? [a.fitted.setId] : [])),
    ...(pt?.engine ? [pt.engine.setId] : []),
    ...(pt?.alternates ?? []).map((a) => a.setId),
    ...(pt?.gearbox ? [pt.gearbox.setId] : []),
    // A body panel mod's stock part.
    ...(doc?.panel ? [doc.panel.setId] : []),
  ];
  if (ids.length) await useSetData.getState().ensure(ids);
}

/** Which axle the picker is choosing for. */
export const useSuspensionUi = create<{ axleId: string | null; tuneId: string | null; driveId: string | null; pick: (id: string | null) => void; tune: (id: string | null) => void; drive: (id: string | null) => void }>()((set) => ({
  axleId: null,
  tuneId: null,
  driveId: null,
  pick: (axleId) => set({ axleId, tuneId: null, driveId: null }),
  tune: (tuneId) => set({ tuneId, axleId: null, driveId: null }),
  drive: (driveId) => set({ driveId, axleId: null, tuneId: null }),
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

/** Fitting a suspension imports, places, assigns and records it: one undo step. */
export function fitSuspension(axleId: string, set: SuspensionSet): Promise<void> {
  return projectStore.getState().group(`Fit ${set.vehicleName} ${set.name}`, () => fitSuspensionSteps(axleId, set));
}

/**
 * Fit a complete suspension to an axle: it comes in as its own model (the
 * game's materials, its parts classified), centred on the car, its hubs on
 * the axle line at wheel-centre height. Replaces what was on the axle.
 */
async function fitSuspensionSteps(axleId: string, set: SuspensionSet): Promise<void> {
  const doc = projectStore.getState().doc;
  const axle = doc?.axles.find((a) => a.id === axleId);
  if (!doc || !axle) return;
  // This end's wheels say where the middle of the car and the wheel centres' height are (the body's
  // box doesn't: a suspension fitted before, with a steering box to one side, is in it).
  const corners = cornerTargets('')?.at;
  const [left, right] = axleKind(doc.axles, axle) === 'front' ? [corners?.FL, corners?.FR] : [corners?.RL, corners?.RR];
  const carX = left && right ? (left[0] + right[0]) / 2 : 0;
  const wheelZ = left && right ? (left[2] + right[2]) / 2 : 0.3;
  const old = axle.fitted?.sourceId;
  const staged = await stageImport(set.mesh, 'dae');
  const sourceId = await confirmImport(staged, defaultSettings('dae'), { gameMaterials: true, classify: false });
  if (!sourceId) return;
  await useSetData.getState().ensure([set.id]);
  const all = boxOfSource(sourceId);
  // The set's wheel centres, from its jbeam (where the game builds the wheels), go onto the axle
  // line: the same for every set, whatever its meshes are called and however far its springs,
  // arms or driveshaft reach. Only a set with no wheels of its own is placed by its meshes.
  const wheels = setWheels(useSetData.getState().data[set.id]?.parts ?? {});
  let at: number[];
  if (wheels.length) {
    const mean = (i: number) => wheels.reduce((s, w) => s + w.centre[i]!, 0) / wheels.length;
    // One side only (half a set): its wheel mirrors about the set's own centre line.
    at = [wheels.length > 1 ? mean(0) : 0, mean(1), mean(2)];
  } else {
    let hubs = boxOfSource(sourceId, /hub|knuckle|upright/i);
    if (hubs.isEmpty()) hubs = all;
    at = [(all.min.x + all.max.x) / 2, (hubs.min.y + hubs.max.y) / 2, (hubs.min.z + hubs.max.z) / 2];
  }
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
  const moved = followSetWheels(axleId);
  startPlacing(sourceId, 'suspension');
  const setTrack = all.max.x - all.min.x;
  useUiStore
    .getState()
    .pushStatus(
      `Fitted the ${set.vehicleName} ${set.name} (${set.type}) to the ${axle.name.toLowerCase()}. It's ${(setTrack * 1000).toFixed(0)} mm wide against your ${(axle.track * 1000).toFixed(0)} mm track.${moved ? ` Your ${moved === 1 ? 'wheel and its brakes' : 'wheels and brakes'} moved onto its hubs.` : ''} The arrows are on it: drag to fine-tune (its physics and the wheels move with it).`,
      'success',
      10000,
    );
}

/** The car's own parts at a wheel: they move with the wheel when a suspension holds it. */
const CORNER_KINDS = ['wheel', 'tire', 'hub', 'brake_disc', 'brake_drum', 'brake_caliper'];

function boxOfKeys(keys: ReadonlySet<string>): Box3 {
  const box = new Box3();
  for (const src of Object.values(useSceneStore.getState().sources)) {
    for (const m of src.meshes) {
      if (!keys.has(m.key)) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
    }
  }
  return box;
}

/**
 * Put the car's own wheels, tyres and brakes on the fitted suspension's hubs: each corner's meshes move
 * together so the wheel's centre lands on the middle of the hub axle the game builds that wheel on.
 * Returns how many corners moved.
 */
export function followSetWheels(axleId: string): number {
  const doc = projectStore.getState().doc;
  const axle = doc?.axles.find((a) => a.id === axleId);
  const fitted = axle?.fitted;
  const data = fitted && useSetData.getState().data[fitted.setId];
  if (!doc || !axle || !fitted || !data) return 0;
  const offset = doc.sources.find((x) => x.id === fitted.sourceId)?.placement.position ?? [0, 0, 0];
  const axleTag = axleKind(doc.axles, axle) === 'front' ? 'F' : 'R';
  const setPrefix = `${fitted.sourceId}:`;
  const moves: { keys: string[]; d: [number, number, number] }[] = [];
  for (const wheel of setWheels(data.parts, offset)) {
    const corner = `${axleTag}${wheel.side}`;
    const partKind = new Map(doc.parts.filter((p) => p.position === corner && CORNER_KINDS.includes(p.taxonomyId)).map((p) => [p.id, p.taxonomyId]));
    const keysOf = (kinds: readonly string[]) => Object.keys(doc.assignments).filter((k) => !k.startsWith(setPrefix) && !doc.ignoredMeshes.includes(k) && kinds.includes(partKind.get(doc.assignments[k]!) ?? ''));
    // The wheel (rim and tyre) says where the corner is; without one, the disc, drum or hub does.
    let ref = keysOf(['wheel', 'tire']);
    if (!ref.length) ref = keysOf(['brake_disc', 'brake_drum', 'hub']);
    if (!ref.length) continue;
    const box = boxOfKeys(new Set(ref));
    if (box.isEmpty()) continue;
    const c = box.getCenter(box.min.clone());
    // Onto the hub's axis (where along the car, and how high). Sideways too when the set says where
    // its wheel sits; a wheel part of the game's decides that otherwise, and the mesh keeps its place
    // along the axle, where it spins just as true.
    const d: [number, number, number] = [wheel.exact ? wheel.centre[0] - c.x : 0, wheel.centre[1] - c.y, wheel.centre[2] - c.z];
    if (Math.hypot(...d) < 0.003) continue;
    moves.push({ keys: keysOf(CORNER_KINDS), d });
  }
  if (!moves.length) return 0;
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  projectStore.getState().execute({
    label: 'Wheels onto the suspension',
    apply: (dd) => {
      for (const { keys, d } of moves)
        for (const k of keys) {
          const cur = dd.meshEdits[k] ?? structuredClone(IDENTITY_EDIT);
          dd.meshEdits[k] = { ...cur, position: [round(cur.position[0] + d[0]), round(cur.position[1] + d[1]), round(cur.position[2] + d[2])] };
        }
    },
  });
  return moves.length;
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

/** A differential setting on an axle (driveline builder); null goes back to the game's. */
export function setDrivelineValue(axleId: string, key: string, value: number | string | null): void {
  projectStore.getState().execute({
    label: 'Change differential',
    coalesce: `drive:${axleId}:${key}`,
    apply: (d) => {
      const a = d.axles.find((x) => x.id === axleId);
      if (!a) return;
      const e = (a.edits ??= emptyEdits());
      const texts = (e.texts ??= {});
      delete e.fields[key];
      delete texts[key];
      if (typeof value === 'number') e.fields[key] = value;
      else if (typeof value === 'string') texts[key] = value;
    },
  });
}

export function resetDriveline(axleId: string): void {
  projectStore.getState().execute({
    label: 'Reset differentials',
    apply: (d) => {
      const a = d.axles.find((x) => x.id === axleId);
      if (a) delete a.edits;
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
