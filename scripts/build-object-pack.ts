/**
 * Build the downloadable objects pack from a folder of object sets.
 *
 *   npm run build-object-pack -- "Objects Libary"
 *     → packs/objects/ (bundled with the app) + release/JBeam-Forge-Objects-<version>.zip
 *
 * The scanning rules live in src/main/library/objectScan.ts (the app runs the
 * same scan over the user's own folders at startup).
 */
import { createWriteStream, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ZipFile } from 'yazl';
import { scanObjects, writeObjectPack } from '../src/main/library/objectScan';

const root = resolve(process.argv[2] ?? 'Objects Libary');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const zipOut = resolve('release', `JBeam-Forge-Objects-${version}.zip`);
const folderOut = resolve('packs', 'objects');

const objects = scanObjects(root);
mkdirSync(dirname(zipOut), { recursive: true });
const zip = new ZipFile();
writeObjectPack(objects, folderOut, `JBeam Forge objects ${version}`, (entry, data) => zip.addBuffer(data, entry));
for (const o of objects) console.log(`${`${o.group} › ${o.category}`.padEnd(34)} ${o.name.padEnd(22)} ${o.textures.length} textures`);
zip.end();
await new Promise<void>((res, rej) => {
  const s = createWriteStream(zipOut);
  s.on('close', () => res());
  s.on('error', rej);
  zip.outputStream.pipe(s);
});
console.log(`
${objects.length} objects → ${zipOut} (${(statSync(zipOut).size / 1e6).toFixed(1)} MB), bundled copy in ${folderOut}`);
