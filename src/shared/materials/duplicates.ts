import type { Project } from '../project/schema';
import type { MaterialDef } from './schema';

/**
 * Imported models are full of copies: Chrome, Chrome.001, Chrome_02 that are
 * all the same material. This finds materials whose settings and textures are
 * identical and proposes merging them. Names that are just copy-suffix
 * variants of each other are confident merges; identical materials with
 * unrelated names are offered too, but not ticked by default.
 */

export interface DuplicateGroup {
  /** The one kept (shortest, cleanest name). */
  keep: string;
  /** The ones folded into it. */
  merge: string[];
  /** Names differ only by copy suffixes (.001, _2, -3, " copy"). */
  sameName: boolean;
}

/** "Aluminum-2.003" → "aluminum", "Chrome_02" → "chrome", "Glass copy 2" → "glass". */
export function baseMaterialName(name: string): string {
  let n = name.toLowerCase().trim();
  for (let prev = ''; prev !== n; ) {
    prev = n;
    n = n.replace(/\.\d{3}$/, '').replace(/[\s_-]*copy(\s*\d+)?$/, '').replace(/[\s_.-]+\d+$/, '').trim();
  }
  return n || name.toLowerCase();
}

/** Everything that affects how a material looks and exports (not its identity or name). */
function contentKey(def: MaterialDef): string {
  const { id: _id, name: _name, origin: _origin, ...rest } = def;
  return JSON.stringify(rest, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

export function findDuplicates(materials: readonly MaterialDef[]): DuplicateGroup[] {
  const byContent = new Map<string, MaterialDef[]>();
  for (const m of materials) {
    const k = contentKey(m);
    const list = byContent.get(k);
    if (list) list.push(m);
    else byContent.set(k, [m]);
  }
  const cleanest = (list: readonly MaterialDef[]) => [...list].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  const groups: DuplicateGroup[] = [];
  for (const list of byContent.values()) {
    if (list.length < 2) continue;
    // Copies of one name (Aluminum-1, Aluminum-1.001) merge with confidence…
    const byName = new Map<string, MaterialDef[]>();
    for (const m of list) {
      const k = baseMaterialName(m.name);
      const same = byName.get(k);
      if (same) same.push(m);
      else byName.set(k, [m]);
    }
    const survivors: MaterialDef[] = [];
    for (const same of byName.values()) {
      const sorted = cleanest(same);
      survivors.push(sorted[0]!);
      if (sorted.length > 1) groups.push({ keep: sorted[0]!.id, merge: sorted.slice(1).map((m) => m.id), sameName: true });
    }
    // …identical materials with unrelated names are only offered.
    if (survivors.length > 1) {
      const sorted = cleanest(survivors);
      groups.push({ keep: sorted[0]!.id, merge: sorted.slice(1).map((m) => m.id), sameName: false });
    }
  }
  return groups.sort((a, b) => Number(b.sameName) - Number(a.sameName));
}

/** Fold materials into the one kept: meshes are repointed, the copies removed. */
export function mergeMaterials(doc: Pick<Project, 'materials' | 'materialSlots'>, groups: readonly Pick<DuplicateGroup, 'keep' | 'merge'>[]): number {
  const into = new Map<string, string>();
  for (const g of groups) for (const id of g.merge) if (id !== g.keep) into.set(id, g.keep);
  if (!into.size) return 0;
  // Chains (w2 → w → a when both a copy-merge and a cross-name merge are chosen) end at the last one kept.
  const final = (id: string): string => {
    const seen = new Set<string>();
    while (into.has(id) && !seen.has(id)) {
      seen.add(id);
      id = into.get(id)!;
    }
    return id;
  };
  for (const id of [...into.keys()]) into.set(id, final(id));
  for (const [key, ids] of Object.entries(doc.materialSlots)) {
    if (ids.some((id) => into.has(id))) doc.materialSlots[key] = ids.map((id) => into.get(id) ?? id);
  }
  doc.materials = doc.materials.filter((m) => !into.has(m.id));
  return into.size;
}
