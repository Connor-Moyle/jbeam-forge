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
 * the user folder is `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current`, or `<userFolder>\current` when
 * the ini names one (the game's "user folder" option).
 *
 * On Linux the game runs natively (its ini and user folder under ~/.local/share) or through
 * Steam's Proton, which keeps the Windows layout inside the game's compatibility prefix
 * (steamapps/compatdata/284160/pfx), with Windows paths in the ini (C:\ is the prefix's drive_c,
 * Z:\ is /).
 */

/** BeamNG.drive's Steam app id (its Proton prefix is compatdata/<id>). */
export const BEAMNG_APP_ID = '284160';

export interface LocateRoots {
  /** %LOCALAPPDATA% (Windows). */
  localAppData: string | undefined;
  /** Steam install roots to read libraryfolders.vdf from. */
  steamRoots: string[];
  /** $XDG_DATA_HOME, usually ~/.local/share (Linux, the game's native build). */
  dataHome?: string | undefined;
}

export function defaultRoots(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): LocateRoots {
  if (platform !== 'win32') {
    const home = env.HOME ?? '';
    const dataHome = env.XDG_DATA_HOME || (home ? join(home, '.local', 'share') : undefined);
    // Steam's usual homes: the normal package, the Flatpak and the Snap.
    const steamRoots = home ? [join(home, '.steam', 'steam'), join(home, '.local', 'share', 'Steam'), join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'), join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam')] : [];
    return { localAppData: undefined, steamRoots, dataHome };
  }
  const steamRoots = [env['ProgramFiles(x86)'], env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files']
    .filter((p): p is string => Boolean(p))
    .map((p) => join(p, 'Steam'));
  return { localAppData: env.LOCALAPPDATA, steamRoots: [...new Set(steamRoots)] };
}

export interface BeamngIni {
  version: string | null;
  installPath: string | null;
  /** The game's user folder, when moved from its default (it holds current/). */
  userFolder: string | null;
}

/** Parse BeamNG.drive.ini (`key = value` lines, may start with a BOM). */
export function parseBeamngIni(text: string): BeamngIni {
  const out: BeamngIni = { version: null, installPath: null, userFolder: null };
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][\w.]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'version') out.version = value || null;
    else if (key === 'installPath') out.installPath = value || null;
    else if (key === 'userFolder') out.userFolder = value || null;
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

/** A found ini, with its paths made local (a Proton prefix's Windows paths mapped to the Linux ones). */
export interface FoundIni {
  ini: BeamngIni;
  /** Where its default user folder lives (the folder holding BeamNG.drive/current). */
  defaultUserRoot: string;
  local: (windowsPath: string) => string;
}

/** A Windows path inside a Proton prefix, as a Linux path: C:\ is the prefix's drive_c, Z:\ is /. */
export function protonPath(prefix: string, windowsPath: string): string {
  const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(windowsPath.trim());
  if (!m) return windowsPath;
  const rest = m[2]!.split(/[\\/]+/).filter(Boolean);
  const drive = m[1]!.toLowerCase();
  if (drive === 'z') return '/' + rest.join('/');
  return join(prefix, `drive_${drive}`, ...rest);
}

/** Steam libraries under the roots (each root, and the libraries its libraryfolders.vdf lists). */
async function steamLibraries(roots: LocateRoots): Promise<string[]> {
  const out: string[] = [];
  for (const steam of roots.steamRoots) {
    const vdf = await readText(join(steam, 'steamapps', 'libraryfolders.vdf'));
    for (const lib of vdf ? [steam, ...parseLibraryFolders(vdf)] : [steam]) if (!out.some((o) => samePath(o, lib))) out.push(lib);
  }
  return out;
}

