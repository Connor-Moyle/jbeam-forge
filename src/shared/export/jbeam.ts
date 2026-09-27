import type { Part, Project, StructBeam, StructNode, StructTri, TuningVar } from '../project/schema';
import type { TaxonomyEntry } from '../taxonomy/schema';
import type { JbeamObject, JbeamValue } from '../jbeam/parse';
import { serializeJbeam, JbeamComment, type WritableObject, type WritableValue } from '../jbeam/serialize';
import { writeTable, type WritableRecord } from '../jbeam/tables';
import { materialDefaults, partPrice } from '../parts/materials';
import { ATTACHMENT_VALUES, BEAM_PRESET_VALUES, type BeamPresetId, type BeamValues } from '../proxy/presets';
import { partRole, partSettings } from '../proxy/generate';
import { beamPhysics, DEFORM_LIMIT_EXPANSION } from '../proxy/beamValues';
import { couplerFor, type Hinge } from '../hinges/schema';
import { hingeIds } from '../hinges/build';
import { limiterBound } from '../hinges/geometry';
import { definedNodes, transplantSuspension } from '../suspension/transplant';
import { buildFeatureParts } from './features';

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

type Doc = Pick<Project, 'meta' | 'parts' | 'assignments' | 'ignoredMeshes' | 'nodes' | 'beams' | 'tris' | 'proxy' | 'hinges'> & Partial<Pick<Project, 'axles' | 'sources' | 'powertrain' | 'variables' | 'features'>>;

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
}

export interface SuspensionSetData {
  parts: Record<string, JbeamObject>;
  anchors: Record<string, [number, number, number]>;
  root: string;
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

/** Parts standing in for a fitted suspension, engine or gearbox (replaced by the game's jbeam on export). */
export const SET_KINDS: ReadonlySet<string> = new Set(['suspension_set', 'engine_set', 'gearbox_set']);

/** Axle tags for part and node names: F, R, R2, R3… */
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
    if (slotsWithNodes.has(slot)) return slot;
  }
  return null;
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

function nodesSection(nodes: readonly StructNode[], group: string, preset: BeamPresetId, vars: PartVars = {}): WritableValue[] {
  const p = BEAM_PRESET_VALUES[preset];
  const records: WritableRecord[] = [...nodes].sort(nodeOrder).map((n) => ({
    values: { id: n.id, posX: num(n.pos[0]), posY: num(n.pos[1]), posZ: num(n.pos[2]) },
    options: { nodeMaterial: p.nodeMaterial, frictionCoef: 0.5, collision: true, selfCollision: true, group, nodeWeight: scaled(n.weight, vars.mass) },
  }));
  const table = writeTable(['id', 'posX', 'posY', 'posZ'], records, { resetValues: { group: '' } });
  return [...table, { group: '' }];
}

/** Glass shatters: its beams deforming past a little trigger its flexbodies to swap to the damaged material. */
export const glassBreakGroup = (part: Pick<Part, 'name'>) => `${part.name}_break`;
export const damagedMaterialName = (name: string) => `${name}_dmg`;

