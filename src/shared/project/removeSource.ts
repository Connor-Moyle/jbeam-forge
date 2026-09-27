import type { Project } from './schema';

/**
 * Take a model out of the project with everything that refers to its meshes:
 * splits, assignments, names, material slots, edits, copies (and copies of
 * those), and an axle's fitted suspension. Parts stay (they may hold other
 * meshes, and their settings are the user's work).
 */
export function removeSourceFromDoc(d: Project, sourceId: string): void {
  const prefix = `${sourceId}:`;
  const gone = (k: string) => k.startsWith(prefix);
  const copies = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of d.meshCopies) {
      const key = `copy:${c.id}`;
      if (!copies.has(key) && (gone(c.from) || copies.has(c.from))) {
        copies.add(key);
        grew = true;
      }
    }
  }
  const drop = (k: string) => gone(k) || copies.has(k);
  d.sources = d.sources.filter((s) => s.id !== sourceId);
  d.splits = d.splits.filter((s) => !drop(s.meshKey));
  d.meshCopies = d.meshCopies.filter((c) => !copies.has(`copy:${c.id}`));
  d.ignoredMeshes = d.ignoredMeshes.filter((k) => !drop(k));
  for (const rec of [d.assignments, d.meshNames, d.materialSlots, d.meshEdits] as Record<string, unknown>[]) {
    for (const k of Object.keys(rec)) if (drop(k)) delete rec[k];
  }
  for (const a of d.axles) {
    if (a.fitted?.sourceId === sourceId) a.fitted = null;
    a.ownMeshes = a.ownMeshes.filter((k) => !drop(k));
  }
  if (d.powertrain.engine?.sourceId === sourceId) d.powertrain.engine = null;
  if (d.powertrain.gearbox?.sourceId === sourceId) d.powertrain.gearbox = null;
}
