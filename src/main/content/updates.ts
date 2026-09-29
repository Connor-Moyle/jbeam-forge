import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@shared/logger';
import type { AppRelease, ReleaseAsset } from '@shared/content/types';
import { apiUrl, assertRepo, downloadFile, endpoints, getJson, GithubError, type Endpoints, type FetchFn } from './github';

/**
 * App versions from GitHub Releases: the newest, and every earlier one to
 * roll back to. A chosen version's installer (or portable exe) is
 * downloaded, checked against the size GitHub lists, and then run or shown.
 */

/** Numeric parts of a version ("v0.12.0-beta.2" → [0,12,0] + pre "beta.2"). */
export function parseVersion(v: string): { nums: number[]; pre: string } | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)], pre: m[4] ?? '' };
}

/** Semver order: <0 when a is older than b. Unparseable versions sort oldest. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i]! - y.nums[i]!;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // a release is newer than its pre-releases
  if (!y.pre) return -1;
  const pa = x.pre.split('.');
  const pb = y.pre.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const s = pa[i];
    const t = pb[i];
    if (s === undefined) return -1;
    if (t === undefined) return 1;
    const ns = /^\d+$/.test(s) ? Number(s) : NaN;
    const nt = /^\d+$/.test(t) ? Number(t) : NaN;
    if (!Number.isNaN(ns) && !Number.isNaN(nt) && ns !== nt) return ns - nt;
    if (s !== t) return s < t ? -1 : 1;
  }
  return 0;
}

export function assetRole(name: string): ReleaseAsset['role'] {
  if (/setup.*\.exe$/i.test(name)) return 'installer';
  if (/portable.*\.exe$/i.test(name)) return 'portable';
  if (/materials.*\.zip$/i.test(name)) return 'textures';
  if (/objects.*\.zip$/i.test(name)) return 'meshes';
  return 'other';
}

/** GitHub's releases list → our releases, newest first (drafts dropped; pre-releases only when asked). */
export function toReleases(raw: unknown, includePrereleases: boolean): AppRelease[] {
  if (!Array.isArray(raw)) throw new GithubError('GitHub sent an unexpected releases list', 'HTTP');
  const out: AppRelease[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || r.draft === true) continue;
    const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
    if (!parseVersion(tag)) continue;
    const prerelease = r.prerelease === true || !!parseVersion(tag)?.pre;
    if (prerelease && !includePrereleases) continue;
    const assets = (Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]) : []).flatMap((a) =>
      a && typeof a.name === 'string' && typeof a.browser_download_url === 'string' && typeof a.size === 'number'
        ? [{ name: a.name, size: a.size, url: a.browser_download_url, sha256: typeof a.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(a.digest) ? a.digest.slice(7) : null, role: assetRole(a.name) }]
        : [],
    );
    out.push({
      tag,
      version: tag.replace(/^v/, ''),
      name: typeof r.name === 'string' && r.name ? r.name : tag,
      notes: typeof r.body === 'string' ? r.body.slice(0, 50_000) : '',
      publishedAt: typeof r.published_at === 'string' ? r.published_at : '',
      prerelease,
      assets,
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

export class UpdateService {
  private readonly e: Endpoints;
  private job: AbortController | null = null;

  constructor(
    readonly downloads: string,
    private readonly fetchFn: FetchFn,
    private readonly logger: Logger,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.e = endpoints(env);
  }

  async releases(repo: string, includePrereleases: boolean): Promise<AppRelease[]> {
    assertRepo(repo);
    const raw = await getJson(this.fetchFn, apiUrl(this.e, repo, 'releases?per_page=50'), this.e, { maxBytes: 8 * 1024 * 1024 });
    return toReleases(raw, includePrereleases);
  }

  cancel(): void {
    this.job?.abort();
  }

  /**
   * Download one asset of a release into the downloads folder (kept there,
   * so rolling back again later needs no second download). Only this app's
   * own files are accepted.
   */
  async download(repo: string, tag: string, assetName: string, onProgress: (done: number, total: number) => void): Promise<string> {
    if (this.job) throw new GithubError('A download is already running', 'BAD_INPUT');
    if (!/^JBeam-Forge-[A-Za-z0-9._-]+\.(exe|zip)$/.test(assetName)) throw new GithubError(`Not a JBeam Forge download: ${assetName}`, 'BAD_INPUT');
    const release = (await this.releases(repo, true)).find((r) => r.tag === tag);
    const asset = release?.assets.find((a) => a.name === assetName);
    if (!release || !asset) throw new GithubError(`${assetName} isn't part of ${tag}`, 'NOT_FOUND');
    await mkdir(this.downloads, { recursive: true });
    const dest = join(this.downloads, asset.name);
    // Already downloaded (and intact): no second download.
    if (await intact(dest, asset.size, asset.sha256)) return dest;
    const ctrl = new AbortController();
    this.job = ctrl;
    let done = 0;
    let last = 0;
    try {
      await downloadFile(this.fetchFn, asset.url, dest, this.e, {
        maxBytes: asset.size,
        expectedSize: asset.size,
        ...(asset.sha256 ? { expectedSha256: asset.sha256 } : {}),
        signal: ctrl.signal,
        onBytes: (n) => {
          done += n;
          const now = Date.now();
          if (now - last > 100 || done === asset.size) {
            last = now;
            onProgress(done, asset.size);
          }
        },
      });
      this.logger.info(`downloaded ${asset.name} (${asset.size} bytes)`);
      return dest;
    } finally {
      this.job = null;
    }
  }

  /** What's already downloaded (name and size). */
  async downloaded(): Promise<{ name: string; size: number }[]> {
    try {
      const names = (await readdir(this.downloads)).filter((n) => !n.endsWith('.part'));
      return await Promise.all(names.map(async (name) => ({ name, size: (await stat(join(this.downloads, name))).size })));
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    await rm(this.downloads, { recursive: true, force: true });
  }
}

async function intact(path: string, size: number, sha256: string | null): Promise<boolean> {
  try {
    if ((await stat(path)).size !== size) return false;
  } catch {
    return false;
  }
  if (!sha256) return true;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex') === sha256;
}
