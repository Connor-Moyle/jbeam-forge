import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@shared/logger';
import type { AppRelease, ReleaseAsset } from '@shared/content/types';
import { compareVersions, parseVersion } from '@shared/content/versions';

export { compareVersions, parseVersion };
import { apiUrl, assertRepo, downloadFile, endpoints, getJson, GithubError, type Endpoints, type FetchFn } from './github';

/**
 * App versions from GitHub Releases: the newest, and every earlier one to
 * roll back to. A chosen version's installer (or portable exe) is
 * downloaded, checked against the size GitHub lists, and then run or shown.
 */

/**
 * What a release file is for this computer: Windows gets the installer and portable exe, Linux the
 * .deb (its installer) and the AppImage (its portable). The other system's files are 'other', so
 * only the right ones are offered.
 */
/** This app's own release files (nothing else is downloaded or run): Windows exes, the Linux AppImage and .deb, zips. */
export function isAppFile(name: string): boolean {
  return /^JBeam-Forge-[A-Za-z0-9._-]+\.(exe|zip|AppImage)$/.test(name) || /^jbeam-forge_[A-Za-z0-9._-]+_amd64\.deb$/.test(name);
}

export function assetRole(name: string, platform: NodeJS.Platform = process.platform): ReleaseAsset['role'] {
  const linux = platform === 'linux';
  if (/setup.*\.exe$/i.test(name)) return linux ? 'other' : 'installer';
  if (/portable.*\.exe$/i.test(name)) return linux ? 'other' : 'portable';
  if (/\.deb$/i.test(name)) return linux ? 'installer' : 'other';
  if (/\.AppImage$/i.test(name)) return linux ? 'portable' : 'other';
  if (/materials.*\.zip$/i.test(name)) return 'textures';
  if (/objects.*\.zip$/i.test(name)) return 'meshes';
  return 'other';
}

/** GitHub's releases list → our releases, newest first (drafts dropped; pre-releases only when asked). */
export function toReleases(raw: unknown, includePrereleases: boolean, platform: NodeJS.Platform = process.platform): AppRelease[] {
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
        ? [{ name: a.name, size: a.size, url: a.browser_download_url, sha256: typeof a.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(a.digest) ? a.digest.slice(7) : null, role: assetRole(a.name, platform) }]
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
    if (!isAppFile(assetName)) throw new GithubError(`Not a JBeam Forge download: ${assetName}`, 'BAD_INPUT');
    // Taken before the first await, so a second call can't slip past the check.
    const ctrl = new AbortController();
    this.job = ctrl;
    try {
      const release = (await this.releases(repo, true)).find((r) => r.tag === tag);
      const asset = release?.assets.find((a) => a.name === assetName);
      if (!release || !asset) throw new GithubError(`${assetName} isn't part of ${tag}`, 'NOT_FOUND');
      await mkdir(this.downloads, { recursive: true });
      const dest = join(this.downloads, asset.name);
      // Already downloaded (and intact): no second download.
      if (await intact(dest, asset.size, asset.sha256)) return dest;
      let done = 0;
      let last = 0;
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
      if (this.job === ctrl) this.job = null;
    }
  }

  /**
   * Before running (or showing) a download: it must still be exactly the file
   * the release lists (size and GitHub's SHA-256), so a file swapped or damaged
   * in the downloads folder afterwards never runs.
   */
  async verifyDownloaded(repo: string, assetName: string): Promise<string> {
    if (!isAppFile(assetName)) throw new GithubError(`Not a JBeam Forge download: ${assetName}`, 'BAD_INPUT');
    const version = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(assetName)?.[1];
    if (!version) throw new GithubError(`No version in ${assetName}`, 'BAD_INPUT');
    const release = (await this.releases(repo, true)).find((r) => r.version === version);
    const asset = release?.assets.find((a) => a.name === assetName);
    if (!asset) throw new GithubError(`${assetName} isn't part of a release any more`, 'NOT_FOUND');
    const path = join(this.downloads, assetName);
    if (!(await intact(path, asset.size, asset.sha256))) {
      await rm(path, { force: true });
      throw new GithubError(`${assetName} doesn't match the release (it may have been damaged or changed): download it again`, 'MISMATCH');
    }
    return path;
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
