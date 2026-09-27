/**
 * Build the downloadable material pack from a folder of material sets.
 *
 *   npm run build-material-pack -- "Materials Libary"
 *     → packs/materials/ (bundled with the app) + release/JBeam-Forge-Materials-<version>.zip
 *
 * The scanning rules live in src/main/library/materialScan.ts (the app runs
 * the same scan over the user's own folders at startup).
 */
import { createWriteStream, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ZipFile } from 'yazl';
import { scanMaterials, writeMaterialPack } from '../src/main/library/materialScan';

const root = resolve(process.argv[2] ?? 'Materials Libary');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const out = resolve('release', `JBeam-Forge-Materials-${version}.zip`);
// The unpacked copy is also what the installer bundles (electron-builder extraResources).
const folderOut = resolve('packs', 'materials');

const built = scanMaterials(root);
mkdirSync(dirname(out), { recursive: true });
const zip = new ZipFile();
writeMaterialPack(built, folderOut, `JBeam Forge materials ${version}`, (entry, data) => zip.addBuffer(data, entry));
for (const b of built) console.log(`${b.category.padEnd(11)} ${b.name.padEnd(28)} ${b.textures.length} textures  [${b.textures.map((t) => t.role).join(', ') || 'values only'}]`);
zip.end();
await new Promise<void>((res, rej) => {
  const s = createWriteStream(out);
  s.on('close', () => res());
  s.on('error', rej);
  zip.outputStream.pipe(s);
});
console.log(`
${built.length} materials → ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB), browsable copy in ${folderOut}`);
