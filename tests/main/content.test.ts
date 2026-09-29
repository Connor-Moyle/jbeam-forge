import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildContentRepo } from '../../src/main/content/buildRepo';
import { ContentService } from '../../src/main/content/service';
import { loadBundledPack } from '../../src/main/services/materialLibrary';
import { planDownload, emptyInstalled, type ContentManifest } from '../../src/shared/content/manifest';
import type { FetchFn } from '../../src/main/content/github';

const quiet = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } as never;
const ENV = { JBFORGE_GITHUB_RAW: 'http://fake.test/raw', JBFORGE_GITHUB_API: 'http://fake.test/api' } as NodeJS.ProcessEnv;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-content-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function pack(root: string, name: string, texture: string) {
  const d = join(root, 'Paint', name);
  await mkdir(join(d, 'textures'), { recursive: true });
  await writeFile(join(d, 'material.json'), JSON.stringify({ name, category: 'Paint', def: { name, layers: [{}] } }));
  await writeFile(join(d, 'textures', 'color.png'), texture);
}

/** A fake GitHub serving the built repo at "main" (and anything in `extra`). */
function fakeGithub(repoDir: string, opts: { tamper?: string; tags?: string[] } = {}): { fetch: FetchFn; hits: string[] } {
  const hits: string[] = [];
  const fetch: FetchFn = async (url) => {
    hits.push(url);
    const u = new URL(url);
    if (u.pathname.startsWith('/api/repos/me/textures/tags')) return new Response(JSON.stringify((opts.tags ?? []).map((name) => ({ name }))), { status: 200 });
    const m = /^\/raw\/me\/textures\/main\/(.+)$/.exec(u.pathname);
    if (!m) return new Response('nope', { status: 404, statusText: 'Not Found' });
    const path = decodeURIComponent(m[1]!);
    if (!existsSync(join(repoDir, path))) return new Response('nope', { status: 404, statusText: 'Not Found' });
    let body = await readFile(join(repoDir, path));
    if (opts.tamper && path.includes(opts.tamper)) body = Buffer.concat([body.subarray(0, body.length - 1), Buffer.from('x')]);
    return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
  };
  return { fetch, hits };
}

