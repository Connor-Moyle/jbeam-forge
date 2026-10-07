import type { Part, Project, RowOptions, StructBeam, StructNode, StructTri, TuningVar, PowertrainEdits } from '../project/schema';
import { RESERVED } from '../jbeam/properties';
import { triggerCorners, type Trigger } from '../triggers/schema';
import type { TaxonomyEntry } from '../taxonomy/schema';
import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';
import { serializeJbeam, JbeamComment, type WritableObject, type WritableValue } from '../jbeam/serialize';
import { readTable, writeTable, type WritableRecord } from '../jbeam/tables';
import { materialDefaults, partPrice } from '../parts/materials';
import { ATTACHMENT_VALUES, BEAM_PRESET_VALUES, type BeamPresetId, type BeamValues } from '../proxy/presets';
import { partRole, partSettings } from '../proxy/generate';
import { beamPhysics, DEFORM_LIMIT_EXPANSION } from '../proxy/beamValues';
import { couplerFor, type Hinge } from '../hinges/schema';
import { hingeIds } from '../hinges/build';
import { limiterBound } from '../hinges/geometry';
import { definedNodes, definedWeights, setGroups, transplantSuspension } from '../suspension/transplant';
import { blockNodes } from '../powertrain/placement';
import { firstSlotType } from '../jbeam/slots';
import { nodesTouchingOtherParts } from './contact';
import { applyDrivelineEdits } from '../powertrain/driveline';
import { exportableProps, propRow, PROPS_HEADER } from '../props/props';
import type { PartScripts } from '../lua/export';
import { applyDrivetrainToAxle, applyDrivetrainToGearbox, DEFAULT_DRIVETRAIN, planDrivetrain } from '../powertrain/drivetrain';
import { camerasInternalSection } from '../cameras/cameras';
import { applyChoices, type SetChoices, type SetOptions } from '../suspension/options';
import { buildFeatureParts } from './features';
import { applyPowertrainEdits } from '../powertrain/edits';
import { engineRevRange, fitShiftingToEngine, type RevRange } from '../powertrain/shiftFit';
import { softenedValue, stabilise, type StabiliseBeam } from '../proxy/stability';
import { setWheels } from '../suspension/wheels';
import { mainAdditions } from './drivable';

/**
 * Project → jbeam parts (SPEC §4.15), in the verified 0.39 format
 * (docs/beamng-vehicle-layout.md, docs/proxy-generation.md):
 *
 *   <slug>            main part: slotType "main", slots2 with the body as a coreSlot
 *   <part name>       one part per project part; slotType = its slot (the base part's name, shared by variants)
 *                     information · slotType · slots2 (children) · flexbodies · nodes · beams · triangles
 *                     (+ refNodes / cameraExternal on the body)
 *
 * Node groups are per *slot*, so parts riding on a slot keep working whichever variant is installed.
 */

type Doc = Pick<Project, 'meta' | 'parts' | 'assignments' | 'ignoredMeshes' | 'nodes' | 'beams' | 'tris' | 'proxy' | 'hinges'> & Partial<Pick<Project, 'axles' | 'sources' | 'powertrain' | 'variables' | 'features' | 'props' | 'cameras' | 'triggers'>>;

export interface TaxonomyLookup {
  entry(id: string): TaxonomyEntry | undefined;
}

export interface JbeamExportOptions {
  /** meshKey → exported DAE node name (only exported meshes). */
  meshNames: ReadonlyMap<string, string>;
  author: string;
  /** Exported mesh name → its materials (as exported), for glass that shatters. */
  meshMaterials?: ReadonlyMap<string, readonly string[]>;
  /** Lights: material → signal and on/off materials, on the main part. */
  glowMap?: Readonly<Record<string, { simpleFunction: JbeamValue; off: string; on: string }>>;
  /** Fitted suspensions' jbeam (by catalogue set id), brought over into the mod. */
  suspensions?: Readonly<Record<string, SuspensionSetData>>;
  /** Vehicle scripts' controller rows and sections, by carrier part id. */
  scripts?: ReadonlyMap<string, PartScripts>;
  /** Told how the car was kept stable at the game's physics rate. */
  onStability?: (r: { softened: number; addedKg: number; heavier: number }) => void;
}

/** The share of its weight the car's own engine model keeps once a game engine does the work in its place. */
const SHELL_WEIGHT = 0.12;
/** Round a fitted wheel's axle, the reach within which the car's own nodes don't collide with the car (m): out from the axle, and to each side. */
const WHEEL_ZONE_RADIUS = 0.5;
const WHEEL_ZONE_SIDE = 0.22;

/** How a beam's values were eased so the car holds together at 2000 Hz. */
interface Softening {
  beams: Map<StructBeam, { k: number; c: number }>;
  weights: Map<string, number>;
}

export interface SuspensionSetData {
  parts: Record<string, JbeamObject>;
  anchors: Record<string, [number, number, number]>;
  root: string;
  /** The game's other parts for its slots (absent for sets cut before 0.12). */
  options?: SetOptions;
  /** Its own nodes its car's body also held: bolted to the new body (absent for sets cut before 0.16). */
  held?: string[];
}

/** A part's slots: type and default (both slot table formats). */
function slotDefaultsOf(part: JbeamObject): { type: string; def: string }[] {
  const out: { type: string; def: string }[] = [];
  for (const key of ['slots', 'slots2'] as const) {
    const t = part[key];
    if (!Array.isArray(t) || !Array.isArray(t[0])) continue;
    const h = (t[0]).map(String);
    const typeCol = h.includes('name') ? h.indexOf('name') : h.indexOf('type');
    const defCol = h.indexOf('default');
    for (const row of t.slice(1)) if (Array.isArray(row) && typeof row[typeCol] === 'string') out.push({ type: row[typeCol], def: typeof row[defCol] === 'string' ? (row[defCol]) : '' });
  }
  return out;
}

/** Whether the export writes a part's own nodes (only parts in the 'own' role do). */
export function nodesExported(doc: Pick<Project, 'parts' | 'proxy'>, tax: TaxonomyLookup): (partId: string) => boolean {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  return (partId) => {
    const part = byId.get(partId);
    const entry = part && tax.entry(part.taxonomyId);
    return !!part && !!entry && partRole(entry, partSettings(doc, part, entry)) === 'own';
  };
}

/** Parts standing in for a fitted suspension, engine or gearbox (replaced by the game's jbeam on export). */
export const SET_KINDS: ReadonlySet<string> = new Set(['suspension_set', 'engine_set', 'gearbox_set']);

/** Axle tags for part and node names: F, R, R2, R3… */
/** The car's engine slot: every engine fits it. */
export const engineSlotType = (slug: string) => `${slug}_E_engine`;

/** Tag of the n-th engine (0 = the default one): E, E2, E3… (part name prefixes). */
export const engineTag = (n: number) => (n ? `E${n + 1}` : 'E');

/**
 * Each engine's tag in part names, by source id. An engine keeps the tag it
 * was given (so reordering engines doesn't rename their parts and break
 * saved configurations); untagged ones (older projects) take their
 * position's tag, or the next free one.
 */
export function engineTags(pt: { engine: { sourceId: string; tag?: string | undefined } | null; alternates?: readonly { sourceId: string; tag?: string | undefined }[] | undefined } | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!pt?.engine) return out;
  const all = [pt.engine, ...(pt.alternates ?? [])];
  const used = new Set(all.flatMap((e) => (e.tag ? [e.tag] : [])));
  for (const e of all) if (e.tag) out.set(e.sourceId, e.tag);
  all.forEach((e, n) => {
    if (out.has(e.sourceId)) return;
    let tag = engineTag(n);
    for (let k = n; used.has(tag); k++) tag = engineTag(k + 1);
    used.add(tag);
    out.set(e.sourceId, tag);
  });
  return out;
}

export function axleTag(i: number): string {
  return i === 0 ? 'F' : i === 1 ? 'R' : `R${i}`;
}

export interface JbeamFile {
  /** File name inside vehicles/<slug>/. */
  file: string;
  part: string;
  text: string;
}