/** Every BeamNG.drive.ini there is: Windows, the native Linux build, and Proton prefixes. */
export async function findInis(roots: LocateRoots): Promise<FoundIni[]> {
  const found: FoundIni[] = [];
  const tryIni = async (path: string, defaultUserRoot: string, local: (p: string) => string) => {
    const text = await readText(path);
    if (text !== null) found.push({ ini: parseBeamngIni(text), defaultUserRoot, local });
  };
  if (roots.localAppData) await tryIni(join(roots.localAppData, 'BeamNG', 'BeamNG.drive.ini'), join(roots.localAppData, 'BeamNG'), (p) => p);
  if (roots.dataHome) {
    await tryIni(join(roots.dataHome, 'BeamNG', 'BeamNG.drive.ini'), join(roots.dataHome, 'BeamNG'), (p) => p);
    await tryIni(join(roots.dataHome, 'BeamNG.drive.ini'), roots.dataHome, (p) => p);
  }
  for (const lib of await steamLibraries(roots)) {
    const prefix = join(lib, 'steamapps', 'compatdata', BEAMNG_APP_ID, 'pfx');
    const local = join(prefix, 'drive_c', 'users', 'steamuser', 'AppData', 'Local', 'BeamNG');
    await tryIni(join(local, 'BeamNG.drive.ini'), local, (p) => protonPath(prefix, p));
  }
  return found;
}

/** The first ini found (the game's own on Windows), its paths made local. */
export async function readBeamngIni(roots: LocateRoots): Promise<BeamngIni | null> {
  const first = (await findInis(roots))[0];
  if (!first) return null;
  const { ini, local } = first;
  return { version: ini.version, installPath: ini.installPath && local(ini.installPath), userFolder: ini.userFolder && local(ini.userFolder) };
}

/** Candidate install dirs, most trustworthy first (ini, then Steam libraries). Not yet validated. */
export async function detectInstallDirs(roots: LocateRoots): Promise<string[]> {
  const found: string[] = [];
  const add = (p: string | null | undefined) => {
    // The game writes installPath with a trailing backslash, which only Windows' resolve() drops.
    if (p && !found.some((f) => samePath(f, p))) found.push(resolve(p.replace(/(?<=[^\\/:])[\\/]+$/, '')));
  };

  for (const { ini, local } of await findInis(roots)) if (ini.installPath) add(local(ini.installPath));

  for (const lib of await steamLibraries(roots)) {
    const candidate = join(lib, 'steamapps', 'common', 'BeamNG.drive');
    if (await isDir(candidate)) add(candidate);
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
  const exes = [join(abs, 'BeamNG.drive.exe'), join(abs, 'Bin64', 'BeamNG.drive.x64.exe'), join(abs, 'BinLinux', 'BeamNG.drive.x64'), join(abs, 'BeamNG.drive.x64')];
  if (!(await Promise.all(exes.map(isFile))).some(Boolean)) {
    problems.push('The game itself wasn’t found here: pick the game folder (the one containing BeamNG.drive.exe, Bin64 or BinLinux).');
  }
  try {
    vehicleCount = (await readdir(join(abs, 'content', 'vehicles'))).filter((f) => f.toLowerCase().endsWith('.zip')).length;
    if (vehicleCount === 0) problems.push('content/vehicles contains no vehicle zips.');
  } catch {
    problems.push('content/vehicles is missing — this does not look like a BeamNG.drive install.');
  }

  const match = (await findInis(roots)).find(({ ini, local }) => ini.installPath && samePath(local(ini.installPath), abs));
  const version = match?.ini.version ?? null;
  const head = await readHead(join(abs, 'integrity.json'), 512);
  const build = head?.match(/"buildinfo"\s*:\s*"([^"]*)"/)?.[1] ?? null;

  return { ok: problems.length === 0, dir: abs, version, build, vehicleCount, problems };
}

/**
 * The BeamNG user folder (mods, logs): <userFolder>/current when the ini names one, else the
 * default (0.39: %LOCALAPPDATA%\BeamNG\BeamNG.drive\current; ~/.local/share/BeamNG/BeamNG.drive/current
 * on Linux; the same Windows place inside a Proton prefix).
 */
export async function detectUserDir(roots: LocateRoots): Promise<string | null> {
  const candidates: string[] = [];
  for (const { ini, local, defaultUserRoot } of await findInis(roots)) {
    if (ini.userFolder) candidates.push(join(local(ini.userFolder), 'current'));
    candidates.push(join(defaultUserRoot, 'BeamNG.drive', 'current'));
  }
  if (roots.localAppData) candidates.push(join(roots.localAppData, 'BeamNG', 'BeamNG.drive', 'current'));
  if (roots.dataHome) candidates.push(join(roots.dataHome, 'BeamNG', 'BeamNG.drive', 'current'), join(roots.dataHome, 'BeamNG.drive', 'current'));
  for (const c of candidates) if (await isDir(c)) return c;
  return null;
}
