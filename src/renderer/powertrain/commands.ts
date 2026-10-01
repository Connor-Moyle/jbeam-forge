import { startPlacing } from '@renderer/scene/placeFitted';
import type { SetChoices } from '@shared/suspension/options';
import { Box3 } from 'three';
import { create } from 'zustand';
import type { SuspensionSet } from '@shared/ipc-contract';
import { removeSourceFromDoc } from '@shared/project/removeSource';
import { emptyEdits, type Project } from '@shared/project/schema';
import { engineTags } from '@shared/export/jbeam';
import { DEFAULT_DRIVETRAIN, type DrivetrainSettings } from '@shared/powertrain/drivetrain';
import { DEFAULT_DESIGN, designName, displacementOf, editsForDesign, type DesignTarget, type EngineDesign } from '@shared/powertrain/design';
import { designTarget, MASS_SCALE } from '@shared/powertrain/edits';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { confirmImport } from '@renderer/import/importFlow';
import { setPlacement } from '@renderer/import/PlacementDialog';
import { defaultSettings, stageImport } from '@renderer/import/pipeline';
import { cornerTargets } from '@renderer/objects/placeObject';
import { assignToNewPart } from '@renderer/parts/commands';
import { useSetData } from '@renderer/suspension/commands';

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
export type PowertrainPage = 'pick' | 'tune' | 'build' | 'option' | 'design';

export const usePowertrainUi = create<{ view: { kind: PowertrainKind; page: PowertrainPage } | null; show: (view: { kind: PowertrainKind; page: PowertrainPage } | null) => void }>()((set) => ({
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

/** Where an engine goes on this car (BeamNG space), for the Engine workspace's camera; null with no car loaded. */
export function engineSpot(): [[number, number, number], [number, number, number]] | null {
  if (carBox([]).isEmpty()) return null;
  const [x, y, z] = target('engine', { y: 0.5 }, []);
  return [
    [x - 0.35, y - 0.4, z - 0.3],
    [x + 0.35, y + 0.4, z + 0.3],
  ];
}

/** Fitting an engine or gearbox imports, places, assigns and records it: one undo step. */
export function fitPowertrain(kind: PowertrainKind, set: SuspensionSet): Promise<void> {
  return projectStore.getState().group(`Fit ${set.vehicleName} ${set.name}`, () => fitPowertrainSteps(kind, set));
}

/** Fit an engine or gearbox from the game (replaces the one fitted before). */
async function fitPowertrainSteps(kind: PowertrainKind, set: SuspensionSet): Promise<void> {
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
      const alternates = d.powertrain.alternates;
      if (old) removeSourceFromDoc(d, old);
      // Replacing the default engine keeps the other engines as they were.
      if (alternates) d.powertrain.alternates = alternates;
      d.powertrain[kind] = { setId: set.id, name: set.name, vehicle: set.vehicleName, type: set.type, sourceId, tuning: {}, edits: emptyEdits() };
    },
  });
  // Straight into placing it: the arrows on the whole set.
  startPlacing(sourceId, kind);
}

/** Adding another engine is one undo step, like fitting one. */
export function addEngineOption(set: SuspensionSet): Promise<void> {
  return projectStore.getState().group(`Add engine option ${set.vehicleName} ${set.name}`, () => addEngineOptionSteps(set));
}

/**
 * Another engine for the car (fork): fitted where the default engine sits,
 * hidden in the viewport, and offered in the same slot so each configuration
 * (and the player, in the parts menu) picks one.
 */
async function addEngineOptionSteps(set: SuspensionSet): Promise<void> {
  const doc = projectStore.getState().doc;
  const main = doc?.powertrain.engine;
  if (!doc || !main) return;
  const staged = await stageImport(set.mesh, 'dae');
  const sourceId = await confirmImport(staged, defaultSettings('dae'), { gameMaterials: true, classify: false });
  if (!sourceId) return;
  const box = boxOf(sourceId);
  const at = boxOf(main.sourceId);
  const src = projectStore.getState().doc?.sources.find((s) => s.id === sourceId);
  if (src && !box.isEmpty() && !at.isEmpty()) {
    const c = box.getCenter(box.min.clone());
    const t = at.getCenter(at.min.clone());
    const p = src.placement;
    setPlacement(sourceId, { ...p, position: [p.position[0] + t.x - c.x, p.position[1] + t.y - c.y, p.position[2] + t.z - c.z] });
  }
  const keys = (useSceneStore.getState().sources[sourceId]?.meshes ?? []).map((m) => m.key);
  assignToNewPart(keys, { taxonomyId: 'engine_set' });
  projectStore.getState().execute({
    label: `Add engine option ${set.vehicleName} ${set.name}`,
    apply: (d) => {
      d.powertrain.alternates = [...(d.powertrain.alternates ?? []), { setId: set.id, name: set.name, vehicle: set.vehicleName, type: set.type, sourceId, tuning: {}, edits: emptyEdits() }];
      fixEngineTags(d.powertrain);
    },
  });
  // Both engines sit in the same place: show the default one.
  useSceneStore.getState().setHidden(keys, true);
  await useSetData.getState().ensure([set.id]);
  useUiStore.getState().pushStatus(`Added the ${set.vehicleName} ${set.name} as another engine. Each configuration picks its engine; it's hidden here while the default one shows.`, 'success', 9000);
}