export const GROUND_MODEL: Record<string, string> = { '|NM_METAL': 'metal', '|NM_PLASTIC': 'plastic', '|NM_GLASS': 'glass', '|NM_RUBBER': 'rubber' };

export function slotTypeOf(parts: readonly Part[], part: Part): string {
  const base = part.variantOf ? parts.find((p) => p.id === part.variantOf) : undefined;
  return (base ?? part).name;
}

/** The body: the root-kind base part (the taxonomy root), else the first top-level base part. */
export function bodyPart(doc: Pick<Doc, 'parts'>, tax: TaxonomyLookup): Part | undefined {
  const bases = doc.parts.filter((p) => !p.variantOf);
  return bases.find((p) => tax.entry(p.taxonomyId)?.parent === null) ?? bases.find((p) => !p.parentPartId);
}

/**
 * The node group a part's flexbodies bind to: its own slot when it has nodes,
 * otherwise the nearest ancestor slot that has nodes (riders, suspension parts until Phase 10).
 */
export function flexGroupOf(doc: Doc, part: Part): string | null {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const slotsWithNodes = new Set<string>();
  for (const n of doc.nodes) {
    const owner = byId.get(n.partId);
    if (owner) slotsWithNodes.add(slotTypeOf(doc.parts, owner));
  }
  for (let cur: Part | undefined = part, guard = 0; cur && guard < 64; cur = cur.parentPartId ? byId.get(cur.parentPartId) : undefined, guard++) {
    const slot = slotTypeOf(doc.parts, cur);
    // The part's own slot counts only when it has nodes itself: another option for the same slot (a variant) is
    // never installed with it, so the group its nodes make wouldn't be there.
    if (cur === part ? doc.nodes.some((n) => n.partId === part.id) : slotsWithNodes.has(slot)) return slot;
  }
  return null;
}

/**
 * Can these nodes carry a mesh? The game fits each vertex to a node and two more that aren't in
 * line with it, so a flexbody group needs three nodes not all on one line.
 */
export function holdsMesh(points: readonly (readonly [number, number, number])[]): boolean {
  if (points.length < 3) return false;
  let a = points[0]!;
  let b = a;
  let far = 0;
  for (const p of points) {
    const d = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
    if (d > far) [far, b] = [d, p];
  }
  if (far < 0.02) return false;
  a = b;
  far = 0;
  for (const p of points) {
    const d = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
    if (d > far) [far, b] = [d, p];
  }
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const len = Math.hypot(...ab);
  return points.some((p) => {
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]] as const;
    const cross = Math.hypot(ap[1] * ab[2] - ap[2] * ab[1], ap[2] * ab[0] - ap[0] * ab[2], ap[0] * ab[1] - ap[1] * ab[0]);
    return cross / len > 0.02;
  });
}

/**
 * The groups a part's meshes bind to: its group, and when those nodes can't carry a mesh (a door
 * glass on its two runner nodes), the groups of the parts above it too until they can.
 */
export function flexGroupsOf(doc: Doc, part: Part, group: string): string[] {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const slotOfNode = (partId: string) => {
    const p = byId.get(partId);
    return p ? slotTypeOf(doc.parts, p) : null;
  };
  const nodesOf = (slot: string) => doc.nodes.filter((n) => slotOfNode(n.partId) === slot).map((n) => n.pos);
  const groups = [group];
  const points = nodesOf(group);
  for (let cur = part.parentPartId ? byId.get(part.parentPartId) : undefined, guard = 0; cur && !holdsMesh(points) && guard < 64; cur = cur.parentPartId ? byId.get(cur.parentPartId) : undefined, guard++) {
    const slot = slotTypeOf(doc.parts, cur);
    if (groups.includes(slot)) continue;
    const more = nodesOf(slot);
    if (!more.length) continue;
    groups.push(slot);
    points.push(...more);
  }
  return groups;
}

function num(n: number): number {
  const r = Math.round(n * 1e4) / 1e4;
  return r === 0 ? 0 : r; // never write -0
}

/** Readable order: by number, then centre / l / r (b1, b1l, b1r, b2, …). */
function nodeOrder(a: StructNode, b: StructNode): number {
  const parse = (id: string) => {
    const m = id.match(/^(.*?)(\d+)(l|r)?$/);
    return m ? { stem: m[1]!, n: Number(m[2]), side: m[3] === 'l' ? 1 : m[3] === 'r' ? 2 : 0 } : { stem: id, n: 0, side: 0 };
  };
  const x = parse(a.id);
  const y = parse(b.id);
  return x.stem.localeCompare(y.stem) || x.n - y.n || x.side - y.side;
}

