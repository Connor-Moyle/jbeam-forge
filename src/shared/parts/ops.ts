import type { Part, Project } from '../project/schema';
import { POSITIONS_BY_AXIS, type PositionAxis, type TaxonomyEntry } from '../taxonomy/schema';
import type { Proposal } from '../taxonomy/classify';
import { placement, positionCompat } from '../taxonomy/positions';

/**
 * Pure document operations on parts and mesh assignments (SPEC §4.3).
 * They mutate the given project (an immer draft inside a Command) and never
 * touch anything else, so every one of them is undoable and unit-testable.
 */

type Doc = Pick<Project, 'meta' | 'parts' | 'assignments' | 'ignoredMeshes'> & Partial<Pick<Project, 'variables'>>;

export interface TaxonomyLookup {
  entry(id: string): TaxonomyEntry | undefined;
}

const POSITION_WORDS: Record<string, string> = { F: 'Front', R: 'Rear', L: 'Left', FL: 'Front Left', FR: 'Front Right', RL: 'Rear Left', RR: 'Rear Right' };

/** Human-readable position for an axis ("R" reads Rear on fr, Right on lr). */
export function positionLabel(axis: PositionAxis, position: string | null): string {
  if (!position) return '';
  if (axis === 'lr') return position === 'L' ? 'Left' : 'Right';
  return POSITION_WORDS[position] ?? position;
}

export function newPartId(): string {
  return `part_${crypto.randomUUID().slice(0, 8)}`;
}

function titleCase(s: string): string {
  return s.replace(/(^|[\s_])([a-z])/g, (_, sep: string, c: string) => `${sep === '_' ? ' ' : sep}${c.toUpperCase()}`);
}

export function defaultDisplayName(entry: TaxonomyEntry, position: string | null, variant: string): string {
  const pos = positionLabel(entry.positionAxis, position);
  const base = pos ? `${pos} ${entry.label.charAt(0).toLowerCase()}${entry.label.slice(1)}` : entry.label;
  return variant ? `${base} (${titleCase(variant)})` : base;
}

