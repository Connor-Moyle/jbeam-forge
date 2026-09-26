import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecentService, serializeRecent } from '../../src/main/services/recent';
import { AccessError, ProjectFiles, withProjectExtension } from '../../src/main/services/projectFiles';
import { createEmptyProject, serializeProject } from '../../src/shared/project/io';
import { NULL_LOGGER } from '../../src/shared/logger';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-proj-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const projectText = (name = 'Car') => serializeProject(createEmptyProject({ name, slug: 'car' }, '0.1.0', new Date('2026-01-01T00:00:00Z')));
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;

describe('ProjectFiles', () => {
  it('refuses to write paths that were never granted', async () => {
    const files = new ProjectFiles();
    await expect(files.write(join(dir, 'x.jbforge'), projectText())).rejects.toBeInstanceOf(AccessError);
  });

  it('writes granted paths after validating the document', async () => {
    const files = new ProjectFiles();
    const path = join(dir, 'car.jbforge');
    files.grantFile(path);
    expect(await files.write(path, projectText('Mine'))).toEqual({ name: 'Mine', slug: 'car' });
    expect(await files.read(path)).toBe(projectText('Mine'));
    await expect(files.write(path, '{"not":"a project"}')).rejects.toThrow();
    expect(await files.read(path)).toBe(projectText('Mine')); // invalid write left the file intact
  });

  it('only reads .jbforge files', async () => {
    const files = new ProjectFiles();
    await writeFile(join(dir, 'secrets.txt'), 'x');
    await expect(files.read(join(dir, 'secrets.txt'))).rejects.toBeInstanceOf(AccessError);
  });

  it('granting a file grants its folder as a root (and nothing above it)', () => {
    const files = new ProjectFiles();
    files.grantFile(join(dir, 'proj', 'car.jbforge'));
    expect(files.isUnderGrantedRoot(join(dir, 'proj', 'models', 'car.dae'))).toBe(true);
    expect(files.isUnderGrantedRoot(join(dir, 'other.dae'))).toBe(false);
  });

  it('withProjectExtension adds .jbforge once', () => {
    expect(withProjectExtension('C:/a/car')).toBe('C:/a/car.jbforge');
    expect(withProjectExtension('C:/a/car.JBFORGE')).toBe('C:/a/car.JBFORGE');
  });
});

describe('RecentService', () => {
  const make = (now = new Date('2026-09-26T12:00:00Z')) => new RecentService(join(dir, 'recent.json'), join(dir, 'thumbs'), NULL_LOGGER, () => now);

  it('keeps most-recent-first, de-duplicated, capped at 12', async () => {
    const r = make();
    for (let i = 0; i < 15; i++) await r.touch(join(dir, `p${i}.jbforge`), { name: `P${i}`, slug: `p${i}` });
    await r.touch(join(dir, 'p10.jbforge'), { name: 'P10', slug: 'p10' });
    const list = await r.list();
    expect(list).toHaveLength(12);
    expect(list[0]!.name).toBe('P10');
    expect(list.filter((e) => e.name === 'P10')).toHaveLength(1);
  });

  it('persists and reloads; reports missing files', async () => {
    const path = join(dir, 'car.jbforge');
    await writeFile(path, projectText());
    const r = make();
    await r.touch(path, { name: 'Car', slug: 'car' });
    await r.touch(join(dir, 'gone.jbforge'), { name: 'Gone', slug: 'gone' });
    const reloaded = make();
    await reloaded.load();
    const list = await reloaded.list();
    expect(list.map((e) => [e.name, e.exists])).toEqual([
      ['Gone', false],
      ['Car', true],
    ]);
    expect(reloaded.has(path)).toBe(true);
  });

  it('stores JPEG thumbnails, rejects anything else, and cleans them up on remove', async () => {
    const r = make();
    const path = join(dir, 'car.jbforge');
    await r.touch(path, { name: 'Car', slug: 'car' }, JPEG);
    expect((await r.list())[0]!.thumbnail).toBe(JPEG);
    await r.touch(join(dir, 'b.jbforge'), { name: 'B', slug: 'b' }, 'data:text/html;base64,PHNjcmlwdD4=');
    expect((await r.list())[0]!.thumbnail).toBeNull();
    await r.remove(path);
    expect(await readdir(join(dir, 'thumbs'))).toEqual([]);
  });

  it('keeps the previous thumbnail when a new one is rejected', async () => {
    const r = make();
    const path = join(dir, 'car.jbforge');
    await r.touch(path, { name: 'Car', slug: 'car' }, JPEG);
    await r.touch(path, { name: 'Car', slug: 'car' }, 'data:image/png;base64,AAAA');
    expect((await r.list())[0]!.thumbnail).toBe(JPEG);
  });

  it('keeps the previous thumbnail when re-touched without one', async () => {
    const r = make();
    const path = join(dir, 'car.jbforge');
    await r.touch(path, { name: 'Car', slug: 'car' }, JPEG);
    await r.touch(path, { name: 'Car', slug: 'car' });
    expect((await r.list())[0]!.thumbnail).toBe(JPEG);
  });

  it('starts empty when the file is corrupt', async () => {
    await writeFile(join(dir, 'recent.json'), '{ nope');
    const r = make();
    await r.load();
    expect(await r.list()).toEqual([]);
  });

  it('serializes deterministically (snapshot)', async () => {
    const r = make();
    await r.touch('C:/projects/car.jbforge', { name: 'Car', slug: 'car' });
    const text = await readFile(join(dir, 'recent.json'), 'utf8');
    expect(text).toBe(serializeRecent(JSON.parse(text) as Parameters<typeof serializeRecent>[0]));
    expect(text).toMatchSnapshot();
  });
});
