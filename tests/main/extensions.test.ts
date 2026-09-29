import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExtensionService } from '../../src/main/extensions/service';

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-ext-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('extensions folder', () => {
  it('creates the sample, lists it with its code, and installs another from a folder', async () => {
    const svc = new ExtensionService(join(dir, 'extensions'), logger);
    expect(await svc.list()).toEqual([]);
    const folder = await svc.create();
    const second = await svc.create();
    expect(second).not.toBe(folder);
    const list = await svc.list();
    expect(list.map((e) => e.manifest?.id)).toEqual(['hello-extension', 'hello-extension-2']);
    expect(list[0]!.code).toContain('forge.commands.register');

    const src = join(dir, 'mine');
    await mkdir(src);
    await writeFile(join(src, 'extension.json'), JSON.stringify({ id: 'my-tools', name: 'My tools', version: '0.1.0', main: 'tools.js' }));
    await writeFile(join(src, 'tools.js'), 'forge.log("hi")');
    const to = await svc.install(src);
    expect(await readFile(join(to, 'tools.js'), 'utf8')).toBe('forge.log("hi")');
    expect((await svc.list()).find((e) => e.manifest?.id === 'my-tools')?.code).toBe('forge.log("hi")');
  });

  it('reports broken extensions instead of failing', async () => {
    const svc = new ExtensionService(dir, logger);
    await mkdir(join(dir, 'bad'));
    await writeFile(join(dir, 'bad', 'extension.json'), '{ "id": "Bad Id" }');
    await mkdir(join(dir, 'escape'));
    await writeFile(join(dir, 'escape', 'extension.json'), JSON.stringify({ id: 'escape', name: 'E', version: '1', main: '../x.js' }));
    const list = await svc.list();
    expect(list.find((e) => e.folder.endsWith('bad'))?.error).toMatch(/extension.json/);
    expect(list.find((e) => e.folder.endsWith('escape'))?.error).toBeTruthy();
    await expect(svc.install(join(dir, 'bad'))).rejects.toThrow(/Not an extension/);
  });
});
