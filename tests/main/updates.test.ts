import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assetRole, compareVersions, toReleases, UpdateService } from '../../src/main/content/updates';
import { preferredContentRoot, resolveContentRoot } from '../../src/main/content/paths';
import { allowedHost, endpoints, rawUrl, type FetchFn } from '../../src/main/content/github';

const quiet = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } as never;
const ENV = { JBFORGE_GITHUB_API: 'http://fake.test/api', JBFORGE_GITHUB_RAW: 'http://fake.test/raw' } as NodeJS.ProcessEnv;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-updates-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('versions', () => {
  it('orders versions like semver, releases after their pre-releases', () => {
    const sorted = ['0.9.0', 'v0.12.0', '0.12.0-beta.2', '0.12.0-beta.10', '0.11.1', '1.0'].sort(compareVersions);
    expect(sorted).toEqual(['0.9.0', '0.11.1', '0.12.0-beta.2', '0.12.0-beta.10', 'v0.12.0', '1.0']);
    expect(compareVersions('0.12.0', '0.12.0')).toBe(0);
  });

  it('reads GitHub releases: drafts and (unless asked) pre-releases dropped, newest first, digests kept', () => {
    const raw = [
      { tag_name: 'v0.11.0', name: 'Old', body: 'notes', published_at: '2026-09-01', assets: [{ name: 'JBeam-Forge-Setup-0.11.0.exe', size: 5, browser_download_url: 'https://github.com/a', digest: `sha256:${'a'.repeat(64)}` }] },
      { tag_name: 'v0.12.0', assets: [{ name: 'JBeam-Forge-0.12.0-portable.exe', size: 5, browser_download_url: 'https://github.com/b' }] },
      { tag_name: 'v0.13.0-beta.1', prerelease: true, assets: [] },
      { tag_name: 'v9.9.9', draft: true, assets: [] },
      { tag_name: 'not-a-version', assets: [] },
    ];
    const r = toReleases(raw, false);
    expect(r.map((x) => x.tag)).toEqual(['v0.12.0', 'v0.11.0']);
    expect(r[1]!.assets[0]).toMatchObject({ role: 'installer', sha256: 'a'.repeat(64) });
    expect(r[0]!.assets[0]).toMatchObject({ role: 'portable', sha256: null });
    expect(toReleases(raw, true)[0]!.tag).toBe('v0.13.0-beta.1');
    expect(assetRole('JBeam-Forge-Materials-0.12.0.zip')).toBe('textures');
  });
});

