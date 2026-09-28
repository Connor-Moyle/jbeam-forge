import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { InstallValidation } from '@shared/beamng';

export type { InstallValidation };

/**
 * Finding and validating a BeamNG.drive install (SPEC §3.1). Everything here
 * takes its roots as arguments so tests can point it at fake trees.
 *
 * Verified on this machine (0.39.1): `%LOCALAPPDATA%\BeamNG\BeamNG.drive.ini`
 * holds `version = …` and `installPath = …`; the install root holds
 * `BeamNG.drive.exe`, `content/vehicles/*.zip` and `integrity.json`
 * (whose `buildinfo` is the only version marker inside the install itself);
 * the user folder is `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current`.
 */

export interface LocateRoots {
  /** %LOCALAPPDATA% */
  localAppData: string | undefined;
  /** Steam install roots to read libraryfolders.vdf from. */
  steamRoots: string[];
}

export function defaultRoots(env: NodeJS.ProcessEnv = process.env): LocateRoots {
  const steamRoots = [env['ProgramFiles(x86)'], env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files']
    .filter((p): p is string => Boolean(p))
    .map((p) => join(p, 'Steam'));
  return { localAppData: env.LOCALAPPDATA, steamRoots: [...new Set(steamRoots)] };
}

export interface BeamngIni {
  version: string | null;
  installPath: string | null;
}

/** Parse BeamNG.drive.ini (`key = value` lines, may start with a BOM). */
export function parseBeamngIni(text: string): BeamngIni {
  const out: BeamngIni = { version: null, installPath: null };
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][\w.]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'version') out.version = value || null;
    else if (key === 'installPath') out.installPath = value || null;
  }
  return out;
}

/** Library paths from Steam's libraryfolders.vdf (`"path"  "D:\\SteamLibrary"`). */
export function parseLibraryFolders(vdf: string): string[] {
  const paths: string[] = [];
  for (const m of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
    paths.push(m[1]!.replace(/\\\\/g, '\\'));
  }
  return paths;
}

/** Compare paths: resolved, no trailing separator, case-insensitive on Windows. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readHead(path: string, bytes: number): Promise<string | null> {
  try {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

export async function readBeamngIni(roots: LocateRoots): Promise<BeamngIni | null> {
  if (!roots.localAppData) return null;
  const text = await readText(join(roots.localAppData, 'BeamNG', 'BeamNG.drive.ini'));
  return text === null ? null : parseBeamngIni(text);
}

/** Candidate install dirs, most trustworthy first (ini, then Steam libraries). Not yet validated. */
export async function detectInstallDirs(roots: LocateRoots): Promise<string[]> {
  const found: string[] = [];
  const add = (p: string | null | undefined) => {
    // The game writes installPath with a trailing backslash, which only Windows' resolve() drops.
    if (p && !found.some((f) => samePath(f, p))) found.push(resolve(p.replace(/(?<=[^\\/:])[\\/]+$/, '')));
  };

  add((await readBeamngIni(roots))?.installPath);

  for (const steam of roots.steamRoots) {
    const vdf = await readText(join(steam, 'steamapps', 'libraryfolders.vdf'));
    const libraries = vdf ? [steam, ...parseLibraryFolders(vdf)] : [steam];
    for (const lib of libraries) {
      const candidate = join(lib, 'steamapps', 'common', 'BeamNG.drive');
      if (await isDir(candidate)) add(candidate);
    }
  }
  return found;
}

export async function validateInstallDir(dir: string, roots: LocateRoots): Promise<InstallValidation> {
  const abs = resolve(dir);
  const problems: string[] = [];
  let vehicleCount = 0;

  if (!(await isDir(abs))) {
    return { ok: false, dir: abs, version: null, build: null, vehicleCount, problems: ['Folder does not exist.'] };
  }
  if (!(await isFile(join(abs, 'BeamNG.drive.exe'))) && !(await isFile(join(abs, 'Bin64', 'BeamNG.drive.x64.exe')))) {
    problems.push('BeamNG.drive.exe not found — pick the game folder itself (the one containing BeamNG.drive.exe).');
  }
  try {
    vehicleCount = (await readdir(join(abs, 'content', 'vehicles'))).filter((f) => f.toLowerCase().endsWith('.zip')).length;
    if (vehicleCount === 0) problems.push('content/vehicles contains no vehicle zips.');
  } catch {
    problems.push('content/vehicles is missing — this does not look like a BeamNG.drive install.');
  }

  const ini = await readBeamngIni(roots);
  const version = ini?.installPath && samePath(ini.installPath, abs) ? ini.version : null;
  const head = await readHead(join(abs, 'integrity.json'), 512);
  const build = head?.match(/"buildinfo"\s*:\s*"([^"]*)"/)?.[1] ?? null;

  return { ok: problems.length === 0, dir: abs, version, build, vehicleCount, problems };
}

/** The BeamNG user folder (mods, logs). 0.39 layout: %LOCALAPPDATA%\BeamNG\BeamNG.drive\current. */
export async function detectUserDir(roots: LocateRoots): Promise<string | null> {
  if (!roots.localAppData) return null;
  const current = join(roots.localAppData, 'BeamNG', 'BeamNG.drive', 'current');
  return (await isDir(current)) ? current : null;
}
