import type { Project } from '../project/schema';
import { slugify } from '../text';

/**
 * Friendly mesh names. Meshes are tracked by a key built from their original
 * name (SUNBURST6.fbx:Circle.087); a friendly name is stored next to it and
 * used everywhere a person or the game sees the mesh: the scene tree, the
 * exported DAE, flexbodies and model re-export. The source file is never touched.
 *
 * Auto names come from the part ("Rear Left halfshaft" → rear_left_halfshaft,
 * then rear_left_halfshaft_2…). Names someone typed are `manual` and are never
 * overwritten.
 */

type Doc = Pick<Project, 'meshNames' | 'assignments' | 'parts' | 'ignoredMeshes'>;

/** "Hood (2)" → "Hood", "Rear Left door card (2001)" → "Rear Left door card": numbered leftovers of import names. */
export function tidyDisplayName(name: string): string {
  return name.replace(/\s*\(\d+\)$/, '').trim() || name;
}

export function meshBaseName(part: Pick<Project['parts'][number], 'displayName' | 'name'>): string {
  return slugify(tidyDisplayName(part.displayName)) || slugify(part.name) || 'mesh';
}

/** The name to show and export for a mesh. */
export function meshName(doc: Pick<Project, 'meshNames'>, key: string, original: string): string {
  return doc.meshNames[key]?.name ?? original;
}

/** The same meshes with their friendly names (for export and previews). */
export function withMeshNames<T extends { key: string; name: string }>(doc: Pick<Project, 'meshNames'>, meshes: readonly T[]): T[] {
  return meshes.map((m) => (doc.meshNames[m.key] ? { ...m, name: doc.meshNames[m.key]!.name } : m));
}

/**
 * Give every assigned mesh a name from its part. Existing auto names that
 * still fit are kept (so adding a mesh doesn't renumber the others); names
 * someone typed are left alone and never reused; meshes that lost their part
 * drop their auto name. Only writes what changes.
 */
export function applyAutoMeshNames(doc: Doc): void {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const taken = new Set(Object.values(doc.meshNames).filter((e) => e.manual).map((e) => e.name.toLowerCase()));
  const want = new Map<string, string>(); // meshKey → base name
  for (const [key, partId] of Object.entries(doc.assignments)) {
    const part = byId.get(partId);
    if (part && !doc.meshNames[key]?.manual) want.set(key, meshBaseName(part));
  }
  // Drop auto names of meshes that no longer belong to a part.
  for (const [key, entry] of Object.entries(doc.meshNames)) if (!entry.manual && !want.has(key)) delete doc.meshNames[key];

  const fits = (name: string, base: string) => name === base || new RegExp(`^${base}_\\d+$`).test(name);
  const pending: [string, string][] = [];
  for (const [key, base] of [...want].sort((a, b) => a[0].localeCompare(b[0]))) {
    const current = doc.meshNames[key]?.name;
    if (current && fits(current, base) && !taken.has(current.toLowerCase())) taken.add(current.toLowerCase());
    else pending.push([key, base]);
  }
  for (const [key, base] of pending) {
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}_${i}`;
    taken.add(name.toLowerCase());
    if (doc.meshNames[key]?.name !== name) doc.meshNames[key] = { name, manual: false };
  }
}

/**
 * Tidy numbered display names ("Hood (2)" → "Hood"). Parts sharing a slot
 * (a part and its variants) stay distinguishable: a clash gets " 2", " 3".
 */
export function tidyDisplayNames(doc: Pick<Project, 'parts'>): void {
  const slotOf = (p: Project['parts'][number]) => p.variantOf ?? p.id;
  const used = new Map<string, Set<string>>();
  const seen = (slot: string) => used.get(slot) ?? used.set(slot, new Set()).get(slot)!;
  for (const p of doc.parts) if (tidyDisplayName(p.displayName) === p.displayName) seen(slotOf(p)).add(p.displayName.toLowerCase());
  for (const p of doc.parts) {
    const tidy = tidyDisplayName(p.displayName);
    if (tidy === p.displayName) continue;
    const names = seen(slotOf(p));
    let next = tidy;
    for (let i = 2; names.has(next.toLowerCase()); i++) next = `${tidy} ${i}`;
    names.add(next.toLowerCase());
    p.displayName = next;
  }
}

/** Why a typed mesh name can't be used, or null. Empty means "back to the original name". */
export function meshNameProblem(doc: Pick<Project, 'meshNames'>, key: string, name: string): string | null {
  if (!name.trim()) return null;
  if (!/^[A-Za-z0-9_.\- ]+$/.test(name)) return 'Use letters, digits, spaces, dots, dashes or underscores.';
  const lower = name.trim().toLowerCase();
  if (Object.entries(doc.meshNames).some(([k, e]) => k !== key && e.name.toLowerCase() === lower)) return `Another mesh is already called ${name.trim()}.`;
  return null;
}

/** Set a typed name (manual, never auto-overwritten); an empty name goes back to the original. */
export function renameMesh(doc: Pick<Project, 'meshNames'>, key: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) delete doc.meshNames[key];
  else doc.meshNames[key] = { name: trimmed, manual: true };
}
