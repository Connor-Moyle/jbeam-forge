import { readdir, stat } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';

/**
 * Texture reference resolution. Real-world model files reference textures
 * badly (verified on the official Sunburst DAE, 0.39.1):
 *   - `boxer_b.color.png` when the file that ships is `boxer_b.color.DDS`
 *   - `/C:/Work%20space/BeamNG%20Game/vehicles/common/grille_d.dds`, an
 *     absolute path from the author's machine
 * So a reference resolves by, in order:
 *   1. the path as given, relative to the model's folder;
 *   2. the same file name, then the same stem with other image extensions,
 *      looked up in an index of the model folder + user-located folders.
 */

export const IMAGE_EXTENSIONS = ['.dds', '.png', '.jpg', '.jpeg', '.tga', '.bmp', '.webp'] as const;
const IMAGE_EXT_SET = new Set<string>(IMAGE_EXTENSIONS);

export interface RefCandidates {
  /** Decoded relative path to try against the model folder, or null for absolute refs. */
  relative: string | null;
  /** Lowercase file names to look up, most specific first. */
  names: string[];
}

/** Pure: what to look for when a model references `ref`. */
export function textureCandidates(ref: string): RefCandidates {
  let decoded = ref;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    /* keep raw */
  }
  decoded = decoded.replace(/^file:\/\//i, '').replace(/\\/g, '/');
  const absolute = decoded.startsWith('/') || /^[A-Za-z]:\//.test(decoded) || isAbsolute(decoded);
  const base = decoded.split('/').filter(Boolean).pop() ?? decoded;
  const ext = extname(base).toLowerCase();
  const stem = IMAGE_EXT_SET.has(ext) ? base.slice(0, base.length - ext.length) : base;
  const names = [base.toLowerCase(), ...IMAGE_EXTENSIONS.map((e) => `${stem}${e}`.toLowerCase())];
  return { relative: absolute ? null : decoded, names: [...new Set(names)] };
}

export interface TextureIndexOptions {
  maxFiles?: number;
  maxDepth?: number;
}

/** Lowercase image file name → first path found (roots searched in order, breadth-first). */
export class TextureIndex {
  private constructor(
    private readonly byName: Map<string, string>,
    readonly truncated: boolean,
  ) {}

  static async build(roots: readonly string[], opts: TextureIndexOptions = {}): Promise<TextureIndex> {
    const maxFiles = opts.maxFiles ?? 20_000;
    const maxDepth = opts.maxDepth ?? 5;
    const byName = new Map<string, string>();
    let truncated = false;
    // Each root gets its own budget: a model sitting in a huge folder (Downloads,
    // Desktop) must not starve the folders the user explicitly located.
    for (const root of roots) {
      let seen = 0;
      let rootTruncated = false;
      let level: string[] = [root];
      for (let depth = 0; depth <= maxDepth && level.length && !rootTruncated; depth++) {
        const next: string[] = [];
        for (const dir of level) {
          let entries;
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const e of entries) {
            if (++seen > maxFiles) {
              rootTruncated = true;
              break;
            }
            const full = join(dir, e.name);
            if (e.isDirectory()) next.push(full);
            else if (IMAGE_EXT_SET.has(extname(e.name).toLowerCase())) {
              const key = e.name.toLowerCase();
              if (!byName.has(key)) byName.set(key, full);
            }
          }
          if (rootTruncated) break;
        }
        level = next;
      }
      truncated ||= rootTruncated;
    }
    return new TextureIndex(byName, truncated);
  }

  lookup(names: readonly string[]): string | null {
    for (const n of names) {
      const hit = this.byName.get(n);
      if (hit) return hit;
    }
    return null;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Resolve every ref for a model in `sourceDir`; null = not found. */
export async function resolveTextureRefs(
  refs: readonly string[],
  sourceDir: string,
  extraRoots: readonly string[],
  opts?: TextureIndexOptions,
): Promise<{ resolved: Record<string, string | null>; truncated: boolean }> {
  let index: TextureIndex | null = null;
  const resolved: Record<string, string | null> = {};
  for (const ref of refs) {
    const c = textureCandidates(ref);
    if (c.relative && IMAGE_EXT_SET.has(extname(c.relative).toLowerCase())) {
      const direct = join(sourceDir, c.relative);
      if (await isFile(direct)) {
        resolved[ref] = direct;
        continue;
      }
    }
    index ??= await TextureIndex.build([sourceDir, ...extraRoots], opts);
    resolved[ref] = index.lookup(c.names);
  }
  return { resolved, truncated: index?.truncated ?? false };
}
