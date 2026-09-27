import type { Project } from '../project/schema';

/**
 * Before 0.7.1 the FBX loader ran names through three's sanitizer, which
 * deletes . : / [ ] and turns spaces into underscores ("Circle.087" was stored
 * as "Circle087"). Names are kept as written now, so projects saved earlier
 * refer to meshes by the old form. These helpers carry those references over.
 */
export function legacyFbxName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
}

type Doc = Pick<Project, 'assignments' | 'ignoredMeshes' | 'meshNames' | 'splits'>;

function referenced(doc: Doc): Set<string> {
  const keys = new Set<string>([...Object.keys(doc.assignments), ...doc.ignoredMeshes, ...Object.keys(doc.meshNames), ...doc.splits.map((s) => s.meshKey)]);
  // A split result "base/sp_x" refers to its base mesh too.
  for (const k of [...keys]) {
    const slash = k.indexOf('/');
    if (slash > 0) keys.add(k.slice(0, slash));
  }
  return keys;
}

/** old key → new key for meshes the document still knows by their pre-0.7.1 name. */
export function legacyKeyMap(doc: Doc, sourceId: string, meshNames: readonly string[]): Map<string, string> {
  const refs = referenced(doc);
  const out = new Map<string, string>();
  for (const name of meshNames) {
    const now = `${sourceId}:${name}`;
    const old = `${sourceId}:${legacyFbxName(name)}`;
    if (old !== now && refs.has(old) && !refs.has(now)) out.set(old, now);
  }
  return out;
}

/** Rewrite mesh keys everywhere the document stores them (split results follow their base mesh). */
export function remapMeshKeys(doc: Doc, map: ReadonlyMap<string, string>): void {
  if (!map.size) return;
  const to = (key: string): string => {
    const direct = map.get(key);
    if (direct) return direct;
    const slash = key.indexOf('/');
    const base = slash > 0 ? map.get(key.slice(0, slash)) : undefined;
    return base ? base + key.slice(slash) : key;
  };
  const moveRecord = <T>(rec: Record<string, T>) => {
    for (const k of Object.keys(rec)) {
      const n = to(k);
      if (n === k) continue;
      rec[n] = rec[k]!;
      delete rec[k];
    }
  };
  moveRecord(doc.assignments);
  moveRecord(doc.meshNames);
  doc.ignoredMeshes = doc.ignoredMeshes.map(to);
  for (const s of doc.splits) s.meshKey = to(s.meshKey);
}
