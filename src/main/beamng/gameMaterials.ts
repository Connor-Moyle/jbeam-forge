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

const cache = new Map<string, { sig: string; list: GameMaterial[]; defs: Map<string, { vehicle: string; key: string; body: unknown }> }>();

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
  const defs = new Map<string, { vehicle: string; key: string; body: unknown }>();
  for (const z of zips) {
    try {
      await withZip(join(root, z), async (zip) => {
        for (const e of await zip.entries()) {
          if (!/\.materials\.json$/i.test(e.name) || e.size > 8 * 1024 * 1024) continue;
          const vehicle = /^vehicles\/([^/]+)\//i.exec(e.name)?.[1] ?? z.replace(/\.zip$/i, '');
          const text = (await zip.readBuffer(e.name)).toString('utf8');
          for (const m of materialsIn(text, vehicle)) if (!seen.has(m.name)) seen.set(m.name, m);
          // Each definition as written, for mods that use another car's materials (see below).
          const { value } = parseJbeam(text);
          if (isJbeamObject(value))
            for (const [key, body] of Object.entries(value)) {
              if (!isJbeamObject(body) || (body.class !== undefined && body.class !== 'Material')) continue;
              const name = typeof body.mapTo === 'string' && body.mapTo.trim() ? body.mapTo.trim() : key;
              if (!defs.has(name.toLowerCase())) defs.set(name.toLowerCase(), { vehicle, key, body });
            }
        }
      });
    } catch {
      // A damaged or locked zip: skip it, the rest still count.
    }
  }
  const list = [...seen.values()].sort((a, b) => Number(b.vehicle === 'common') - Number(a.vehicle === 'common') || a.vehicle.localeCompare(b.vehicle) || a.name.localeCompare(b.name));
  cache.set(installDir, { sig, list, defs });
  return list;
}

/**
 * The game's definitions of materials a mod uses that live with another car (the Scintilla's,
 * the BX's). A car only loads the materials in its own folder and vehicles/common, so a mod using
 * a borrowed engine's materials has to carry their definitions (texture paths stay the game's).
 * Common materials are left out: every car has them.
 */
export async function gameMaterialDefinitions(installDir: string, names: readonly string[]): Promise<Record<string, unknown>> {
  await scanGameMaterials(installDir);
  const defs = cache.get(installDir)?.defs;
  const out: Record<string, unknown> = {};
  for (const n of names) {
    const d = defs?.get(n.toLowerCase());
    if (d && d.vehicle !== 'common') out[d.key] = d.body;
  }
  return out;
}
