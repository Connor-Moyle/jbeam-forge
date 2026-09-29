import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ZipFile } from 'yazl';
import { CONTENT_FORMAT, ContentManifestSchema, isSafeDir, manifestProblems, type ContentItem, type ContentKind, type ContentManifest } from '@shared/content/manifest';

/**
 * Builds a content repository (textures or meshes) from a pack folder: one
 * zip per material or object folder, and manifest.json. Zips are
 * deterministic (sorted entries, fixed timestamps), so an unchanged item
 * keeps its hash from one version to the next and isn't downloaded again.
 */

const MARKER: Record<ContentKind, string> = { textures: 'material.json', meshes: 'object.json', scripts: 'script.jbscript' };
const FIXED_TIME = new Date('2020-01-01T00:00:00Z');

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

/** Folders holding the kind's marker file, relative to `root` with forward slashes. */
export function contentFolders(root: string, kind: ContentKind): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 6) return;
    const entries = readdirSync(d, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === MARKER[kind])) {
      out.push(relative(root, d).split(sep).join('/'));
      return;
    }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) walk(join(d, e.name), depth + 1);
  };
  walk(root, 0);
  return out.sort();
}

/** A stable id from the folder: readable slug plus a short hash (so similar names never collide). */
export function itemId(dir: string): string {
  const hash = createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 8);
  const slug = dir
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  return `${slug || 'item'}-${hash}`;
}

async function zipFolder(folder: string, out: string): Promise<{ files: number; unpacked: number }> {
  const zip = new ZipFile();
  let unpacked = 0;
  const files = walkFiles(folder);
  for (const f of files) {
    const data = readFileSync(f);
    unpacked += data.length;
    zip.addBuffer(data, relative(folder, f).split(sep).join('/'), { mtime: FIXED_TIME, mode: 0o100644 });
  }
  zip.end();
  await new Promise<void>((res, rej) => {
    const s = createWriteStream(out);
    s.on('close', () => res());
    s.on('error', rej);
    zip.outputStream.pipe(s);
  });
  return { files: files.length, unpacked };
}

export interface BuildResult {
  manifest: ContentManifest;
  skipped: string[];
}

/** Write <out>/manifest.json and <out>/items/*.zip for the pack at `source`. */
export async function buildContentRepo(source: string, out: string, kind: ContentKind, version: string, log: (line: string) => void = () => undefined): Promise<BuildResult> {
  rmSync(join(out, 'items'), { recursive: true, force: true });
  mkdirSync(join(out, 'items'), { recursive: true });
  const items: ContentItem[] = [];
  const skipped: string[] = [];
  for (const dir of contentFolders(source, kind)) {
    if (!isSafeDir(dir)) {
      skipped.push(`${dir}: folder name can't be unpacked safely on every system`);
      continue;
    }
    const folder = join(source, ...dir.split('/'));
    let meta: { name?: unknown; label?: unknown; category?: unknown; group?: unknown };
    try {
      meta = JSON.parse(readFileSync(join(folder, MARKER[kind]), 'utf8')) as typeof meta;
    } catch (err) {
      skipped.push(`${dir}: ${MARKER[kind]} unreadable (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const id = itemId(dir);
    const path = `items/${id}.zip`;
    const zipPath = join(out, 'items', `${id}.zip`);
    const { files, unpacked } = await zipFolder(folder, zipPath);
    const bytes = readFileSync(zipPath);
    // A script's display name is its label (its name is the controller's).
    const shown = typeof meta.label === 'string' && meta.label.trim() ? meta.label : meta.name;
    const name = typeof shown === 'string' && shown.trim() ? shown.trim().slice(0, 120) : dir.split('/').pop()!.slice(0, 120);
    const category = typeof meta.category === 'string' ? meta.category.slice(0, 80) : dir.split('/')[0]!.slice(0, 80);
    items.push({ id, name, category, ...(typeof meta.group === 'string' ? { group: meta.group.slice(0, 80) } : {}), dir, path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files, unpacked });
    log(`${category.padEnd(20)} ${name.padEnd(40)} ${files} files, ${(bytes.length / 1e6).toFixed(2)} MB`);
  }
  const manifest = ContentManifestSchema.parse({ format: CONTENT_FORMAT, kind, version, generated: new Date().toISOString(), items });
  const problems = manifestProblems(manifest);
  if (problems.length) throw new Error(`The ${kind} repository would be inconsistent:\n${problems.join('\n')}`);
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  return { manifest, skipped };
}

/** Total size of a built repository's zips. */
export function repoBytes(out: string): number {
  return readdirSync(join(out, 'items')).reduce((n, f) => n + statSync(join(out, 'items', f)).size, 0);
}
