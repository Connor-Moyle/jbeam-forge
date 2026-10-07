import type { Part, PartProxy, Project, StructNode } from '../project/schema';
import type { TaxonomyEntry } from '../taxonomy/schema';
import { materialDefaults } from '../parts/materials';
import { bindable, buildProxy } from './build';
import { orientOpenAway } from './quality';
import type { ProxyMesh } from './mesh';
import { attachToParent, deriveStructure, FAR_FROM_PARENT, parentGap, placeRefNodes, positionTag, predictStability, presetSprings, type StabilityReport } from './derive';
import { BEAM_PRESET_VALUES, kindDefaults, targetVertices } from './presets';
import { adoptManualNodes } from '../structure/edit';
import { applyHinge } from '../hinges/apply';

/**
 * Generate parts' structure into the document (SPEC §4.4). Pure: works on
 * the project (an immer draft inside a Command) plus each part's merged
 * render geometry. Requires `await meshoptReady` beforehand.
 */

type Doc = Pick<Project, 'parts' | 'nodes' | 'beams' | 'tris' | 'proxy' | 'hinges'>;

export interface TaxonomyLookup {
  entry(id: string): TaxonomyEntry | undefined;
}

export interface PartGeometry {
  partId: string;
  /** All of the part's meshes merged, BeamNG space. */
  mesh: ProxyMesh;
}

export interface PartReport {
  partId: string;
  vertices: number;
  beams: number;
  triangles: number;
  massKg: number;
  mirrored: boolean;
  ms: number;
  warnings: string[];
  stability: StabilityReport;
}

export function defaultProxySettings(entry: TaxonomyEntry): PartProxy {
  const d = kindDefaults(entry);
  return { mode: d.mode, detail: 0.5, symmetry: true, maxEdge: 0.75, minEdge: 0.04, inset: 0.005, bracing: d.bracing, attachment: d.attachment, massKg: null };
}

export function partSettings(doc: Pick<Doc, 'proxy'>, part: Part, entry: TaxonomyEntry): PartProxy {
  return doc.proxy.parts[part.id] ?? defaultProxySettings(entry);
}

export function partMass(part: Part, entry: TaxonomyEntry, settings: PartProxy): number {
  return settings.massKg ?? materialDefaults(entry, part.constructionMaterial).mass;
}

export function nodePrefix(part: Part, entry: TaxonomyEntry): string {
  return `${entry.nodePrefix}${positionTag(entry.positionAxis, part.position)}`;
}

/** Parts of the same slot (a base and its variants) may reuse node ids: only one is ever installed. */
function slotOf(parts: readonly Part[], id: string): string {
  const p = parts.find((x) => x.id === id);
  return p?.variantOf ?? id;
}

/** Order parts so parents come before children. */
function topological(parts: readonly Part[], ids: readonly string[]): string[] {
  const want = new Set(ids);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const depth = (id: string) => {
    let d = 0;
    for (let cur = byId.get(id)?.parentPartId ?? null; cur && d < 64; cur = byId.get(cur)?.parentPartId ?? null) d++;
    return d;
  };
  return [...want].sort((a, b) => depth(a) - depth(b));
}

export interface GenerateResult {
  reports: PartReport[];
  skipped: { partId: string; reason: string }[];
  /** Parts that intentionally have no own structure (they ride on the parent, or the suspension builds them). */
  notProxies: { partId: string; role: 'rides' | 'suspension' }[];
}

/** Nodes lighter than this are avoided by capping the node count by the part's mass (official p10 is 0.3 kg). */
export const MIN_NODE_KG = 0.1;

/**
 * Most nodes a part may have for its mass: nodes stay at least MIN_NODE_KG and at least 40 % of the
 * official node weight for its preset (engine blocks use few heavy nodes; panels many light ones).
 */
export function massNodeCap(entry: TaxonomyEntry, massKg: number): number {
  const minWeight = Math.max(MIN_NODE_KG, BEAM_PRESET_VALUES[entry.beamPreset].nodeWeight * 0.4);
  return Math.max(4, Math.floor(massKg / minWeight));
}

export function partRole(entry: TaxonomyEntry, settings: PartProxy): 'own' | 'rides' | 'suspension' {
  return settings.role ?? kindDefaults(entry).role;
}

/** Panels and trim that are held flat by stiffener nodes when they come out thin (glass and mechanical parts aren't). */
const STIFFENED: ReadonlySet<string> = new Set(['panel_metal', 'panel_plastic', 'trim_light', 'structure_stiff']);

/**
 * The middle of the car, low down: a panel's inner side is the one facing it. From the body's
 * structure when there is one (regenerating a single part gives only that part's shape), else from
 * every node there is, else from the shapes being generated.
 */
