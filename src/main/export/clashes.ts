import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { withZip } from '../beamng/zip';

/**
 * Other mods that also carry vehicles/<slug>: the game merges every mod's folder of that name, so
 * an older copy left in the mods folder (an earlier export renamed, a test folder) mixes its parts
 * with the new ones and the car can come apart on spawn. Unpacked mods and zips, in subfolders too.
 */
export async function vehicleClashes(modsDir: string, slug: string, ownPath: string): Promise<string[]> {
  const out: string[] = [];
  const want = `vehicles/${slug.toLowerCase()}/`;
  const unpacked = join(modsDir, 'unpacked');
  try {
    for (const dir of await readdir(unpacked)) {
      const path = join(unpacked, dir);
      if (path.toLowerCase() === ownPath.toLowerCase() || dir.startsWith('.')) continue;
      try {
        if ((await stat(join(path, 'vehicles', slug))).isDirectory()) out.push(relative(modsDir, path));
      } catch {
        /* not this one */
      }
    }
  } catch {
    /* no unpacked folder */
  }
  const zips: string[] = [];
  const walk = async (dir: string, depth: number) => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      if (n.toLowerCase().endsWith('.zip')) zips.push(p);
      else if (depth < 2 && n !== 'unpacked' && !n.startsWith('.')) {
        try {
          if ((await stat(p)).isDirectory()) await walk(p, depth + 1);
        } catch {
          /* gone */
        }
      }
    }
  };
  await walk(modsDir, 0);
  for (const z of zips) {
    try {
      const has = await withZip(z, async (zip) => (await zip.entries()).some((e) => e.name.toLowerCase().startsWith(want)));
      if (has) out.push(relative(modsDir, z));
    } catch {
      /* a damaged or locked zip */
    }
  }
  return out;
}
