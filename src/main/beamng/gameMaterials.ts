import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam } from '@shared/jbeam/parse';
import { withZip } from './zip';

/**
 * The material names the game already has (from every vehicle zip's
 * *.materials.json), so a mesh can use one by name ("Use a BeamNG material
 * instead") and look exactly like the stock cars. Common materials (glass,
 * lights, rubber, chrome…) come from common.zip and work on any vehicle.
 */

export interface GameMaterial {
  /** The name a mesh's material slot uses (the entry's `mapTo`, else its key). */
  name: string;
  /** Vehicle folder it comes from ("common" works everywhere). */
  vehicle: string;
  /** Whether it's a car-paint material (takes the three paint colours). */
  paint: boolean;
}

/** Material names defined in one materials.json text. */
export function materialsIn(text: string, vehicle: string): GameMaterial[] {
  const { value } = parseJbeam(text);
  if (!isJbeamObject(value)) return [];
  const out: GameMaterial[] = [];
  for (const [key, body] of Object.entries(value)) {
    if (!isJbeamObject(body)) continue;
    if (body.class !== undefined && body.class !== 'Material') continue;
    const name = typeof body.mapTo === 'string' && body.mapTo.trim() ? body.mapTo.trim() : typeof body.name === 'string' && body.name.trim() ? body.name.trim() : key;
    const stages = Array.isArray(body.Stages) ? body.Stages : [];
    const paint = body.instanceDiffuse === true || stages.some((s) => isJbeamObject(s) && (s.instanceDiffuse === true || typeof s.colorPaletteMap === 'string'));
    out.push({ name, vehicle, paint });
  }
  return out;
}

const cache = new Map<string, { sig: string; list: GameMaterial[] }>();

/** Every game material name in an install, common ones first, then by vehicle and name (read once per install state). */
export async function scanGameMaterials(installDir: string): Promise<GameMaterial[]> {
  const root = join(installDir, 'content', 'vehicles');
  let zips: string[];
  try {
    zips = (await readdir(root)).filter((f) => f.toLowerCase().endsWith('.zip')).sort();
  } catch {
    return [];
  }
  const sig = (await Promise.all(zips.map(async (z) => `${z}:${(await stat(join(root, z))).mtimeMs}`))).join('|');
  const hit = cache.get(installDir);
  if (hit?.sig === sig) return hit.list;
  const seen = new Map<string, GameMaterial>();
  for (const z of zips) {
    try {
      await withZip(join(root, z), async (zip) => {
        for (const e of await zip.entries()) {
          if (!/\.materials\.json$/i.test(e.name) || e.size > 8 * 1024 * 1024) continue;
          const vehicle = /^vehicles\/([^/]+)\//i.exec(e.name)?.[1] ?? z.replace(/\.zip$/i, '');
          for (const m of materialsIn((await zip.readBuffer(e.name)).toString('utf8'), vehicle)) if (!seen.has(m.name)) seen.set(m.name, m);
        }
      });
    } catch {
      // A damaged or locked zip: skip it, the rest still count.
    }
  }
  const list = [...seen.values()].sort((a, b) => Number(b.vehicle === 'common') - Number(a.vehicle === 'common') || a.vehicle.localeCompare(b.vehicle) || a.name.localeCompare(b.name));
  cache.set(installDir, { sig, list });
  return list;
}
