import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Logger } from '@shared/logger';
import {
  ContentManifestSchema,
  contentChanges,
  emptyInstalled,
  InstalledContentSchema,
  manifestProblems,
  planDownload,
  type ContentItem,
  type ContentKind,
  type ContentManifest,
  type InstalledContent,
} from '@shared/content/manifest';
import type { ContentProgress, ContentRef, ContentStatus, DownloadResult } from '@shared/content/types';
import { safeJoin, withZip } from '../beamng/zip';
import { apiUrl, assertRef, assertRepo, downloadFile, endpoints, getJson, GithubError, rawUrl, type Endpoints, type FetchFn } from './github';

/**
 * The textures and meshes downloaded from their content repositories:
 * fetching a manifest, downloading all or some items (in parallel, each
 * checked against its size and SHA-256), unpacking each into place without
 * ever leaving a half-written folder, removing items, and what's installed.
 */

const MARKER: Record<ContentKind, string> = { textures: 'material.json', meshes: 'object.json', scripts: 'script.jbscript' };
const KIND_LABEL: Record<ContentKind, string> = { textures: 'Textures are', meshes: 'Meshes are', scripts: 'Scripts are' };
const UNPACK_LIMIT = 2 * 1024 * 1024 * 1024;

export class ContentService {
  private readonly jobs = new Map<ContentKind, AbortController>();
  private readonly writes = new Map<ContentKind, Promise<void>>();
  private readonly e: Endpoints;

  constructor(
    readonly root: string,
    private readonly fetchFn: FetchFn,
    private readonly logger: Logger,
    private readonly hooks: { onChange?: (kind: ContentKind) => void; onProgress?: (p: ContentProgress) => void } = {},
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.e = endpoints(env);
  }

  dir(kind: ContentKind): string {
    return join(this.root, kind);
  }

  private installedPath(kind: ContentKind): string {
    return join(this.dir(kind), '.installed.json');
  }

  async installed(kind: ContentKind): Promise<InstalledContent> {
    try {
      const parsed = InstalledContentSchema.safeParse(JSON.parse(await readFile(this.installedPath(kind), 'utf8')));
      if (parsed.success && parsed.data.kind === kind) return parsed.data;
      this.logger.warn(`${kind}: installed list unreadable, starting a new one`);
    } catch {
      // nothing installed yet
    }
    return emptyInstalled(kind);
  }

  /** Change the installed list (writes are queued per kind; written via a temp file and rename). */
  private update(kind: ContentKind, fn: (s: InstalledContent) => void): Promise<void> {
    const prev = this.writes.get(kind) ?? Promise.resolve();
    const next = prev.then(async () => {
      const s = await this.installed(kind);
      fn(s);
      await mkdir(this.dir(kind), { recursive: true });
      const tmp = `${this.installedPath(kind)}.tmp`;
      await writeFile(tmp, `${JSON.stringify(s, null, 1)}\n`);
      await rename(tmp, this.installedPath(kind));
    });
    this.writes.set(
      kind,
      next.catch(() => undefined),
    );
    return next;
  }

  async status(kind: ContentKind): Promise<ContentStatus> {
    return { kind, dir: this.dir(kind), installed: await this.installed(kind), busy: this.jobs.has(kind) };
  }

  /** The manifest at a branch or tag, checked for shape and consistency. */
  async manifest(kind: ContentKind, repo: string, ref: string, signal?: AbortSignal): Promise<ContentManifest> {
    const raw = await getJson(this.fetchFn, rawUrl(this.e, repo, ref, 'manifest.json'), this.e, { maxBytes: 32 * 1024 * 1024, ...(signal ? { signal } : {}) });
    const parsed = ContentManifestSchema.safeParse(raw);
    if (!parsed.success) throw new GithubError(`${repo} doesn't have a valid JBeam Forge manifest at ${ref}: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`, 'HTTP');
    if (parsed.data.kind !== kind) throw new GithubError(`${repo} holds ${parsed.data.kind}, not ${kind}. Check the repository in Settings → Downloads.`, 'BAD_INPUT');
    const problems = manifestProblems(parsed.data);
    if (problems.length) throw new GithubError(`${repo}'s manifest is inconsistent: ${problems.slice(0, 3).join('; ')}`, 'HTTP');
    return parsed.data;
  }

