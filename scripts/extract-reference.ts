#!/usr/bin/env tsx
/**
 * Extract an official vehicle's meshes + the textures its DAE references into
 * scratch/test-models/<vehicle>/ — the local, never-committed test model
 * (Phase 3 decision: the Hirochi Sunburst is the reference test car).
 *
 * Usage: npm run extract-reference -- sunburst2 [--dir=<install>]
 *
 * Textures are matched the way the importer does it (same file name, then the
 * same stem as .dds), searched in the vehicle zip first, then common.zip.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withZip, type ZipReader } from '../src/main/beamng/zip';
import { textureCandidates } from '../src/main/import/textures';
import { describeInstall, resolveInstallDir } from './lib/installDir';

const argv = process.argv.slice(2);
const vehicle = argv.find((a) => !a.startsWith('--'));
if (!vehicle) {
  console.error('Usage: npm run extract-reference -- <vehicle> [--dir=<install>]   (e.g. sunburst2)');
  process.exit(1);
}
const install = await resolveInstallDir(argv);
console.log(`BeamNG install: ${describeInstall(install)}`);
const vehiclesDir = join(install.dir, 'content', 'vehicles');
const outDir = join(process.cwd(), 'scratch', 'test-models', vehicle);
await mkdir(outDir, { recursive: true });

async function index(zip: ZipReader): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const e of await zip.entries()) {
    const name = e.name.split('/').pop()!.toLowerCase();
    if (!byName.has(name)) byName.set(name, e.name);
  }
  return byName;
}

const refs = new Set<string>();
await withZip(join(vehiclesDir, `${vehicle}.zip`), async (zip) => {
  const daes = (await zip.entries()).filter((e) => e.name.startsWith(`vehicles/${vehicle}/`) && e.name.toLowerCase().endsWith('.dae'));
  for (const e of daes) {
    const text = await zip.readText(e.name, 512 * 1024 * 1024);
    const file = join(outDir, e.name.split('/').pop()!);
    await writeFile(file, text);
    // Only <image> elements name files; <init_from> inside effects references image ids.
    for (const m of text.matchAll(/<image\b[^>]*>\s*<init_from>([^<]+)<\/init_from>/g)) refs.add(m[1]!.trim());
    console.log(`  mesh    ${e.name} (${(e.size / 1e6).toFixed(1)} MB)`);
  }
});

const pending = new Map([...refs].map((r) => [r, textureCandidates(r).names] as const));
const found: string[] = [];
for (const zipName of [`${vehicle}.zip`, 'common.zip']) {
  if (pending.size === 0) break;
  await withZip(join(vehiclesDir, zipName), async (zip) => {
    const byName = await index(zip);
    for (const [ref, names] of [...pending]) {
      const hit = names.map((n) => byName.get(n)).find(Boolean);
      if (!hit) continue;
      const dest = join(outDir, zipName === 'common.zip' ? 'common' : '', hit.split('/').pop()!);
      await mkdir(join(dest, '..'), { recursive: true });
      await writeFile(dest, await zip.readBuffer(hit));
      found.push(`${ref} → ${zipName}:${hit}`);
      pending.delete(ref);
    }
  });
}

for (const f of found) console.log(`  texture ${f}`);
console.log(`\n${found.length}/${refs.size} referenced textures extracted → ${outDir}`);
if (pending.size) console.log(`Not found in ${vehicle}.zip or common.zip: ${[...pending.keys()].join(', ')}`);
