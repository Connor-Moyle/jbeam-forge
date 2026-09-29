import { create } from 'zustand';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import type { ImportedMesh } from '@renderer/import/normalize';
import { proposeParts, type Proposal } from '@shared/taxonomy/classify';
import type { TaxonomyEntry } from '@shared/taxonomy/schema';
import * as ops from '@shared/parts/ops';
import { removePartStructure } from '@shared/proxy/generate';
import { currentTaxonomy, saveUserEntry } from './taxonomy';

/**
 * Undoable part/assignment commands (every one is a single history entry)
 * and the auto-classify flow shown after an import.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function assignToNewPart(meshKeys: readonly string[], spec: ops.NewPart): string | null {
  let id: string | null = null;
  projectStore.getState().execute({
    label: `Assign ${plural(meshKeys.length, 'mesh')}`,
    apply: (d) => {
      const part = ops.createPart(d, currentTaxonomy(), spec);
      ops.assignMeshes(d, meshKeys, part.id);
      id = part.id;
    },
  });
  return id;
}

/**
 * Bulk assign with positional auto-distribution: meshes are grouped by the
 * position their bounding box implies and each group gets its own part
 * (4 door glasses → FL/FR/RL/RR). Returns the part ids.
 */
export function assignDistributed(meshKeys: readonly string[], taxonomyId: string, variant: string): string[] {
  const tax = currentTaxonomy();
  const entry = tax.entry(taxonomyId);
  if (!entry) return [];
  const { centers, origin } = meshCenters(meshKeys);
  const positions = ops.distributePositions(entry.positionAxis, centers, origin);
  const groups = new Map<string, string[]>();
  for (const k of meshKeys) {
    const pos = positions[k] ?? '';
    groups.set(pos, [...(groups.get(pos) ?? []), k]);
  }
  const ids: string[] = [];
  projectStore.getState().execute({
    label: `Assign ${plural(meshKeys.length, 'mesh')} as ${entry.label}`,
    apply: (d) => {
      for (const [pos, keys] of groups) {
        const part = ops.createPart(d, tax, { taxonomyId, position: pos || null, variant });
        ops.assignMeshes(d, keys, part.id);
        ids.push(part.id);
      }
    },
  });
  return ids;
}

export function assignToPart(meshKeys: readonly string[], partId: string): void {
  projectStore.getState().execute({ label: `Assign ${plural(meshKeys.length, 'mesh')}`, apply: (d) => ops.assignMeshes(d, meshKeys, partId) });
}

export function unassign(meshKeys: readonly string[]): void {
  projectStore.getState().execute({ label: `Unassign ${plural(meshKeys.length, 'mesh')}`, apply: (d) => ops.unassignMeshes(d, meshKeys) });
}

/** Back to Unassigned: unassign and un-ignore in one step. */
export function moveToUnassigned(meshKeys: readonly string[]): void {
  projectStore.getState().execute({
    label: `Unassign ${plural(meshKeys.length, 'mesh')}`,
    apply: (d) => {
      ops.unassignMeshes(d, meshKeys);
      ops.setIgnored(d, meshKeys, false);
    },
  });
}

export function setIgnored(meshKeys: readonly string[], ignored: boolean): void {
  projectStore.getState().execute({ label: `${ignored ? 'Ignore' : 'Restore'} ${plural(meshKeys.length, 'mesh')}`, apply: (d) => ops.setIgnored(d, meshKeys, ignored) });
}

/** Returns false when the move would create a cycle (nothing changes). */
export function reparentPart(partId: string, parentId: string | null): boolean {
  const doc = projectStore.getState().doc;
  if (!doc || ops.wouldCycle(doc, partId, parentId)) return false;
  projectStore.getState().execute({ label: 'Move part', apply: (d) => void ops.reparent(d, partId, parentId) });
  return true;
}

/** Deleting (or merging away) a part also drops its generated structure and settings. */
export function deletePart(partId: string): void {
  projectStore.getState().execute({
    label: 'Delete part',
    apply: (d) => {
      removePartStructure(d, partId);
      delete d.proxy.parts[partId];
      ops.deletePart(d, partId);
    },
  });
}

export function mergeParts(targetId: string, sourceIds: readonly string[]): void {
  projectStore.getState().execute({
    label: `Merge ${plural(sourceIds.length + 1, 'part')}`,
    apply: (d) => {
      for (const id of sourceIds) {
        if (id === targetId) continue;
        removePartStructure(d, id);
        delete d.proxy.parts[id];
      }
      ops.mergeParts(d, targetId, sourceIds);
    },
  });
}

export function updatePart(partId: string, patch: ops.PartDetails, label = 'Edit part'): void {
  projectStore.getState().execute({ label, apply: (d) => ops.updatePart(d, partId, patch) });
}

