import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { ContentKind } from '@shared/content/manifest';
import { isSafeDir } from '@shared/content/manifest';
import type { LibraryScript } from '@shared/lua/types';
import type { MaterialDef } from '@shared/materials/schema';
import { mapPaths, texturesOf } from '../services/materialLibrary';
import type { PublishStatus } from '@shared/content/types';

/**
 * Publishing to the download library (for whoever looks after it): items are written as folders
 * into a local copy of the content repository, then committed and pushed. The repository's own
 * workflow builds the downloads from them (content-repo/ in this project is its template).
 */

const run = promisify(execFile);
const MARKER: Record<ContentKind, string> = { textures: 'material.json', meshes: 'object.json', scripts: 'script.jbscript' };
export const CONTENT_REPO_URL = 'https://github.com/Connor-Moyle/jbeam-forge-content.git';

/** A folder name anyone's system can unpack: what a person typed, with the unsafe characters out. */
export function folderName(raw: string): string {
  const clean = raw
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80)
    .trim();
  return clean || 'Untitled';
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === 'ENOENT') throw new Error('Git isn’t installed (or isn’t on the PATH). Install it from git-scm.com, then try again.');
    throw new Error((e.stderr || e.message || String(err)).trim().split('\n').slice(-4).join('\n'));
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Is `dir` a copy of a content repository (a git folder with textures/, meshes/ or scripts/, or the tools)? */
export async function publishStatus(dir: string | null): Promise<PublishStatus> {
  if (!dir) return { dir: null, ok: false, problem: 'No content repository chosen.' };
  if (!(await exists(join(dir, '.git')))) return { dir, ok: false, problem: 'That folder isn’t a git repository. Use “Get a copy” to download one.' };
  if (!(await exists(join(dir, 'tools', 'build.mjs')))) return { dir, ok: false, problem: 'That folder isn’t a JBeam Forge content repository (no tools/build.mjs).' };
  const porcelain = await git(dir, ['status', '--porcelain', '--untracked-files=all']);
  const changed = porcelain ? porcelain.split('\n').length : 0;
  const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
  const remote = await git(dir, ['remote', 'get-url', 'origin']).catch(() => '');
  return { dir, ok: true, problem: null, changed, branch, remote };
}

/** Download a copy of the content repository into `parent` (it becomes <parent>/jbeam-forge-content). */
export async function cloneContentRepo(parent: string, url = CONTENT_REPO_URL): Promise<string> {
  const dest = join(parent, 'jbeam-forge-content');
  if (await exists(dest)) {
    if (await exists(join(dest, '.git'))) return dest;
    throw new Error(`${dest} already exists and isn't a repository.`);
  }
  await git(parent, ['clone', '--filter=blob:none', url, dest]);
  return dest;
}

async function freeFolder(base: string): Promise<string> {
  let dest = base;
  for (let i = 2; await exists(dest); i++) dest = `${base} ${i}`;
  return dest;
}

/** A material as <repo>/textures/<Category>/<Name>/ (material.json + textures/). Returns the folder. */
export async function addMaterial(repo: string, name: string, category: string, def: MaterialDef): Promise<string> {
  const folder = await freeFolder(join(repo, 'textures', folderName(category), folderName(name)));
  await mkdir(join(folder, 'textures'), { recursive: true });
  const inFolder = new Map<string, string>();
  for (const src of texturesOf(def)) {
    let entry = `textures/${basename(src)}`;
    for (let i = 2; [...inFolder.values()].includes(entry); i++) entry = `textures/${i}_${basename(src)}`;
    inFolder.set(src, entry);
    await writeFile(join(folder, ...entry.split('/')), await readFile(src));
  }
  const doc = { version: 1, name, category, def: mapPaths({ ...def, id: 'pack', origin: null }, (p) => inFolder.get(p) ?? p) };
  await writeFile(join(folder, 'material.json'), `${JSON.stringify(doc, null, 2)}\n`);
  return folder;
}

/** A script as <repo>/scripts/<category>/<name>/ (script.jbscript, and its code as a .lua to read). */
export async function addScript(repo: string, entry: LibraryScript): Promise<string> {
  const folder = await freeFolder(join(repo, 'scripts', folderName(entry.category || 'Other').toLowerCase().replace(/\s+/g, '_'), entry.name));
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'script.jbscript'), `${JSON.stringify(entry, null, 2)}\n`);
  if (entry.code) await writeFile(join(folder, `${entry.name}.lua`), entry.code);
  return folder;
}

/** Any finished item folder (it must hold the kind's marker file) copied in under <kind>/<category>/. */
export async function addFolder(repo: string, kind: ContentKind, source: string, category: string): Promise<string> {
  const names = await readdir(source);
  if (!names.includes(MARKER[kind])) throw new Error(`That folder has no ${MARKER[kind]}, so it isn't a ${kind === 'textures' ? 'material' : kind === 'meshes' ? 'mesh' : 'script'} folder.`);
  const rel = `${folderName(category)}/${folderName(basename(source))}`;
  if (!isSafeDir(rel)) throw new Error(`“${rel}” can’t be used as a folder name.`);
  const folder = await freeFolder(join(repo, kind, ...rel.split('/')));
  await cp(source, folder, { recursive: true });
  return folder;
}

/** Commit everything changed in the copy and push it: the repository's workflow does the rest. */
export async function publish(repo: string, message: string): Promise<{ committed: number; pushed: boolean; output: string }> {
  const status = await git(repo, ['status', '--porcelain', '--untracked-files=all']);
  const committed = status ? status.split('\n').length : 0;
  if (committed) {
    await git(repo, ['add', '-A']);
    await git(repo, ['commit', '-q', '-m', message.trim() || 'New content']);
  }
  await git(repo, ['pull', '-q', '--rebase', 'origin', 'HEAD']).catch(() => undefined);
  const output = await git(repo, ['push', '-q', 'origin', 'HEAD']);
  return { committed, pushed: true, output };
}
