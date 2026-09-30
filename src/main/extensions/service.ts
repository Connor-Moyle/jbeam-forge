import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import type { Logger } from '@shared/logger';
import { EXTENSION_ID, ExtensionManifestSchema, SAMPLE_EXTENSION, type ExtensionInfo } from '@shared/extensions/api';

/**
 * Extensions on disk (fork): userData/extensions/<id>/extension.json and its
 * script. Main only reads and copies files; the code runs in a renderer
 * worker with no access to them.
 */

const MAX_CODE = 2_000_000;

export class ExtensionService {
  constructor(
    readonly dir: string,
    private readonly logger: Logger,
    /** The example extensions shipped with the app. */
    readonly examplesDir: string | null = null,
  ) {}

  /** The examples that come with the app (installable copies). */
  async examples(): Promise<ExtensionInfo[]> {
    if (!this.examplesDir) return [];
    try {
      const names = (await readdir(this.examplesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
      const out: ExtensionInfo[] = [];
      for (const n of names.sort()) out.push(await this.read(join(this.examplesDir, n)));
      return out.filter((e) => e.manifest);
    } catch {
      return [];
    }
  }

  async installExample(id: string): Promise<string> {
    if (!this.examplesDir || !EXTENSION_ID.test(id)) throw new Error('No such example');
    return this.install(join(this.examplesDir, id));
  }

  async list(): Promise<ExtensionInfo[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.dir, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    } catch {
      return [];
    }
    const out: ExtensionInfo[] = [];
    for (const name of names.sort()) out.push(await this.read(join(this.dir, name)));
    return out;
  }

  private async read(folder: string): Promise<ExtensionInfo> {
    try {
      const raw = JSON.parse(await readFile(join(folder, 'extension.json'), 'utf8')) as unknown;
      const parsed = ExtensionManifestSchema.safeParse(raw);
      if (!parsed.success) return { manifest: null, folder, code: null, error: `extension.json: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` };
      const main = resolve(folder, parsed.data.main);
      if (!main.startsWith(resolve(folder) + sep)) return { manifest: parsed.data, folder, code: null, error: 'main must be inside the extension folder' };
      if ((await stat(main)).size > MAX_CODE) return { manifest: parsed.data, folder, code: null, error: `${parsed.data.main} is bigger than 2 MB` };
      return { manifest: parsed.data, folder, code: await readFile(main, 'utf8'), error: null };
    } catch (err) {
      return { manifest: null, folder, code: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** A new extension from the sample; returns its folder. */
  async create(): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    let id = SAMPLE_EXTENSION.manifest.id;
    for (let i = 2; await exists(join(this.dir, id)); i++) id = `${SAMPLE_EXTENSION.manifest.id}-${i}`;
    const folder = join(this.dir, id);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'extension.json'), `${JSON.stringify({ ...SAMPLE_EXTENSION.manifest, id }, null, 2)}\n`);
    await writeFile(join(folder, 'main.js'), SAMPLE_EXTENSION.main);
    this.logger.info(`created extension ${id}`);
    return folder;
  }

  /** Copy an extension folder in (replacing one with the same id). */
  async install(from: string): Promise<string> {
    const info = await this.read(from);
    if (!info.manifest) throw new Error(`Not an extension: ${info.error ?? 'no extension.json'}`);
    if (!EXTENSION_ID.test(info.manifest.id)) throw new Error('The extension id must be lower-case letters, digits and dashes.');
    if (resolve(from).startsWith(resolve(this.dir) + sep)) return from;
    const to = join(this.dir, info.manifest.id);
    await mkdir(this.dir, { recursive: true });
    await cp(from, to, { recursive: true, force: true, filter: (src) => !basename(src).startsWith('.') });
    this.logger.info(`installed extension ${info.manifest.id} from ${from}`);
    return to;
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