/** jbeam part name `<slug>_<slotType>[_<position>][_<variant>]`, unique within the project. */
export function uniquePartName(doc: Doc, entry: TaxonomyEntry, position: string | null, variant: string): string {
  const base = [doc.meta.slug, entry.slotType, position, variant || null].filter(Boolean).join('_');
  const taken = new Set(doc.parts.map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export interface NewPart {
  taxonomyId: string;
  position?: string | null;
  variant?: string;
  parentPartId?: string | null;
  variantOf?: string | null;
  id?: string;
}

export function createPart(doc: Doc, tax: TaxonomyLookup, spec: NewPart): Part {
  const entry = tax.entry(spec.taxonomyId);
  if (!entry) throw new Error(`Unknown part kind "${spec.taxonomyId}"`);
  const position = spec.position && POSITIONS_BY_AXIS[entry.positionAxis].includes(spec.position) ? spec.position : null;
  const variant = spec.variant ?? '';
  const part: Part = {
    id: spec.id ?? newPartId(),
    taxonomyId: entry.id,
    name: uniquePartName(doc, entry, position, variant),
    displayName: defaultDisplayName(entry, position, variant),
    position,
    parentPartId: spec.parentPartId ?? findParent(doc, tax, entry, position),
    variantOf: spec.variantOf ?? null,
    price: null,
    description: '',
    constructionMaterial: 'steel',
  };
  doc.parts.push(part);
  return part;
}

/** Nearest existing base part of an ancestor kind, preferring a compatible position. */
export function findParent(doc: Doc, tax: TaxonomyLookup, entry: TaxonomyEntry, position: string | null): string | null {
  const at = placement(entry.positionAxis, position);
  for (let kind = entry.parent, guard = 0; kind && guard < 64; kind = tax.entry(kind)?.parent ?? null, guard++) {
    const k = tax.entry(kind);
    const candidates = doc.parts.filter((p) => p.taxonomyId === kind && !p.variantOf);
    let best: { id: string; s: number } | null = null;
    for (const c of candidates) {
      const s = positionCompat(at, placement(k?.positionAxis, c.position));
      if (s > 0 && (!best || s > best.s)) best = { id: c.id, s };
    }
    if (best) return best.id;
  }
  return null;
}

/** Turn an auto-classification proposal into parts + assignments. Returns the created part ids. */
export function applyProposal(doc: Doc, tax: TaxonomyLookup, proposal: Proposal): string[] {
  const idMap = new Map<string, string>();
  for (const p of proposal.parts) idMap.set(p.id, newPartId());
  // Parents and bases first so names/links resolve in order.
  const created: string[] = [];
  const pending = [...proposal.parts];
  const done = new Set<string>();
  while (pending.length) {
    const i = pending.findIndex((p) => (!p.parentPartId || done.has(p.parentPartId)) && (!p.variantOf || done.has(p.variantOf)));
    const p = pending.splice(i === -1 ? 0 : i, 1)[0]!;
    const entry = tax.entry(p.taxonomyId);
    if (!entry) continue;
    const part = createPart(doc, tax, {
      id: idMap.get(p.id)!,
      taxonomyId: p.taxonomyId,
      position: p.position,
      variant: p.variant,
      variantOf: p.variantOf ? (idMap.get(p.variantOf) ?? null) : null,
      parentPartId: p.parentPartId ? (idMap.get(p.parentPartId) ?? null) : undefined,
    });
    done.add(p.id);
    created.push(part.id);
    for (const key of p.meshKeys) doc.assignments[key] = part.id;
  }
  return created;
}

export function assignMeshes(doc: Doc, meshKeys: readonly string[], partId: string): void {
  if (!doc.parts.some((p) => p.id === partId)) throw new Error(`No part ${partId}`);
  for (const k of meshKeys) {
    doc.assignments[k] = partId;
    const i = doc.ignoredMeshes.indexOf(k);
    if (i !== -1) doc.ignoredMeshes.splice(i, 1);
  }
}

export function unassignMeshes(doc: Doc, meshKeys: readonly string[]): void {
  for (const k of meshKeys) delete doc.assignments[k];
}

export function setIgnored(doc: Doc, meshKeys: readonly string[], ignored: boolean): void {
  for (const k of meshKeys) {
    const i = doc.ignoredMeshes.indexOf(k);
    if (ignored) {
      delete doc.assignments[k];
      if (i === -1) doc.ignoredMeshes.push(k);
    } else if (i !== -1) doc.ignoredMeshes.splice(i, 1);
  }
}

/** Would making `parentId` the parent of `partId` create a loop? */
export function wouldCycle(doc: Pick<Doc, 'parts'>, partId: string, parentId: string | null): boolean {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  for (let cur = parentId, guard = 0; cur; cur = byId.get(cur)?.parentPartId ?? null, guard++) {
    if (cur === partId || guard > doc.parts.length) return true;
  }
  return false;
}

/** Reparent; returns false (and changes nothing) when it would create a cycle. */
export function reparent(doc: Doc, partId: string, parentId: string | null): boolean {
  const part = doc.parts.find((p) => p.id === partId);
  if (!part || wouldCycle(doc, partId, parentId)) return false;
  part.parentPartId = parentId;
  return true;
}

/** Remove a part: its meshes become unassigned, children move up, variants become bases. */
export function deletePart(doc: Doc, partId: string): void {
  const part = doc.parts.find((p) => p.id === partId);
  if (!part) return;
  for (const [k, v] of Object.entries(doc.assignments)) if (v === partId) delete doc.assignments[k];
  for (const p of doc.parts) {
    if (p.parentPartId === partId) p.parentPartId = part.parentPartId;
    if (p.variantOf === partId) p.variantOf = null;
  }
  doc.parts.splice(doc.parts.indexOf(part), 1);
  // Its in-game settings go with it (documents from before v13 have none).
  if (doc.variables) doc.variables = doc.variables.filter((v) => v.partId !== partId);
}

/** Merge parts into `targetId`: their meshes move over, then they are deleted. */
export function mergeParts(doc: Doc, targetId: string, sourceIds: readonly string[]): void {
  for (const id of sourceIds) {
    if (id === targetId) continue;
    for (const [k, v] of Object.entries(doc.assignments)) if (v === id) doc.assignments[k] = targetId;
    for (const p of doc.parts) if (p.parentPartId === id && p.id !== targetId) p.parentPartId = targetId;
    deletePart(doc, id);
  }
}

export type PartDetails = Partial<Pick<Part, 'displayName' | 'price' | 'description' | 'constructionMaterial' | 'position' | 'name'>>;

export function updatePart(doc: Doc, partId: string, patch: PartDetails): void {
  const part = doc.parts.find((p) => p.id === partId);
  if (!part) return;
  Object.assign(part, patch);
}

/** "Duplicate as variant": same kind/position/parent, no meshes, linked to the base. */
export function duplicateAsVariant(doc: Doc, tax: TaxonomyLookup, partId: string, variant: string): Part | null {
  const src = doc.parts.find((p) => p.id === partId);
  if (!src) return null;
  const baseId = src.variantOf ?? src.id;
  const n = doc.parts.filter((p) => p.variantOf === baseId).length + 2;
  const part = createPart(doc, tax, {
    taxonomyId: src.taxonomyId,
    position: src.position,
    variant: variant || `v${n}`,
    parentPartId: src.parentPartId,
    variantOf: baseId,
  });
  Object.assign(part, { price: src.price, description: src.description, constructionMaterial: src.constructionMaterial });
  return part;
}

/**
 * Positional auto-distribution for a bulk assign: each mesh gets the position
 * its bounding-box centre implies (BeamNG space: +X left, −Y front), relative
 * to the whole model's centre. 4 door glasses → FL/FR/RL/RR.
 */
export function distributePositions(axis: PositionAxis, centers: Record<string, readonly [number, number, number]>, origin: readonly [number, number, number]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, c] of Object.entries(centers)) {
    const fore = c[1] < origin[1] ? 'F' : 'R';
    const side = c[0] > origin[0] ? 'L' : 'R';
    out[key] = axis === 'none' ? null : axis === 'fr' ? fore : axis === 'lr' ? side : `${fore}${side}`;
  }
  return out;
}
