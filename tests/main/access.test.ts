import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { FolderTrust, isInside, locateSource, projectResourceFolders } from '../../src/main/import/access';
import { ProjectFiles } from '../../src/main/services/projectFiles';
import { createEmptyProject } from '../../src/shared/project/io';
import type { Project, Source } from '../../src/shared/project/schema';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-access-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(rel: string): Promise<string> {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, 'x');
  return p;
}

function project(sources: Partial<Source>[]): Project {
  const p = createEmptyProject({ name: 'P', slug: 'p' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  return {
    ...p,
    sources: sources.map((s, i) => ({
      id: `s${i}`,
      path: s.path ?? s.absolutePath!,
      absolutePath: s.absolutePath ?? 'C:/nowhere/x.dae',
      format: 'dae',
      import: { scale: 1, upAxis: '+y', forwardAxis: '+z' },
      textureDirs: s.textureDirs ?? [],
      addedAt: '2026-01-01T00:00:00.000Z',
    })),
  };
}

describe('projectResourceFolders', () => {
  it('auto-safe inside the project folder; everything else needs consent', async () => {
    const projectPath = join(dir, 'proj', 'car.jbforge');
    const inner = await put('proj/models/car.dae');
    const outer = await put('elsewhere/wheel.dae');
    await mkdir(join(dir, 'textures'), { recursive: true });
    const res = await projectResourceFolders(projectPath, project([{ path: 'models/car.dae', absolutePath: inner }, { absolutePath: outer, textureDirs: [join(dir, 'textures'), join(dir, 'does-not-exist')] }]));
    expect(res.inside).toEqual([resolve(dir, 'proj', 'models')]);
    expect(res.outside.sort()).toEqual([resolve(dir, 'elsewhere'), resolve(dir, 'textures')].sort());
  });

  it('a relative path that escapes the project folder is outside (no silent traversal)', async () => {
    const projectPath = join(dir, 'proj', 'car.jbforge');
    await put('secret/model.dae');
    const res = await projectResourceFolders(projectPath, project([{ path: '../secret/model.dae', absolutePath: 'C:/x/model.dae' }]));
    expect(res.inside).toEqual([]);
    expect(res.outside).toEqual([resolve(dir, 'secret')]);
  });
});

describe('locateSource', () => {
  it('never looks at candidates outside granted folders', async () => {
    const model = await put('models/car.dae');
    const files = new ProjectFiles();
    expect(await locateSource(files, null, { path: model, absolutePath: model })).toBeNull();
    files.grantRoot(join(dir, 'models'));
    expect(await locateSource(files, null, { path: model, absolutePath: model })).toBe(model);
  });
});

describe('FolderTrust', () => {
  it('remembers allowed folders per project across reloads', async () => {
    const file = join(dir, 'trust.json');
    const t = new FolderTrust(file);
    await t.load();
    await t.trust('C:/p/car.jbforge', ['D:/assets']);
    const reloaded = new FolderTrust(file);
    await reloaded.load();
    expect(reloaded.isTrusted('C:/p/car.jbforge', 'D:/assets')).toBe(true);
    expect(reloaded.isTrusted('C:/p/other.jbforge', 'D:/assets')).toBe(false);
  });
});

describe('isInside', () => {
  it('handles equal paths, children and siblings with a shared prefix', () => {
    expect(isInside(join(dir, 'a'), join(dir, 'a'))).toBe(true);
    expect(isInside(join(dir, 'a', 'b'), join(dir, 'a'))).toBe(true);
    expect(isInside(join(dir, 'ab'), join(dir, 'a'))).toBe(false);
  });
});