/** Give every engine its tag for exported part names, where it has none yet. */
function fixEngineTags(p: Project['powertrain']): void {
  const tags = engineTags(p);
  for (const e of [p.engine, ...(p.alternates ?? [])]) if (e && !e.tag) e.tag = tags.get(e.sourceId);
}

/** Make another engine the default one (the old default becomes an option). */
export function makeDefaultEngine(sourceId: string): void {
  const pt = projectStore.getState().doc?.powertrain;
  const alt = pt?.alternates?.find((a) => a.sourceId === sourceId);
  if (!pt?.engine || !alt) return;
  const oldKeys = (useSceneStore.getState().sources[pt.engine.sourceId]?.meshes ?? []).map((m) => m.key);
  projectStore.getState().execute({
    label: `Make ${alt.vehicle} ${alt.name} the default engine`,
    apply: (d) => {
      const p = d.powertrain;
      if (!p.engine || !p.alternates) return;
      const i = p.alternates.findIndex((a) => a.sourceId === sourceId);
      if (i < 0) return;
      // Tags travel with the engines, so their part names (and configurations naming them) don't change.
      fixEngineTags(p);
      const next = p.alternates[i]!;
      p.alternates[i] = p.engine;
      p.engine = next;
    },
  });
  useSceneStore.getState().setHidden(oldKeys, true);
  useSceneStore.getState().setHidden((useSceneStore.getState().sources[sourceId]?.meshes ?? []).map((m) => m.key), false);
}

export function removeEngineOption(sourceId: string): void {
  projectStore.getState().execute({
    label: 'Remove engine option',
    apply: (d) => removeSourceFromDoc(d, sourceId),
  });
}

