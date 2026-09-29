/**
 * Build the two optional content repositories the app downloads from:
 *
 *   npm run build-content-repos -- [--textures packs/materials] [--meshes packs/objects] [--out release/content] [--version 2026.09.29]
 *
 * Writes <out>/textures and <out>/meshes, each a ready-to-push repository
 * (manifest.json, items/*.zip, README.md). Push each to its GitHub
 * repository and tag it v<version>; see docs/content-repos.md.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { BUILT_IN_TEMPLATES } from '../src/shared/lua/library';
import { templateToLibrary } from '../src/shared/lua/library/share';
import { join, resolve } from 'node:path';
import { buildContentRepo, repoBytes } from '../src/main/content/buildRepo';
import type { ContentKind } from '../src/shared/content/manifest';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
const version = arg('version', today);
const out = resolve(arg('out', join('release', 'content')));
const sources: Record<ContentKind, string> = { textures: resolve(arg('textures', join('packs', 'materials'))), meshes: resolve(arg('meshes', join('packs', 'objects'))), scripts: resolve(arg('scripts', join('packs', 'scripts'))) };
// No scripts folder yet: start the scripts repository with the app's own templates.
if (!existsSync(sources.scripts)) {
  const seed = join(out, '.scripts-seed');
  rmSync(seed, { recursive: true, force: true });
  for (const t of BUILT_IN_TEMPLATES) {
    const dir = join(seed, t.category.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase(), t.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'script.jbscript'), `${JSON.stringify(templateToLibrary(t), null, 2)}\n`);
    writeFileSync(join(dir, `${t.name0}.lua`), t.lua);
  }
  sources.scripts = seed;
}
const WHAT: Record<ContentKind, { what: string; tab: string; item: string }> = {
  textures: { what: 'materials and textures', tab: 'Textures', item: 'material' },
  meshes: { what: 'meshes (calipers, discs, gauges, suspension parts…)', tab: 'Meshes', item: 'object' },
  scripts: { what: 'vehicle scripts (Lua functions to add to any car)', tab: 'Scripts', item: 'script' },
};

const readme = (kind: ContentKind, count: number) => `# JBeam Forge ${kind}

The optional ${WHAT[kind].what} JBeam Forge downloads from inside the app
(Downloads → ${WHAT[kind].tab}). ${count} items, version ${version}.

- \`manifest.json\`: every item, with its folder, size and SHA-256.
- \`items/<id>.zip\`: one ${WHAT[kind].item} folder each.

Each release is tagged \`v<version>\`, so the app can download any earlier version too.
Built with \`npm run build-content-repos\` in the JBeam Forge repository.
`;

for (const kind of ['textures', 'meshes', 'scripts'] as const) {
  if (!existsSync(sources[kind])) {
    console.log(`${kind}: no source folder at ${sources[kind]}, skipped`);
    continue;
  }
  const dir = join(out, kind);
  mkdirSync(dir, { recursive: true });
  const { manifest, skipped } = await buildContentRepo(sources[kind], dir, kind, version, (l) => console.log(`  ${l}`));
  writeFileSync(join(dir, 'README.md'), readme(kind, manifest.items.length));
  writeFileSync(join(dir, '.gitattributes'), '*.zip binary\n');
  for (const s of skipped) console.warn(`  skipped ${s}`);
  console.log(`${kind}: ${manifest.items.length} items, ${(repoBytes(dir) / 1e6).toFixed(1)} MB → ${dir}`);
}
