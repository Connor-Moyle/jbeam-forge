#!/usr/bin/env node
/**
 * Builds what JBeam Forge downloads from this repository:
 *
 *   node tools/build.mjs [--out out] [--version 2026.10.06.1] [--check]
 *
 * For each of textures/, meshes/ and scripts/ it writes <out>/<kind>/manifest.json and
 * <out>/<kind>/items/<id>.zip, one zip per material, object or script folder. The GitHub
 * workflow runs this on every push to main and publishes <out> as the "downloads" branch.
 * --check only reads every folder and reports problems (nothing is written).
 *
 * Zips are deterministic (sorted files, fixed timestamps), so an item that didn't change keeps
 * its hash and isn't downloaded again. Item ids come from the folder path: renaming or moving a
 * folder makes it a new item. This must match JBeam Forge's own builder
 * (src/main/content/buildRepo.ts); the app's tests check that it does.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = ['textures', 'meshes', 'scripts'];
const MARKER = { textures: 'material.json', meshes: 'object.json', scripts: 'script.jbscript' };
const FIXED_TIME = new Date('2020-01-01T00:00:00Z');
const MAX_ZIP = 95 * 1024 * 1024; // GitHub refuses files over 100 MB

// eslint-disable-next-line no-control-regex -- control characters are exactly what's refused
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

export function isSafeDir(dir) {
  const parts = dir.split('/');
  return parts.length >= 1 && parts.length <= 6 && parts.every((p) => p.length > 0 && p.length <= 100 && !BAD_CHARS.test(p) && !RESERVED.test(p) && !p.startsWith('.') && !p.endsWith('.') && p.trim() === p);
}

function walkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

/** Folders holding the kind's marker file, relative to `root` with forward slashes. */
export function contentFolders(root, kind) {
  const out = [];
  const walk = (d, depth) => {
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
export function itemId(dir) {
  const hash = createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 8);
  const slug = dir
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  return `${slug || 'item'}-${hash}`;
}

async function zipFolder(ZipFile, folder, out) {
  const zip = new ZipFile();
  let unpacked = 0;
  const files = walkFiles(folder);
  for (const f of files) {
    const data = readFileSync(f);
    unpacked += data.length;
    zip.addBuffer(data, relative(folder, f).split(sep).join('/'), { mtime: FIXED_TIME, mode: 0o100644 });
  }
  zip.end();
  await new Promise((res, rej) => {
    const s = createWriteStream(out);
    s.on('close', () => res());
    s.on('error', rej);
    zip.outputStream.pipe(s);
  });
  return { files: files.length, unpacked };
}

function readMeta(folder, kind) {
  const meta = JSON.parse(readFileSync(join(folder, MARKER[kind]), 'utf8'));
  return meta && typeof meta === 'object' ? meta : {};
}

/** Problems in one folder that would stop it downloading or loading. */
function folderProblems(source, kind, dir) {
  const problems = [];
  if (!isSafeDir(dir)) problems.push(`${kind}/${dir}: the folder name can't be unpacked on every system (no < > : " | ? *, no leading dot, at most 6 levels)`);
  const folder = join(source, ...dir.split('/'));
  let meta = null;
  try {
    meta = readMeta(folder, kind);
  } catch (err) {
    problems.push(`${kind}/${dir}/${MARKER[kind]}: not valid JSON (${err.message})`);
  }
  if (meta) {
    if (kind === 'meshes' && typeof meta.mesh === 'string' && !existsSync(join(folder, meta.mesh))) problems.push(`${kind}/${dir}: object.json names the mesh "${meta.mesh}", which isn't in the folder`);
    if (kind !== 'scripts' && typeof meta.name !== 'string') problems.push(`${kind}/${dir}/${MARKER[kind]}: has no "name"`);
  }
  const files = walkFiles(folder);
  if (files.length > 10000) problems.push(`${kind}/${dir}: more than 10,000 files`);
  return problems;
}

/** Write <out>/manifest.json and <out>/items/*.zip for the folder `source`. */
export async function buildKind(ZipFile, source, out, kind, version, log = () => undefined) {
  rmSync(join(out, 'items'), { recursive: true, force: true });
  mkdirSync(join(out, 'items'), { recursive: true });
  const items = [];
  const skipped = [];
  for (const dir of contentFolders(source, kind)) {
    const problems = folderProblems(source, kind, dir);
    if (problems.length) {
      skipped.push(...problems);
      continue;
    }
    const folder = join(source, ...dir.split('/'));
    const meta = readMeta(folder, kind);
    const id = itemId(dir);
    const zipPath = join(out, 'items', `${id}.zip`);
    const { files, unpacked } = await zipFolder(ZipFile, folder, zipPath);
    const bytes = readFileSync(zipPath);
    if (bytes.length > MAX_ZIP) {
      rmSync(zipPath);
      skipped.push(`${kind}/${dir}: ${(bytes.length / 1e6).toFixed(0)} MB zipped, over GitHub's limit; make its textures smaller`);
      continue;
    }
    // A script's display name is its label (its name is the controller's).
    const shown = typeof meta.label === 'string' && meta.label.trim() ? meta.label : meta.name;
    const name = typeof shown === 'string' && shown.trim() ? shown.trim().slice(0, 120) : dir.split('/').pop().slice(0, 120);
    const category = typeof meta.category === 'string' ? meta.category.slice(0, 80) : dir.split('/')[0].slice(0, 80);
    items.push({ id, name, category, ...(typeof meta.group === 'string' ? { group: meta.group.slice(0, 80) } : {}), dir, path: `items/${id}.zip`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files, unpacked });
    log(`  ${category.padEnd(20)} ${name.padEnd(40)} ${files} files, ${(bytes.length / 1e6).toFixed(2)} MB`);
  }
  const manifest = { format: 1, kind, version, generated: new Date().toISOString(), items };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  return { manifest, skipped };
}

function sameFolderTwice(root) {
  const problems = [];
  for (const kind of KINDS) {
    const source = join(root, kind);
    if (!existsSync(source)) continue;
    const dirs = contentFolders(source, kind).map((d) => `${d.toLowerCase()}/`);
    const seen = new Set();
    for (const d of dirs) {
      if (seen.has(d)) problems.push(`${kind}/${d}: two folders differ only in upper/lower case`);
      seen.add(d);
    }
    const sorted = [...dirs].sort();
    for (let k = 1; k < sorted.length; k++) if (sorted[k].startsWith(sorted[k - 1])) problems.push(`${kind}/${sorted[k]}: inside another item's folder`);
  }
  return problems;
}

async function main() {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const version = arg('version', today);
  const check = process.argv.includes('--check');
  const problems = sameFolderTwice(root);
  if (check) {
    for (const kind of KINDS) {
      const source = join(root, kind);
      if (!existsSync(source)) continue;
      const dirs = contentFolders(source, kind);
      for (const dir of dirs) problems.push(...folderProblems(source, kind, dir));
      console.log(`${kind}: ${dirs.length} items`);
    }
  } else {
    const { ZipFile } = await import('yazl');
    const out = resolve(arg('out', join(root, 'out')));
    for (const kind of KINDS) {
      const source = join(root, kind);
      if (!existsSync(source)) continue;
      console.log(`${kind}:`);
      const { manifest, skipped } = await buildKind(ZipFile, source, join(out, kind), kind, version, (l) => console.log(l));
      problems.push(...skipped);
      const total = manifest.items.reduce((n, i) => n + i.size, 0);
      console.log(`${kind}: ${manifest.items.length} items, ${(total / 1e6).toFixed(1)} MB`);
    }
    writeFileSync(join(out, 'README.md'), `# JBeam Forge downloads ${version}\n\nBuilt automatically from the main branch. JBeam Forge reads this branch; nothing here is edited by hand.\n`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} (these folders are left out until fixed):`);
    for (const p of problems) console.error(`  - ${p}`);
    if (check) process.exitCode = 1;
  } else console.log('\nNo problems.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
