import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';

/**
 * Watches the open project's model files (fork): when one is saved again
 * (Blender export over the old file), the renderer reloads it, keeping the
 * parts, materials and everything else. Folders are watched rather than
 * files, since many programs save by writing a new file and renaming it.
 * A change is reported once the file has stopped changing for a moment.
 */

const SETTLE_MS = 700;
const TEXTURE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tga', '.dds', '.bmp', '.webp']);

export class SourceWatcher {
  private readonly dirs = new Map<string, FSWatcher>();
  private files = new Set<string>();
  private textures = false;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly stamps = new Map<string, string>();

  constructor(
    private readonly onChange: (path: string, kind: 'model' | 'texture') => void,
    private readonly log: { warn: (...a: unknown[]) => void; debug: (...a: unknown[]) => void },
  ) {}

  /** Watch exactly these files (and, with `textures`, images beside them). */
  async set(paths: readonly string[], textures: boolean): Promise<void> {
    this.files = new Set(paths.map((p) => p.replace(/\\/g, '/')));
    this.textures = textures;
    const wanted = new Set([...this.files].map((p) => dirname(p)));
    for (const [dir, w] of this.dirs) {
      if (wanted.has(dir)) continue;
      w.close();
      this.dirs.delete(dir);
    }
    for (const p of this.files) this.stamps.set(p, await this.stamp(p));
    for (const dir of wanted) {
      if (this.dirs.has(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, (_event, name) => {
          if (name) this.touched(`${dir}/${String(name).replace(/\\/g, '/')}`);
        });
        w.on('error', (err) => this.log.warn('watch failed for', dir, err.message));
        this.dirs.set(dir, w);
      } catch (err) {
        this.log.warn('could not watch', dir, err instanceof Error ? err.message : String(err));
      }
    }
  }

  close(): void {
    for (const w of this.dirs.values()) w.close();
    this.dirs.clear();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private async stamp(path: string): Promise<string> {
    try {
      const s = await stat(path);
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return 'missing';
    }
  }

  private touched(path: string): void {
    const model = this.files.has(path);
    const texture = !model && this.textures && TEXTURE_EXTS.has(extname(path).toLowerCase()) && [...this.files].some((f) => dirname(f) === dirname(path));
    if (!model && !texture) return;
    clearTimeout(this.timers.get(path));
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        void this.settle(path, model ? 'model' : 'texture');
      }, SETTLE_MS),
    );
  }

  /** Report once the file is there and its size and time have stopped changing. */
  private async settle(path: string, kind: 'model' | 'texture'): Promise<void> {
    const a = await this.stamp(path);
    await new Promise((r) => setTimeout(r, 250));
    const b = await this.stamp(path);
    if (a !== b) return this.touched(path);
    if (b === 'missing' || this.stamps.get(path) === b) return;
    this.stamps.set(path, b);
    this.log.debug('changed on disk:', basename(path));
    // A texture beside a model reloads every model in that folder.
    if (kind === 'texture') for (const f of this.files) if (dirname(f) === dirname(path)) this.onChange(f, 'texture');
    if (kind === 'model') this.onChange(path, 'model');
  }
}
