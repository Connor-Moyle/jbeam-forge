import type { FittedSet, Project } from '../project/schema';
import { isJbeamObject, type JbeamObject } from '../jbeam/parse';
import { serializeJbeam, JbeamComment, type WritableValue } from '../jbeam/serialize';
import { applyPowertrainEdits } from '../powertrain/edits';
import { applyChoices } from '../suspension/options';
import { rimSlot, sizeLabel, tyreRadius, tyreSlot, type RimSpec, type TyreSpec } from '../wheels/schema';
import type { SuspensionSetData } from './jbeam';

/**
 * Mods that aren't a whole vehicle (fork): an engine for cars in the game,
 * universal tyres, universal wheels. Each is written where the game looks
 * for such parts: engines beside the car they fit, tyres and wheels under
 * vehicles/common/ for every car.
 */

export type ModKind = 'vehicle' | 'engine' | 'tyres' | 'wheels' | 'panel';

export interface ModFileOut {
  /** Path inside the mod. */
  path: string;
  text: string;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Where a part-only mod keeps its shared files (meshes, materials). */
export const commonRoot = (slug: string) => `vehicles/common/${slug}`;

const axlesOf = (a: 'both' | 'F' | 'R'): ('F' | 'R')[] => (a === 'both' ? ['F', 'R'] : [a]);
const sides = (axle: 'F' | 'R') => [`${axle}R`, `${axle}L`] as const;

/** Flexbodies for a wheel mesh on both sides of an axle (the left one turned round). */
function wheelFlexbodies(meshes: readonly string[], group: 'tire' | 'wheel', axle: 'F' | 'R'): WritableValue[] {
  if (!meshes.length) return [];
  const [right, left] = sides(axle);
  return [
    ['mesh', '[group]:', 'nonFlexMaterials'],
    ...meshes.flatMap((m) => [
      [m, [`${group}_${right}`], [], { pos: { x: 0, y: 0, z: 0 } }],
      [m, [`${group}_${left}`], [], { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 180 } }],
    ]),
  ];
}

/**
 * A tyre part per size and axle: it fills the rims' tyre slot for its size
 * and sets the pressure wheel's tyre values (options only: the hub's rows,
 * which come later, pick them up), plus the tyre mesh as flexbodies.
 */
export function tyreModFiles(slug: string, author: string, spec: TyreSpec, meshes: readonly string[]): ModFileOut[] {
  const parts: Record<string, WritableValue> = {};
  for (const size of spec.sizes)
    for (const axle of axlesOf(spec.axles)) {
      const name = `${slug}_${size.width}_${size.aspect}_${size.rim}_${axle}`;
      const radius = tyreRadius(size);
      parts[name] = {
        information: { authors: author || 'JBeam Forge', name: `${spec.name} ${sizeLabel(size)} (${axle === 'F' ? 'front' : 'rear'})`, value: spec.value },
        slotType: tyreSlot(axle, size.rim, size.rimWidth),
        ...(meshes.length ? { flexbodies: wheelFlexbodies(meshes, 'tire', axle) } : {}),
        pressureWheels: [
          ['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'],
          new JbeamComment(`${sizeLabel(size)} ${spec.tread}: ${Math.round(radius * 1000)} mm radius`),
          { hasTire: true },
          { radius: r4(radius) },
          { tireWidth: r4(size.width / 1000) },
          { numRays: spec.numRays },
          { pressurePSI: axle === 'F' ? spec.pressureFront : spec.pressureRear },
          { frictionCoef: spec.frictionCoef },
          { slidingFrictionCoef: spec.slidingFrictionCoef },
          { treadCoef: spec.treadCoef },
          { noLoadCoef: spec.noLoadCoef },
          { fullLoadCoef: spec.fullLoadCoef },
          { loadSensitivitySlope: spec.loadSensitivitySlope },
          { softnessCoef: spec.softnessCoef },
          { nodeWeight: spec.nodeWeight },
          { nodeMaterial: '|NM_RUBBER' },
          { wheelSideBeamSpring: spec.sideSpring, wheelSideBeamDamp: spec.sideDamp },
          { wheelTreadBeamSpring: spec.treadSpring, wheelTreadBeamDamp: spec.treadDamp },
          { wheelPeripheryBeamSpring: spec.peripherySpring, wheelPeripheryBeamDamp: spec.peripheryDamp },
          { disableMeshBreaking: true, disableTriangleBreaking: true },
        ],
      };
    }
  return [{ path: `${commonRoot(slug)}/${slug}_tyres.jbeam`, text: serializeJbeam(parts) }];
}

