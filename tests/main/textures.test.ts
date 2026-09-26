import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveTextureRefs, TextureIndex, textureCandidates } from '../../src/main/import/textures';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-tex-'));
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

describe('textureCandidates', () => {
  it('keeps relative refs and offers other extensions for the same stem', () => {
    const c = textureCandidates('boxer_b.color.png');
    expect(c.relative).toBe('boxer_b.color.png');
    expect(c.names).toEqual(expect.arrayContaining(['boxer_b.color.png', 'boxer_b.color.dds', 'boxer_b.color.jpg']));
    expect(c.names[0]).toBe('boxer_b.color.png');
  });

  it('treats absolute and URL-encoded foreign paths as name lookups (Sunburst case)', () => {
    const c = textureCandidates('/C:/Work%20space/BeamNG%20Game/vehicles/common/grille_d.dds');
    expect(c.relative).toBeNull();
    expect(c.names[0]).toBe('grille_d.dds');
  });

  it('handles backslashes and file:// URLs', () => {
    expect(textureCandidates('file:///D:\\art\\Paint.TGA').names[0]).toBe('paint.tga');
    expect(textureCandidates('textures\\wheel.png').relative).toBe('textures/wheel.png');
  });
});

describe('resolveTextureRefs', () => {
  it('prefers the path as given, relative to the model', async () => {
    const direct = await put('model/textures/wheel.png');
    await put('model/other/wheel.png');
    const { resolved } = await resolveTextureRefs(['textures/wheel.png'], join(dir, 'model'), []);
    expect(resolved['textures/wheel.png']).toBe(direct);
  });

  it('falls back to .dds with the same stem, case-insensitively (png → DDS)', async () => {
    const dds = await put('model/engines/boxer_b.color.DDS');
    const { resolved } = await resolveTextureRefs(['boxer_b.color.png'], join(dir, 'model'), []);
    expect(resolved['boxer_b.color.png']).toBe(dds);
  });

  it('finds foreign absolute refs in located folders, and reports misses as null', async () => {
    const grille = await put('located/common/grille_d.dds');
    const { resolved } = await resolveTextureRefs(
      ['/C:/Work%20space/BeamNG%20Game/vehicles/common/grille_d.dds', 'nowhere.png'],
      join(dir, 'model'),
      [join(dir, 'located')],
    );
    expect(resolved['/C:/Work%20space/BeamNG%20Game/vehicles/common/grille_d.dds']).toBe(grille);
    expect(resolved['nowhere.png']).toBeNull();
  });

  it('searches roots in order (model folder first)', async () => {
    const mine = await put('model/paint.png');
    await put('located/paint.png');
    const { resolved } = await resolveTextureRefs(['/abs/paint.png'], join(dir, 'model'), [join(dir, 'located')]);
    expect(resolved['/abs/paint.png']).toBe(mine);
  });
});

describe('TextureIndex limits', () => {
  it('stops at maxFiles and says so', async () => {
    for (let i = 0; i < 10; i++) await put(`big/t${i}.png`);
    const idx = await TextureIndex.build([join(dir, 'big')], { maxFiles: 5 });
    expect(idx.truncated).toBe(true);
  });

  it('gives each root its own budget, so a huge model folder cannot starve located folders', async () => {
    for (let i = 0; i < 10; i++) await put(`huge/t${i}.png`);
    const wanted = await put('located/body.dds');
    const idx = await TextureIndex.build([join(dir, 'huge'), join(dir, 'located')], { maxFiles: 5 });
    expect(idx.truncated).toBe(true);
    expect(idx.lookup(['body.dds'])).toBe(wanted);
  });

  it('respects maxDepth', async () => {
    await put('deep/a/b/c/d/far.png');
    const shallow = await TextureIndex.build([join(dir, 'deep')], { maxDepth: 2 });
    expect(shallow.lookup(['far.png'])).toBeNull();
    const deep = await TextureIndex.build([join(dir, 'deep')], { maxDepth: 5 });
    expect(deep.lookup(['far.png'])).not.toBeNull();
  });
});
