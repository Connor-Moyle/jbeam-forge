import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultRoots,
  detectInstallDirs,
  detectUserDir,
  parseBeamngIni,
  parseLibraryFolders,
  samePath,
  validateInstallDir,
  type LocateRoots,
} from '../../src/main/beamng/locate';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'jbf-locate-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function put(path: string, content = ''): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function fakeInstall(root: string, opts: { exe?: 'root' | 'bin64' | 'none'; zips?: string[]; build?: string } = {}): Promise<string> {
  await mkdir(root, { recursive: true });
  if ((opts.exe ?? 'root') === 'root') await put(join(root, 'BeamNG.drive.exe'));
  if (opts.exe === 'bin64') await put(join(root, 'Bin64', 'BeamNG.drive.x64.exe'));
  if (opts.zips) {
    await mkdir(join(root, 'content', 'vehicles'), { recursive: true });
    for (const z of opts.zips) await put(join(root, 'content', 'vehicles', z));
  }
  if (opts.build) await put(join(root, 'integrity.json'), JSON.stringify({ buildinfo: opts.build, format: 1, integritydata: [] }));
  return root;
}

async function writeIni(localAppData: string, installPath: string, version = '0.39.1.0'): Promise<void> {
  await put(join(localAppData, 'BeamNG', 'BeamNG.drive.ini'), `\uFEFFversion = ${version}\r\ninstallPath = ${installPath}\\\r\n`);
}

describe('parsers', () => {
  it('parseBeamngIni reads version and installPath (BOM, CRLF, trailing backslash)', () => {
    const ini = '\uFEFFversion = 0.39.1.0\r\ninstallPath = I:\\SteamLibrary\\steamapps\\common\\BeamNG.drive\\\r\nother = 1\r\n';
    expect(parseBeamngIni(ini)).toEqual({ version: '0.39.1.0', installPath: 'I:\\SteamLibrary\\steamapps\\common\\BeamNG.drive\\' });
    expect(parseBeamngIni('')).toEqual({ version: null, installPath: null });
  });

  it('parseLibraryFolders unescapes doubled backslashes', () => {
    const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t\t"label"\t\t""\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"I:\\\\SteamLibrary"\n\t}\n}\n';
    expect(parseLibraryFolders(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'I:\\SteamLibrary']);
  });

  it('samePath ignores trailing separators (and case on Windows)', () => {
    expect(samePath(join(tmp, 'a'), join(tmp, 'a') + '/')).toBe(true);
    expect(samePath(join(tmp, 'a'), join(tmp, 'b'))).toBe(false);
    if (process.platform === 'win32') expect(samePath(join(tmp, 'A'), join(tmp, 'a'))).toBe(true);
  });

  it('defaultRoots derives unique Steam roots', () => {
    const roots = defaultRoots({ 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'L' });
    expect(roots.localAppData).toBe('L');
    expect(roots.steamRoots).toHaveLength(2);
    expect(roots.steamRoots.every((r) => r.endsWith('Steam'))).toBe(true);
  });
});

describe('detectInstallDirs', () => {
  it('lists the ini install first, then Steam libraries, de-duplicated', async () => {
    const la = join(tmp, 'la');
    const a = await fakeInstall(join(tmp, 'A'));
    const steam = join(tmp, 'steam');
    const lib = join(tmp, 'lib2');
    const b = await fakeInstall(join(lib, 'steamapps', 'common', 'BeamNG.drive'));
    await writeIni(la, a);
    await put(join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "1" { "path"\t\t${JSON.stringify(lib)} } }`);
    const roots: LocateRoots = { localAppData: la, steamRoots: [steam] };

    expect(await detectInstallDirs(roots)).toEqual([resolve(a), resolve(b)]);

    await writeIni(la, b);
    expect(await detectInstallDirs(roots)).toEqual([resolve(b)]);
  });

  it('returns nothing when there is no ini and no Steam library', async () => {
    expect(await detectInstallDirs({ localAppData: join(tmp, 'none'), steamRoots: [join(tmp, 'nosteam')] })).toEqual([]);
  });
});

describe('validateInstallDir', () => {
  const rootsFor = (la: string): LocateRoots => ({ localAppData: la, steamRoots: [] });

  it('accepts a complete install and reports version, build and vehicle count', async () => {
    const la = join(tmp, 'la');
    const dir = await fakeInstall(join(tmp, 'game'), { zips: ['covet.zip', 'pickup.ZIP', 'readme.txt'], build: 'build 20972' });
    await writeIni(la, dir);
    expect(await validateInstallDir(dir, rootsFor(la))).toEqual({
      ok: true,
      dir: resolve(dir),
      version: '0.39.1.0',
      build: 'build 20972',
      vehicleCount: 2,
      problems: [],
    });
  });

  it('accepts the Bin64 executable layout', async () => {
    const dir = await fakeInstall(join(tmp, 'game'), { exe: 'bin64', zips: ['a.zip'] });
    expect((await validateInstallDir(dir, rootsFor(tmp))).ok).toBe(true);
  });

  it.each([
    ['no executable', { exe: 'none' as const, zips: ['a.zip'] }, 'BeamNG.drive.exe'],
    ['no content/vehicles', {}, 'content/vehicles is missing'],
    ['no vehicle zips', { zips: ['notes.txt'] }, 'no vehicle zips'],
  ])('rejects an install with %s', async (_label, opts, problem) => {
    const dir = await fakeInstall(join(tmp, 'game'), opts);
    const v = await validateInstallDir(dir, rootsFor(tmp));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain(problem);
  });

  it('rejects a missing folder', async () => {
    const v = await validateInstallDir(join(tmp, 'nope'), rootsFor(tmp));
    expect(v).toMatchObject({ ok: false, problems: ['Folder does not exist.'], vehicleCount: 0 });
  });

  it('only trusts the ini version when it points at this folder', async () => {
    const la = join(tmp, 'la');
    const dir = await fakeInstall(join(tmp, 'game'), { zips: ['a.zip'] });
    await writeIni(la, join(tmp, 'elsewhere'));
    const v = await validateInstallDir(dir, rootsFor(la));
    expect(v.ok).toBe(true);
    expect(v.version).toBeNull();
    expect(v.build).toBeNull();
  });
});

describe('detectUserDir', () => {
  it('finds %LOCALAPPDATA%/BeamNG/BeamNG.drive/current', async () => {
    const current = join(tmp, 'BeamNG', 'BeamNG.drive', 'current');
    await mkdir(current, { recursive: true });
    expect(await detectUserDir({ localAppData: tmp, steamRoots: [] })).toBe(current);
  });

  it('returns null when absent or unknown', async () => {
    expect(await detectUserDir({ localAppData: tmp, steamRoots: [] })).toBeNull();
    expect(await detectUserDir({ localAppData: undefined, steamRoots: [] })).toBeNull();
  });
});
