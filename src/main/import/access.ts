import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Project, SourceFormat } from '@shared/project/schema';
import { SOURCE_FORMATS } from '@shared/project/schema';
import type { ProjectFiles } from '../services/projectFiles';
import { AccessError } from '../services/projectFiles';
import { atomicWrite } from '../services/atomicWrite';
import { IMAGE_EXTENSIONS } from './textures';

/**
 * Only these file types are ever read for the renderer, even inside granted
 * folders: model sources, their side files (MTL, glTF buffers) and images.
 */
const READABLE_EXTENSIONS = new Set<string>(['.dae', '.fbx', '.obj', '.mtl', '.gltf', '.glb', '.bin', '.stl', '.kn5', ...IMAGE_EXTENSIONS, '.ktx2']);

export const MODEL_FILTERS = [
  { name: '3D models', extensions: ['dae', 'fbx', 'obj', 'gltf', 'glb', 'stl', 'kn5'] },
  { name: 'COLLADA (.dae)', extensions: ['dae'] },
  { name: 'FBX', extensions: ['fbx'] },
  { name: 'Wavefront OBJ', extensions: ['obj'] },
  { name: 'glTF / GLB', extensions: ['gltf', 'glb'] },
  { name: 'STL', extensions: ['stl'] },
  { name: 'Assetto Corsa (.kn5)', extensions: ['kn5'] },
];

export function formatFromPath(path: string): SourceFormat | null {
  const ext = extname(path).slice(1).toLowerCase();
  return (SOURCE_FORMATS as readonly string[]).includes(ext) ? (ext as SourceFormat) : null;
}

export function assertReadable(projects: ProjectFiles, path: string): void {
  if (!READABLE_EXTENSIONS.has(extname(path).toLowerCase())) throw new AccessError(`File type not allowed: ${extname(path) || '(none)'}`);
  if (!projects.isUnderGrantedRoot(path)) throw new AccessError('This file is outside every folder you have opened or located');
}

/** Candidate locations for a source when (re)opening a project, most likely first. */
export function sourceCandidates(projectPath: string | null, source: { path: string; absolutePath: string }): string[] {
  const out: string[] = [];
  const projectDir = projectPath ? dirname(projectPath) : null;
  if (projectDir && !isAbsolute(source.path)) out.push(join(projectDir, source.path));
  out.push(source.absolutePath);
  if (isAbsolute(source.path)) out.push(source.path);
  if (projectDir) {
    const base = source.absolutePath.split(/[\\/]/).pop() ?? '';
    out.push(join(projectDir, base), join(projectDir, 'models', base));
  }
  return [...new Set(out)];
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** First existing candidate that is already readable. Never stats paths outside granted folders. */
export async function locateSource(projects: ProjectFiles, projectPath: string | null, source: { path: string; absolutePath: string }): Promise<string | null> {
  for (const c of sourceCandidates(projectPath, source)) {
    if (!projects.isUnderGrantedRoot(c)) continue;
    if (await isFile(c)) return c;
  }
  return null;
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Folders an opened project wants to read from: the folder of each source
 * file that exists, and each texture folder that exists. Split into those
 * inside the project's own folder (safe to grant) and everything else, which
 * needs the user's consent — a shared .jbforge must not be able to grant
 * itself read access to arbitrary folders.
 */
export async function projectResourceFolders(projectPath: string, project: Project): Promise<{ inside: string[]; outside: string[] }> {
  const projectDir = dirname(projectPath);
  const found: string[] = [];
  for (const s of project.sources) {
    for (const c of sourceCandidates(projectPath, s)) {
      if (await isFile(c)) {
        found.push(dirname(resolve(c)));
        break;
      }
    }
    for (const d of s.textureDirs) if (await isDir(d)) found.push(resolve(d));
  }
  const unique = [...new Set(found)];
  return { inside: unique.filter((d) => isInside(d, projectDir)), outside: unique.filter((d) => !isInside(d, projectDir)) };
}

const TrustFileSchema = z.object({ version: z.literal(1), projects: z.record(z.string(), z.array(z.string())) });

/** Folders the user has allowed each project (by path) to read, persisted in userData. */
export class FolderTrust {
  private data: z.infer<typeof TrustFileSchema> = { version: 1, projects: {} };

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = TrustFileSchema.safeParse(JSON.parse(await readFile(this.filePath, 'utf8')));
      if (parsed.success) this.data = parsed.data;
    } catch {
      /* none yet */
    }
  }

  private key(projectPath: string): string {
    return resolve(projectPath).toLowerCase();
  }

  isTrusted(projectPath: string, folder: string): boolean {
    return (this.data.projects[this.key(projectPath)] ?? []).some((f) => resolve(f).toLowerCase() === resolve(folder).toLowerCase());
  }

  async trust(projectPath: string, folders: readonly string[]): Promise<void> {
    const k = this.key(projectPath);
    this.data.projects[k] = [...new Set([...(this.data.projects[k] ?? []), ...folders.map((f) => resolve(f))])];
    await atomicWrite(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}
