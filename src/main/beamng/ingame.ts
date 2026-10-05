import { copyFile, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IngameStatus } from '@shared/beamng';
import { withZip } from './zip';

/**
 * JBeam Forge inside BeamNG.drive comes with the desktop app (resources/ingame/jbeam_forge.zip,
 * built by scripts/build-ingame.mjs) and is kept at the same version: installing or updating it
 * puts that zip in the game's mods folder as mods/jbeam_forge.zip.
 */

export const INGAME_ZIP = 'jbeam_forge.zip';
const VERSION_FILE = 'jbeamforge-version.json';

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

const versionOf = (text: string): string | null => {
  try {
    const v = (JSON.parse(text) as { version?: unknown }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
};

/** The version inside an in-game zip (null when it has none or can't be read). */
export async function zipVersion(path: string): Promise<string | null> {
  if (!(await exists(path))) return null;
  try {
    return await withZip(path, async (zip) => versionOf((await zip.readBuffer(VERSION_FILE, 64 * 1024)).toString('utf8')));
  } catch {
    return null;
  }
}

/** Compare dotted versions ("0.16.0" < "0.16.1"); anything unreadable counts as oldest. */
export function newer(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export async function ingameStatus(bundledZip: string, modsDir: string | null): Promise<IngameStatus> {
  const bundled = await zipVersion(bundledZip);
  if (!modsDir) return { bundled, installed: null, modsDir: null, unpacked: false, updateAvailable: false };
  const zipped = await zipVersion(join(modsDir, INGAME_ZIP));
  const unpackedFile = join(modsDir, 'unpacked', 'jbeam_forge', VERSION_FILE);
  const unpacked = await exists(unpackedFile);
  const installed = zipped ?? (unpacked ? versionOf(await readFile(unpackedFile, 'utf8').catch(() => '')) : null);
  return { bundled, installed, modsDir, unpacked, updateAvailable: !!installed && newer(bundled, installed) };
}

/** Put the bundled in-game version in the mods folder (replacing an older one). */
export async function installIngame(bundledZip: string, modsDir: string): Promise<IngameStatus> {
  if (!(await exists(bundledZip))) throw new Error('This copy of JBeam Forge doesn’t include the in-game version (build it with npm run build:ingame).');
  const dest = join(modsDir, INGAME_ZIP);
  const part = `${dest}.part`;
  await copyFile(bundledZip, part);
  try {
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    if ((err as NodeJS.ErrnoException).code === 'EBUSY' || (err as NodeJS.ErrnoException).code === 'EPERM') throw new Error('BeamNG.drive is using the in-game version right now. Close the game and try again.');
    throw err;
  }
  // An unpacked copy of ours (from building it by hand) would load twice: the zip replaces it.
  const unpacked = join(modsDir, 'unpacked', 'jbeam_forge');
  if (await exists(join(unpacked, VERSION_FILE))) await rm(unpacked, { recursive: true, force: true });
  return ingameStatus(bundledZip, modsDir);
}
