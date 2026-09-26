import type { Project, Split } from '../project/schema';
import { toRuns } from './split';

/** Document operations for non-destructive splits (undoable inside a Command). */

type Doc = Pick<Project, 'splits' | 'assignments' | 'ignoredMeshes'>;

/** Key of the mesh a split produces (must match the renderer's derivation). */
export function splitResultKey(split: Pick<Split, 'meshKey' | 'id'>): string {
  return `${split.meshKey}/${split.id}`;
}

export function newSplitId(): string {
  return `sp_${crypto.randomUUID().slice(0, 8)}`;
}

/** `base`, or `base_2`, `base_3`… — unique among the given mesh names. */
export function uniqueMeshName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

export interface NewSplit {
  meshKey: string;
  name: string;
  triangles: Iterable<number>;
  id?: string;
}

/** Record a split. The new mesh starts in the same part as the mesh it came from (if any). */
export function addSplit(doc: Doc, spec: NewSplit): Split {
  const split: Split = { id: spec.id ?? newSplitId(), meshKey: spec.meshKey, name: spec.name, triangleRuns: toRuns(spec.triangles) };
  if (split.triangleRuns.length === 0) throw new Error('A split needs at least one triangle');
  doc.splits.push(split);
  const parentPart = doc.assignments[spec.meshKey];
  if (parentPart) doc.assignments[splitResultKey(split)] = parentPart;
  return split;
}

/**
 * Undo a split ("merge back"): removes it and every split made from its
 * result, plus their assignments and ignore flags. Returns the removed ids.
 */
export function removeSplit(doc: Doc, splitId: string): string[] {
  const removed: string[] = [];
  const queue = [splitId];
  while (queue.length) {
    const id = queue.shift()!;
    const i = doc.splits.findIndex((s) => s.id === id);
    if (i === -1) continue;
    const [split] = doc.splits.splice(i, 1);
    removed.push(id);
    const key = splitResultKey(split!);
    delete doc.assignments[key];
    const ig = doc.ignoredMeshes.indexOf(key);
    if (ig !== -1) doc.ignoredMeshes.splice(ig, 1);
    for (const s of doc.splits) if (s.meshKey === key) queue.push(s.id);
  }
  return removed;
}

/** The split that produced this mesh key, if it is a split result. */
export function splitProducing(doc: Pick<Doc, 'splits'>, meshKey: string): Split | undefined {
  return doc.splits.find((s) => splitResultKey(s) === meshKey);
}
