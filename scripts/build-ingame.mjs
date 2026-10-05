#!/usr/bin/env node
/**
 * Build JBeam Forge for inside BeamNG.drive and assemble the mod:
 *
 *   npm run build:ingame        → release/ingame/jbeam_forge/ (unpacked) and release/jbeam_forge_ingame.zip
 *
 * The mod: the game side (ingame/mod: Lua, the F10 key, the screen's Vue wrapper), the app's
 * screens built as one module (vite.ingame.config.ts → forge.mjs, forge.css and its workers) and
 * the practice car. Drop the zip in the game's mods folder, or the folder in mods/unpacked.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const out = join(ROOT, 'release', 'ingame', 'jbeam_forge');
const ui = join(out, 'ui', 'ui-vue', 'mods', 'jbeamForge');

execFileSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.ingame.config.ts'], { cwd: ROOT, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(ROOT, 'ingame', 'mod'), out, { recursive: true });
cpSync(join(ROOT, 'out', 'ingame'), ui, { recursive: true });
cpSync(join(ROOT, 'assets', 'demo-car'), join(ui, 'demo-car'), { recursive: true });

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(out);
const zipPath = join(ROOT, 'release', 'jbeam_forge_ingame.zip');
await new Promise((resolve, reject) => {
  const zip = new yazl.ZipFile();
  for (const f of files) zip.addFile(f, relative(out, f).split('\\').join('/'));
  zip.end();
  zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
});
const size = statSync(zipPath).size;
console.log(`JBeam Forge for the game: ${files.length} files → ${relative(ROOT, zipPath)} (${(size / 1e6).toFixed(1)} MB)`);
if (!existsSync(join(ui, 'forge.mjs'))) throw new Error('forge.mjs missing from the mod');