function carMiddle(doc: Doc, tax: TaxonomyLookup, geometries: readonly PartGeometry[]): [number, number, number] {
  let yLo = Infinity;
  let yHi = -Infinity;
  let zLo = Infinity;
  let zHi = -Infinity;
  const take = (y: number, z: number) => {
    yLo = Math.min(yLo, y);
    yHi = Math.max(yHi, y);
    zLo = Math.min(zLo, z);
    zHi = Math.max(zHi, z);
  };
  const body = doc.parts.find((p) => tax.entry(p.taxonomyId)?.parent === null && !p.variantOf);
  const bodyNodes = body ? doc.nodes.filter((n) => n.partId === body.id) : [];
  for (const n of bodyNodes.length ? bodyNodes : doc.nodes) take(n.pos[1], n.pos[2]);
  // Shapes too when they are the whole car (a first generation), or there is no structure yet.
  if (geometries.length > 3 || !Number.isFinite(yLo))
    for (const g of geometries) {
      const p = g.mesh.positions;
      for (let v = 0; v < p.length; v += 3) take(p[v + 1]!, p[v + 2]!);
    }
  return Number.isFinite(yLo) ? [0, (yLo + yHi) / 2, zLo + (zHi - zLo) * 0.4] : [0, 0, 0.5];
}
export function generateStructure(doc: Doc, tax: TaxonomyLookup, geometries: readonly PartGeometry[]): GenerateResult {
  const geomById = new Map(geometries.map((g) => [g.partId, g.mesh]));
  const reports: PartReport[] = [];
  const skipped: GenerateResult['skipped'] = [];
  const notProxies: GenerateResult['notProxies'] = [];
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const presetOf = (partId: string) => tax.entry(byId.get(partId)?.taxonomyId ?? '')?.beamPreset;
  const attachmentOf = (partId: string) => {
    const p = byId.get(partId);
    const e = p && tax.entry(p.taxonomyId);
    return p && e ? partSettings(doc, p, e).attachment : undefined;
  };
  const springs = presetSprings(presetOf, attachmentOf);
  const regenerated = new Set<string>();
  const middle = carMiddle(doc, tax, geometries);

  for (const partId of topological(doc.parts, [...geomById.keys()])) {
    const part = byId.get(partId);
    const entry = part && tax.entry(part.taxonomyId);
    const mesh = geomById.get(partId)!;
    if (!part || !entry) {
      skipped.push({ partId, reason: 'unknown part type' });
      continue;
    }
    const settings = partSettings(doc, part, entry);
    const defaults = kindDefaults(entry);
    const role = partRole(entry, settings);
    if (role !== 'own') {
      removePartStructure(doc, partId); // a part switched to riding keeps no stale nodes
      notProxies.push({ partId, role });
      continue;
    }
    if (mesh.index.length < 3) {
      skipped.push({ partId, reason: 'no geometry' });
      continue;
    }
    const massKg = partMass(part, entry, settings);
    const cap = massNodeCap(entry, massKg);
    const target = Math.min(targetVertices(defaults.budget, settings.detail), cap);
    const build = (vertices: number) => buildProxy(mesh, { mode: settings.mode, targetVertices: vertices, symmetry: settings.symmetry, maxEdge: settings.maxEdge, minEdge: settings.minEdge, inset: settings.inset, maxVertices: Math.max(cap, vertices) });
    let built = build(target);
    // A long thin part can come out as a row of single nodes, which the game can't hang a mesh on:
    // it gets more nodes (in steps, to three times its budget) until every node has neighbours off its line.
    for (let more = Math.ceil(target * 1.5); !bindable(built.mesh) && more <= target * 3; more = Math.ceil(more * 1.5)) {
      const denser = build(more);
      if (denser.stats.vertices > built.stats.vertices) built = denser;
    }
    const fallbackWarnings: string[] = [];
    if (built.stats.vertices < 4 || built.stats.triangles < 2) {
      // Thin or fragmented shapes can clean down to nothing: every meshed part still needs nodes.
      built = buildProxy(mesh, { mode: 'box', targetVertices: 8, symmetry: false, maxEdge: 0, minEdge: 0, inset: 0 });
      fallbackWarnings.push(`The ${settings.mode} proxy came out empty (very thin or fragmented shape), so a box was fitted instead.`);
    }

    // Replace this part's structure. Nodes moved by hand stay and take the place of the regenerated node they match.
    removePartStructure(doc, partId);
    const manual = doc.nodes.filter((n) => n.partId === partId && n.manual);
    const slot = slotOf(doc.parts, partId);
    const taken = new Set(doc.nodes.filter((n) => slotOf(doc.parts, n.partId) !== slot).map((n) => n.id));
    // A panel left as one layer has its collision faces looking out of the car.
    built = { ...built, mesh: orientOpenAway(built.mesh, middle) };
    const derived = deriveStructure({ partId, mesh: built.mesh, prefix: nodePrefix(part, entry), massKg, bracing: settings.bracing, taken, ...(settings.mode !== 'surface' && STIFFENED.has(entry.beamPreset) ? { stiffenTowards: middle } : {}) });
    const adopted = adoptManualNodes(derived, manual);
    doc.nodes.push(...derived.nodes);
    doc.beams.push(...derived.beams);
    doc.tris.push(...derived.tris);
    const warnings = [...fallbackWarnings, ...derived.warnings];
    if (adopted.loose) warnings.push(`${adopted.loose} hand-moved node${adopted.loose === 1 ? ' is' : 's are'} too far from the new structure to reconnect; ${adopted.loose === 1 ? 'it was' : 'they were'} kept on ${adopted.loose === 1 ? 'its' : 'their'} own.`);
    const partNodes = [...derived.nodes, ...manual];

    const attach = attachBeams(doc, part, entry, partNodes, settings.attachment, tax);
    doc.beams.push(...attach.beams);
    // A hinged part swaps its temporary bolts for its hinge, limiter and latch.
    const hinged = hingeUp(doc, part, entry);
    if (attach.warning && !hinged) warnings.push(attach.warning);
    doc.proxy.parts[partId] = settings;
    regenerated.add(partId);

    const partBeams = [...derived.beams, ...attach.beams];
    const stability = predictStability(partNodes, partBeams, springs);
    if (stability.verdict !== 'ok') warnings.push(`Stability ${stability.verdict}: ${stability.offenders[0]?.message ?? ''}`);
    reports.push({ partId, vertices: partNodes.length, beams: partBeams.length, triangles: derived.tris.length, massKg, mirrored: built.mirrored, ms: built.stats.ms, warnings, stability });
  }

  // Children that were not regenerated keep their nodes but must re-attach: their parent's slot has new
  // nodes (and, if a variant changed, a new set of names common to every variant).
  // Grandchildren too: they may hold on to the grandparent.
  const regeneratedSlots = new Set([...regenerated].map((id) => slotOf(doc.parts, id)));
  const partById = new Map(doc.parts.map((p) => [p.id, p]));
  const upTwo = (p: Part) => {
    const parent = p.parentPartId ? partById.get(p.parentPartId) : undefined;
    return [parent, parent?.parentPartId ? partById.get(parent.parentPartId) : undefined].filter((x): x is Part => !!x);
  };
  for (const child of doc.parts) {
    if (regenerated.has(child.id) || !child.parentPartId || !upTwo(child).some((a) => regeneratedSlots.has(slotOf(doc.parts, a.id)))) continue;
    const entry = tax.entry(child.taxonomyId);
    const nodes = doc.nodes.filter((n) => n.partId === child.id);
    if (!entry || !nodes.length) continue;
    doc.beams = doc.beams.filter((b) => !(b.partId === child.id && b.kind === 'attach'));
    doc.beams.push(...attachBeams(doc, child, entry, nodes, partSettings(doc, child, entry).attachment, tax).beams);
    hingeUp(doc, child, entry);
  }

  // refNodes follow the body (placed once, or re-placed when the body regenerates).
  const body = doc.parts.find((p) => tax.entry(p.taxonomyId)?.parent === null && !p.variantOf);
  if (body && (regenerated.has(body.id) || !doc.proxy.refNodes)) {
    doc.proxy.refNodes = placeRefNodes(doc.nodes.filter((n) => n.partId === body.id));
  }
  return { reports, skipped, notProxies };
}

