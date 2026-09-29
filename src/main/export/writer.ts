import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, extname, join, posix } from 'node:path';
import { ZipFile } from 'yazl';
import { SLUG_PATTERN } from '@shared/project/schema';
import { IMAGE_EXTENSIONS } from '../import/textures';

/**
 * Writes an exported mod (SPEC §4.15) either as an **unpacked mod** in
 * BeamNG's user folder (`mods/unpacked/<slug>/vehicles/<slug>/…`) or as a zip.
 *
 * Safety: every output path is relative and inside `vehicles/<slug>/`; copied
 * textures must be readable images the user already granted; an existing
 * unpacked folder is replaced only if it carries our marker (we never
 * overwrite a mod JBeam Forge didn't create). Installs are staged in a temp
 * folder and swapped in, so a failed export never leaves a half-written mod.
 */

export const MARKER_FILE = 'jbforge-export.json';

export interface ModFile {
  /** e.g. "vehicles/test/test.jbeam" */
  path: string;
  text?: string;
  /** base64 for binary files (preview jpg) */
  base64?: string;
}

export interface ModCopy {
  from: string;
  /** e.g. "vehicles/test/test_paint_b.color.dds" */
  to: string;
}

export interface ModBundle {
  slug: string;
  projectName: string;
  files: ModFile[];
  copies: ModCopy[];
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

/** Validate a bundle's paths; returns them normalised. */
export function checkBundle(bundle: ModBundle, canReadSource: (path: string) => boolean): void {
  if (!SLUG_PATTERN.test(bundle.slug)) throw new ExportError(`Invalid mod name "${bundle.slug}"`);
  const root = `vehicles/${bundle.slug}/`;
  const check = (p: string) => {
    const norm = posix.normalize(p.replace(/\\/g, '/'));
    if (norm !== p || !norm.startsWith(root) || norm.includes('..') || posix.isAbsolute(norm)) throw new ExportError(`Refusing to write outside ${root}: ${p}`);
  };
  for (const f of bundle.files) check(f.path);
  for (const c of bundle.copies) {
    check(c.to);
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(extname(c.from).toLowerCase())) throw new ExportError(`Only textures can be copied into a mod: ${c.from}`);
    if (!canReadSource(c.from)) throw new ExportError(`Texture is outside every folder you have opened or located: ${c.from}`);
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

async function writeBundleTo(dir: string, bundle: ModBundle): Promise<number> {
  let bytes = 0;
  for (const f of bundle.files) {
    const out = join(dir, ...f.path.split('/'));
    await mkdir(dirname(out), { recursive: true });
    const data = f.base64 !== undefined ? Buffer.from(f.base64, 'base64') : Buffer.from(f.text ?? '', 'utf8');
    await writeFile(out, data);
    bytes += data.length;
  }
  for (const c of bundle.copies) {
    const out = join(dir, ...c.to.split('/'));
    await mkdir(dirname(out), { recursive: true });
    await copyFile(c.from, out);
    bytes += (await stat(out)).size;
  }
  await writeFile(join(dir, MARKER_FILE), `${JSON.stringify({ generator: 'JBeam Forge', project: bundle.projectName, slug: bundle.slug, exportedAt: new Date().toISOString() }, null, 2)}\n`);
  return bytes;
}

/** Install as `<modsDir>/unpacked/<slug>`; returns the folder. */
export async function installUnpacked(modsDir: string, bundle: ModBundle): Promise<{ path: string; bytes: number }> {
  const unpacked = join(modsDir, 'unpacked');
  const target = join(unpacked, bundle.slug);
  if ((await exists(target)) && !(await exists(join(target, MARKER_FILE)))) {
    throw new ExportError(`${target} already exists and was not created by JBeam Forge. Rename or remove it, or choose another mod name.`);
  }
  await mkdir(unpacked, { recursive: true });
  const stamp = Date.now().toString(36);
  const staging = join(unpacked, `.${bundle.slug}.jbforge-new-${stamp}`);
  const backup = join(unpacked, `.${bundle.slug}.jbforge-old-${stamp}`);
  try {
    const bytes = await writeBundleTo(staging, bundle);
    if (await exists(target)) await rename(target, backup);
    await rename(staging, target);
    await rm(backup, { recursive: true, force: true });
    return { path: target, bytes };
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (!(await exists(target)) && (await exists(backup))) await rename(backup, target).catch(() => undefined);
    throw err;
  }
}

/** Write a zip (paths as in the bundle, so it drops straight into mods/). */
export async function writeZip(zipPath: string, bundle: ModBundle, compress = true): Promise<{ path: string; bytes: number }> {
  const zip = new ZipFile();
  const opts = { compress };
  for (const f of bundle.files) zip.addBuffer(f.base64 !== undefined ? Buffer.from(f.base64, 'base64') : Buffer.from(f.text ?? '', 'utf8'), f.path, opts);
  for (const c of bundle.copies) zip.addBuffer(await readFile(c.from), c.to, opts);
  const tmp = `${zipPath}.jbforge-tmp`;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp);
    out.on('close', () => resolve());
    out.on('error', reject);
    zip.outputStream.on('error', reject).pipe(out);
    zip.end();
  });
  await rename(tmp, zipPath);
  return { path: zipPath, bytes: (await stat(zipPath)).size };
}
