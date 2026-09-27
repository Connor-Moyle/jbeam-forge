import type { Part, Project, StructBeam, StructNode, StructTri } from '../project/schema';
import type { TaxonomyEntry } from '../taxonomy/schema';
import type { JbeamObject, JbeamValue } from '../jbeam/parse';
import { serializeJbeam, JbeamComment, type WritableObject, type WritableValue } from '../jbeam/serialize';
import { writeTable, type WritableRecord } from '../jbeam/tables';
import { materialDefaults } from '../parts/materials';
import { ATTACHMENT_VALUES, BEAM_PRESET_VALUES, type BeamPresetId, type BeamValues } from '../proxy/presets';
import { partRole, partSettings } from '../proxy/generate';
import { beamPhysics, DEFORM_LIMIT_EXPANSION } from '../proxy/beamValues';

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

type Doc = Pick<Project, 'meta' | 'parts' | 'assignments' | 'ignoredMeshes' | 'nodes' | 'beams' | 'tris' | 'proxy'>;

export interface TaxonomyLookup {
  entry(id: string): TaxonomyEntry | undefined;
}

export interface JbeamExportOptions {
  /** meshKey → exported DAE node name (only exported meshes). */
  meshNames: ReadonlyMap<string, string>;
  author: string;
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

function nodesSection(nodes: readonly StructNode[], group: string, preset: BeamPresetId): WritableValue[] {
  const p = BEAM_PRESET_VALUES[preset];
  const records: WritableRecord[] = [...nodes].sort(nodeOrder).map((n) => ({
    values: { id: n.id, posX: num(n.pos[0]), posY: num(n.pos[1]), posZ: num(n.pos[2]) },
    options: { nodeMaterial: p.nodeMaterial, frictionCoef: 0.5, collision: true, selfCollision: true, group, nodeWeight: n.weight },
  }));
  const table = writeTable(['id', 'posX', 'posY', 'posZ'], records, { resetValues: { group: '' } });
  return [...table, { group: '' }];
}

function beamsSection(part: Part, beams: readonly StructBeam[], preset: BeamPresetId, attachStyle: keyof typeof ATTACHMENT_VALUES): WritableValue[] {
  const a = ATTACHMENT_VALUES[attachStyle];
  const common = { beamType: '|NORMAL', beamPrecompression: 1, deformLimitExpansion: DEFORM_LIMIT_EXPANSION };
  const order = { edge: 0, brace: 1, attach: 2 } as const;
  const sorted = [...beams].sort((x, y) => order[x.kind] - order[y.kind]);
  const records: WritableRecord[] = sorted.map((b) => {
    const values = { 'id1:': b.id1, 'id2:': b.id2 };
    const v = beamPhysics(b.kind, preset, attachStyle, part.name);
    return { values, options: { ...common, ...beamOptions(v), ...(v.breakGroup ? { breakGroup: v.breakGroup } : {}) } };
  });
  const comments = new Map<number, string>();
  const firstBrace = sorted.findIndex((b) => b.kind === 'brace');
  const firstAttach = sorted.findIndex((b) => b.kind === 'attach');
  if (sorted.length) comments.set(0, 'skin');
  if (firstBrace > 0) comments.set(firstBrace, 'bracing');
  if (firstAttach >= 0) comments.set(firstAttach, `attachment to parent (${a.label.toLowerCase()})`);
  const table = writeTable(['id1:', 'id2:'], records, { resetValues: { breakGroup: '' }, comments });
  return firstAttach >= 0 && a.breakGroup ? [...table, { breakGroup: '' }] : table;
}

function trianglesSection(tris: readonly StructTri[], group: string, preset: BeamPresetId): WritableValue[] {
  const gm = GROUND_MODEL[BEAM_PRESET_VALUES[preset].nodeMaterial] ?? 'metal';
  const records: WritableRecord[] = tris.map((t) => ({ values: { 'id1:': t.ids[0], 'id2:': t.ids[1], 'id3:': t.ids[2] }, options: { groundModel: gm, group } }));
  return [...writeTable(['id1:', 'id2:', 'id3:'], records, { resetValues: { group: '' } }), { group: '' }];
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
export function buildJbeamFiles(doc: Doc, tax: TaxonomyLookup, opts: JbeamExportOptions): JbeamFile[] {
  const slug = doc.meta.slug;
  const files: JbeamFile[] = [];
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

  const main: WritableObject = {
    [slug]: {
      information: { authors: opts.author || 'JBeam Forge', name: doc.meta.name },
      slotType: 'main',
      slots2: slotsFor(doc, roots, bodySlot),
    },
  };
  files.push({ file: `${slug}.jbeam`, part: slug, text: serializeJbeam(main) });

  const meshesOf = (partId: string) =>
    Object.keys(doc.assignments)
      .filter((k) => doc.assignments[k] === partId && !doc.ignoredMeshes.includes(k) && opts.meshNames.has(k))
      .map((k) => opts.meshNames.get(k)!)
      .sort();

  for (const part of doc.parts) {
    const entry = tax.entry(part.taxonomyId);
    if (!entry) continue;
    const settings = partSettings(doc, part, entry);
    const preset = materialDefaults(entry, part.constructionMaterial).beamPreset;
    const own = partRole(entry, settings) === 'own';
    const nodes = own ? doc.nodes.filter((n) => n.partId === part.id) : [];
    const beams = own ? doc.beams.filter((b) => b.partId === part.id) : [];
    const tris = own ? doc.tris.filter((t) => t.partId === part.id) : [];
    const slotType = slotTypeOf(doc.parts, part);
    const group = nodes.length ? slotType : flexGroupOf(doc, part);
    const meshes = meshesOf(part.id);

    const content: Record<string, WritableValue> = {
      information: { authors: opts.author || 'JBeam Forge', name: part.displayName, value: part.price },
      slotType,
    };
    const kids = childrenOf(part);
    if (kids.length) content.slots2 = slotsFor(doc, kids, null);
    if (part.id === body?.id && doc.proxy.refNodes) {
      const r = doc.proxy.refNodes;
      content.refNodes = [['ref:', 'back:', 'left:', 'up:', 'leftCorner:', 'rightCorner:'], [r.ref, r.back, r.left, r.up, r.leftCorner, r.rightCorner]];
      content.cameraExternal = cameraFor(nodes);
    }
    if (meshes.length && group) content.flexbodies = [['mesh', '[group]:', 'nonFlexMaterials'], ...meshes.map((m) => [m, [group]] as WritableValue[])];
    if (nodes.length) content.nodes = nodesSection(nodes, slotType, preset);
    if (beams.length) content.beams = beamsSection(part, beams, preset, settings.attachment);
    if (tris.length) content.triangles = trianglesSection(tris, slotType, preset);
    const doc1: WritableObject = { [part.name]: content };
    files.push({ file: `${part.name}.jbeam`, part: part.name, text: serializeJbeam(doc1) });
  }
  return files;
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
