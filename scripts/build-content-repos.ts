/**
 * Build the two optional content repositories the app downloads from:
 *
 *   npm run build-content-repos -- [--textures packs/materials] [--meshes packs/objects] [--out release/content] [--version 2026.09.29]
 *
 * Writes <out>/textures and <out>/meshes, each a ready-to-push repository
 * (manifest.json, items/*.zip, README.md). Push each to its GitHub
 * repository and tag it v<version>; see docs/content-repos.md.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
const sources: Record<ContentKind, string> = { textures: resolve(arg('textures', join('packs', 'materials'))), meshes: resolve(arg('meshes', join('packs', 'objects'))) };

const readme = (kind: ContentKind, count: number) => `# JBeam Forge ${kind}

The optional ${kind === 'textures' ? 'materials and textures' : 'meshes (calipers, discs, gauges, suspension parts…)'} JBeam Forge downloads from inside the app
(Downloads → ${kind === 'textures' ? 'Textures' : 'Meshes'}). ${count} items, version ${version}.

- \`manifest.json\`: every item, with its folder, size and SHA-256.
- \`items/<id>.zip\`: one ${kind === 'textures' ? 'material' : 'object'} folder each.

Each release is tagged \`v<version>\`, so the app can download any earlier version too.
Built with \`npm run build-content-repos\` in the JBeam Forge repository.
`;

for (const kind of ['textures', 'meshes'] as const) {
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
