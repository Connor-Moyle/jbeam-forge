import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { z } from 'zod';
import { ZipFile } from 'yazl';
import { createWriteStream, type Dirent } from 'node:fs';
import { MaterialDefSchema, TEXTURE_SLOTS, type MaterialDef } from '@shared/materials/schema';
import { describeError, type Logger } from '@shared/logger';
import { safeJoin, withZip } from '../beamng/zip';
import { atomicWrite } from './atomicWrite';

/**
 * The user's material library (Phase 8b): materials saved from any project,
 * reusable in every other. Lives in userData: material-library.json plus a
 * folder per item holding its own copies of the textures, so an item keeps
 * working after the project it came from moves or is deleted.
 *
 * `.jbmat` files share one material: a zip with material.json (texture paths
 * relative, under textures/) and the texture files.
 */

export const LibraryItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(100),
  category: z.string().max(60),
  savedAt: z.string(),
  def: MaterialDefSchema,
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

const FileSchema = z.object({ version: z.literal(1), items: z.array(LibraryItemSchema) });
const JbmatSchema = z.object({ version: z.literal(1), name: z.string().min(1), category: z.string(), def: MaterialDefSchema });

/** Every texture path a material uses, per layer and slot. */
function mapPaths(def: MaterialDef, fn: (path: string) => string): MaterialDef {
  return { ...def, layers: def.layers.map((l) => ({ ...l, maps: Object.fromEntries(Object.entries(l.maps).map(([slot, p]) => [slot, p.startsWith('/vehicles/') ? p : fn(p)])) })) };
}

function texturesOf(def: MaterialDef): string[] {
  const out = new Set<string>();
  for (const l of def.layers) for (const slot of TEXTURE_SLOTS) {
    const p = l.maps[slot];
    if (p && !p.startsWith('/vehicles/')) out.add(p);
  }
  return [...out];
}