describe('content repositories', () => {
  it('builds, downloads all, reloads as a pack with the bundled ids, and skips what is current', async () => {
    const src = join(dir, 'src');
    await pack(src, 'Candy Red', 'red');
    await pack(src, 'Matte Black', 'black');
    const repo = join(dir, 'repo');
    const { manifest } = await buildContentRepo(src, repo, 'textures', '1.0.0');
    expect(manifest.items).toHaveLength(2);

    const gh = fakeGithub(repo);
    const events: string[] = [];
    const svc = new ContentService(join(dir, 'content'), gh.fetch, quiet, { onChange: (k) => events.push(k) }, ENV);
    const r = await svc.download('textures', 'me/textures', 'main', 'all', 2);
    expect(r.installed.sort()).toEqual(manifest.items.map((i) => i.id).sort());
    expect(r.failed).toEqual([]);
    expect(events).toEqual(['textures']);
    const installed = await svc.installed('textures');
    expect(installed.version).toBe('1.0.0');
    expect(Object.keys(installed.items)).toHaveLength(2);
    expect(await readFile(join(dir, 'content', 'textures', 'Paint', 'Candy Red', 'textures', 'color.png'), 'utf8')).toBe('red');
    // Same ids as the pack folder the items were built from.
    const fromContent = await loadBundledPack(join(dir, 'content', 'textures'), quiet);
    const fromSource = await loadBundledPack(src, quiet);
    expect(fromContent.map((i) => i.id).sort()).toEqual(fromSource.map((i) => i.id).sort());
    // Nothing left behind in the temp folder.
    expect(existsSync(join(dir, 'content', '.tmp', 'textures'))).toBe(false);

    const again = await svc.download('textures', 'me/textures', 'main', 'all');
    expect(again.installed).toEqual([]);
    expect(again.skipped).toHaveLength(2);
  });

  it('downloads single items, updates changed ones, and removes', async () => {
    const src = join(dir, 'src');
    await pack(src, 'Candy Red', 'red');
    await pack(src, 'Matte Black', 'black');
    const repo = join(dir, 'repo');
    const { manifest } = await buildContentRepo(src, repo, 'textures', '1.0.0');
    const red = manifest.items.find((i) => i.name === 'Candy Red')!;
    const svc = new ContentService(join(dir, 'content'), fakeGithub(repo).fetch, quiet, {}, ENV);
    expect((await svc.download('textures', 'me/textures', 'main', [red.id])).installed).toEqual([red.id]);
    expect(existsSync(join(dir, 'content', 'textures', 'Paint', 'Matte Black'))).toBe(false);

    // A new version of the repository changes the red.
    await writeFile(join(src, 'Paint', 'Candy Red', 'textures', 'color.png'), 'redder');
    const { manifest: m2 } = await buildContentRepo(src, repo, 'textures', '1.1.0');
    expect(await svc.changes('textures', m2)).toEqual({ updated: [red.id], removed: [] });
    await svc.download('textures', 'me/textures', 'main', [red.id]);
    expect(await readFile(join(dir, 'content', 'textures', 'Paint', 'Candy Red', 'textures', 'color.png'), 'utf8')).toBe('redder');

    expect(await svc.remove('textures', 'all')).toEqual([red.id]);
    expect(existsSync(join(dir, 'content', 'textures', 'Paint'))).toBe(false);
    expect((await svc.installed('textures')).items).toEqual({});
  });

  it('refuses a download that does not match its hash, and keeps what was installed', async () => {
    const src = join(dir, 'src');
    await pack(src, 'Candy Red', 'red');
    const repo = join(dir, 'repo');
    const { manifest } = await buildContentRepo(src, repo, 'textures', '1.0.0');
    const svc = new ContentService(join(dir, 'content'), fakeGithub(repo, { tamper: 'items/' }).fetch, quiet, {}, ENV);
    const r = await svc.download('textures', 'me/textures', 'main', 'all');
    expect(r.installed).toEqual([]);
    expect(r.failed[0]?.error).toMatch(/didn't match/);
    expect(existsSync(join(dir, 'content', 'textures', 'Paint'))).toBe(false);
    expect(manifest.items).toHaveLength(1);
  });

  it('refuses zips that escape their folder and manifests with unsafe folders', async () => {
    const repo = join(dir, 'repo');
    await mkdir(join(repo, 'items'), { recursive: true });
    const { ZipFile } = await import('yazl');
    const z = new ZipFile();
    z.addBuffer(Buffer.from('{}'), 'material.json');
    z.addBuffer(Buffer.from('evil'), 'xx/xx/evil.txt');
    z.end();
    const chunks: Buffer[] = [];
    for await (const c of z.outputStream) chunks.push(c as Buffer);
    // yazl won't write "../"; swap it into the names afterwards (same length; names aren't checksummed).
    const zip = Buffer.from(Buffer.concat(chunks).toString('latin1').split('xx/xx/evil.txt').join('../../evil.txt'), 'latin1');
    await writeFile(join(repo, 'items', 'evil.zip'), zip);
    const item = { id: 'evil', name: 'Evil', category: 'X', dir: 'X/Evil', path: 'items/evil.zip', size: zip.length, sha256: createHash('sha256').update(zip).digest('hex'), files: 2, unpacked: 6 };
    const m: ContentManifest = { format: 1, kind: 'textures', version: '1', generated: '', items: [item] };
    await writeFile(join(repo, 'manifest.json'), JSON.stringify(m));
    const svc = new ContentService(join(dir, 'content'), fakeGithub(repo).fetch, quiet, {}, ENV);
    const r = await svc.download('textures', 'me/textures', 'main', 'all');
    expect(r.failed[0]?.error).toMatch(/damaged or unsafe/);
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false);

    await writeFile(join(repo, 'manifest.json'), JSON.stringify({ ...m, items: [{ ...item, dir: '../Evil' }] }));
    await expect(svc.manifest('textures', 'me/textures', 'main')).rejects.toThrow(/valid JBeam Forge manifest/);
    await writeFile(join(repo, 'manifest.json'), JSON.stringify({ ...m, kind: 'meshes' }));
    await expect(svc.manifest('textures', 'me/textures', 'main')).rejects.toThrow(/holds meshes/);
  });

  it('lists versions, and cancels', async () => {
    const src = join(dir, 'src');
    for (let i = 0; i < 6; i++) await pack(src, `Paint ${i}`, `p${i}`);
    const repo = join(dir, 'repo');
    await buildContentRepo(src, repo, 'textures', '1.0.0');
    const gh = fakeGithub(repo, { tags: ['v1.0.0', 'v0.9.0'] });
    // Cancel as the second item starts downloading.
    const fetch: FetchFn = (url, init) => {
      if (gh.hits.filter((h) => h.includes('/items/')).length === 1 && url.includes('/items/')) svc.cancel('textures');
      return gh.fetch(url, init);
    };
    const svc = new ContentService(join(dir, 'content'), fetch, quiet, {}, ENV);
    expect(await svc.refs('me/textures')).toEqual([
      { name: 'main', type: 'branch' },
      { name: 'v1.0.0', type: 'tag' },
      { name: 'v0.9.0', type: 'tag' },
    ]);
    const r = await svc.download('textures', 'me/textures', 'main', 'all', 1);
    expect(r.cancelled).toBe(true);
    expect(r.installed.length).toBeLessThan(6);
    expect((await readdir(join(dir, 'content'))).includes('.tmp') ? await readdir(join(dir, 'content', '.tmp')) : []).toEqual([]);
  });

  it('plans only what is missing or changed', () => {
    const item = (id: string, sha: string) => ({ id, name: id, category: 'c', dir: `c/${id}`, path: `items/${id}.zip`, size: 10, sha256: sha.repeat(64), files: 1, unpacked: 1 });
    const m: ContentManifest = { format: 1, kind: 'meshes', version: '2', generated: '', items: [item('a', 'a'), item('b', 'b')] };
    const inst = { ...emptyInstalled('meshes'), items: { a: { sha256: 'a'.repeat(64), dir: 'c/a', size: 10, installedAt: '' } } };
    const p = planDownload(m, inst, 'all');
    expect(p.fetch.map((i) => i.id)).toEqual(['b']);
    expect(p.bytes).toBe(10);
  });
});
