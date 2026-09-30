import { mkdir, readdir, readFile, realpath, stat, writeFile, copyFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import type { Logger } from '@shared/logger';
import { withZip } from '../beamng/zip';

/**
 * Extension file access (fork). An extension that asks for "files" in its
 * extension.json can read inside folders the user picked for it (a game's
 * install folder, a mods folder), and nothing else: every path is resolved
 * (links included) and must be inside one of that extension's folders.
 * Picked folders are remembered per extension. Extensions that ask for
 * "import" can hand the app models, written here as OBJ files.
 */

const MAX_READ = 512 * 1024 * 1024;

export interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
}

export class ExtensionFiles {
  private grants: Record<string, string[]> = {};
  private loaded = false;

  constructor(
    private readonly grantsFile: string,
    readonly modelsDir: string,
    private readonly logger: Logger,
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.grantsFile, 'utf8')) as unknown;
      if (raw && typeof raw === 'object') for (const [id, list] of Object.entries(raw)) if (Array.isArray(list)) this.grants[id] = list.filter((p): p is string => typeof p === 'string');
    } catch {
      // none yet
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.grantsFile), { recursive: true });
    await writeFile(this.grantsFile, `${JSON.stringify(this.grants, null, 2)}\n`);
  }

  async folders(extId: string): Promise<string[]> {
    await this.load();
    return [...(this.grants[extId] ?? [])];
  }

  async grant(extId: string, folder: string): Promise<string> {
    await this.load();
    const real = await realpath(folder);
    const list = this.grants[extId] ?? [];
    if (!list.includes(real)) this.grants[extId] = [...list, real];
    await this.save();
    this.logger.info(`extension ${extId} may read ${real}`);
    return real;
  }

  async revoke(extId: string): Promise<void> {
    await this.load();
    delete this.grants[extId];
    await this.save();
  }

  /** The real path, if it's inside one of the extension's folders; throws otherwise. */
  async check(extId: string, path: string): Promise<string> {
    await this.load();
    let real: string;
    try {
      real = await realpath(resolve(path));
    } catch {
      throw new Error(`Not found: ${path}`);
    }
    const inside = (this.grants[extId] ?? []).some((root) => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep));
    if (!inside) throw new Error(`Outside the folders this extension may read: ${path}. Ask for one with forge.files.pickFolder().`);
    return real;
  }

  async list(extId: string, path: string): Promise<DirEntry[]> {
    const real = await this.check(extId, path);
    const out: DirEntry[] = [];
    for (const e of await readdir(real, { withFileTypes: true })) {
      const p = join(real, e.name);
      let size = 0;
      if (e.isFile()) size = (await stat(p).catch(() => ({ size: 0 }))).size;
      out.push({ name: e.name, path: p, dir: e.isDirectory(), size });
    }
    return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }

  async read(extId: string, path: string, maxBytes = MAX_READ): Promise<Uint8Array> {
    const real = await this.check(extId, path);
    const s = await stat(real);
    if (!s.isFile()) throw new Error(`Not a file: ${path}`);
    if (s.size > Math.min(maxBytes, MAX_READ)) throw new Error(`${basename(path)} is bigger than ${Math.round(Math.min(maxBytes, MAX_READ) / 1e6)} MB`);
    return new Uint8Array(await readFile(real));
  }

  /** A zip's files (in the extension's folders), without unpacking it. */
  async zipList(extId: string, zipPath: string): Promise<{ name: string; size: number }[]> {
    const real = await this.check(extId, zipPath);
    return withZip(real, async (z) => (await z.entries()).map((e) => ({ name: e.name, size: e.size })));
  }

  async zipRead(extId: string, zipPath: string, entry: string, maxBytes = MAX_READ): Promise<Uint8Array> {
    const real = await this.check(extId, zipPath);
    return new Uint8Array(await withZip(real, (z) => z.readBuffer(entry, Math.min(maxBytes, MAX_READ))));
  }

  /**
   * Unpack a zip's files under the given folders (all when empty) to
   * userData/extension-models/<ext>/<zip name>/, which the extension may
   * then read and import from. Returns that folder.
   */
  async zipExtract(extId: string, zipPath: string, prefixes: readonly string[]): Promise<string> {
    const real = await this.check(extId, zipPath);
    const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'zip';
    const out = join(this.modelsDir, safe(extId), safe(basename(real, extname(real))));
    await mkdir(out, { recursive: true });
    const wanted = (name: string) => !prefixes.length || prefixes.some((p) => name.startsWith(p));
    await withZip(real, async (z) => {
      const total = (await z.entries()).filter((e) => wanted(e.name)).reduce((n, e) => n + e.size, 0);
      if (total > 4 * MAX_READ) throw new Error(`That would unpack ${Math.round(total / 1e6)} MB; pick fewer folders`);
      await z.extract(wanted, out);
    });
    await this.grant(extId, out);
    return realpath(out);
  }

  /**
   * A model an extension built: its OBJ, MTL and textures written to
   * userData/extension-models/<ext>/<name>/. Textures come as bytes or as a
   * path in the extension's folders (copied). Returns the OBJ's path.
   */
  async writeModel(extId: string, name: string, files: readonly { name: string; text?: string; bytes?: Uint8Array; from?: string }[]): Promise<string> {
    const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'model';
    const dir = join(this.modelsDir, safe(extId), safe(name));
    await mkdir(dir, { recursive: true });
    let obj = '';
    for (const f of files) {
      const out = join(dir, safe(f.name));
      if (f.text !== undefined) await writeFile(out, f.text);
      else if (f.bytes) await writeFile(out, f.bytes);
      else if (f.from) await copyFile(await this.check(extId, f.from), out);
      if (extname(out).toLowerCase() === '.obj') obj = out;
    }
    if (!obj) throw new Error('The model has no .obj file');
    return obj;
  }
}