export function removePowertrain(kind: PowertrainKind): void {
  projectStore.getState().execute({
    label: kind === 'engine' ? 'Remove engine' : 'Remove gearbox',
    apply: (d) => {
      const f = d.powertrain[kind];
      if (f) removeSourceFromDoc(d, f.sourceId);
    },
  });
  // The next engine took its place: show it.
  const next = projectStore.getState().doc?.powertrain.engine;
  if (kind === 'engine' && next) useSceneStore.getState().setHidden((useSceneStore.getState().sources[next.sourceId]?.meshes ?? []).map((m) => m.key), false);
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

/** The game's other parts for the engine's or gearbox's slots (turbo, ECU, exhaust…): fitted defaults and in-game choices. */
export function setPowertrainChoices(kind: PowertrainKind, choices: SetChoices): void {
  projectStore.getState().execute({
    label: kind === 'engine' ? 'Choose engine parts' : 'Choose gearbox parts',
    apply: (d) => {
      const f = d.powertrain[kind];
      if (f) f.choices = choices;
    },
  });
}

/** One of the game's numbers in the engine or gearbox (null: back to the game's value). */
export function setPowertrainField(kind: PowertrainKind, key: string, value: number | null): void {
  projectStore.getState().execute({
    label: kind === 'engine' ? 'Edit engine' : 'Edit gearbox',
    coalesce: `build:${kind}:${key}`,
    apply: (d) => {
      const f = d.powertrain[kind];
      if (!f) return;
      if (value === null) delete f.edits.fields[key];
      else f.edits.fields[key] = value;
    },
  });
}

/** A word setting of the engine or gearbox (its sound blend…); null goes back to the game's. */
export function setPowertrainText(kind: PowertrainKind, key: string, value: string | null): void {
  projectStore.getState().execute({
    label: kind === 'engine' ? 'Change engine sound' : 'Edit gearbox',
    coalesce: `buildText:${kind}:${key}`,
    apply: (d) => {
      const f = d.powertrain[kind];
      if (!f) return;
      const texts = (f.edits.texts ??= {});
      if (value === null) delete texts[key];
      else texts[key] = value;
    },
  });
}

/** The engine's torque curve (null: the game's). `coalesce` groups a drag into one undo step. */
export function setTorqueCurve(curve: [number, number][] | null, coalesce?: string): void {
  projectStore.getState().execute({
    label: 'Edit torque curve',
    ...(coalesce ? { coalesce } : {}),
    apply: (d) => {
      const f = d.powertrain.engine;
      if (f) f.edits.torque = curve;
    },
  });
}

/** The gearbox's ratios (null: the game's). */
export function setGearRatios(ratios: number[] | null, coalesce?: string): void {
  projectStore.getState().execute({
    label: 'Edit gear ratios',
    ...(coalesce ? { coalesce } : {}),
    apply: (d) => {
      const f = d.powertrain.gearbox;
      if (f) f.edits.gearRatios = ratios;
    },
  });
}

/** Undo every builder change to one of them. */
export function resetPowertrainEdits(kind: PowertrainKind): void {
  projectStore.getState().execute({
    label: kind === 'engine' ? 'Reset engine' : 'Reset gearbox',
    apply: (d) => {
      const f = d.powertrain[kind];
      if (f) f.edits = emptyEdits();
    },
  });
}

let optionSyncStarted = false;

/**
 * The other engines sit where the default one does: hide each one's meshes
 * when they first load (hiding lives in the scene, not the project, so a
 * reopened project would otherwise show every engine on top of each other).
 * Shown again by "Make default".
 */
export function startEngineOptionSync(): void {
  if (optionSyncStarted) return;
  optionSyncStarted = true;
  const done = new Set<string>();
  let shownDefault: string | null = null;
  const sync = () => {
    const alts = projectStore.getState().doc?.powertrain.alternates ?? [];
    const sources = useSceneStore.getState().sources;
    for (const a of alts) {
      if (done.has(a.sourceId)) continue;
      const meshes = sources[a.sourceId]?.meshes;
      if (!meshes?.length) continue;
      done.add(a.sourceId);
      useSceneStore.getState().setHidden(meshes.map((m) => m.key), true);
    }
    // A source that became the default again is shown by makeDefaultEngine; forget it so a later swap back hides it.
    for (const id of [...done]) if (!alts.some((a) => a.sourceId === id)) done.delete(id);
    // The default engine changed (Make default, or its undo/redo): show the new one.
    const main = projectStore.getState().doc?.powertrain.engine?.sourceId ?? null;
    if (main !== shownDefault) {
      const meshes = main ? sources[main]?.meshes : undefined;
      if (!main) shownDefault = null;
      else if (meshes?.length) {
        shownDefault = main;
        if (alts.length) useSceneStore.getState().setHidden(meshes.map((m) => m.key), false);
      }
    }
  };
  useSceneStore.subscribe((s, prev) => {
    if (s.sources !== prev.sources) sync();
  });
  projectStore.subscribe(sync);
  sync();
}

/** How the gearbox reaches the axles (drive shafts). */
export function setDrivetrain(patch: Partial<DrivetrainSettings>): void {
  projectStore.getState().execute({
    label: 'Change drive shafts',
    coalesce: 'drivetrain',
    apply: (d) => {
      d.powertrain.drivetrain = { ...(d.powertrain.drivetrain ?? DEFAULT_DRIVETRAIN), ...patch };
    },
  });
}

/** The engine designer's draft while no engine is fitted yet (it's applied once one is). */
export const useEngineDraft = create<{ design: EngineDesign; set: (design: EngineDesign) => void }>()((set) => ({
  design: DEFAULT_DESIGN,
  set: (design) => set({ design }),
}));

/** Apply a design to the fitted engine: its curve, revs, friction, weight and turbo (one undo step per control). */
export function applyEngineDesign(design: EngineDesign, target: DesignTarget, coalesce?: string): void {
  projectStore.getState().execute({
    label: 'Design the engine',
    ...(coalesce ? { coalesce } : {}),
    apply: (d) => {
      const f = d.powertrain.engine;
      if (!f) return;
      const e = editsForDesign(design, target, f.edits.fields, MASS_SCALE);
      f.edits.fields = e.fields;
      f.edits.torque = e.torque;
      f.edits.design = e.design;
    },
  });
}

/** How alike a game engine is to a design (lower is closer): layout and cylinders first, then fuel, size and boost. */
function baseDistance(design: EngineDesign, set: SuspensionSet): number {
  const e = set.engine;
  if (!e) return Infinity;
  const want = design.layout === 'electric' ? 'Electric' : design.layout === 'rotary' ? 'Rotary' : design.layout === 'inline' ? `Inline-${design.cylinders}` : design.layout === 'flat' ? `Flat-${design.cylinders}` : `${design.layout.toUpperCase()}${design.cylinders}`;
  let d = e.layout === want ? 0 : e.layout.replace(/\D/g, '') === String(design.cylinders) ? 3 : 6;
  const fuel = design.layout === 'electric' ? 'electric' : design.fuel === 'diesel' ? 'diesel' : 'petrol';
  if (e.fuel !== fuel) d += 8;
  if (e.displacementL !== null) d += Math.abs(e.displacementL - displacementOf(design));
  const forced = design.aspiration === 'na' || design.boost === 0 ? null : design.aspiration === 'supercharger' ? 'supercharger' : 'turbo';
  if (forced !== e.forcedInduction) d += 1;
  return d;
}

/** The game engine most like a design, to carry it (mounts, shape and sound). */
export function matchingBaseEngine(design: EngineDesign, sets: readonly SuspensionSet[]): SuspensionSet | null {
  let best: SuspensionSet | null = null;
  let bestD = Infinity;
  for (const s of sets) {
    if (s.kind !== 'engine') continue;
    const d = baseDistance(design, s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Fit the closest game engine and put the design on it: one undo step. */
export function fitDesignedEngine(design: EngineDesign, set: SuspensionSet): Promise<void> {
  return projectStore.getState().group(`Fit a ${designName(design)}`, async () => {
    await fitPowertrainSteps('engine', set);
    await useSetData.getState().ensure([set.id]);
    const data = useSetData.getState().data[set.id];
    if (data && projectStore.getState().doc?.powertrain.engine?.setId === set.id) applyEngineDesign(design, designTarget(data.parts, data.root));
  });
}