/** Glass: every node within this (m) of where it's held. */
export const GLASS_ATTACH_SPAN = 0.2;

/** Build the part's hinge if it has one (true when built). */
export function hingeUp(doc: Doc, part: Part, entry: TaxonomyEntry): boolean {
  const hinge = doc.hinges.find((h) => h.partId === part.id);
  if (!hinge || !part.parentPartId) return false;
  const parentIds = new Set(swapSafeParentNodes(doc, part.parentPartId).map((n) => n.id));
  return applyHinge(doc, hinge, parentIds, nodePrefix(part, entry));
}

/** Bolt a part to its parent again (after its hinge is removed). */
export function reattachPart(doc: Doc, part: Part, entry: TaxonomyEntry): void {
  const nodes = doc.nodes.filter((n) => n.partId === part.id);
  doc.beams = doc.beams.filter((b) => !(b.partId === part.id && b.kind === 'attach'));
  doc.beams.push(...attachBeams(doc, part, entry, nodes, partSettings(doc, part, entry).attachment).beams);
}

function attachBeams(doc: Doc, part: Part, entry: TaxonomyEntry, nodes: readonly StructNode[], style: PartProxy['attachment'], tax?: TaxonomyLookup) {
  if (!part.parentPartId) return { beams: [], warning: null as string | null };
  const own = swapSafeParentNodes(doc, part.parentPartId);
  // The grandparent is always fitted when the parent is, so a part can hold on to it too where the parent's
  // nodes alone would let it tip (a grille on a bumper whose nodes run along one line). Never through a
  // part that moves: glass in a door must not tie the door to the body.
  const parent = doc.parts.find((p) => p.id === part.parentPartId);
  const parentEntry = parent && tax?.entry(parent.taxonomyId);
  const parentMoves = !parent || !parentEntry || !!parentEntry.openable || doc.hinges.some((h) => h.partId === parent.id);
  const parentNodes = !parentMoves && parent?.parentPartId ? [...own, ...swapSafeParentNodes(doc, parent.parentPartId)] : own;
  if (!parentNodes.length) return { beams: [], warning: 'Its parent part has no structure yet: generate the parent, then this part attaches automatically.' };
  const gap = parentGap(nodes, parentNodes);
  // Openable parts are held shut by temporary breakable bolts until a hinge replaces them.
  const warning = entry.openable
    ? `${entry.label} opens: until you add its hinge (Inspector → Hinge) it is held shut by temporary breakable bolts.`
    : gap > FAR_FROM_PARENT
      ? `${gap.toFixed(2)} m from its parent part: attached by its 3 nearest nodes only. Check the part's parent, or move its mesh.`
      : null;
  // Glass is clipped into its frame all the way round.
  const span = entry.beamPreset === 'glass_brittle' ? GLASS_ATTACH_SPAN : undefined;
  return { beams: attachToParent(nodes, parentNodes, entry.openable ? 'bolted' : style, part.id, span ? { span } : {}), warning };
}

