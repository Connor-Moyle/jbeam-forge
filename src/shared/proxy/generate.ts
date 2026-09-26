import type { Part, PartProxy, Project, StructNode } from '../project/schema';
import type { TaxonomyEntry } from '../taxonomy/schema';
import { materialDefaults } from '../parts/materials';
import { buildProxy } from './build';
import type { ProxyMesh } from './mesh';
import { attachToParent, deriveStructure, FAR_FROM_PARENT, parentGap, placeRefNodes, positionTag, predictStability, presetSprings, type StabilityReport } from './derive';
import { BEAM_PRESET_VALUES, kindDefaults, targetVertices } from './presets';

/**
 * Generate parts' structure into the document (SPEC §4.4). Pure: works on
 * the project (an immer draft inside a Command) plus each part's merged
 * render geometry. Requires `await meshoptReady` beforehand.
 */

type Doc = Pick<Project, 'parts' | 'nodes' | 'beams' | 'tris' | 'proxy'>;

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
    const built = buildProxy(mesh, { mode: settings.mode, targetVertices: target, symmetry: settings.symmetry, maxEdge: settings.maxEdge, minEdge: settings.minEdge, inset: settings.inset, maxVertices: cap });

    // Replace this part's structure (manual nodes are kept for Phase 7's regeneration rules).
    removePartStructure(doc, partId);
    const slot = slotOf(doc.parts, partId);
    const taken = new Set(doc.nodes.filter((n) => slotOf(doc.parts, n.partId) !== slot).map((n) => n.id));
    const derived = deriveStructure({ partId, mesh: built.mesh, prefix: nodePrefix(part, entry), massKg, bracing: settings.bracing, taken });
    doc.nodes.push(...derived.nodes);
    doc.beams.push(...derived.beams);
    doc.tris.push(...derived.tris);
    const warnings = [...derived.warnings];

    const attach = attachBeams(doc, part, entry, derived.nodes, settings.attachment);
    doc.beams.push(...attach.beams);
    if (attach.warning) warnings.push(attach.warning);
    doc.proxy.parts[partId] = settings;
    regenerated.add(partId);

    const partBeams = [...derived.beams, ...attach.beams];
    const stability = predictStability(derived.nodes, partBeams, springs);
    if (stability.verdict !== 'ok') warnings.push(`Stability ${stability.verdict}: ${stability.offenders[0]?.message ?? ''}`);
    reports.push({ partId, vertices: derived.nodes.length, beams: partBeams.length, triangles: derived.tris.length, massKg, mirrored: built.mirrored, ms: built.stats.ms, warnings, stability });
  }

  // Children that were not regenerated keep their nodes but must re-attach to a regenerated parent's new nodes.
  for (const child of doc.parts) {
    if (regenerated.has(child.id) || !child.parentPartId || !regenerated.has(child.parentPartId)) continue;
    const entry = tax.entry(child.taxonomyId);
    const nodes = doc.nodes.filter((n) => n.partId === child.id);
    if (!entry || !nodes.length) continue;
    doc.beams = doc.beams.filter((b) => !(b.partId === child.id && b.kind === 'attach'));
    doc.beams.push(...attachBeams(doc, child, entry, nodes, partSettings(doc, child, entry).attachment).beams);
  }

  // refNodes follow the body (placed once, or re-placed when the body regenerates).
  const body = doc.parts.find((p) => tax.entry(p.taxonomyId)?.parent === null && !p.variantOf);
  if (body && (regenerated.has(body.id) || !doc.proxy.refNodes)) {
    doc.proxy.refNodes = placeRefNodes(doc.nodes.filter((n) => n.partId === body.id));
  }
  return { reports, skipped, notProxies };
}

function attachBeams(doc: Doc, part: Part, entry: TaxonomyEntry, nodes: readonly StructNode[], style: PartProxy['attachment']) {
  if (!part.parentPartId) return { beams: [], warning: null as string | null };
  if (entry.openable) return { beams: [], warning: `${entry.label} opens: it attaches through hinges and a latch (Phase 9), so no rigid attachment was generated.` };
  const parentNodes = doc.nodes.filter((n) => n.partId === part.parentPartId);
  if (!parentNodes.length) return { beams: [], warning: 'Its parent part has no structure yet: generate the parent, then this part attaches automatically.' };
  const gap = parentGap(nodes, parentNodes);
  const warning = gap > FAR_FROM_PARENT ? `${gap.toFixed(2)} m from its parent part: attached by its 3 nearest nodes only. Check the part's parent, or move its mesh.` : null;
  return { beams: attachToParent(nodes, parentNodes, style, part.id), warning };
}

/** Drop a part's generated nodes/beams/triangles, plus beams of other parts that pointed at its nodes. */
export function removePartStructure(doc: Doc, partId: string): void {
  const gone = new Set(doc.nodes.filter((n) => n.partId === partId && !n.manual).map((n) => n.id));
  doc.nodes = doc.nodes.filter((n) => n.partId !== partId || n.manual);
  doc.beams = doc.beams.filter((b) => b.partId !== partId && !(b.kind === 'attach' && (gone.has(b.id1) || gone.has(b.id2)) && isChildOfRemoved(doc, b.partId, partId)));
  doc.tris = doc.tris.filter((t) => t.partId !== partId);
}

function isChildOfRemoved(doc: Doc, childPartId: string, parentPartId: string): boolean {
  return doc.parts.find((p) => p.id === childPartId)?.parentPartId === parentPartId;
}

/** Totals for the status bar. */
export function structureTotals(doc: Pick<Project, 'nodes' | 'beams' | 'tris'>): { nodes: number; beams: number; tris: number; massKg: number } {
  let mass = 0;
  for (const n of doc.nodes) mass += n.weight;
  return { nodes: doc.nodes.length, beams: doc.beams.length, tris: doc.tris.length, massKg: Math.round(mass * 10) / 10 };
}
