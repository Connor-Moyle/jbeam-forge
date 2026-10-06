import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { LibraryItem, ObjectItem, SuspensionSet } from '@shared/ipc-contract';
import type { Logger } from '@shared/logger';
import { loadBundledObjects, loadBundledPack } from '../services/materialLibrary';
import type { ScanJob, ScanResult } from './worker';

/**
 * The user's own library folders (Settings → Library folders), scanned at
 * startup with the same rules as the bundled packs. Each folder's result is
 * cached under userData and only rebuilt when a file in it changed.
 */

export interface FolderStatus {
  /** beamng: suspension parts from the BeamNG.drive install (`folder` is the install). */
  kind: 'materials' | 'objects' | 'beamng';
  folder: string;
  count: number;
  error: string | null;
}

const MAX_FILES = 50_000;
/** Bump when the BeamNG part cutting changes, so installs are cut again. */
const BEAMNG_FORMAT = 13; // 13: a wheel only one car has (the Covet 3-wheel's) comes with its suspension

type Folders = { materials: readonly string[]; objects: readonly string[]; beamngInstall: string | null };

/** The vehicle zips' names, sizes and dates: changes when the game updates. */
async function installFingerprint(installDir: string): Promise<string> {
  const hash = createHash('sha1').update(`format ${BEAMNG_FORMAT}
`);
  const dir = join(installDir, 'content', 'vehicles');
  for (const name of (await readdir(dir)).sort()) {
    const s = await stat(join(dir, name));
    hash.update(`${name}|${s.size}|${s.mtimeMs}
`);
  }
  return hash.digest('hex');
}

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

/** The complete suspensions written by buildPartObjects (<dir>/<vehicle>/<part>/set.json). */
async function loadSets(dir: string): Promise<SuspensionSet[]> {
  const out: SuspensionSet[] = [];
  let vehicles: string[] = [];
  try {
    vehicles = (await readdir(dir)).filter((v) => !v.startsWith('_'));
  } catch {
    return out;
  }
  for (const v of vehicles) {
    let parts: string[] = [];
    try {
      parts = await readdir(join(dir, v));
    } catch {
      continue;
    }
    for (const p of parts) {
      const folder = join(dir, v, p);
      try {
        const s = JSON.parse(await readFile(join(folder, 'set.json'), 'utf8')) as Omit<SuspensionSet, 'id' | 'mesh' | 'jbeam' | 'logo'> & { mesh: string; logo: string | null };
        out.push({ ...s, kind: s.kind ?? 'suspension', slotType: s.slotType ?? '', id: `${v}/${p}`, mesh: join(folder, s.mesh), jbeam: join(folder, 'jbeam.json'), logo: s.logo ? join(folder, s.logo) : null });
      } catch {
        // not a set folder
      }
    }
  }
  return out;
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
  private sets: SuspensionSet[] = [];
  private folders: FolderStatus[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly cacheRoot: string,
    private readonly logger: Logger,
    /** Called with each folder the app must be allowed to read from (the cache copies). */
    private readonly grant: (dir: string) => void,
  ) {}

  get items(): { materials: LibraryItem[]; objects: ObjectItem[]; sets: SuspensionSet[]; folders: FolderStatus[]; scanning: boolean } {
    return { materials: this.materials, objects: this.objects, sets: this.sets, folders: this.folders, scanning: this.running !== null };
  }

  /**
   * Scan (or reuse the cache of) every folder. Calls for the same folders while one runs share it;
   * a call with other folders (the game folder changed meanwhile) runs again once it's done, with
   * the newest folders, so a change is never lost.
   */
  scan(folders: Folders): Promise<void> {
    const key = JSON.stringify(folders);
    if (!this.running) {
      this.runningKey = key;
      this.running = this.scanAll(folders).finally(() => {
        this.running = null;
        const next = this.queued;
        this.queued = null;
        if (next) void this.scan(next.folders).then(next.resolve, next.resolve);
      });
      return this.running;
    }
    if (key === this.runningKey && !this.queued) return this.running;
    // Only the newest request matters; earlier waiters are answered by the same run.
    const prev = this.queued;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    this.queued = { folders, resolve: () => (prev?.resolve(), resolve()) };
    return done;
  }

  private runningKey = '';
  private queued: { folders: Folders; resolve: () => void } | null = null;

  /** Sets cut from car mods (Automation exports), kept under the cache's imports folder. */
  private async importedSets(): Promise<SuspensionSet[]> {
    const root = join(this.cacheRoot, 'imports');
    let dirs: string[] = [];
    try {
      dirs = await readdir(root);
    } catch {
      return [];
    }
    const out: SuspensionSet[] = [];
    for (const d of dirs) {
      this.grant(join(root, d));
      out.push(...(await loadSets(join(root, d, 'sets'))).map((s) => ({ ...s, id: `import:${d}/${s.id}` })));
    }
    return out;
  }

  /**
   * Bring in the engines and gearboxes of a car mod zip (a car exported from
   * Automation): cut like the game's cars, then listed in the catalogue.
   * Returns the sets it added.
   */
  async importMod(zipPath: string, install: string | null): Promise<SuspensionSet[]> {
    const key = createHash('sha1').update(zipPath.toLowerCase()).digest('hex').slice(0, 10);
    const out = join(this.cacheRoot, 'imports', key);
    this.logger.info('importing car mod', zipPath);
    const r = await runWorker({ kind: 'mod', folder: zipPath, out, install, title: basename(zipPath) });
    if (!r.ok) throw new Error(r.error);
    const all = await this.importedSets();
    const added = all.filter((s) => s.id.startsWith(`import:${key}/`));
    this.sets = [...this.sets.filter((s) => !s.id.startsWith(`import:${key}/`)), ...added];
    return added;
  }

  private async scanAll(folders: Folders): Promise<void> {
    const materials: LibraryItem[] = [];
    const objects: ObjectItem[] = [];
    const status: FolderStatus[] = [];
    const sets: SuspensionSet[] = [];
    if (folders.beamngInstall) {
      const install = folders.beamngInstall;
      const out = join(this.cacheRoot, 'beamng', 'parts');
      const stamp = join(this.cacheRoot, 'beamng', 'parts.fingerprint');
      try {
        const fp = await installFingerprint(install);
        if (!(existsSync(stamp) && (await readFile(stamp, 'utf8')) === fp && existsSync(out))) {
          this.logger.info('cutting suspension parts from', install);
          const r = await runWorker({ kind: 'beamng', folder: install, out, title: 'BeamNG parts' });
          if (!r.ok) throw new Error(r.error);
          await writeFile(stamp, fp);
        }
        this.grant(out);
        const items = await loadBundledObjects(join(out, 'BeamNG'), this.logger, 'bng');
        objects.push(...items);
        sets.push(...(await loadSets(join(out, 'sets'))));
        status.push({ kind: 'beamng', folder: install, count: items.length, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn('BeamNG parts:', message);
        status.push({ kind: 'beamng', folder: install, count: 0, error: message });
      }
    }
    // Car mods brought in (engines from Automation exports): already cut, just loaded.
    sets.push(...(await this.importedSets()));
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
    this.sets = sets;
    this.folders = status;
  }
}
