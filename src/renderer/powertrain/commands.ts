import { Box3 } from 'three';
import { create } from 'zustand';
import type { SuspensionSet } from '@shared/ipc-contract';
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
 * Engine and gearbox workshop (Phase 11): a complete engine or gearbox from
 * a stock car, as its own model; on export its jbeam is brought over.
 */

export type PowertrainKind = 'engine' | 'gearbox';

export const usePowertrainCatalogue = create<{ sets: SuspensionSet[] | null; load: (force?: boolean) => Promise<void> }>()((set, get) => ({
  sets: null,
  load: async (force = false) => {
    if (get().sets && !force) return;
    set({ sets: await call('powertrain:catalogue') });
  },
}));

/** What the panel shows: the two cards, a picker, or a tuning page. */
export const usePowertrainUi = create<{ view: { kind: PowertrainKind; page: 'pick' | 'tune' } | null; show: (view: { kind: PowertrainKind; page: 'pick' | 'tune' } | null) => void }>()((set) => ({
  view: null,
  show: (view) => set({ view }),
}));

function boxOf(sourceId: string): Box3 {
  const box = new Box3();
  for (const m of useSceneStore.getState().sources[sourceId]?.meshes ?? []) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
  }
  return box;
}

function carBox(exclude: readonly string[]): Box3 {
  const box = new Box3();
  for (const src of Object.values(useSceneStore.getState().sources)) {
    if (exclude.includes(src.sourceId)) continue;
    for (const m of src.meshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
    }
  }
  return box;
}

/**
 * Where it goes: an engine just behind the front axle, centred, a little
 * above wheel-centre height; a gearbox behind the engine (or where an engine
 * would be, when there's none yet).
 */
function target(kind: PowertrainKind, size: { y: number }, exclude: readonly string[]): [number, number, number] {
  const doc = projectStore.getState().doc;
  const body = carBox(exclude);
  const x = body.isEmpty() ? 0 : (body.min.x + body.max.x) / 2;
  const wheels = cornerTargets(exclude[0] ?? '');
  const frontAxle = doc?.axles[0]?.y ?? (wheels ? (wheels.at.FL[1] + wheels.at.FR[1]) / 2 : body.isEmpty() ? 0 : body.min.y + (body.max.y - body.min.y) * 0.2);
  const z = (wheels?.at.FL[2] ?? 0.3) + 0.2;
  const engine = doc?.powertrain.engine ? boxOf(doc.powertrain.engine.sourceId) : null;
  if (kind === 'gearbox' && engine && !engine.isEmpty()) return [(engine.min.x + engine.max.x) / 2, engine.max.y + size.y / 2 - 0.05, (engine.min.z + engine.max.z) / 2 - 0.05];
  return [x, frontAxle + 0.25 + (kind === 'gearbox' ? 0.5 : 0), z];
}

/** Fit an engine or gearbox from the game (replaces the one fitted before). */
export async function fitPowertrain(kind: PowertrainKind, set: SuspensionSet): Promise<void> {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const old = doc.powertrain[kind]?.sourceId;
  const staged = await stageImport(set.mesh, 'dae');
  const sourceId = await confirmImport(staged, defaultSettings('dae'), { gameMaterials: true, classify: false });
  if (!sourceId) return;
  const box = boxOf(sourceId);
  const size = { y: box.max.y - box.min.y };
  const [tx, ty, tz] = target(kind, size, [sourceId, ...(old ? [old] : [])]);
  const src = projectStore.getState().doc?.sources.find((s) => s.id === sourceId);
  if (src && !box.isEmpty()) {
    const c = box.getCenter(box.min.clone());
    const p = src.placement;
    setPlacement(sourceId, { ...p, position: [p.position[0] + tx - c.x, p.position[1] + ty - c.y, p.position[2] + tz - c.z] });
  }
  assignToNewPart(
    (useSceneStore.getState().sources[sourceId]?.meshes ?? []).map((m) => m.key),
    { taxonomyId: kind === 'engine' ? 'engine_set' : 'gearbox_set' },
  );
  projectStore.getState().execute({
    label: `Fit ${set.vehicleName} ${set.name}`,
    apply: (d) => {
      if (old) removeSourceFromDoc(d, old);
      d.powertrain[kind] = { setId: set.id, name: set.name, vehicle: set.vehicleName, type: set.type, sourceId, tuning: {} };
    },
  });
  useUiStore.getState().pushStatus(`Fitted the ${set.vehicleName} ${set.name}. Fine-tune where it sits with the gizmo (G / R / S).`, 'success', 8000);
}

export function removePowertrain(kind: PowertrainKind): void {
  projectStore.getState().execute({
    label: kind === 'engine' ? 'Remove engine' : 'Remove gearbox',
    apply: (d) => {
      const f = d.powertrain[kind];
      if (f) removeSourceFromDoc(d, f.sourceId);
    },
  });
}

export function setPowertrainTuning(kind: PowertrainKind, name: string, value: number | null): void {
  projectStore.getState().execute({
    label: kind === 'engine' ? 'Tune engine' : 'Tune gearbox',
    coalesce: `tune:${kind}:${name}`,
    apply: (d) => {
      const f = d.powertrain[kind];
      if (!f) return;
      if (value === null) delete f.tuning[name];
      else f.tuning[name] = value;
    },
  });
}