/**
 * A wheel (rim) part per axle: fills the hubs' wheel slot for its lug count,
 * sets the hub values, offers the tyre slot of its size (filled by the
 * game's tyres of that size, or a tyre mod's).
 */
export function rimModFiles(slug: string, author: string, spec: RimSpec, meshes: readonly string[]): ModFileOut[] {
  const parts: Record<string, WritableValue> = {};
  for (const axle of axlesOf(spec.axles)) {
    const name = `${slug}_${spec.diameter}x${spec.width}_${axle}`;
    const tyre = tyreSlot(axle, spec.diameter, spec.width);
    parts[name] = {
      information: { authors: author || 'JBeam Forge', name: `${spec.name} ${spec.diameter}x${spec.width} (${axle === 'F' ? 'front' : 'rear'})`, value: spec.value },
      slotType: rimSlot(axle, spec.lugs),
      slots: [
        ['type', 'default', 'description'],
        [tyre, '', `${axle === 'F' ? 'Front' : 'Rear'} Tires`],
      ],
      ...(meshes.length ? { flexbodies: wheelFlexbodies(meshes, 'wheel', axle) } : {}),
      pressureWheels: [
        ['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'],
        new JbeamComment(`${spec.diameter}x${spec.width} ${spec.lugs}-lug, offset ${spec.offsetMm} mm`),
        { hubRadius: r4((spec.diameter * 25.4) / 2000) },
        { hubWidth: r4((spec.width * 25.4) / 1000) },
        { wheelOffset: r4(spec.offsetMm / 1000) },
        { hubNodeWeight: spec.hubNodeWeight },
        { hubBeamSpring: spec.hubBeamSpring, hubBeamDamp: spec.hubBeamDamp },
        { hubNodeMaterial: '|NM_METAL' },
      ],
    };
  }
  return [{ path: `${commonRoot(slug)}/${slug}_wheels.jbeam`, text: serializeJbeam(parts) }];
}

/** Replace a part name wherever a slot default names it. */
function renameDefaults(body: JbeamObject, from: string, to: string): JbeamObject {
  const out: JbeamObject = { ...body };
  for (const table of ['slots', 'slots2'] as const) {
    const t = body[table];
    if (!Array.isArray(t)) continue;
    out[table] = t.map((row, i) => (i > 0 && Array.isArray(row) ? row.map((c) => (c === from ? to : c)) : row));
  }
  return out;
}

export interface EngineModResult {
  files: ModFileOut[];
  errors: string[];
}

/**
 * An engine for cars in the game: each engine picked in the engine builder
 * (from a car of the game) with its changes, as a new part in that car's
 * engine slot, so it shows in that car's parts menu. Its own parts that
 * were changed (a turbo, an ECU) go along under new names.
 */
