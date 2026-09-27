import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { LibraryItem, ObjectItem } from '@shared/ipc-contract';
import type { Logger } from '@shared/logger';
import { loadBundledObjects, loadBundledPack } from '../services/materialLibrary';
import type { ScanJob, ScanResult } from './worker';

/**
 * The user's own library folders (Settings → Library folders), scanned at
 * startup with the same rules as the bundled packs. Each folder's result is
 * cached under userData and only rebuilt when a file in it changed.
 */

export interface FolderStatus {
  kind: 'materials' | 'objects';
  folder: string;
  count: number;
  error: string | null;
}

const MAX_FILES = 50_000;

/** Every file's path, size and date: changes when anything in the folder does. */
async function fingerprint(folder: string): Promise<string> {
  const hash = createHash('sha1');
  let files = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || files > MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) {
        const s = await stat(full);
        hash.update(`${relative(folder, full)}|${s.size}|${s.mtimeMs}\n`);
        files++;
      }
    }
  };
  await walk(folder, 0);
  return hash.digest('hex');
}

function runWorker(job: ScanJob): Promise<ScanResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./libraryWorker.js', import.meta.url));
    worker.once('message', (r: ScanResult) => {
      resolve(r);
      void worker.terminate();
    });
    worker.once('error', (err: Error) => resolve({ ok: false, error: err.message }));
    worker.postMessage(job);
  });
}

export class UserLibrary {
  private materials: LibraryItem[] = [];
  private objects: ObjectItem[] = [];
  private folders: FolderStatus[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly cacheRoot: string,
    private readonly logger: Logger,
    /** Called with each folder the app must be allowed to read from (the cache copies). */
    private readonly grant: (dir: string) => void,
  ) {}

  get items(): { materials: LibraryItem[]; objects: ObjectItem[]; folders: FolderStatus[]; scanning: boolean } {
    return { materials: this.materials, objects: this.objects, folders: this.folders, scanning: this.running !== null };
  }

  /** Scan (or reuse the cache of) every folder. Concurrent calls share one run. */
  scan(folders: { materials: readonly string[]; objects: readonly string[] }): Promise<void> {
    this.running ??= this.scanAll(folders).finally(() => (this.running = null));
    return this.running;
  }

  private async scanAll(folders: { materials: readonly string[]; objects: readonly string[] }): Promise<void> {
    const materials: LibraryItem[] = [];
    const objects: ObjectItem[] = [];
    const status: FolderStatus[] = [];
    for (const kind of ['materials', 'objects'] as const) {
      for (const folder of folders[kind]) {
        const key = createHash('sha1').update(folder.toLowerCase()).digest('hex').slice(0, 10);
        const out = join(this.cacheRoot, kind, key);
        try {
          if (!existsSync(folder)) throw new Error('Folder not found');
          const fp = await fingerprint(folder);
          const stamp = join(this.cacheRoot, kind, `${key}.fingerprint`);
          const cached = existsSync(stamp) && (await readFile(stamp, 'utf8')) === fp && existsSync(out);
          if (!cached) {
            this.logger.info(`scanning ${kind} folder`, folder);
            const r = await runWorker({ kind, folder, out, title: `${basename(folder)} (your ${kind})` });
            if (!r.ok) throw new Error(r.error);
            await writeFile(stamp, fp);
          }
          this.grant(out);
          if (kind === 'materials') {
            const items = await loadBundledPack(out, this.logger, `user${key}`);
            materials.push(...items);
            status.push({ kind, folder, count: items.length, error: null });
          } else {
            const items = await loadBundledObjects(out, this.logger, `user${key}`);
            objects.push(...items);
            status.push({ kind, folder, count: items.length, error: null });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`library folder ${folder}:`, message);
          status.push({ kind, folder, count: 0, error: message });
        }
      }
    }
    this.materials = materials;
    this.objects = objects;
    this.folders = status;
  }
}
