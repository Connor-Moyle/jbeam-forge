import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { isSafeRef, REPO_PATTERN } from '@shared/content/manifest';

/**
 * Talking to GitHub: the REST API (releases, tags) and raw file downloads.
 * The endpoints can be pointed elsewhere (JBFORGE_GITHUB_API / _RAW) so the
 * test harness can serve a fake repository locally. Downloads stream to disk
 * with a size limit and a SHA-256, and only land under their final name once
 * complete.
 */

export type FetchFn = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

export interface Endpoints {
  api: string;
  raw: string;
}

export function endpoints(env: NodeJS.ProcessEnv = process.env): Endpoints {
  return { api: (env.JBFORGE_GITHUB_API ?? 'https://api.github.com').replace(/\/+$/, ''), raw: (env.JBFORGE_GITHUB_RAW ?? 'https://raw.githubusercontent.com').replace(/\/+$/, '') };
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'RATE_LIMIT' | 'HTTP' | 'NETWORK' | 'TOO_LARGE' | 'MISMATCH' | 'CANCELLED' | 'BAD_INPUT' | 'BAD_HOST',
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

export function assertRepo(repo: string): void {
  if (!REPO_PATTERN.test(repo)) throw new GithubError(`Not a GitHub repository name: "${repo}" (expected owner/name)`, 'BAD_INPUT');
}

export function assertRef(ref: string): void {
  if (!isSafeRef(ref)) throw new GithubError(`Not a branch or tag name: "${ref}"`, 'BAD_INPUT');
}

/** A file in a repository at a branch or tag. */
export function rawUrl(e: Endpoints, repo: string, ref: string, path: string): string {
  assertRepo(repo);
  assertRef(ref);
  return `${e.raw}/${repo}/${ref.split('/').map(encodeURIComponent).join('/')}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function apiUrl(e: Endpoints, repo: string, path: string): string {
  assertRepo(repo);
  return `${e.api}/repos/${repo}/${path}`;
}

/** Hosts a download may come from (after redirects): GitHub's, or the configured test endpoints. */
export function allowedHost(url: string, e: Endpoints): boolean {
  let host: string;
  let protocol: string;
  try {
    ({ host, protocol } = new URL(url));
  } catch {
    return false;
  }
  const own = [e.api, e.raw].map((u) => new URL(u).host);
  if (own.includes(host)) return true;
  return protocol === 'https:' && (host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com'));
}

const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'JBeam-Forge' };

function cancelled(signal?: AbortSignal): boolean {
  return !!signal?.aborted;
}

async function open(fetchFn: FetchFn, url: string, e: Endpoints, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...(signal ? { signal } : {}), headers: HEADERS });
  } catch (err) {
    if (cancelled(signal)) throw new GithubError('Cancelled', 'CANCELLED');
    throw new GithubError(`Couldn't reach GitHub: ${err instanceof Error ? err.message : String(err)}. Check your internet connection.`, 'NETWORK');
  }
  if (res.url && !allowedHost(res.url, e)) throw new GithubError(`Refusing a download redirected to ${new URL(res.url).host}`, 'BAD_HOST');
  if (res.ok) return res;
  if (res.status === 404) throw new GithubError(`Not found on GitHub: ${url.replace(/^https?:\/\/[^/]+/, '')}`, 'NOT_FOUND');
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const mins = Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
    throw new GithubError(`GitHub's limit for anonymous requests was reached${mins ? `; try again in ${mins} minute${mins === 1 ? '' : 's'}` : '; try again later'}.`, 'RATE_LIMIT');
  }
  throw new GithubError(`GitHub answered ${res.status} ${res.statusText} for ${url.replace(/^https?:\/\/[^/]+/, '')}`, 'HTTP');
}

/** Read a whole response as text, refusing more than `maxBytes`. */
async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new GithubError(`Response too large (${declared} bytes)`, 'TOO_LARGE');
  if (!res.body) return '';
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>)) {
    n += (chunk as Buffer).length;
    if (n > maxBytes) throw new GithubError(`Response too large (over ${maxBytes} bytes)`, 'TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function getJson(fetchFn: FetchFn, url: string, e: Endpoints, opts: { maxBytes?: number; signal?: AbortSignal } = {}): Promise<unknown> {
  const res = await open(fetchFn, url, e, opts.signal);
  const text = await readLimited(res, opts.maxBytes ?? 16 * 1024 * 1024);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GithubError(`Not valid JSON: ${url.replace(/^https?:\/\/[^/]+/, '')}`, 'HTTP');
  }
}

/**
 * Stream `url` to `dest`, via `dest.part`: refused past `maxBytes`, checked
 * against `expected` size and SHA-256 when given. Returns the bytes and hash.
 */
export async function downloadFile(
  fetchFn: FetchFn,
  url: string,
  dest: string,
  e: Endpoints,
  opts: { maxBytes: number; expectedSize?: number; expectedSha256?: string; signal?: AbortSignal; onBytes?: (n: number) => void },
): Promise<{ bytes: number; sha256: string }> {
  const res = await open(fetchFn, url, e, opts.signal);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > opts.maxBytes) throw new GithubError(`Download too large (${declared} bytes)`, 'TOO_LARGE');
  if (!res.body) throw new GithubError('Empty download', 'HTTP');
  const hash = createHash('sha256');
  let bytes = 0;
  const count = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > opts.maxBytes) return cb(new GithubError(`Download too large (over ${opts.maxBytes} bytes)`, 'TOO_LARGE'));
      hash.update(chunk);
      opts.onBytes?.(chunk.length);
      cb(null, chunk);
    },
  });
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), count, createWriteStream(part), ...(opts.signal ? [{ signal: opts.signal }] : []));
  } catch (err) {
    await rm(part, { force: true });
    if (cancelled(opts.signal)) throw new GithubError('Cancelled', 'CANCELLED');
    if (err instanceof GithubError) throw err;
    throw new GithubError(`Download interrupted: ${err instanceof Error ? err.message : String(err)}`, 'NETWORK');
  }
  const sha256 = hash.digest('hex');
  if ((opts.expectedSize !== undefined && bytes !== opts.expectedSize) || (opts.expectedSha256 && sha256 !== opts.expectedSha256)) {
    await rm(part, { force: true });
    throw new GithubError(`Download didn't match what the repository lists (${bytes} bytes${opts.expectedSize !== undefined ? ` of ${opts.expectedSize}` : ''}); it may have changed while downloading. Try again.`, 'MISMATCH');
  }
  await rename(part, dest);
  return { bytes, sha256 };
}