export class MaterialLibraryService {
  private items: LibraryItem[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {}

  /** Folder holding the library's texture copies (readable by the renderer). */
  get root(): string {
    return this.dir;
  }

  private get file(): string {
    return join(this.dir, 'material-library.json');
  }

  async load(): Promise<LibraryItem[]> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.logger.warn('material library read failed:', describeError(err).message);
      return (this.items = []);
    }
    try {
      this.items = FileSchema.parse(JSON.parse(text)).items;
    } catch (err) {
      const backup = `${this.file}.invalid-${Date.now()}`;
      this.logger.warn('material-library.json is invalid; backing up to', backup, describeError(err).message);
      await rename(this.file, backup).catch(() => undefined);
      this.items = [];
    }
    return this.items;
  }

  get(): LibraryItem[] {
    return this.items;
  }

  private write(items: LibraryItem[]): Promise<LibraryItem[]> {
    const run = this.queue.then(async () => {
      await mkdir(this.dir, { recursive: true });
      await atomicWrite(this.file, `${JSON.stringify({ version: 1, items }, null, 2)}\n`);
      this.items = items;
      return items;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Copy the material's textures into the library and add it. */
  async add(name: string, category: string, def: MaterialDef): Promise<LibraryItem[]> {
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const folder = join(this.dir, id);
    await mkdir(folder, { recursive: true });
    const copied = new Map<string, string>();
    for (const src of texturesOf(def)) {
      const dest = join(folder, basename(src));
      try {
        await copyFile(src, dest);
        copied.set(src, dest);
      } catch (err) {
        this.logger.warn('library: texture not copied', src, describeError(err).message);
      }
    }
    const stored = mapPaths({ ...def, id, origin: null }, (p) => copied.get(p) ?? p);
    const item = LibraryItemSchema.parse({ id, name, category, savedAt: new Date().toISOString(), def: stored });
    this.logger.info('library: saved', name);
    return this.write([...this.items, item]);
  }

  async remove(id: string): Promise<LibraryItem[]> {
    const items = this.items.filter((i) => i.id !== id);
    await rm(join(this.dir, id), { recursive: true, force: true }).catch(() => undefined);
    return this.write(items);
  }

  /** Write one material and its textures to a .jbmat zip. */
  async exportJbmat(path: string, name: string, category: string, def: MaterialDef): Promise<void> {
    const zip = new ZipFile();
    const inZip = new Map<string, string>();
    for (const src of texturesOf(def)) {
      let entry = `textures/${basename(src)}`;
      for (let i = 2; [...inZip.values()].includes(entry); i++) entry = `textures/${i}_${basename(src)}`;
      inZip.set(src, entry);
      zip.addBuffer(await readFile(src), entry);
    }
    const doc = { version: 1, name, category, def: mapPaths({ ...def, origin: null }, (p) => inZip.get(p) ?? p) };
    zip.addBuffer(Buffer.from(JSON.stringify(doc, null, 2)), 'material.json');
    zip.end();
    await new Promise<void>((res, rej) => {
      const out = createWriteStream(path);
      out.on('close', () => res());
      out.on('error', rej);
      zip.outputStream.pipe(out);
    });
  }

  /**
   * Add every material in a .jbmat or a material pack (a zip of
   * <folder>/material.json + <folder>/textures/…) to the library. Materials
   * already there (same name and category) are skipped, so re-importing an
   * updated pack only adds what's new.
   */
  async importFile(path: string): Promise<{ items: LibraryItem[]; added: number; skipped: number }> {
    return withZip(path, async (zip) => {
      const entries = await zip.entries();
      const docs = entries.filter((e) => e.name === 'material.json' || e.name.endsWith('/material.json'));
      if (!docs.length) throw new Error('No materials in this file (expected material.json inside).');
      const have = new Set(this.items.map((i) => `${i.category}/${i.name}`.toLowerCase()));
      const added: LibraryItem[] = [];
      let skipped = 0;
      for (const doc of docs) {
        const parsed = JbmatSchema.parse(JSON.parse((await zip.readBuffer(doc.name, 4 * 1024 * 1024)).toString('utf8')));
        if (have.has(`${parsed.category}/${parsed.name}`.toLowerCase())) {
          skipped++;
          continue;
        }
        const base = doc.name.slice(0, doc.name.length - 'material.json'.length); // '' or 'Metals/Gold/'
        const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const folder = join(this.dir, id);
        await mkdir(folder, { recursive: true });
        for (const e of entries) {
          if (!e.name.startsWith(`${base}textures/`) || e.name.endsWith('/')) continue;
          await writeFile(safeJoin(folder, basename(e.name)), await zip.readBuffer(e.name));
        }
        const def = mapPaths(parsed.def, (p) => safeJoin(folder, basename(p)));
        added.push(LibraryItemSchema.parse({ id, name: parsed.name, category: parsed.category, savedAt: new Date().toISOString(), def: { ...def, id } }));
        have.add(`${parsed.category}/${parsed.name}`.toLowerCase());
      }
      this.logger.info(`library: imported ${added.length} (skipped ${skipped}) from`, path);
      const items = await this.write([...this.items, ...added]);
      return { items, added: added.length, skipped };
    });
  }
}

/**
 * The material pack shipped with the app (read-only): every
 * <Category>/<Name>/material.json under `dir`, with its texture paths made
 * absolute. Skips anything that doesn't parse rather than failing the lot.
 */
export async function loadBundledPack(dir: string, logger: Logger): Promise<LibraryItem[]> {
  const found: string[] = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries: Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(d, e.name), depth + 1);
      else if (e.name === 'material.json') found.push(join(d, e.name));
    }
  };
  await walk(dir, 0);
  const items: LibraryItem[] = [];
  for (const file of found.sort()) {
    try {
      const parsed = JbmatSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      const folder = dirname(file);
      const id = `pack_${relative(dir, folder).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.slice(0, 64);
      const def = mapPaths({ ...parsed.def, id }, (p) => join(folder, p));
      items.push(LibraryItemSchema.parse({ id, name: parsed.name, category: parsed.category, savedAt: '', def }));
    } catch (err) {
      logger.warn('material pack: skipped', file, describeError(err).message);
    }
  }
  logger.info(`material pack: ${items.length} materials from`, dir);
  return items;
}
