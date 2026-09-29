/**
 * For the desktop harness: small textures and meshes packs, built into
 * content repositories the same way the real ones are, and a GitHub-like
 * releases list, all under the folder given.
 *
 *   tsx scripts/lib/fake-content.ts <dir> <current app version>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContentRepo } from '../../src/main/content/buildRepo';
import { defaultMaterial } from '../../src/shared/materials/schema';

const [dir, current = '0.12.0'] = process.argv.slice(2);
if (!dir) throw new Error('usage: fake-content.ts <dir> <version>');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DAE = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><up_axis>Z_UP</up_axis></asset>
<library_geometries><geometry id="g"><mesh><source id="p"><float_array id="pa" count="9">0 0 0 0.1 0 0 0 0.1 0</float_array><technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="v"><input semantic="POSITION" source="#p"/></vertices><triangles count="1"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles></mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="s"><node id="caliper" name="caliper"><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#s"/></scene></COLLADA>
`;

const packs = join(dir, 'packs');
for (const [cat, name] of [
  ['Paint', 'Harness Candy Red'],
  ['Paint', 'Harness Pearl White'],
  ['Metals', 'Harness Brushed Steel'],
] as const) {
  const d = join(packs, 'materials', cat, name);
  mkdirSync(join(d, 'textures'), { recursive: true });
  const def = defaultMaterial('x', name.toLowerCase().replace(/\s+/g, '_'));
  def.layers[0]!.maps.baseColorMap = 'textures/color.png';
  writeFileSync(join(d, 'material.json'), JSON.stringify({ version: 1, name, category: cat, def }));
  writeFileSync(join(d, 'textures', 'color.png'), PNG);
}
for (const [cat, name] of [
  ['Brake Calipers', 'Harness Caliper'],
  ['Gauges', 'Harness Gauge'],
] as const) {
  const d = join(packs, 'objects', 'Harness', cat, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'object.json'), JSON.stringify({ version: 1, name, category: cat, group: 'Harness', mesh: 'mesh.dae', material: null }));
  writeFileSync(join(d, 'mesh.dae'), DAE);
}

await buildContentRepo(join(packs, 'materials'), join(dir, 'repos', 'textures'), 'textures', '2.0.0');
await buildContentRepo(join(packs, 'objects'), join(dir, 'repos', 'meshes'), 'meshes', '2.0.0');

// Releases: one newer than the app, the app's own, and one older (to roll back to).
const [maj, min] = current.split('.').map(Number) as [number, number];
const assetsFor = (v: string) => {
  const setup = Buffer.from(`fake installer ${v}`);
  const portable = Buffer.from(`fake portable ${v}`);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets', `JBeam-Forge-Setup-${v}.exe`), setup);
  writeFileSync(join(dir, 'assets', `JBeam-Forge-${v}-portable.exe`), portable);
  return [
    { name: `JBeam-Forge-Setup-${v}.exe`, size: setup.length, browser_download_url: `ASSETS/JBeam-Forge-Setup-${v}.exe` },
    { name: `JBeam-Forge-${v}-portable.exe`, size: portable.length, browser_download_url: `ASSETS/JBeam-Forge-${v}-portable.exe` },
  ];
};
const versions = [`${maj}.${min + 1}.0`, current, `${maj}.${Math.max(0, min - 1)}.0`];
writeFileSync(
  join(dir, 'releases.json'),
  JSON.stringify(versions.map((v, i) => ({ tag_name: `v${v}`, name: `JBeam Forge ${v}`, body: `Notes for ${v}.`, published_at: `2026-09-${String(28 - i).padStart(2, '0')}T00:00:00Z`, prerelease: false, draft: false, assets: assetsFor(v) }))),
);
console.log('fake content ready');
