import type { Project } from '../project/schema';
import { partRole, partSettings } from '../proxy/generate';
import { bodyPart, flexGroupOf, slotTypeOf, type TaxonomyLookup } from './jbeam';

/**
 * Export validation (SPEC §3.2, §4.15). Hard failures block export — they are
 * exactly the mistakes that made the original build's cars invisible or
 * broken in-game; warnings don't.
 */

type Doc = Pick<Project, 'meta' | 'parts' | 'assignments' | 'ignoredMeshes' | 'nodes' | 'beams' | 'tris' | 'proxy'>;

export interface ExportIssue {
  code: string;
  message: string;
  partId?: string;
}

export interface ValidationReport {
  errors: ExportIssue[];
  warnings: ExportIssue[];
}

export interface ValidationInput {
  /** meshKey → exported DAE node name. */
  meshNames: ReadonlyMap<string, string>;
  /** Node names actually written to the DAE. */
  daeNodes: ReadonlySet<string>;
  /** Texture references that could not be found for copying (material name → refs). */
  missingTextures: readonly { material: string; ref: string }[];
  /** All loaded mesh keys (to count unassigned ones). */
  loadedMeshKeys: readonly string[];
}

export function validateExport(doc: Doc, tax: TaxonomyLookup, input: ValidationInput): ValidationReport {
  const errors: ExportIssue[] = [];
  const warnings: ExportIssue[] = [];
  const err = (code: string, message: string, partId?: string) => errors.push({ code, message, partId });
  const warn = (code: string, message: string, partId?: string) => warnings.push({ code, message, partId });

  if (doc.parts.length === 0) err('no-parts', 'The project has no parts. Assign meshes to parts first.');
  const body = bodyPart(doc, tax);
  if (!body) err('no-body', 'No top-level part to act as the body (the core slot).');

  const nodeIds = new Map<string, string>(); // id → owning slot
  const partById = new Map(doc.parts.map((p) => [p.id, p]));
  for (const n of doc.nodes) {
    const owner = partById.get(n.partId);
    if (!owner) {
      err('node-orphan', `Node ${n.id} belongs to a part that no longer exists.`);
      continue;
    }
    const slot = slotTypeOf(doc.parts, owner);
    const prev = nodeIds.get(n.id);
    if (prev && prev !== slot) err('node-duplicate', `Node id ${n.id} is used by two different slots (${prev}, ${slot}).`, n.partId);
    nodeIds.set(n.id, slot);
  }
  for (const b of doc.beams) if (!nodeIds.has(b.id1) || !nodeIds.has(b.id2)) err('beam-dangling', `A beam of ${partById.get(b.partId)?.name ?? b.partId} references a missing node (${b.id1}–${b.id2}). Regenerate the part.`, b.partId);
  for (const t of doc.tris) if (t.ids.some((id) => !nodeIds.has(id))) err('tri-dangling', `A triangle of ${partById.get(t.partId)?.name ?? t.partId} references a missing node. Regenerate the part.`, t.partId);

  for (const part of doc.parts) {
    const entry = tax.entry(part.taxonomyId);
    if (!entry) {
      err('unknown-type', `${part.displayName}: unknown part type "${part.taxonomyId}".`, part.id);
      continue;
    }
    if (part.variantOf && !partById.has(part.variantOf)) err('variant-orphan', `${part.displayName} is a variant of a part that no longer exists.`, part.id);
    if (part.parentPartId && !partById.has(part.parentPartId)) err('slot-dangling', `${part.displayName} hangs on a slot whose part no longer exists.`, part.id);
    const meshes = Object.keys(doc.assignments).filter((k) => doc.assignments[k] === part.id && !doc.ignoredMeshes.includes(k));
    const role = partRole(entry, partSettings(doc, part, entry));
    const hasNodes = doc.nodes.some((n) => n.partId === part.id);
    if (meshes.length === 0) {
      warn('part-empty', `${part.displayName} has no meshes; it exports as an empty slot option.`, part.id);
      continue;
    }
    if (role === 'own' && !hasNodes) {
      err('not-generated', `${part.displayName} has no structure yet: generate it (Generate in the toolbar).`, part.id);
      continue;
    }
    if (!flexGroupOf(doc, part)) err('no-flex-group', `${part.displayName} has no nodes to bind its mesh to, and neither does any part above it. Generate its parent.`, part.id);
    for (const k of meshes) {
      const name = input.meshNames.get(k);
      if (!name || !input.daeNodes.has(name)) err('flexbody-missing-mesh', `${part.displayName}: mesh ${k.slice(k.indexOf(':') + 1)} is not in the exported DAE.`, part.id);
    }
    if (entry.openable && hasNodes) warn('openable-unhinged', `${part.displayName} opens, but until hinges are added (Phase 9) it is bolted shut.`, part.id);
  }

  if (body && doc.nodes.some((n) => n.partId === body.id)) {
    const r = doc.proxy.refNodes;
    if (!r) err('refnodes-missing', 'The body has no refNodes: regenerate the body.');
    else for (const id of Object.values(r)) if (!nodeIds.has(id)) err('refnodes-missing', `refNode ${id} does not exist: regenerate the body.`);
  } else if (body) err('body-not-generated', `${body.displayName} (the body) has no structure: generate it.`, body.id);

  for (const t of input.missingTextures) err('texture-missing', `Material ${t.material}: texture ${t.ref} was not found (Locate folder… in the Scene panel).`);

  const unassigned = input.loadedMeshKeys.filter((k) => !doc.assignments[k] && !doc.ignoredMeshes.includes(k)).length;
  if (unassigned) warn('meshes-unassigned', `${unassigned} mesh${unassigned === 1 ? ' is' : 'es are'} not assigned to any part and won't be exported.`);
  return { errors, warnings };
}