function beamsSection(part: Part, beams: readonly StructBeam[], preset: BeamPresetId, attachStyle: keyof typeof ATTACHMENT_VALUES, hinge: Hinge | undefined, pos: (id: string) => [number, number, number] | undefined, vars: PartVars = {}, glass = false): WritableValue[] {
  const a = ATTACHMENT_VALUES[attachStyle];
  const common = { beamType: '|NORMAL', beamPrecompression: 1, deformLimitExpansion: DEFORM_LIMIT_EXPANSION };
  const order = { edge: 0, brace: 1, attach: 2, mount: 3, hinge: 4, limit: 5, support: 6, popopen: 7 } as const;
  const sorted = [...beams].sort((x, y) => order[x.kind] - order[y.kind]);
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
    const options: JbeamObject = { ...common, ...beamOptions(v), ...(v.breakGroup ? { breakGroup: v.breakGroup } : {}), ...special };
    // The part's own structure (skin and bracing) follows its in-game stiffness and strength.
    if (glass && (b.kind === 'edge' || b.kind === 'brace')) {
      options.deformGroup = glassBreakGroup(part);
      options.deformationTriggerRatio = 0.02;
    }
    if (b.kind === 'edge' || b.kind === 'brace') {
      if (vars.stiffness && typeof options.beamSpring === 'number') options.beamSpring = scaled(options.beamSpring, vars.stiffness);
      if (vars.strength && typeof options.beamDeform === 'number') options.beamDeform = scaled(options.beamDeform, vars.strength);
      if (vars.strength && typeof options.beamStrength === 'number') options.beamStrength = scaled(options.beamStrength, vars.strength);
    }
    return { values, options };
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
    return { values: { 'id1:': t.ids[0], 'id2:': t.ids[1], 'id3:': t.ids[2] }, options: { ...(aero ? { dragCoef: aero.drag } : {}), groundModel: gm, group, ...lift }, ...(lift ? { inlineOptions: lift } : {}) };
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
  const extraSlots: WritableValue[] = [];
  const data = (setId: string) => opts.suspensions?.[setId];
  const bring = (setId: string, sourceId: string, tag: string, target: readonly { id: string; pos: [number, number, number] }[], tuning: Record<string, number>, slotRewrites?: Record<string, { slotType: string; part: string }>) => {
    const data = opts.suspensions?.[setId];
    if (!data) return null;
    const meshNames: Record<string, string> = {};
    for (const [key, name] of opts.meshNames) if (key.startsWith(`${sourceId}:`) && !key.includes('/')) meshNames[key.slice(sourceId.length + 1)] = name;
    const offset = fullDoc.sources?.find((s) => s.id === sourceId)?.placement.position ?? [0, 0, 0];
    const t = transplantSuspension({ parts: data.parts, root: data.root, anchors: data.anchors, offset, partPrefix: `${slug}_${tag}_`, nodePrefix: `${tag.toLowerCase()}_`, target, meshNames, tuning, slotRewrites });
    for (const [name, content] of Object.entries(t.parts)) files.push({ file: `${name}.jbeam`, part: name, text: serializeJbeam({ [name]: content }) });
    return t;
  };
  (fullDoc.axles ?? []).forEach((axle, i) => {
    if (!axle.fitted) return;
    const t = bring(axle.fitted.setId, axle.fitted.sourceId, axleTag(i), bodyNodes, axle.tuning);
    if (!t) return;
    extraSlots.push([t.rootSlotType, [t.rootSlotType], [], t.rootPart, `${axle.name} suspension`]);
    // The user's own meshes ride on the set's nodes (every node group the set's meshes used).
    const own = axle.ownMeshes.filter((k) => opts.meshNames.has(k) && !fullDoc.ignoredMeshes.includes(k)).map((k) => opts.meshNames.get(k)!);
    if (own.length) {
      const groups = new Set<string>();
      for (const p of Object.values(data(axle.fitted.setId)?.parts ?? {})) {
        if (!Array.isArray(p.flexbodies)) continue;
        for (const row of p.flexbodies.slice(1)) if (Array.isArray(row) && Array.isArray(row[1])) for (const g of row[1]) if (typeof g === 'string') groups.add(g);
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
  const boxSlot = box ? (typeof box.parts[box.root]?.slotType === 'string' ? (box.parts[box.root]!.slotType as string) : box.root) : null;
  const engineData = pt?.engine ? opts.suspensions?.[pt.engine.setId] : undefined;
  const engineTransmissionSlots = engineData && boxSlot ? Object.values(engineData.parts).flatMap((p) => slotDefaultsOf(p).filter((r) => /transmission|transaxle|gearbox/i.test(r.type)).map((r) => r.type)) : [];
  const rewrites = Object.fromEntries(engineTransmissionSlots.map((st) => [st, { slotType: `${slug}_G_${boxSlot}`, part: `${slug}_G_${box!.root}` }]));
  let engineNodes: { id: string; pos: [number, number, number] }[] = [];
  if (pt?.engine) {
    const t = bring(pt.engine.setId, pt.engine.sourceId, 'E', bodyNodes, pt.engine.tuning, rewrites);
    if (t) {
      extraSlots.push([t.rootSlotType, [t.rootSlotType], [], t.rootPart, 'Engine']);
      engineNodes = Object.values(t.parts).flatMap((p) => [...definedNodes(p)].map(([id, pos]) => ({ id, pos })));
    }
  }
  if (pt?.gearbox) {
    const t = bring(pt.gearbox.setId, pt.gearbox.sourceId, 'G', [...engineNodes, ...bodyNodes], pt.gearbox.tuning);
    // Without an engine of ours to plug into, the gearbox hangs off the body.
    if (t && !engineTransmissionSlots.length) extraSlots.push([t.rootSlotType, [t.rootSlotType], [], t.rootPart, 'Transmission']);
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
  const ownNodes = (part: Part) => {
    const entry = tax.entry(part.taxonomyId);
    return entry && partRole(entry, partSettings(doc, part, entry)) === 'own' ? doc.nodes.filter((n) => n.partId === part.id) : [];
  };
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
  });
  for (const [name, content] of Object.entries(fx.parts)) files.push({ file: `${name}.jbeam`, part: name, text: serializeJbeam({ [name]: content }) });

  const main: WritableObject = {
    [slug]: {
      information: { authors: opts.author || 'JBeam Forge', name: doc.meta.name },
      slotType: 'main',
      ...(opts.glowMap && Object.keys(opts.glowMap).length ? { glowMap: opts.glowMap as unknown as WritableValue } : {}),
      slots2: [...slotsFor(doc, roots, bodySlot), ...fx.mainSlots],
    },
  };
  files.push({ file: `${slug}.jbeam`, part: slug, text: serializeJbeam(main) });

  const meshesOf = (partId: string) =>
    Object.keys(doc.assignments)
      .filter((k) => doc.assignments[k] === partId && !doc.ignoredMeshes.includes(k) && opts.meshNames.has(k) && !fromFitted(k))
      .map((k) => opts.meshNames.get(k)!)
      .sort();

  for (const part of doc.parts) {
    const entry = tax.entry(part.taxonomyId);
    if (!entry) continue;
    const settings = partSettings(doc, part, entry);
    const preset = materialDefaults(entry, part.constructionMaterial).beamPreset;
    const own = partRole(entry, settings) === 'own';
    const nodes = own ? ownNodes(part) : [];
    const beams = own ? doc.beams.filter((b) => b.partId === part.id) : [];
    const tris = own ? doc.tris.filter((t) => t.partId === part.id) : [];
    const slotType = slotTypeOf(doc.parts, part);
    const group = nodes.length ? slotType : flexGroupOf(doc, part);
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
    }
    const glass = entry.beamPreset === 'glass_brittle' && nodes.length > 0;
    if (meshes.length && group) {
      const rows: WritableValue[] = [['mesh', '[group]:', 'nonFlexMaterials']];
      for (const m of meshes) {
        const mat = glass ? opts.meshMaterials?.get(m)?.[0] : undefined;
        if (mat) rows.push({ deformGroup: glassBreakGroup(part), deformMaterialBase: mat, deformMaterialDamaged: damagedMaterialName(mat) });
        rows.push([m, [group]]);
      }
      if (glass && rows.length > meshes.length + 1) rows.push({ deformGroup: '' });
      content.flexbodies = rows;
    }
    const tuningVars = (fullDoc.variables ?? []).filter((v) => v.partId === part.id);
    const partVars: PartVars = Object.fromEntries(tuningVars.map((v) => [v.setting, variableName(part, v.setting)]));
    if (tuningVars.length && nodes.length) content.variables = variablesSection(part, tuningVars);
    if (nodes.length) content.nodes = nodesSection(nodes, slotType, preset, partVars);
    const hinge = own ? doc.hinges.find((h) => h.partId === part.id) : undefined;
    const posOf = (id: string) => doc.nodes.find((n) => n.id === id)?.pos;
    if (beams.length) content.beams = beamsSection(part, beams, preset, settings.attachment, hinge, posOf, partVars, glass);
    const aero = AERO[part.taxonomyId];
    if (tris.length) content.triangles = trianglesSection(tris, slotType, preset, aero && { ...aero, pos: posOf, downforce: partVars.downforce });
    if (hinge && nodes.length) Object.assign(content, hingeSections(doc, part, hinge, nodes));
    const doc1: WritableObject = { [part.name]: content };
    files.push({ file: `${part.name}.jbeam`, part: part.name, text: serializeJbeam(doc1) });
  }
  return files;
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
    out.triggers2 = [['id', 'idRef:', 'idX:', 'idY:', 'type', 'size', 'baseRotation', 'rotation', 'translation', 'baseTranslation'], ...triggers.map((t) => t.row)];
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
function triggerFrame(nodes: readonly StructNode[], at: readonly number[]): { ref: string; x: string; y: string; offset: JbeamObject } {
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
  return { ref: ref.id, x: xNode.id, y: yNode.id, offset: { x: num(dot(d, ex)), y: num(dot(d, ey)), z: num(dot(d, ez)) } };
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