  /** The latest (default branch) and every tagged version, newest tags first. */
  async refs(repo: string, branch = 'main', signal?: AbortSignal): Promise<ContentRef[]> {
    const tags = await getJson(this.fetchFn, apiUrl(this.e, repo, 'tags?per_page=100'), this.e, signal ? { signal } : {});
    const names = Array.isArray(tags) ? tags.flatMap((t) => (t && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string' ? [(t as { name: string }).name] : [])) : [];
    return [{ name: branch, type: 'branch' as const }, ...names.filter((n) => /^[A-Za-z0-9._/-]{1,100}$/.test(n)).map((name) => ({ name, type: 'tag' as const }))];
  }

  /** Stop every running download (the content folder is moving). */
  cancelAll(): void {
    for (const c of this.jobs.values()) c.abort();
  }

  /** Stop the running download of a kind. */
  cancel(kind: ContentKind): void {
    this.jobs.get(kind)?.abort();
  }

  /**
   * Download and install `ids` (or everything) from `repo` at `ref`. Items
   * already installed with the same hash are skipped. Returns what happened;
   * a failed item never stops the others.
   */
  async download(kind: ContentKind, repo: string, ref: string, ids: readonly string[] | 'all', concurrency = 4): Promise<DownloadResult> {
    assertRepo(repo);
    assertRef(ref);
    if (this.jobs.has(kind)) throw new GithubError(`${KIND_LABEL[kind]} already downloading`, 'BAD_INPUT');
    const ctrl = new AbortController();
    this.jobs.set(kind, ctrl);
    const failed: DownloadResult['failed'] = [];
    const installedIds: string[] = [];
    let progress: ContentProgress = { kind, done: 0, total: 0, bytesDone: 0, bytesTotal: 0, current: null, failed, state: 'running' };
    let lastSent = 0;
    const report = (force = false) => {
      const now = Date.now();
      if (!force && now - lastSent < 100) return;
      lastSent = now;
      this.hooks.onProgress?.({ ...progress, failed: [...failed] });
    };
    try {
      const manifest = await this.manifest(kind, repo, ref, ctrl.signal);
      const plan = planDownload(manifest, await this.installed(kind), ids);
      progress = { ...progress, total: plan.fetch.length, bytesTotal: plan.bytes };
      report(true);
      const queue = [...plan.fetch];
      const worker = async () => {
        for (let item = queue.shift(); item && !ctrl.signal.aborted; item = queue.shift()) {
          progress.current = item.name;
          report();
          try {
            await this.installItem(kind, item, repo, ref, ctrl.signal, (n) => {
              progress.bytesDone += n;
              report();
            });
            installedIds.push(item.id);
            await this.update(kind, (s) => {
              s.repo = repo;
              s.ref = ref;
              s.version = manifest.version;
              s.items[item.id] = { sha256: item.sha256, dir: item.dir, size: item.size, installedAt: new Date().toISOString(), ref, version: manifest.version };
            });
          } catch (err) {
            if (ctrl.signal.aborted) break;
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`${kind}: ${item.id} failed: ${message}`);
            failed.push({ id: item.id, name: item.name, error: message });
          }
          progress.done += 1;
          report();
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(8, Math.round(concurrency))) }, worker));
      // Everything asked for was already current: that version is what's installed. (Not when items failed.)
      if (!installedIds.length && !failed.length && !ctrl.signal.aborted && plan.current.length)
        await this.update(kind, (s) => {
          s.repo = repo;
          s.ref = ref;
          s.version = manifest.version;
        });
      const cancelled = ctrl.signal.aborted;
      progress = { ...progress, current: null, state: cancelled ? 'cancelled' : 'finished' };
      this.logger.info(`${kind}: ${installedIds.length} installed, ${plan.current.length} already current, ${failed.length} failed${cancelled ? ' (cancelled)' : ''} from ${repo}@${ref}`);
      return { installed: installedIds, skipped: plan.current.map((i) => i.id), failed, cancelled };
    } finally {
      // Clean up before the job ends, so a new download of this kind can't have its files swept away;
      // only then say it's finished.
      await rm(join(this.root, '.tmp', kind), { recursive: true, force: true }).catch(() => undefined);
      this.jobs.delete(kind);
      if (progress.state === 'running') progress = { ...progress, current: null, state: ctrl.signal.aborted ? 'cancelled' : 'finished' };
      report(true);
      if (installedIds.length) this.hooks.onChange?.(kind);
    }
  }

  /** Download one item's zip, unpack it beside its folder, then swap it in. */
  private async installItem(kind: ContentKind, item: ContentItem, repo: string, ref: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
    const tmp = join(this.root, '.tmp', kind);
    await mkdir(tmp, { recursive: true });
    const zipPath = join(tmp, `${item.id}.zip`);
    await downloadFile(this.fetchFn, rawUrl(this.e, repo, ref, item.path), zipPath, this.e, { maxBytes: item.size, expectedSize: item.size, expectedSha256: item.sha256, signal, onBytes });
    const staging = join(tmp, `${item.id}.unpacked`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      await unpackZip(zipPath, staging, { maxFiles: item.files, maxBytes: Math.min(UNPACK_LIMIT, Math.ceil(item.unpacked * 1.01) + 1024), marker: MARKER[kind] });
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      await rm(zipPath, { force: true });
      throw new GithubError(`The download is damaged or unsafe, so it wasn't unpacked (${err instanceof Error ? err.message : String(err)})`, 'MISMATCH');
    }
    await rm(zipPath, { force: true });
    if (signal.aborted) throw new GithubError('Cancelled', 'CANCELLED');
    const kindDir = this.dir(kind);
    const target = safeJoin(kindDir, item.dir);
    await mkdir(dirname(target), { recursive: true });
    // Swap: the old folder is moved aside first, so a failure never leaves a mix of versions.
    const old = join(tmp, `${item.id}.old`);
    await rm(old, { recursive: true, force: true });
    const had = await exists(target);
    if (had) await rename(target, old);
    try {
      await rename(staging, target);
    } catch (err) {
      if (had) await rename(old, target).catch(() => undefined);
      throw err;
    }
    await rm(old, { recursive: true, force: true });
  }

  /** Remove installed items (or all of a kind). */
  async remove(kind: ContentKind, ids: readonly string[] | 'all'): Promise<string[]> {
    if (this.jobs.has(kind)) throw new GithubError('Wait for the download to finish (or cancel it) first', 'BAD_INPUT');
    const s = await this.installed(kind);
    const targets = ids === 'all' ? Object.keys(s.items) : ids.filter((id) => s.items[id]);
    const kindDir = this.dir(kind);
    for (const id of targets) {
      const dir = safeJoin(kindDir, s.items[id]!.dir);
      await rm(dir, { recursive: true, force: true });
      await pruneEmpty(dirname(dir), kindDir);
    }
    await this.update(kind, (st) => {
      for (const id of targets) delete st.items[id];
      if (!Object.keys(st.items).length) Object.assign(st, { repo: '', ref: '', version: '' });
    });
    if (targets.length) this.hooks.onChange?.(kind);
    return targets;
  }

  /** Items with a newer version in `manifest`, and ones it no longer lists. */
  async changes(kind: ContentKind, manifest: ContentManifest): Promise<{ updated: string[]; removed: string[] }> {
    return contentChanges(manifest, await this.installed(kind));
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Remove empty folders from `dir` up to (not including) `stop`. */
async function pruneEmpty(dir: string, stop: string): Promise<void> {
  for (let d = dir; relative(stop, d) && !relative(stop, d).startsWith('..'); d = dirname(d)) {
    try {
      if ((await readdir(d)).length) return;
      await rmdir(d);
    } catch {
      return;
    }
  }
}

/**
 * Unpack a content zip into `dest`: every entry must stay inside it, the
 * count and total size are capped (against zip bombs), and the kind's marker
 * file must be at the top.
 */
export async function unpackZip(zipPath: string, dest: string, limits: { maxFiles: number; maxBytes: number; marker: string }): Promise<number> {
  return withZip(zipPath, async (zip) => {
    const entries = await zip.entries();
    if (entries.length > limits.maxFiles) throw new GithubError(`The download holds ${entries.length} files, more than the ${limits.maxFiles} listed`, 'MISMATCH');
    if (!entries.some((e) => e.name === limits.marker)) throw new GithubError(`The download has no ${limits.marker}`, 'MISMATCH');
    const total = entries.reduce((n, e) => n + e.size, 0);
    if (total > limits.maxBytes) throw new GithubError(`The download unpacks to ${total} bytes, more than listed`, 'TOO_LARGE');
    let written = 0;
    for (const e of entries) {
      const out = safeJoin(dest, e.name.split('/').join(sep));
      await mkdir(dirname(out), { recursive: true });
      let n = 0;
      const guard = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          n += chunk.length;
          written += chunk.length;
          if (n > e.size || written > limits.maxBytes) return cb(new GithubError('A file unpacked larger than the zip said', 'TOO_LARGE'));
          cb(null, chunk);
        },
      });
      await pipeline(await zip.stream(e.name), guard, createWriteStream(out));
    }
    return entries.length;
  });
}

