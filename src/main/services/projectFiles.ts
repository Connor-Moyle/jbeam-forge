import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { parseProject } from '@shared/project/io';
import { atomicWrite } from './atomicWrite';

const MAX_PROJECT_BYTES = 256 * 1024 * 1024;

export class AccessError extends Error {
  readonly code = 'EACCES';
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

function key(path: string): string {
  const r = resolve(path);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/**
 * `.jbforge` file access. The renderer never supplies raw paths for writing:
 * a path is usable only after it was granted by a native dialog, the recent
 * list, or an earlier save. Granted project folders also become roots the
 * `jbf://` protocol may serve from (Phase 3b).
 */
export class ProjectFiles {
  private readonly grantedFiles = new Set<string>();
  private readonly grantedRoots = new Set<string>();

  grantFile(path: string): void {
    this.grantedFiles.add(key(path));
    this.grantedRoots.add(key(dirname(path)));
  }

  grantRoot(dir: string): void {
    this.grantedRoots.add(key(dir));
  }

  isFileGranted(path: string): boolean {
    return this.grantedFiles.has(key(path));
  }

  /** True when `path` is inside (or equal to) a granted root. */
  isUnderGrantedRoot(path: string): boolean {
    let dir = key(path);
    for (;;) {
      if (this.grantedRoots.has(dir)) return true;
      const parent = key(dirname(dir));
      if (parent === dir) return false;
      dir = parent;
    }
  }

  async read(path: string): Promise<string> {
    if (extname(path).toLowerCase() !== '.jbforge') throw new AccessError('Only .jbforge project files can be opened');
    const size = (await stat(path)).size;
    if (size > MAX_PROJECT_BYTES) throw new Error(`Project file is ${Math.round(size / 1e6)} MB — larger than the ${MAX_PROJECT_BYTES / 1e6} MB limit`);
    return readFile(path, 'utf8');
  }

  /** Validates before writing: we never write a document we could not load back. */
  async write(path: string, text: string): Promise<{ name: string; slug: string }> {
    if (!this.isFileGranted(path)) throw new AccessError('Saving to this path was not granted by a file dialog');
    if (extname(path).toLowerCase() !== '.jbforge') throw new AccessError('Projects must be saved as .jbforge files');
    const { project } = parseProject(text);
    await atomicWrite(path, text);
    return { name: project.meta.name, slug: project.meta.slug };
  }
}

/** Ensure a chosen save path ends in .jbforge. */
export function withProjectExtension(path: string): string {
  return extname(path).toLowerCase() === '.jbforge' ? path : `${path}.jbforge`;
}