/**
 * Nodes of the parent to attach to. When the parent's slot has several generated
 * variants, only node names that *every* variant has are used, so swapping the
 * parent's variant in-game never leaves this part's beams dangling. Falls back to
 * the parent's own nodes when the variants share fewer than 3 names.
 */
export function swapSafeParentNodes(doc: Pick<Doc, 'parts' | 'nodes'>, parentId: string): StructNode[] {
  const own = doc.nodes.filter((n) => n.partId === parentId);
  const parent = doc.parts.find((p) => p.id === parentId);
  if (!parent) return own;
  const slot = parent.variantOf ?? parent.id;
  const siblings = doc.parts.filter((p) => (p.variantOf ?? p.id) === slot && p.id !== parentId);
  let common = new Set(own.map((n) => n.id));
  for (const s of siblings) {
    const ids = new Set(doc.nodes.filter((n) => n.partId === s.id).map((n) => n.id));
    if (ids.size === 0) continue; // not generated: no constraint yet
    common = new Set([...common].filter((id) => ids.has(id)));
  }
  const safe = own.filter((n) => common.has(n.id));
  return safe.length >= 3 ? safe : own;
}

/** Drop a part's generated nodes/beams/triangles, plus beams of other parts that pointed at its nodes. */
export function removePartStructure(doc: Doc, partId: string): void {
  const gone = new Set(doc.nodes.filter((n) => n.partId === partId && !n.manual).map((n) => n.id));
  doc.nodes = doc.nodes.filter((n) => n.partId !== partId || n.manual);
  doc.beams = doc.beams.filter((b) => b.partId !== partId && !(b.kind === 'attach' && (gone.has(b.id1) || gone.has(b.id2)) && isChildOfRemoved(doc, b.partId, partId)));
  doc.tris = doc.tris.filter((t) => t.partId !== partId);
}

/** A child or grandchild (attachments reach two levels up). */
function isChildOfRemoved(doc: Doc, childPartId: string, parentPartId: string): boolean {
  const parent = doc.parts.find((p) => p.id === childPartId)?.parentPartId;
  if (!parent) return false;
  return parent === parentPartId || doc.parts.find((p) => p.id === parent)?.parentPartId === parentPartId;
}

/** Totals for the status bar. */
export function structureTotals(doc: Pick<Project, 'nodes' | 'beams' | 'tris'>): { nodes: number; beams: number; tris: number; massKg: number } {
  let mass = 0;
  for (const n of doc.nodes) mass += n.weight;
  return { nodes: doc.nodes.length, beams: doc.beams.length, tris: doc.tris.length, massKg: Math.round(mass * 10) / 10 };
}