export function engineModFiles(doc: Pick<Project, 'meta' | 'powertrain'>, author: string, sets: Readonly<Record<string, SuspensionSetData>>): EngineModResult {
  const slug = doc.meta.slug;
  const engines = [doc.powertrain?.engine, ...(doc.powertrain?.alternates ?? [])].filter((e): e is FittedSet => !!e);
  const errors: string[] = [];
  if (!engines.length) errors.push('Pick an engine from a car of the game in the engine builder: the mod is that engine, changed, as a new part for that car.');
  const files: ModFileOut[] = [];
  const byVehicle = new Map<string, Record<string, JbeamObject>>();
  // The car's folder in the game (etk800), from the set id "<folder>/<part>": its display name (ETK 800-Series) isn't a folder.
  const folderOf = (e: FittedSet) => (e.setId.includes('/') ? e.setId.slice(0, e.setId.indexOf('/')) : e.vehicle);
  for (const e of engines) {
    const data = sets[e.setId];
    if (!data) {
      errors.push(`${e.name}: its game data isn't loaded (is the BeamNG install still there?).`);
      continue;
    }
    const chosen = applyChoices(data, data.options, e.choices);
    const edited = applyPowertrainEdits(chosen.parts, chosen.root, e.edits);
    const out = byVehicle.get(folderOf(e)) ?? {};
    const rootName = `${slug}_${chosen.root}`;
    let root = edited[chosen.root];
    if (!root || !isJbeamObject(root)) {
      errors.push(`${e.name}: the engine part is missing from its data.`);
      continue;
    }
    // Changed sub-parts ship under new names, and the new engine points at them.
    for (const [name, body] of Object.entries(edited)) {
      if (name === chosen.root || body === chosen.parts[name] || !isJbeamObject(body)) continue;
      const copy = `${slug}_${name}`;
      out[copy] = { ...body, information: { ...(isJbeamObject(body.information) ? body.information : {}), name: `${isJbeamObject(body.information) && typeof body.information.name === 'string' ? body.information.name : name} (${doc.meta.name})` } };
      root = renameDefaults(root, name, copy);
    }
    const info = isJbeamObject(root.information) ? root.information : {};
    out[rootName] = { ...root, information: { ...info, authors: author || 'JBeam Forge', name: doc.meta.name + (engines.filter((x) => folderOf(x) === folderOf(e)).length > 1 ? ` (${e.name})` : '') } };
    byVehicle.set(folderOf(e), out);
  }
  for (const [vehicle, parts] of byVehicle) files.push({ path: `vehicles/${vehicle}/${slug}_engine.jbeam`, text: serializeJbeam(parts) });
  return { files, errors };
}

/** A game part's flexbody node groups (every row's, once each). */
function flexGroups(body: JbeamObject): string[] {
  const out: string[] = [];
  const table = Array.isArray(body.flexbodies) ? body.flexbodies : [];
  for (const row of table.slice(1)) {
    if (!Array.isArray(row)) continue;
    const g = row[1];
    for (const name of Array.isArray(g) ? g : typeof g === 'string' ? [g] : []) if (typeof name === 'string' && name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * A body panel for a car in the game: the stock part's jbeam (nodes, beams,
 * triangles, slots: it attaches, bends and breaks the same) with the new
 * model as its flexbodies, bound to the stock part's node groups, as a new
 * part in the same slot. The model is placed as the car's (vehicle space).
 */
export function panelModFiles(slug: string, author: string, modName: string, panel: { vehicle: string; part: string }, data: SuspensionSetData | undefined, meshes: readonly string[]): EngineModResult {
  const errors: string[] = [];
  const stock = data?.parts[panel.part];
  if (!stock || !isJbeamObject(stock)) return { files: [], errors: [`${panel.part}: its game data isn't loaded (is the BeamNG install still there? Rescan it in Settings → Library).`] };
  if (!meshes.length) errors.push('Import your panel’s 3D model: the mod replaces the stock panel’s mesh with it.');
  const groups = flexGroups(stock);
  if (!groups.length) errors.push(`${panel.part} has no flexbody groups to bind the new mesh to.`);
  const info = isJbeamObject(stock.information) ? stock.information : {};
  const name = `${slug}_${panel.part}`;
  const part: JbeamObject = {
    ...stock,
    information: { ...info, authors: author || 'JBeam Forge', name: modName },
    flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ...meshes.map((m) => [m, groups, []])] as WritableValue as JbeamObject['flexbodies'],
  };
  return { files: [{ path: `vehicles/${panel.vehicle}/${slug}_${panel.part.replace(/[^A-Za-z0-9_]+/g, '_')}.jbeam`, text: serializeJbeam({ [name]: part }) }], errors };
}

/** Move a vehicle mod's shared files (mesh, materials, textures) to vehicles/common/<slug>/. */
export function toCommon(path: string, slug: string): string {
  return path.startsWith(`vehicles/${slug}/`) ? `${commonRoot(slug)}/${path.slice(`vehicles/${slug}/`.length)}` : path;
}