describe('downloading a version', () => {
  const body = Buffer.from('installer bytes');
  const sha = createHash('sha256').update(body).digest('hex');
  const fetchFor = (digest: string | null, served = body): { fetch: FetchFn; calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      fetch: (url) => {
        calls.push(url);
        if (url.includes('/releases')) return Promise.resolve(new Response(JSON.stringify([{ tag_name: 'v0.12.0', assets: [{ name: 'JBeam-Forge-Setup-0.12.0.exe', size: body.length, browser_download_url: 'http://fake.test/dl/setup.exe', ...(digest ? { digest: `sha256:${digest}` } : {}) }] }]), { status: 200 }));
        return Promise.resolve(new Response(served, { status: 200 }));
      },
    };
  };

  it('downloads, checks the digest, and reuses an intact download', async () => {
    const f = fetchFor(sha);
    const svc = new UpdateService(join(dir, 'updates'), f.fetch, quiet, ENV);
    const progress: number[] = [];
    const path = await svc.download('me/app', 'v0.12.0', 'JBeam-Forge-Setup-0.12.0.exe', (d) => progress.push(d));
    expect(await readFile(path, 'utf8')).toBe('installer bytes');
    expect(progress.at(-1)).toBe(body.length);
    await svc.download('me/app', 'v0.12.0', 'JBeam-Forge-Setup-0.12.0.exe', () => undefined);
    expect(f.calls.filter((c) => c.includes('/dl/'))).toHaveLength(1);
    expect(await svc.downloaded()).toEqual([{ name: 'JBeam-Forge-Setup-0.12.0.exe', size: body.length }]);
  });

  it('refuses a download whose digest or size is wrong, and names that are not ours', async () => {
    const bad = new UpdateService(join(dir, 'u1'), fetchFor('b'.repeat(64)).fetch, quiet, ENV);
    await expect(bad.download('me/app', 'v0.12.0', 'JBeam-Forge-Setup-0.12.0.exe', () => undefined)).rejects.toThrow(/didn't match/);
    const short = new UpdateService(join(dir, 'u2'), fetchFor(null, Buffer.from('short')).fetch, quiet, ENV);
    await expect(short.download('me/app', 'v0.12.0', 'JBeam-Forge-Setup-0.12.0.exe', () => undefined)).rejects.toThrow(/didn't match/);
    await expect(short.download('me/app', 'v0.12.0', '../evil.exe', () => undefined)).rejects.toThrow(/Not a JBeam Forge download/);
    await expect(short.download('me/app', 'v0.1.0', 'JBeam-Forge-Setup-0.1.0.exe', () => undefined)).rejects.toThrow(/isn't part of/);
  });
});

describe('running a download', () => {
  const body = Buffer.from('installer bytes');
  const sha = createHash('sha256').update(body).digest('hex');
  const fetchFn: FetchFn = (url) =>
    Promise.resolve(url.includes('/releases') ? new Response(JSON.stringify([{ tag_name: 'v0.12.0', assets: [{ name: 'JBeam-Forge-Setup-0.12.0.exe', size: body.length, browser_download_url: 'http://fake.test/dl/setup.exe', digest: `sha256:${sha}` }] }]), { status: 200 }) : new Response(body, { status: 200 }));

  it('only runs a file that still matches the release; a changed one is removed', async () => {
    const svc = new UpdateService(join(dir, 'updates'), fetchFn, quiet, ENV);
    const path = await svc.download('me/app', 'v0.12.0', 'JBeam-Forge-Setup-0.12.0.exe', () => undefined);
    expect(await svc.verifyDownloaded('me/app', 'JBeam-Forge-Setup-0.12.0.exe')).toBe(path);
    await writeFile(path, 'tampered bytes!');
    await expect(svc.verifyDownloaded('me/app', 'JBeam-Forge-Setup-0.12.0.exe')).rejects.toThrow(/doesn't match the release/);
    expect(await svc.downloaded()).toEqual([]);
    await expect(svc.verifyDownloaded('me/app', '..\\evil.exe')).rejects.toThrow(/Not a JBeam Forge download/);
    await expect(svc.verifyDownloaded('me/app', 'JBeam-Forge-Setup-0.9.0.exe')).rejects.toThrow(/isn't part of a release/);
  });
});

describe('GitHub addresses', () => {
  it('builds raw URLs, refuses bad names, and only trusts GitHub hosts', () => {
    const e = endpoints({});
    expect(rawUrl(e, 'Connor-Moyle/jbeam-forge-textures', 'v1.0.0', 'items/a b.zip')).toBe('https://raw.githubusercontent.com/Connor-Moyle/jbeam-forge-textures/v1.0.0/items/a%20b.zip');
    expect(() => rawUrl(e, 'not a repo', 'main', 'x')).toThrow(/owner\/name/);
    expect(() => rawUrl(e, 'a/b', '../main', 'x')).toThrow(/branch or tag/);
    expect(allowedHost('https://objects.githubusercontent.com/x', e)).toBe(true);
    expect(allowedHost('https://github.com/x', e)).toBe(true);
    expect(allowedHost('https://evil.example/x', e)).toBe(false);
    expect(allowedHost('http://github.com/x', e)).toBe(false);
  });
});

describe('content folder', () => {
  const base = { override: null, isPackaged: true, portableDir: undefined, execPath: 'C:/Users/me/AppData/Local/Programs/JBeam Forge/JBeam Forge.exe', appPath: '/app', userData: '/ud' };
  it('sits beside the program: next to a portable exe, beside the install folder, or in the repo', () => {
    expect(preferredContentRoot(base).replace(/\\/g, '/')).toBe('C:/Users/me/AppData/Local/Programs/JBeam Forge Content');
    expect(preferredContentRoot({ ...base, portableDir: 'D:/Tools' }).replace(/\\/g, '/')).toBe('D:/Tools/JBeam Forge Content');
    expect(preferredContentRoot({ ...base, isPackaged: false }).replace(/\\/g, '/')).toBe('/app/content');
    expect(preferredContentRoot({ ...base, override: 'E:/Mine' })).toBe('E:/Mine');
  });

  it('falls back to app data when the place is not writable', async () => {
    // Under a file: can't be created.
    const file = join(dir, 'a-file');
    await writeFile(file, 'x');
    const r = await resolveContentRoot({ ...base, override: join(file, 'x'), userData: dir });
    expect(r).toEqual({ root: join(dir, 'content'), fallback: true, preferred: join(file, 'x') });
    const ok = await resolveContentRoot({ ...base, override: join(dir, 'mine'), userData: dir });
    expect(ok.fallback).toBe(false);
  });
});