/** A row's hand-set properties (JBeam workspace), without the ones JBeam Forge writes itself. */
function rowOptions(options: RowOptions | undefined, target: keyof typeof RESERVED): JbeamObject | undefined {
  if (!options) return undefined;
  const out: JbeamObject = {};
  for (const [k, v] of Object.entries(options)) if (!RESERVED[target].includes(k)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** They're written on the row itself ("…, {"collision": false}]"), so the rows after it are untouched. */
function inline(options: RowOptions | undefined, target: keyof typeof RESERVED): { inlineOptions?: JbeamObject } {
  const own = rowOptions(options, target);
  return own ? { inlineOptions: own } : {};
}

function beamOptions(v: BeamValues): JbeamObject {
  return { beamSpring: v.beamSpring, beamDamp: v.beamDamp, beamDeform: v.beamDeform, beamStrength: v.beamStrength ?? 'FLT_MAX' };
}

/** Settings adjustable in game: jbeam variable names, by setting. */
type PartVars = Partial<Record<TuningVar['setting'], string>>;

/** "$=12.5*$hood_mass": a value scaled by a tuning variable (or the plain value). */
function scaled(value: number, variable: string | undefined): JbeamValue {
  return variable ? `$=${num(value)}*${variable}` : value;
}

export function variableName(part: Pick<Part, 'name'>, setting: TuningVar['setting']): string {
  return `$${part.name.replace(/[^A-Za-z0-9_]/g, '_')}_${setting}`;
}

const SETTING_TEXT: Record<TuningVar['setting'], { title: string; description: string }> = {
  mass: { title: 'Weight', description: 'Scales the part’s weight' },
  stiffness: { title: 'Stiffness', description: 'Scales how stiff the part’s structure is' },
  strength: { title: 'Strength', description: 'Scales how much it takes to bend or break the part' },
  downforce: { title: 'Downforce', description: 'Scales the downforce it makes (angle of attack)' },
};

/**
 * Aero parts: lift on their upward-facing triangles (the game's wings are a
 * single upward-facing surface, found by the normals of the stock sunburst2
 * spoilers), drag on all of them. Values from the stock parts.
 */
export const AERO: Readonly<Record<string, { lift: number; stall: number; drag: number }>> = {
  wing: { lift: 70, stall: 0.24, drag: 44 },
  spoiler: { lift: 15, stall: 0.3, drag: 11 },
  splitter: { lift: 20, stall: 0.3, drag: 20 },
  lip: { lift: 10, stall: 0.3, drag: 15 },
};

function variablesSection(part: Part, vars: readonly TuningVar[]): WritableValue[] {
  return [
    ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
    ...vars.map((v) => [variableName(part, v.setting), 'range', 'x', part.displayName, num(v.default), num(v.min), num(v.max), SETTING_TEXT[v.setting].title, SETTING_TEXT[v.setting].description, { stepDis: 0.01 }] as WritableValue[]),
  ];
}

function nodesSection(nodes: readonly StructNode[], group: string, preset: BeamPresetId, vars: PartVars = {}, soft?: Softening, touching?: ReadonlySet<string>): WritableValue[] {
  const p = BEAM_PRESET_VALUES[preset];
  const records: WritableRecord[] = [...nodes].sort(nodeOrder).map((n) => ({
    values: { id: n.id, posX: num(n.pos[0]), posY: num(n.pos[1]), posZ: num(n.pos[2]) },
    // A node that starts against another part's surface stays out of self-collision (contact.ts).
    options: { nodeMaterial: p.nodeMaterial, frictionCoef: 0.5, collision: true, selfCollision: !touching?.has(n.id), group, nodeWeight: scaled(soft?.weights.get(n.id) ?? n.weight, vars.mass), ...rowOptions(n.options, 'node') },
    ...inline(n.options, 'node'),
  }));
  const table = writeTable(['id', 'posX', 'posY', 'posZ'], records, { resetValues: { group: '' } });
  return [...table, { group: '' }];
}

/** Glass shatters: its beams deforming past a little trigger its flexbodies to swap to the damaged material. */
export const glassBreakGroup = (part: Pick<Part, 'name'>) => `${part.name}_break`;
export const damagedMaterialName = (name: string) => `${name}_dmg`;

function beamsSection(part: Part, beams: readonly StructBeam[], preset: BeamPresetId, attachStyle: keyof typeof ATTACHMENT_VALUES, hinge: Hinge | undefined, pos: (id: string) => [number, number, number] | undefined, vars: PartVars = {}, glass = false, soft?: Softening, shell = false): WritableValue[] {
  const a = ATTACHMENT_VALUES[attachStyle];
  const common = { beamType: '|NORMAL', beamPrecompression: 1, deformLimitExpansion: DEFORM_LIMIT_EXPANSION };
  const order = { edge: 0, brace: 1, attach: 2, mount: 3, hinge: 4, limit: 5, support: 6, popopen: 7 } as const;
  // Eased beams sit together within their kind, so their values are written once.
  const ease = (b: StructBeam) => soft?.beams.get(b)?.k ?? 1;
  // A beam between two nodes in the same place (a hinge pivot landing on a panel node) holds nothing
  // and the game warns about it ("zero size beam"): left out.
  const zero = (b: StructBeam) => {
    const p = pos(b.id1);
    const q = pos(b.id2);
    return !!p && !!q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.001;
  };
  const sorted = beams.filter((b) => !zero(b)).sort((x, y) => order[x.kind] - order[y.kind] || ease(y) - ease(x));
  const records: WritableRecord[] = sorted.map((b) => {
    const values = { 'id1:': b.id1, 'id2:': b.id2 };
    // The limiter's bound comes from the opening angle and where its two ends are.
    const p1 = pos(b.id1);
    const p2 = pos(b.id2);
    const bound = b.kind === 'limit' && hinge && p1 && p2 ? limiterBound(p1, p2, hinge.axis, hinge.openAngle * hinge.direction) : 1;
    const v = beamPhysics(b.kind, preset, attachStyle, part.name, hinge, bound);
    const special: JbeamObject = v.beamType
      ? {
          beamType: `|${v.beamType}`,
          beamPrecompression: v.precompression ?? 1,
          beamLongBound: num(v.longBound ?? 1),
          beamShortBound: num(v.shortBound ?? 1),
          beamLimitSpring: v.limitSpring ?? 0,
          beamLimitDamp: v.limitDamp ?? 0,
          breakGroupType: v.breakGroupType ?? 0,
        }
      : {};
    const eased = soft?.beams.get(b);
    const options: JbeamObject = { ...common, ...beamOptions(eased ? { ...v, beamSpring: softenedValue(v.beamSpring, eased.k), beamDamp: softenedValue(v.beamDamp, eased.c) } : v), ...(v.breakGroup ? { breakGroup: v.breakGroup } : {}), ...special };
    // The part's own structure (skin and bracing) follows its in-game stiffness and strength.
    if (glass && (b.kind === 'edge' || b.kind === 'brace')) {
      options.deformGroup = glassBreakGroup(part);
      options.deformationTriggerRatio = 0.02;
    }
    // A shell's nodes are a fraction of the block's weight, and its beams are eased by as much: an
    // engine block's 6 MN/m beams between 4 kg nodes shook until they bent (31 mm, on every car).
    if (shell && (b.kind === 'edge' || b.kind === 'brace')) {
      for (const key of ['beamSpring', 'beamDamp', 'beamDeform'] as const) if (typeof options[key] === 'number') options[key] = Math.round(options[key] * SHELL_WEIGHT);
    }
    if (b.kind === 'edge' || b.kind === 'brace') {
      if (vars.stiffness && typeof options.beamSpring === 'number') options.beamSpring = scaled(options.beamSpring, vars.stiffness);
      if (vars.strength && typeof options.beamDeform === 'number') options.beamDeform = scaled(options.beamDeform, vars.strength);
      if (vars.strength && typeof options.beamStrength === 'number') options.beamStrength = scaled(options.beamStrength, vars.strength);
    }
    return { values, options: { ...options, ...rowOptions(b.options, 'beam') }, ...inline(b.options, 'beam') };
  });
  const comments = new Map<number, string>();
  const firstBrace = sorted.findIndex((b) => b.kind === 'brace');
  const firstAttach = sorted.findIndex((b) => b.kind === 'attach');
  const firstHinge = sorted.findIndex((b) => b.kind === 'mount' || b.kind === 'hinge');
  const firstLimit = sorted.findIndex((b) => b.kind === 'limit');
  const firstSeal = sorted.findIndex((b) => b.kind === 'support');
  const firstPop = sorted.findIndex((b) => b.kind === 'popopen');
  if (sorted.length) comments.set(0, 'skin');
  if (firstBrace > 0) comments.set(firstBrace, 'bracing');
  if (firstAttach >= 0) comments.set(firstAttach, `attachment to parent (${a.label.toLowerCase()})`);
  if (firstHinge >= 0) comments.set(firstHinge, 'hinge');
  if (firstLimit >= 0) comments.set(firstLimit, `opening limit (${hinge?.openAngle ?? '?'}°)`);
  if (firstSeal >= 0) comments.set(firstSeal, 'seal supports');
  if (firstPop >= 0) comments.set(firstPop, 'pops open when unlatched');
  const table = writeTable(['id1:', 'id2:'], records, { resetValues: { breakGroup: '', deformGroup: '', deformationTriggerRatio: '' }, comments });
  return firstAttach >= 0 && a.breakGroup ? [...table, { breakGroup: '' }] : table;
}

function trianglesSection(tris: readonly StructTri[], group: string, preset: BeamPresetId, aero?: { lift: number; stall: number; drag: number; pos: (id: string) => [number, number, number] | undefined; downforce?: string }): WritableValue[] {
  const gm = GROUND_MODEL[BEAM_PRESET_VALUES[preset].nodeMaterial] ?? 'metal';
  const facesUp = (t: StructTri) => {
    const [a, b, c] = t.ids.map((id) => aero!.pos(id));
    if (!a || !b || !c) return false;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    return len > 0 && n[2]! / len > 0.6;
  };
  const records: WritableRecord[] = tris.map((t) => {
    const lift = aero && facesUp(t) ? { liftCoef: scaled(aero.lift, aero.downforce), stallAngle: aero.stall } : undefined;
    const own = rowOptions(t.options, 'tri');
    const rowOnly = lift || own ? { ...lift, ...own } : undefined;
    return { values: { 'id1:': t.ids[0], 'id2:': t.ids[1], 'id3:': t.ids[2] }, options: { ...(aero ? { dragCoef: aero.drag } : {}), groundModel: gm, group, ...rowOnly }, ...(rowOnly ? { inlineOptions: rowOnly } : {}) };
  });
  return [...writeTable(['id1:', 'id2:', 'id3:'], records, { resetValues: { group: '' }, inlineKeys: ['liftCoef', 'stallAngle'] }), { group: '' }];
}

function slotsFor(doc: Doc, children: readonly Part[], coreSlotType: string | null): WritableValue[] {
  const rows: WritableValue[] = [['name', 'allowTypes', 'denyTypes', 'default', 'description']];
  const seen = new Set<string>();
  for (const child of children) {
    const st = slotTypeOf(doc.parts, child);
    if (seen.has(st)) continue;
    seen.add(st);
    const base = child.variantOf ? doc.parts.find((p) => p.id === child.variantOf)! : child;
    const row: WritableValue[] = [st, [st], [], base.name, base.displayName];
    if (st === coreSlotType) row.push({ coreSlot: true });
    rows.push(row);
  }
  return rows;
}

/** The energy storages a set's engines and motors draw from, by name (the game's default is mainTank). */
export function fuelStoragesOf(parts: Readonly<Record<string, JbeamObject>>): string[] {
  const names = new Set<string>();
  for (const p of Object.values(parts))
    for (const section of Object.values(p)) {
      if (!isJbeamObject(section) || typeof section.requiredEnergyType !== 'string') continue;
      const named = typeof section.energyStorage === 'string' ? [section.energyStorage] : Array.isArray(section.energyStorage) ? section.energyStorage.filter((n): n is string => typeof n === 'string') : ['mainTank'];
      for (const n of named) names.add(n);
    }
  return [...names];
}

/** Build every jbeam file of the mod. */
export function buildJbeamFiles(fullDoc: Doc, tax: TaxonomyLookup, opts: JbeamExportOptions): JbeamFile[] {
  const slug = fullDoc.meta.slug;
  const files: JbeamFile[] = [];
  // Fitted suspensions, engine and gearbox: their project parts are replaced by the game's own jbeam, brought over.
  const pt = fullDoc.powertrain;
  const fittedSources = [...(fullDoc.axles ?? []).flatMap((a) => (a.fitted ? [a.fitted.sourceId] : [])), ...(pt?.engine ? [pt.engine.sourceId] : []), ...(pt?.gearbox ? [pt.gearbox.sourceId] : [])];
  const fitted = new Set(fittedSources);
  const fromFitted = (k: string) => fitted.has(k.slice(0, k.indexOf(':')));
  const doc: Doc = { ...fullDoc, parts: fullDoc.parts.filter((p) => !SET_KINDS.has(p.taxonomyId)) };
  const setParts = new Set(fullDoc.parts.filter((p) => SET_KINDS.has(p.taxonomyId)).map((p) => p.id));
  const bodyNodes = fullDoc.nodes.filter((n) => !setParts.has(n.partId));
  // Where a borrowed suspension, engine or gearbox bolts on: the body and its structure (frame,
  // floor, subframes…). Not the doors, hood or an engine block of ours: a suspension tied to the
  // doors and the hood pulled the car apart as it settled.
  const mountNodes = (() => {
    const body = bodyPart(doc, tax);
    const structural = new Set(doc.parts.filter((p) => p.id === body?.id || (tax.entry(p.taxonomyId)?.beamPreset === 'structure_stiff' && !tax.entry(p.taxonomyId)?.openable)).map((p) => p.id));
    const nodes = bodyNodes.filter((n) => structural.has(n.partId));
    return nodes.length ? nodes : bodyNodes;
  })();
  const extraSlots: WritableValue[] = [];
  // Parts not built from our structure (the game's sets, plates, the hitch): their beams load our nodes.
  const foreign: JbeamObject[] = [];
  const data = (setId: string) => opts.suspensions?.[setId];
  // Meshes of a set bound to groups only the original car had ride on our body instead.
  const bodyGroup = (() => {
    const b = bodyPart(doc, tax);
    return b ? (flexGroupOf(doc, b) ?? undefined) : undefined;
  })();
  const bring = (setId: string, sourceId: string, tag: string, target: readonly { id: string; pos: [number, number, number] }[], tuning: Record<string, number>, slotRewrites?: Record<string, { slotType: string; part: string }>, edits?: PowertrainEdits, choices?: SetChoices, driveline?: PowertrainEdits, linkedNodes?: Record<string, string>) => {
    const found = opts.suspensions?.[setId];
    if (!found) return null;
    // The game's other parts the user chose, then the engine and gearbox builders' changes, onto the game's parts before they're renamed.
    const chosen = applyChoices(found, found.options, choices);
    const edited = edits ? { ...chosen, parts: applyPowertrainEdits(chosen.parts, chosen.root, edits) } : chosen;
    const data = driveline ? { ...edited, parts: applyDrivelineEdits(edited.parts, driveline) } : edited;
    const meshNames: Record<string, string> = {};
    for (const [key, name] of opts.meshNames) if (key.startsWith(`${sourceId}:`) && !key.includes('/')) meshNames[key.slice(sourceId.length + 1)] = name;
    const offset = fullDoc.sources?.find((s) => s.id === sourceId)?.placement.position ?? [0, 0, 0];
    // Every engine shares the e_ node names (only one is fitted at a time), so the gearbox fits whichever is chosen.
    const t = transplantSuspension({ parts: data.parts, root: data.root, anchors: data.anchors, offset, partPrefix: `${slug}_${tag}_`, nodePrefix: `${tag.startsWith('E') ? 'e' : tag.toLowerCase()}_`, target, meshNames, tuning, slotRewrites, linkedNodes, fallbackGroup: bodyGroup, held: found.held });
    for (const [name, content] of Object.entries(t.parts)) files.push({ file: `${name}.jbeam`, part: name, text: serializeJbeam({ [name]: content }) });
    foreign.push(...Object.values(t.parts));
    return t;
  };
  const axleSets: { index: number; t: ReturnType<typeof transplantSuspension> }[] = [];
  // A drive shaft or differential that pushed against its own car's engine block (its torque
  // reaction nodes e3r, e4r, e2l) pushes against the block of the engine fitted here. Left to
  // stand-ins bolted to the body, one of them sat 146 mm out of place at rest.
  const blockOfEngine: Record<string, string> = {};
  const fittedEngine = pt?.engine ? opts.suspensions?.[pt.engine.setId] : undefined;
  if (fittedEngine) {
    // Only the points every engine that can be chosen has.
    const others = (pt?.alternates ?? []).map((a) => opts.suspensions?.[a.setId]).map((s) => (s ? blockNodes(s.parts) : new Map<string, unknown>()));
    for (const id of blockNodes(fittedEngine.parts).keys()) if (others.every((o) => o.has(id))) blockOfEngine[id] = `e_${id}`;
  }
  (fullDoc.axles ?? []).forEach((axle, i) => {
    if (!axle.fitted) return;
    const t = bring(axle.fitted.setId, axle.fitted.sourceId, axleTag(i), mountNodes, axle.tuning, undefined, undefined, axle.fitted.choices, axle.edits, blockOfEngine);
    if (!t) return;
    axleSets.push({ index: i, t });
    extraSlots.push([t.rootSlotType, [t.rootSlotType], [], t.rootPart, `${axle.name} suspension`]);
    // The user's own meshes ride on the set's nodes (every node group the set's meshes used).
    const own = axle.ownMeshes.filter((k) => opts.meshNames.has(k) && !fullDoc.ignoredMeshes.includes(k)).map((k) => opts.meshNames.get(k)!);
    if (own.length) {
      const groups = new Set<string>();
      const setParts = data(axle.fitted.setId)?.parts ?? {};
      const made = setGroups(setParts);
      for (const p of Object.values(setParts)) {
        if (!Array.isArray(p.flexbodies)) continue;
        for (const row of p.flexbodies.slice(1)) if (Array.isArray(row) && Array.isArray(row[1])) for (const g of row[1]) if (typeof g === 'string') groups.add(made.has(g) || !bodyGroup ? g : bodyGroup);
      }
      const root = t.parts[t.rootPart]!;
      const rows = Array.isArray(root.flexbodies) ? root.flexbodies : [['mesh', '[group]:', 'nonFlexMaterials']];
      root.flexbodies = [...rows, ...own.map((m) => [m, [...groups]])];
      const file = files.find((f) => f.part === t.rootPart);
      if (file) file.text = serializeJbeam({ [t.rootPart]: root });
    }
  });
  // The gearbox plugs into the engine's transmission slot (renamed ahead so the engine can point at it).
  const box = pt?.gearbox ? opts.suspensions?.[pt.gearbox.setId] : undefined;
  const boxSlot = box ? firstSlotType(box.parts[box.root]) || box.root : null;
  // Each engine's transmission slot is pointed at our gearbox.
  const rewritesFor = (setId: string) => {
    const engineData = opts.suspensions?.[setId];
    const slots = engineData && boxSlot ? Object.values(engineData.parts).flatMap((p) => slotDefaultsOf(p).filter((r) => /transmission|transaxle|gearbox/i.test(r.type)).map((r) => r.type)) : [];
    return { slots, rewrites: Object.fromEntries(slots.map((st) => [st, { slotType: `${slug}_G_${boxSlot}`, part: `${slug}_G_${box!.root}` }])) };
  };
  const engineTransmissionSlots = pt?.engine ? rewritesFor(pt.engine.setId).slots : [];
  // An engine's mounts often sit on the gearbox's nodes: point them at the gearbox's renamed ones (its prefix is g_).
  const gearboxNodes: Record<string, string> = engineTransmissionSlots.length && box ? Object.fromEntries(Object.values(box.parts).flatMap((p) => [...definedNodes(p).keys()].map((id) => [id, `g_${id}`]))) : {};
  let engineNodes: { id: string; pos: [number, number, number]; weight?: number; structural?: boolean }[] = [];
  let engineParts: Record<string, JbeamObject> | null = null;
  let gearboxParts: Record<string, JbeamObject> | null = null;
  // Every engine that can sit in front of the gearbox (the default and the alternates).
  const engineRevs: RevRange[] = [];
  if (pt?.engine) {
    const tags = engineTags(pt);
    const t = bring(pt.engine.setId, pt.engine.sourceId, tags.get(pt.engine.sourceId) ?? 'E', mountNodes, pt.engine.tuning, rewritesFor(pt.engine.setId).rewrites, pt.engine.edits, pt.engine.choices, undefined, gearboxNodes);
    if (t) {
      // One engine slot name whichever engine is the default (engines from different cars name theirs differently), so configurations keep working.
      const engineSlot = engineSlotType(slug);
      const setSlot = (part: string, content: JbeamObject | undefined) => {
        if (!content) return;
        content.slotType = engineSlot;
        const file = files.find((f) => f.part === part);
        if (file) file.text = serializeJbeam({ [part]: content });
      };
      if (engineSlot !== t.rootSlotType) setSlot(t.rootPart, t.parts[t.rootPart]);
      extraSlots.push([engineSlot, [engineSlot], [], t.rootPart, 'Engine']);
      engineNodes = Object.values(t.parts).flatMap((p) => {
        const weights = definedWeights(p);
        return [...definedNodes(p)].map(([id, pos]) => ({ id, pos, weight: weights.get(id), structural: false }));
      });
      engineParts = t.parts;
      const range = engineRevRange(Object.values(t.parts));
      if (range) engineRevs.push(range);
      // The engine designer's own model rides on the engine's nodes, on the groups the game engine's meshes used.
      const own = (pt.engine.ownMeshes ?? []).filter((k) => opts.meshNames.has(k) && !fullDoc.ignoredMeshes.includes(k)).map((k) => opts.meshNames.get(k)!);
      if (own.length) {
        const setParts = data(pt.engine.setId)?.parts ?? {};
        const made = setGroups(setParts);
        const used = new Set<string>();
        for (const p of Object.values(setParts)) {
          if (!Array.isArray(p.flexbodies)) continue;
          for (const row of p.flexbodies.slice(1)) if (Array.isArray(row) && Array.isArray(row[1])) for (const g of row[1]) if (typeof g === 'string' && made.has(g)) used.add(g);
        }
        const groups = used.size ? [...used] : [...made];
        const root = t.parts[t.rootPart]!;
        const rows = Array.isArray(root.flexbodies) ? root.flexbodies : [['mesh', '[group]:', 'nonFlexMaterials']];
        root.flexbodies = [...rows, ...own.map((m) => [m, groups])];
        const file = files.find((f) => f.part === t.rootPart);
        if (file) file.text = serializeJbeam({ [t.rootPart]: root });
      }
      // The other engines fill the same slot: the player (or a configuration) picks one.
      for (const alt of pt.alternates ?? []) {
        const a = bring(alt.setId, alt.sourceId, tags.get(alt.sourceId) ?? 'E2', mountNodes, alt.tuning, rewritesFor(alt.setId).rewrites, alt.edits, alt.choices, undefined, rewritesFor(alt.setId).slots.length ? gearboxNodes : undefined);
        if (a) setSlot(a.rootPart, a.parts[a.rootPart]);
        const altRange = a ? engineRevRange(Object.values(a.parts)) : null;
        if (altRange) engineRevs.push(altRange);
      }
    }
  }
  if (pt?.gearbox) {
    // Its beams to its own car's engine block go to the same points of the engine fitted here, by name
    // (by place, a block of another size left them on stand-ins bolted to the body).
    const t = bring(pt.gearbox.setId, pt.gearbox.sourceId, 'G', [...engineNodes, ...mountNodes], pt.gearbox.tuning, undefined, pt.gearbox.edits, pt.gearbox.choices, undefined, blockOfEngine);
    // Without an engine of ours to plug into, the gearbox hangs off the body.
    if (t && !engineTransmissionSlots.length) extraSlots.push([t.rootSlotType, [t.rootSlotType], [], t.rootPart, 'Transmission']);
    // Its launch and shift revs were written for its own car's engine: brought into ours' range
    // (a race transaxle behind a bus diesel never let the clutch in). What the modder set stays.
    const revs = engineRevs.length ? { idle: Math.max(...engineRevs.map((r) => r.idle)), limit: Math.min(...engineRevs.map((r) => r.limit)) } : null;
    if (t && revs) {
      const keep = new Set(Object.keys(pt.gearbox.edits?.fields ?? {}).map((k) => `${slug}_G_${k}`));
      const fitted = fitShiftingToEngine(t.parts, t.rootPart, revs, keep);
      for (const name of fitted.changed) {
        // Changed in place: the drive shafts below and the car's load sums hold on to these parts.
        Object.assign(t.parts[name]!, fitted.parts[name]);
        const file = files.find((f) => f.part === name);
        if (file) file.text = serializeJbeam({ [name]: t.parts[name]! });
      }
    }
    if (t) gearboxParts = t.parts;
  }
  // Drive shafts: join the gearbox to the driven axles' differentials (and drop the rest's rows).
  if (axleSets.length && (engineParts || gearboxParts)) {
    const axles = fullDoc.axles ?? [];
    const plan = planDrivetrain({ engine: engineParts, gearbox: gearboxParts, axles: axleSets.map(({ index, t }) => ({ index, name: axles[index]!.name, y: axles[index]!.y, parts: t.parts })) }, pt?.drivetrain ?? DEFAULT_DRIVETRAIN);
    for (const { index, t } of axleSets) {
      for (const part of applyDrivetrainToAxle(t.parts, plan, index)) {
        const file = files.find((f) => f.part === part);
        if (file) file.text = serializeJbeam({ [part]: t.parts[part]! });
      }
    }
    if (gearboxParts)
      for (const part of applyDrivetrainToGearbox(gearboxParts, plan)) {
        const file = files.find((f) => f.part === part);
        if (file) file.text = serializeJbeam({ [part]: gearboxParts[part]! });
      }
    if (plan.rows) {
      const name = `${slug}_drivetrain`;
      files.push({ file: `${name}.jbeam`, part: name, text: serializeJbeam({ [name]: { information: { authors: opts.author || 'JBeam Forge', name: 'Drive shafts' }, slotType: name, powertrain: plan.rows as WritableValue[] } }) });
      extraSlots.push([name, [name], [], name, 'Drive shafts', { coreSlot: true }]);
    }
  }
  const body = bodyPart(doc, tax);
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  // Children hang on the parent's *slot*: every variant of the parent declares the same child slots.
  const childrenOf = (p: Part) => {
    const slot = slotTypeOf(doc.parts, p);
    return doc.parts.filter((c) => {
      const parent = c.parentPartId ? byId.get(c.parentPartId) : undefined;
      return !!parent && c.id !== p.id && slotTypeOf(doc.parts, parent) === slot;
    });
  };
  const roots = doc.parts.filter((p) => !p.parentPartId || !byId.has(p.parentPartId));
  const bodySlot = body ? slotTypeOf(doc.parts, body) : null;
  // The car's own engine model with one of the game's engines fitted: the game's engine is the
  // real one now, in the same place. The model stays as a light shell that collides with nothing,
  // or two engine blocks would fight for the bay and push the bonnet off. (Lightened here, so the
  // easing of its beams goes by the weight it will have.)
  const isShell = (part: Part) => part.taxonomyId === 'engine' && !!engineParts;
  const ownNodes = (part: Part) => {
    const entry = tax.entry(part.taxonomyId);
    const nodes = entry && partRole(entry, partSettings(doc, part, entry)) === 'own' ? doc.nodes.filter((n) => n.partId === part.id) : [];
    return isShell(part) ? nodes.map((n) => ({ ...n, weight: Math.max(0.5, Math.round(n.weight * SHELL_WEIGHT * 1000) / 1000), options: { ...n.options, collision: false, selfCollision: false } })) : nodes;
  };
  // With a game suspension on an axle, that axle's own wheels, tyres and brakes ride on the game's wheel:
  // the rim and disc spin with its hub, the tyre with its tyre, the caliper steers with the knuckle.
  const wheelGroups = new Map<string, string[]>();
  (fullDoc.axles ?? []).forEach((axle, i) => {
    const set = axle.fitted ? opts.suspensions?.[axle.fitted.setId] : undefined;
    if (!set || i > 1) return;
    for (const w of setWheels(set.parts)) {
      const corner = `${i === 0 ? 'F' : 'R'}${w.side}`;
      for (const p of doc.parts.filter((x) => x.position === corner)) {
        const g = p.taxonomyId === 'tire' ? w.tireGroup : p.taxonomyId === 'brake_caliper' ? w.armGroup : ['wheel', 'brake_disc', 'brake_drum', 'hub'].includes(p.taxonomyId) ? w.hubGroup : undefined;
        if (g) wheelGroups.set(p.id, [g]);
      }
    }
  });
  const groupOf = (part: Part) => (ownNodes(part).length ? slotTypeOf(doc.parts, part) : flexGroupOf(doc, part));

  // Plates, tow hitch, nitrous, paint designs, and the game's global slots.
  const fx = buildFeatureParts(fullDoc.features ?? { plates: { front: null, rear: null }, hitch: null, nitrous: null, skins: [] }, {
    slug,
    author: opts.author,
    groupOf: (id) => {
      const p = byId.get(id);
      return p ? groupOf(p) : null;
    },
    nodes: bodyNodes.map((n) => ({ id: n.id, pos: n.pos, partId: n.partId })),
    hasPart: (id) => !!byId.get(id) && !!tax.entry(byId.get(id)!.taxonomyId),
    bodyPartId: body?.id ?? null,
    hasEngine: !!pt?.engine && !!opts.suspensions?.[pt.engine.setId],
    fuelStorages: [...new Set([pt?.engine, ...(pt?.alternates ?? [])].flatMap((e) => (e ? fuelStoragesOf(opts.suspensions?.[e.setId]?.parts ?? {}) : [])))],
  });
  for (const [name, content] of Object.entries(fx.parts)) files.push({ file: `${name}.jbeam`, part: name, text: serializeJbeam({ [name]: content }) });
  foreign.push(...(Object.values(fx.parts) as JbeamObject[]));

  const main: WritableObject = {
    [slug]: {
      information: { authors: opts.author || 'JBeam Forge', name: doc.meta.name },
      slotType: 'main',
      ...(opts.glowMap && Object.keys(opts.glowMap).length ? { glowMap: opts.glowMap as unknown as WritableValue } : {}),
      slots2: [...slotsFor(doc, roots, bodySlot), ...fx.mainSlots],
    },
  };
  files.push({ file: `${slug}.jbeam`, part: slug, text: serializeJbeam(main) });

  // Animated meshes move as props, not flexbodies (those that can't be hung stay flexbodies).
  const propFrames = exportableProps(fullDoc, bodyPart(doc, tax)?.id, nodesExported(doc, tax));
  const propKeys = new Set(propFrames.keys());
  const meshesOf = (partId: string) =>
    Object.keys(doc.assignments)
      .filter((k) => doc.assignments[k] === partId && !doc.ignoredMeshes.includes(k) && opts.meshNames.has(k) && !fromFitted(k) && !propKeys.has(k))
      .map((k) => opts.meshNames.get(k)!)
      .sort();

  const softening = softenForGame(doc, tax, ownNodes, foreign);
  const nodePos = new Map<string, [number, number, number]>();
  for (const n of doc.nodes) if (!nodePos.has(n.id)) nodePos.set(n.id, n.pos);
  opts.onStability?.({ softened: softening.softened, addedKg: softening.addedKg, heavier: softening.weights.size });
  // A part and its variants are never fitted together: they count as one part here.
  const baseOf = new Map(doc.parts.map((p) => [p.id, p.variantOf ?? p.id]));
  const touchingParts = nodesTouchingOtherParts(
    doc.nodes.map((n) => ({ id: n.id, pos: n.pos, partId: baseOf.get(n.partId) ?? n.partId })),
    doc.tris.map((t) => ({ ids: t.ids, partId: baseOf.get(t.partId) ?? t.partId })),
    undefined,
    // Doors, the bonnet and the boot lid too. They were left to collide where they shut against the
    // body, but their latch, hinges and seal supports are what hold them, and the contact shoved
    // them out of shape the moment the car spawned (a bonnet's corners 23 mm, a boot lid 26 mm, measured
    // in the game): their edges looked torn and the doors stood ajar.
  );
  // Nodes beside a fitted suspension's wheels too. On a suspension softer or lower than the body
  // was drawn for, the tyre rides tucked up into the arch, and arch nodes that collided with it
  // were pushed out of shape and held the wheel back.
  const touching = new Set(touchingParts);
  for (const axle of fullDoc.axles ?? []) {
    const parts = axle.fitted ? opts.suspensions?.[axle.fitted.setId]?.parts : undefined;
    if (!axle.fitted || !parts) continue;
    const offset = fullDoc.sources?.find((s) => s.id === axle.fitted!.sourceId)?.placement.position ?? [0, 0, 0];
    for (const wheel of setWheels(parts, offset))
      for (const n of bodyNodes) {
        const v = [n.pos[0] - wheel.centre[0], n.pos[1] - wheel.centre[1], n.pos[2] - wheel.centre[2]];
        const along = v[0]! * wheel.axis[0] + v[1]! * wheel.axis[1] + v[2]! * wheel.axis[2];
        // Where only the hub face is known the tyre is outboard of it.
        if (wheel.exact ? Math.abs(along) > WHEEL_ZONE_SIDE : along < -0.1 || along > 2 * WHEEL_ZONE_SIDE) continue;
        if (Math.sqrt(Math.max(0, v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2 - along ** 2)) <= WHEEL_ZONE_RADIUS) touching.add(n.id);
      }
  }

  for (const part of doc.parts) {
    const entry = tax.entry(part.taxonomyId);
    if (!entry) continue;
    const settings = partSettings(doc, part, entry);
    const preset = materialDefaults(entry, part.constructionMaterial).beamPreset;
    const own = partRole(entry, settings) === 'own';
    const shell = isShell(part);
    // A hinged part's hinge and latch nodes sit on top of nodes of its skin (and the latch's other
    // half belongs with the body): out of the group its meshes are hung on, or the game builds a
    // mesh's frame on two nodes no distance apart and the skin there tears into spikes. Nor do they
    // collide: they are points of a mechanism, not surface, and one a few centimetres under the
    // part's own skin was pushed away by it.
    const helpers = doc.hinges.some((h) => h.partId === part.id) ? hingeIds(doc, part.id) : null;
    const helperIds = new Set(helpers ? [...helpers.hinge, helpers.latchPart, helpers.latchBody].filter((x): x is string => !!x) : []);
    const nodes = (own ? ownNodes(part) : []).map((n) => (helperIds.has(n.id) ? { ...n, options: { ...n.options, group: '', collision: false, selfCollision: false } } : n));
    const beams = own ? doc.beams.filter((b) => b.partId === part.id) : [];
    const tris = own && !shell ? doc.tris.filter((t) => t.partId === part.id) : [];
    const slotType = slotTypeOf(doc.parts, part);
    const group = nodes.length ? slotType : flexGroupOf(doc, part);
    const groups = !nodes.length ? wheelGroups.get(part.id) : undefined;
    const meshes = meshesOf(part.id);

    const content: Record<string, WritableValue> = {
      information: { authors: opts.author || 'JBeam Forge', name: part.displayName, value: partPrice(part, entry) },
      slotType,
    };
    const kids = childrenOf(part);
    if (kids.length) content.slots2 = slotsFor(doc, kids, null);
    // The body carries the fitted suspensions' slots.
    // Plates and the hitch hang on the mount's slot, so every variant of it carries them.
    const featureSlots = doc.parts.filter((p) => slotTypeOf(doc.parts, p) === slotType).flatMap((p) => fx.partSlots.get(p.id) ?? []);
    const moreSlots = [...(part.id === body?.id ? extraSlots : []), ...featureSlots];
    if (moreSlots.length) content.slots2 = [...((content.slots2 as WritableValue[] | undefined) ?? [['name', 'allowTypes', 'denyTypes', 'default', 'description']]), ...moreSlots];
    if (part.id === body?.id && doc.proxy.refNodes) {
      const r = doc.proxy.refNodes;
      content.refNodes = [['ref:', 'back:', 'left:', 'up:', 'leftCorner:', 'rightCorner:'], [r.ref, r.back, r.left, r.up, r.leftCorner, r.rightCorner]];
      content.cameraExternal = cameraFor(nodes);
      const internal = fullDoc.cameras?.length ? camerasInternalSection(fullDoc.cameras, nodes) : null;
      if (internal) content.camerasInternal = internal;
    }
    const glass = entry.beamPreset === 'glass_brittle' && nodes.length > 0;
    if (meshes.length && (groups ?? group)) {
      const bind = groups ?? flexGroupsOf(doc, part, group!);
      const rows: WritableValue[] = [['mesh', '[group]:', 'nonFlexMaterials']];
      for (const m of meshes) {
        const mat = glass ? opts.meshMaterials?.get(m)?.[0] : undefined;
        if (mat) rows.push({ deformGroup: glassBreakGroup(part), deformMaterialBase: mat, deformMaterialDamaged: damagedMaterialName(mat) });
        rows.push([m, bind]);
      }
      if (glass && rows.length > meshes.length + 1) rows.push({ deformGroup: '' });
      content.flexbodies = rows;
    }
    const props = [...propFrames.values()].filter((x) => doc.assignments[x.prop.meshKey] === part.id && opts.meshNames.has(x.prop.meshKey));
    if (props.length) {
      const posOf = (id: string) => nodePos.get(id)!;
      content.props = [PROPS_HEADER, ...props.map((x) => propRow(x.prop, opts.meshNames.get(x.prop.meshKey)!, x.refs, posOf))];
    }
    const tuningVars = (fullDoc.variables ?? []).filter((v) => v.partId === part.id);
    const partVars: PartVars = Object.fromEntries(tuningVars.map((v) => [v.setting, variableName(part, v.setting)]));
    if (tuningVars.length && nodes.length) content.variables = variablesSection(part, tuningVars);
    if (nodes.length) content.nodes = nodesSection(nodes, slotType, preset, partVars, softening, touching);
    const hinge = own ? doc.hinges.find((h) => h.partId === part.id) : undefined;
    const posOf = (id: string) => nodePos.get(id);
    if (beams.length) content.beams = beamsSection(part, beams, preset, settings.attachment, hinge, posOf, partVars, glass, softening, shell);
    const aero = AERO[part.taxonomyId];
    if (tris.length) content.triangles = trianglesSection(tris, slotType, preset, aero && { ...aero, pos: posOf, downforce: partVars.downforce });
    if (hinge && nodes.length) Object.assign(content, hingeSections(doc, part, hinge, nodes));
    const clickable = (doc.triggers ?? []).filter((t) => t.partId === part.id);
    if (clickable.length && nodes.length >= 3) addTriggers(content, clickable, nodes);
    const scripted = opts.scripts?.get(part.id);
    if (scripted) {
      const rows = Array.isArray(content.controller) ? (content.controller) : [['fileName']];
      content.controller = [...rows, ...(scripted.rows as unknown as WritableValue[])];
      for (const [k, v] of Object.entries(scripted.sections)) if (!(k in content)) content[k] = v as WritableValue;
    }
    const doc1: WritableObject = { [part.name]: content };
    files.push({ file: `${part.name}.jbeam`, part: part.name, text: serializeJbeam(doc1) });
  }
  // What the game's borrowed parts expect from a car's own main part: the drive controller, fuel
  // or batteries, tuning variables they use. Added once every part is known.
  const extra = mainAdditions(
    files.filter((f) => f.part !== slug).map((f) => f.text),
    !!pt?.engine && !!opts.suspensions?.[pt.engine.setId],
  );
  const mainPart = main[slug] as WritableObject;
  if (extra.controller) mainPart.controller = extra.controller;
  if (extra.energyStorage) {
    mainPart.energyStorage = extra.energyStorage;
    for (const [name, section] of Object.entries(extra.storages)) mainPart[name] = section;
  }
  if (extra.variables.length) mainPart.variables = [['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'], ...extra.variables] as WritableValue;
  const mainFile = files.find((f) => f.part === slug);
  if (mainFile) mainFile.text = serializeJbeam(main);
  return files;
}

/** Spring or damping set by hand on a beam (its row options): never eased. */
const handSet = (b: StructBeam) => !!b.options && ('beamSpring' in b.options || 'beamDamp' in b.options);

/** A foreign part's beams, as springs on their two nodes (numbers only: a $variable is left out). */
function foreignBeams(part: JbeamObject): StabiliseBeam[] {
  if (!part.beams) return [];
  try {
    return readTable(part.beams).records.flatMap((r) => {
      const type = typeof r.options.beamType === 'string' ? r.options.beamType : '|NORMAL';
      if (type.includes('BOUNDED') || type.includes('HYDRO') || type.includes('PRESSURED')) return [];
      const spring = typeof r.options.beamSpring === 'number' ? r.options.beamSpring : r.options.beamSpring === undefined ? 4_300_000 : 0;
      const damp = typeof r.options.beamDamp === 'number' ? r.options.beamDamp : r.options.beamDamp === undefined ? 580 : 0;
      const id1 = r.values['id1:'];
      const id2 = r.values['id2:'];
      return typeof id1 === 'string' && typeof id2 === 'string' ? [{ id1, id2, spring, damp, fixed: true }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Every exported beam and node together, eased so no node is past what the game's 2000 Hz step holds
 * (see proxy/stability.ts). Our beams soften; the game's and hand-set ones stay, and their nodes get weight.
 */
function softenForGame(doc: Doc, tax: TaxonomyLookup, ownNodes: (part: Part) => StructNode[], foreign: readonly JbeamObject[]): Softening & { softened: number; addedKg: number } {
  const weights = new Map<string, number>();
  const ours: StructBeam[] = [];
  const list: StabiliseBeam[] = [];
  const pos = new Map<string, [number, number, number]>();
  for (const n of doc.nodes) if (!pos.has(n.id)) pos.set(n.id, n.pos);
  const beamsOf = new Map<string, StructBeam[]>();
  for (const b of doc.beams) {
    const l = beamsOf.get(b.partId);
    if (l) l.push(b);
    else beamsOf.set(b.partId, [b]);
  }
  for (const part of doc.parts) {
    const entry = tax.entry(part.taxonomyId);
    const nodes = entry ? ownNodes(part) : [];
    if (!entry || !nodes.length) continue;
    // Variants share node names (one is fitted at a time): the lightest decides.
    for (const n of nodes) weights.set(n.id, Math.min(weights.get(n.id) ?? Infinity, n.weight));
    const settings = partSettings(doc, part, entry);
    const preset = materialDefaults(entry, part.constructionMaterial).beamPreset;
    const hinge = doc.hinges.find((h) => h.partId === part.id);
    for (const b of beamsOf.get(part.id) ?? []) {
      const p1 = pos.get(b.id1);
      const p2 = pos.get(b.id2);
      const bound = b.kind === 'limit' && hinge && p1 && p2 ? limiterBound(p1, p2, hinge.axis, hinge.openAngle * hinge.direction) : 1;
      const v = beamPhysics(b.kind, preset, settings.attachment, part.name, hinge, bound);
      if (v.beamType === 'BOUNDED') continue;
      const own = b.options ?? {};
      const spring = typeof own.beamSpring === 'number' ? own.beamSpring : v.beamSpring;
      const damp = typeof own.beamDamp === 'number' ? own.beamDamp : v.beamDamp;
      ours.push(b);
      list.push({ id1: b.id1, id2: b.id2, spring, damp, fixed: handSet(b) });
    }
  }
  const foreignList = foreign.flatMap(foreignBeams);
  const r = stabilise(weights, [...list, ...foreignList]);
  const beams = new Map<StructBeam, { k: number; c: number }>();
  ours.forEach((b, i) => {
    const k = r.springScale[i]!;
    const c = r.dampScale[i]!;
    if (k < 1 || c < 1) beams.set(b, { k, c });
  });
  return { beams, weights: r.weights, softened: r.softened, addedKg: r.addedKg };
}

/**
 * The latch coupler, handle triggers and the input action wiring of a hinged
 * part, in the form the stock doors use (advancedCouplerControl + triggers2).
 */
function hingeSections(doc: Doc, part: Part, hinge: Hinge, nodes: readonly StructNode[]): Record<string, WritableValue> {
  const ids = hingeIds(doc, part.id);
  const out: Record<string, WritableValue> = {};
  const coupler = couplerFor(hinge.action);
  if (ids.latchPart && ids.latchBody) {
    out.controller = [['fileName'], ['advancedCouplerControl', { name: coupler }]];
    out[coupler] = {
      couplerNodes: [
        ['cid1', 'cid2', 'autoCouplingStrength', 'autoCouplingRadius', 'autoCouplingLockRadius', 'autoCouplingSpeed', 'couplingStartRadius', 'breakGroup'],
        [ids.latchBody, ids.latchPart, hinge.latchStrength, hinge.autoLatch ? 0.01 : 0, 0.005, 0.2, 0.1, `${part.name}_latch`],
      ],
      groupType: 'autoCoupling',
      attachSoundVolume: 1,
      detachSoundVolume: 1,
      'soundNode:': [ids.latchPart],
      attachSoundEvent: 'event:>Vehicle>Latches>Door>modern_06_close',
      detachSoundEvent: 'event:>Vehicle>Latches>Door>modern_06_open',
      breakSoundEvent: '',
      openForceMagnitude: 50,
      openForceDuration: 0.45,
      closeForceMagnitude: 60,
      closeForceDuration: 0.5,
    };
  }
  // Trigger ids: the action for the first outside handle (the stock convention), _int for inside, numbered after that.
  const used = new Map<string, number>();
  const triggers = hinge.handles.map((h) => {
    const t = triggerFrame(nodes, h.pos);
    const base = h.inside ? `${hinge.action}_int` : hinge.action;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}${n}`;
    const size = h.inside ? { x: 0.12, y: 0.03, z: 0.08 } : { x: 0.16, y: 0.03, z: 0.05 };
    return { id, row: [id, t.ref, t.x, t.y, 'box', size, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, t.offset] as WritableValue[] };
  });
  if (triggers.length) {
    out.triggers2 = [TRIGGERS_HEADER, ...triggers.map((t) => t.row)];
    out.triggerEventLinks2 = [['triggerId:triggers2', 'triggerInput', 'inputAction'], ...triggers.map((t) => [t.id, 'action0', hinge.action])];
  }
  out.actionsEnabled = [['id'], [hinge.action]];
  return out;
}

/**
 * A trigger box is placed relative to three of the part's nodes: the
 * reference node, one towards its X and one towards its Y. The box centre is
 * the handle position in that frame.
 */
const TRIGGERS_HEADER = ['id', 'idRef:', 'idX:', 'idY:', 'type', 'size', 'baseRotation', 'rotation', 'translation', 'baseTranslation'];

/**
 * The part's own triggers (JBeam Forge's Triggers workspace), added to any
 * its hinge wrote. Each box is placed in the frame of three nodes near it;
 * its size there covers the box as turned on the car.
 */
function addTriggers(content: Record<string, WritableValue>, triggers: readonly Trigger[], nodes: readonly StructNode[]): void {
  const rows = (Array.isArray(content.triggers2) ? content.triggers2.slice(1) : []) as WritableValue[][];
  const links = (Array.isArray(content.triggerEventLinks2) ? content.triggerEventLinks2.slice(1) : []) as WritableValue[][];
  const taken = new Set(rows.map((r) => (typeof r[0] === 'string' ? r[0] : '')));
  for (const t of triggers) {
    let id = t.id;
    for (let i = 2; taken.has(id); i++) id = `${t.id}${i}`;
    taken.add(id);
    const f = triggerFrame(nodes, t.pos);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const c of triggerCorners(t)) {
      const d = [c[0] - f.origin[0]!, c[1] - f.origin[1]!, c[2] - f.origin[2]!];
      f.axes.forEach((ax, k) => {
        const v = d[0]! * ax[0]! + d[1]! * ax[1]! + d[2]! * ax[2]!;
        lo[k] = Math.min(lo[k]!, v);
        hi[k] = Math.max(hi[k]!, v);
      });
    }
    const size = { x: num(hi[0]! - lo[0]!), y: num(hi[1]! - lo[1]!), z: num(hi[2]! - lo[2]!) };
    const centre = { x: num((hi[0]! + lo[0]!) / 2), y: num((hi[1]! + lo[1]!) / 2), z: num((hi[2]! + lo[2]!) / 2) };
    rows.push([id, f.ref, f.x, f.y, 'box', size, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, centre]);
    links.push([id, 'action0', t.action]);
  }
  content.triggers2 = [TRIGGERS_HEADER, ...rows];
  content.triggerEventLinks2 = [['triggerId:triggers2', 'triggerInput', 'inputAction'], ...links];
}

function triggerFrame(nodes: readonly StructNode[], at: readonly number[]): { ref: string; x: string; y: string; offset: JbeamObject; origin: readonly number[]; axes: number[][] } {
  const byDist = [...nodes].sort((a, b) => Math.hypot(a.pos[0] - at[0]!, a.pos[1] - at[1]!, a.pos[2] - at[2]!) - Math.hypot(b.pos[0] - at[0]!, b.pos[1] - at[1]!, b.pos[2] - at[2]!));
  const ref = byDist[0]!;
  const sub = (p: readonly number[], q: readonly number[]) => [p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!];
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return v.map((c) => c / l);
  };
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  // X towards the next node; Y towards the first node that isn't along X.
  const xNode = byDist.find((n) => n !== ref && Math.hypot(...sub(n.pos, ref.pos)) > 0.02) ?? byDist[1]!;
  const ex = norm(sub(xNode.pos, ref.pos));
  const yNode = byDist.find((n) => n !== ref && n !== xNode && Math.abs(dot(norm(sub(n.pos, ref.pos)), ex)) < 0.9) ?? byDist[2]!;
  const yRaw = sub(yNode.pos, ref.pos);
  const ey = norm(yRaw.map((c, i) => c - dot(yRaw, ex) * ex[i]!));
  const ez = [ex[1]! * ey[2]! - ex[2]! * ey[1]!, ex[2]! * ey[0]! - ex[0]! * ey[2]!, ex[0]! * ey[1]! - ex[1]! * ey[0]!];
  const d = sub(at, ref.pos);
  return { ref: ref.id, x: xNode.id, y: yNode.id, offset: { x: num(dot(d, ex)), y: num(dot(d, ey)), z: num(dot(d, ez)) }, origin: ref.pos, axes: [ex, ey, ez] };
}

/** Chase camera sized from the body (official Sunburst: distance 5.1 for a ~4.3 m car). */
function cameraFor(nodes: readonly StructNode[]): JbeamObject {
  const ys = nodes.map((n) => n.pos[1]);
  const zs = nodes.map((n) => n.pos[2]);
  const length = ys.length ? Math.max(...ys) - Math.min(...ys) : 4;
  const height = zs.length ? Math.max(...zs) - Math.min(...zs) : 1.4;
  return { distance: num(Math.max(3, length * 1.2)), offset: { x: 0, y: 0, z: num(height * 0.3) }, distanceMin: 2, fov: 65 };
}

export { JbeamComment };
export type { JbeamValue };