export function duplicateAsVariant(partId: string, variant = ''): string | null {
  let id: string | null = null;
  projectStore.getState().execute({ label: 'Duplicate as variant', apply: (d) => void (id = ops.duplicateAsVariant(d, currentTaxonomy(), partId, variant)?.id ?? null) });
  return id;
}

/** "Add Custom Part": a new taxonomy kind, stored in the project or for all projects. */
export async function addCustomKind(entry: TaxonomyEntry, scope: 'project' | 'user'): Promise<void> {
  if (scope === 'user') {
    await saveUserEntry(entry);
    return;
  }
  projectStore.getState().execute({
    label: `Add custom part "${entry.label}"`,
    apply: (d) => {
      d.customTaxonomy = d.customTaxonomy.filter((e) => (e as { id?: unknown }).id !== entry.id);
      d.customTaxonomy.push(entry);
    },
  });
}

// ---------------------------------------------------------------- geometry helpers

function meshIndex(): Map<string, ImportedMesh> {
  const map = new Map<string, ImportedMesh>();
  for (const s of Object.values(useSceneStore.getState().sources)) for (const m of s.meshes) map.set(m.key, m);
  return map;
}

/** Bounding-box centres (BeamNG space) of the given meshes, plus the whole model's centre. */
export function meshCenters(meshKeys: readonly string[]): { centers: Record<string, [number, number, number]>; origin: [number, number, number] } {
  const index = meshIndex();
  const centers: Record<string, [number, number, number]> = {};
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const m of index.values()) {
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox!;
    if (b.isEmpty()) continue;
    lo[0] = Math.min(lo[0]!, b.min.x);
    lo[1] = Math.min(lo[1]!, b.min.y);
    lo[2] = Math.min(lo[2]!, b.min.z);
    hi[0] = Math.max(hi[0]!, b.max.x);
    hi[1] = Math.max(hi[1]!, b.max.y);
    hi[2] = Math.max(hi[2]!, b.max.z);
  }
  for (const k of meshKeys) {
    const b = index.get(k)?.geometry.boundingBox;
    if (b && !b.isEmpty()) centers[k] = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
  }
  const origin: [number, number, number] = Number.isFinite(lo[0]) ? [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2] : [0, 0, 0];
  return { centers, origin };
}

// ---------------------------------------------------------------- auto-classify

export interface PendingClassification {
  /** The project (by creation stamp) and sources it was computed for; stale once either goes away. */
  projectCreatedAt: string;
  sourceIds: string[];
  fileName: string;
  meshCount: number;
  proposal: Proposal;
}

interface ClassifyUiState {
  pending: PendingClassification | null;
  setPending: (p: PendingClassification | null) => void;
}

export const useClassifyUi = create<ClassifyUiState>()((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));

/** After an import: classify the new, unassigned meshes and ask before applying. */
export function offerAutoClassify(fileName: string, meshes: readonly Pick<ImportedMesh, 'key' | 'name'>[]): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const fresh = meshes.filter((m) => !doc.assignments[m.key] && !doc.ignoredMeshes.includes(m.key));
  if (fresh.length === 0) {
    if (fileName === 'the model') useUiStore.getState().pushStatus('Every mesh is already in a part (or ignored).', 'info');
    return;
  }
  const { centers, origin } = meshCenters(fresh.map((m) => m.key));
  const proposal = proposeParts(
    fresh.map((m) => {
      const c = centers[m.key];
      return { key: m.key, name: m.name, center: c ? ([c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]] as [number, number, number]) : undefined };
    }),
    currentTaxonomy().classifier,
  );
  if (proposal.parts.length === 0) {
    useUiStore.getState().pushStatus(`No part names recognised in ${fileName}. Split or assign its meshes from the Scene tree.`, 'info', 8000);
    return;
  }
  const sourceIds = [...new Set(fresh.map((m) => m.key.slice(0, m.key.indexOf(':'))))];
  useClassifyUi.getState().setPending({ projectCreatedAt: doc.meta.createdAt, sourceIds, fileName, meshCount: fresh.length, proposal });
}

/** Still applicable: same project, and its sources are still in the document. */
export function pendingStillValid(p: PendingClassification): boolean {
  const doc = projectStore.getState().doc;
  return !!doc && doc.meta.createdAt === p.projectCreatedAt && p.sourceIds.every((id) => doc.sources.some((s) => s.id === id));
}

export function applyPendingClassification(): void {
  const pending = useClassifyUi.getState().pending;
  useClassifyUi.getState().setPending(null);
  if (!pending || !pendingStillValid(pending)) return;
  const { proposal } = pending;
  const assigned = Object.keys(proposal.assignments).length;
  projectStore.getState().execute({
    label: `Auto-classify ${plural(assigned, 'mesh')}`,
    apply: (d) => void ops.applyProposal(d, currentTaxonomy(), proposal),
  });
  useUiStore.getState().pushStatus(`Created ${plural(proposal.parts.length, 'part')} from ${plural(assigned, 'mesh')}; ${proposal.unassigned.length} left unassigned`, 'success');
}
