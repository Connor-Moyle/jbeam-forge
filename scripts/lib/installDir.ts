import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultRoots, detectInstallDirs, validateInstallDir, type InstallValidation } from '../../src/main/beamng/locate';

/**
 * Resolve the BeamNG install for CLI scripts: `--dir=<path>`, else the app's
 * saved setting (%APPDATA%/jbeam-forge/settings.json), else auto-detect.
 */
export async function resolveInstallDir(argv: string[]): Promise<InstallValidation> {
  const roots = defaultRoots();
  const flag = argv.find((a) => a.startsWith('--dir='))?.slice('--dir='.length);
  const candidates: string[] = [];
  if (flag) candidates.push(flag);
  else {
    const saved = await readSavedInstallDir();
    if (saved) candidates.push(saved);
    candidates.push(...(await detectInstallDirs(roots)));
  }
  for (const dir of candidates) {
    const v = await validateInstallDir(dir, roots);
    if (v.ok) return v;
    if (flag) throw new Error(`--dir ${flag} is not a valid BeamNG install:\n  ${v.problems.join('\n  ')}`);
  }
  throw new Error('No BeamNG.drive install found. Set it in the app (Settings → BeamNG) or pass --dir=<install folder>.');
}

async function readSavedInstallDir(): Promise<string | null> {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  try {
    const settings = JSON.parse(await readFile(join(appData, 'jbeam-forge', 'settings.json'), 'utf8')) as { beamngInstallDir?: unknown };
    return typeof settings.beamngInstallDir === 'string' ? settings.beamngInstallDir : null;
  } catch {
    return null;
  }
}

export function describeInstall(v: InstallValidation): string {
  return `${v.dir} (${v.version ? `v${v.version}` : v.build ?? 'unknown version'}, ${v.vehicleCount} vehicle zips)`;
}
