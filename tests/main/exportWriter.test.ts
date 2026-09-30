import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yauzl from 'yauzl';
import { checkBundle, ExportError, installUnpacked, MARKER_FILE, writeZip, type ModBundle } from '../../src/main/export/writer';

let dir: string;
let tex: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-export-'));
  tex = join(dir, 'paint.dds');
  await writeFile(tex, 'DDS fake');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bundle = (over: Partial<ModBundle> = {}): ModBundle => ({
  slug: 'test',
  projectName: 'Test',
  files: [
    { path: 'vehicles/test/test.jbeam', text: '{}' },
    { path: 'vehicles/test/default.jpg', base64: Buffer.from([0xff, 0xd8]).toString('base64') },
  ],
  copies: [{ from: tex, to: 'vehicles/test/paint.dds' }],
  ...over,
});

describe('checkBundle', () => {
  it('accepts paths inside vehicles/<slug>/ and granted image copies', () => {
    expect(() => checkBundle(bundle(), () => true)).not.toThrow();
  });

  it('rejects escapes, foreign folders, non-images and ungranted sources', () => {
    expect(() => checkBundle(bundle({ files: [{ path: 'vehicles/test/../../evil.txt', text: '' }] }), () => true)).toThrow(ExportError);
    expect(() => checkBundle(bundle({ files: [{ path: 'vehicles/other/x.jbeam', text: '' }] }), () => true)).toThrow(/outside/);
    expect(() => checkBundle(bundle({ copies: [{ from: join(dir, 'secret.txt'), to: 'vehicles/test/secret.txt' }] }), () => true)).toThrow(/Only textures/);
    expect(() => checkBundle(bundle(), () => false)).toThrow(/outside every folder/);
    expect(() => checkBundle(bundle({ slug: 'Bad Name' }), () => true)).toThrow(/Invalid mod name/);
  });

  it('lets part mods use vehicles/common/<slug>/ and name their own jbeam beside a car', () => {
    expect(() => checkBundle(bundle({ files: [{ path: 'vehicles/common/test/test_tyres.jbeam', text: '{}' }], copies: [] }), () => true)).not.toThrow();
    expect(() => checkBundle(bundle({ files: [{ path: 'vehicles/etk800/test_engine.jbeam', text: '{}' }], copies: [] }), () => true)).not.toThrow();
    // Never a game file's name, and never outside jbeam.
    expect(() => checkBundle(bundle({ files: [{ path: 'vehicles/etk800/etk800_engine.jbeam', text: '{}' }], copies: [] }), () => true)).toThrow(/outside/);
    expect(() => checkBundle(bundle({ files: [{ path: 'vehicles/etk800/test_engine.lua', text: '' }], copies: [] }), () => true)).toThrow(/outside/);
    expect(() => checkBundle(bundle({ files: [{ path: 'vehicles/common/other/x.jbeam', text: '' }], copies: [] }), () => true)).toThrow(/outside/);
  });
});

describe('installUnpacked', () => {
  it('writes mods/unpacked/<slug> with a marker, and replaces its own previous export', async () => {
    const mods = join(dir, 'mods');
    const first = await installUnpacked(mods, bundle());
    expect(first.path).toBe(join(mods, 'unpacked', 'test'));
    expect(await readFile(join(first.path, 'vehicles', 'test', 'test.jbeam'), 'utf8')).toBe('{}');
    expect(await readFile(join(first.path, 'vehicles', 'test', 'paint.dds'), 'utf8')).toBe('DDS fake');
    expect(JSON.parse(await readFile(join(first.path, MARKER_FILE), 'utf8')).generator).toBe('JBeam Forge');
    await installUnpacked(mods, bundle({ files: [{ path: 'vehicles/test/test.jbeam', text: '{"v":2}' }], copies: [] }));
    expect(await readFile(join(first.path, 'vehicles', 'test', 'test.jbeam'), 'utf8')).toBe('{"v":2}');
    // Old files don't linger, and no staging/backup folders are left behind.
    expect(await readdir(join(first.path, 'vehicles', 'test'))).toEqual(['test.jbeam']);
    expect(await readdir(join(mods, 'unpacked'))).toEqual(['test']);
  });

  it('never overwrites a folder it did not create', async () => {
    const mods = join(dir, 'mods');
    await mkdir(join(mods, 'unpacked', 'test'), { recursive: true });
    await writeFile(join(mods, 'unpacked', 'test', 'someone-elses.txt'), 'x');
    await expect(installUnpacked(mods, bundle())).rejects.toThrow(/not created by JBeam Forge/);
    expect(await readdir(join(mods, 'unpacked', 'test'))).toEqual(['someone-elses.txt']);
  });
});

describe('writeZip', () => {
  it('writes every file and copy at its mod path', async () => {
    const out = join(dir, 'test.zip');
    await writeZip(out, bundle());
    const names = await new Promise<string[]>((resolve, reject) => {
      yauzl.open(out, { lazyEntries: true }, (err, zip) => {
        if (err || !zip) return reject(err ?? new Error('zip open failed'));
        const list: string[] = [];
        zip.on('entry', (e: { fileName: string }) => {
          list.push(e.fileName);
          zip.readEntry();
        });
        zip.on('end', () => resolve(list.sort()));
        zip.readEntry();
      });
    });
    expect(names).toEqual(['vehicles/test/default.jpg', 'vehicles/test/paint.dds', 'vehicles/test/test.jbeam']);
  });
});
