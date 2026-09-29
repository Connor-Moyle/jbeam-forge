import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Logger } from '@shared/logger';
import { parseLibraryScript } from '@shared/lua/library/share';
import type { LibraryScript } from '@shared/lua/types';

/**
 * Saved vehicle scripts (fork): the user's own library (userData/scripts)
 * and scripts downloaded from the scripts repository (the content folder).
 */

export interface LibraryEntry {
  path: string;
  source: 'mine' | 'downloaded';
  entry: LibraryScript;
}

const MAX_FILES = 2000;

async function walk(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 6 || out.length > MAX_FILES) return out;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.')) await walk(p, depth + 1, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.jbscript')) out.push(p);
  }
  return out;
}

export class ScriptLibrary {
  constructor(
    readonly dir: string,
    private readonly downloadedDir: () => string,
    private readonly logger: Logger,
  ) {}

  async list(): Promise<{ scripts: LibraryEntry[]; errors: string[] }> {
    const scripts: LibraryEntry[] = [];
    const errors: string[] = [];
    for (const [source, root] of [
      ['mine', this.dir],
      ['downloaded', this.downloadedDir()],
    ] as const) {
      for (const path of await walk(root)) {
        try {
          if ((await stat(path)).size > 2_000_000) throw new Error('too big');
          scripts.push({ path, source, entry: parseLibraryScript(await readFile(path, 'utf8'), relative(root, path)) });
        } catch (err) {
          errors.push(`${relative(root, path)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    if (errors.length) this.logger.warn(`${errors.length} script file(s) unreadable`);
    scripts.sort((a, b) => a.entry.category.localeCompare(b.entry.category) || a.entry.label.localeCompare(b.entry.label));
    return { scripts, errors };
  }

  /** Save to the user's library, named after the script (replacing one of the same name). */
  async save(entry: LibraryScript): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const file = `${entry.label.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || entry.name}.jbscript`;
    const path = join(this.dir, file);
    await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    return path;
  }

  /** Delete a file from the user's library (never a downloaded one). */
  async remove(path: string): Promise<void> {
    const full = resolve(path);
    const root = resolve(this.dir) + sep;
    if (!full.startsWith(root) || !full.toLowerCase().endsWith('.jbscript')) throw new Error('Only scripts in your own library can be deleted.');
    await rm(full, { force: true });
  }
}
