import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteStream } from 'node:fs';
import yazl from 'yazl';
import { ExtensionFiles } from '../../src/main/extensions/files';
import { modelLabel } from '../../src/main/import/acCar';

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-extfs-'));
  await mkdir(join(dir, 'game', 'cars'), { recursive: true });
  await writeFile(join(dir, 'game', 'cars', 'car.txt'), 'hello');
  await writeFile(join(dir, 'secret.txt'), 'no');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('extension file access', () => {
  it('reads only inside folders granted to that extension, links included, and remembers them', async () => {
    const files = new ExtensionFiles(join(dir, 'grants.json'), join(dir, 'models'), logger);
    await expect(files.read('my-ext', join(dir, 'game', 'cars', 'car.txt'))).rejects.toThrow(/Outside/);
    await files.grant('my-ext', join(dir, 'game'));
    expect(new TextDecoder().decode(await files.read('my-ext', join(dir, 'game', 'cars', 'car.txt')))).toBe('hello');
    expect((await files.list('my-ext', join(dir, 'game'))).map((e) => e.name)).toEqual(['cars']);
    await expect(files.read('my-ext', join(dir, 'game', '..', 'secret.txt'))).rejects.toThrow(/Outside/);
    await expect(files.read('other-ext', join(dir, 'game', 'cars', 'car.txt'))).rejects.toThrow(/Outside/);
    await symlink(join(dir, 'secret.txt'), join(dir, 'game', 'link.txt')).catch(() => undefined);
    await expect(files.read('my-ext', join(dir, 'game', 'link.txt'))).rejects.toThrow(/Outside|Not found/);
    const again = new ExtensionFiles(join(dir, 'grants.json'), join(dir, 'models'), logger);
    expect((await again.folders('my-ext')).length).toBe(1);
    await again.revoke('my-ext');
    expect(await again.folders('my-ext')).toEqual([]);
  });

  it('writes an extension’s model into its own folder', async () => {
    const files = new ExtensionFiles(join(dir, 'grants.json'), join(dir, 'models'), logger);
    const obj = await files.writeModel('my-ext', '../../evil name', [{ name: 'model.obj', text: 'o a' }, { name: 'model.mtl', text: '' }]);
    expect(obj.startsWith(join(dir, 'models', 'my-ext'))).toBe(true);
    await expect(files.writeModel('my-ext', 'x', [{ name: 'a.mtl', text: '' }])).rejects.toThrow(/no .obj/);
  });
});

describe('zips for extensions', () => {
  it('lists, reads and unpacks a zip inside its folders, and may then read what it unpacked', async () => {
    const zipPath = join(dir, 'game', 'car.zip');
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile();
      zip.addBuffer(Buffer.from('{"a":1}'), 'vehicles/car/car.jbeam');
      zip.addBuffer(Buffer.from('other'), 'levels/x/info.json');
      zip.end();
      zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
    });
    const files = new ExtensionFiles(join(dir, 'grants.json'), join(dir, 'models'), logger);
    await expect(files.zipList('my-ext', zipPath)).rejects.toThrow(/Outside/);
    await files.grant('my-ext', join(dir, 'game'));
    expect((await files.zipList('my-ext', zipPath)).map((e) => e.name).sort()).toEqual(['levels/x/info.json', 'vehicles/car/car.jbeam']);
    expect(new TextDecoder().decode(await files.zipRead('my-ext', zipPath, 'vehicles/car/car.jbeam'))).toBe('{"a":1}');
    const out = await files.zipExtract('my-ext', zipPath, ['vehicles/car/']);
    expect(new TextDecoder().decode(await files.read('my-ext', join(out, 'vehicles', 'car', 'car.jbeam')))).toBe('{"a":1}');
    await expect(files.read('my-ext', join(out, 'levels', 'x', 'info.json'))).rejects.toThrow(/Not found/);
  });
});

describe('Assetto Corsa model labels', () => {
  it('says what each kn5 is', () => {
    expect(modelLabel('mx5.kn5')).toBe('Detailed (mx5)');
    expect(modelLabel('mx5_lod_B.kn5')).toMatch(/^Medium detail, LOD B/);
    expect(modelLabel('mx5_lod_d.kn5')).toMatch(/^Far detail, LOD D/);
    expect(modelLabel('collider.kn5')).toMatch(/^Collider/);
    expect(modelLabel('driver_base.kn5')).toBe('Driver');
  });
});
