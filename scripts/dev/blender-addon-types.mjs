#!/usr/bin/env node
/**
 * Write JBeam Forge's part types into the Blender add-on (tools/blender/jbeam_forge_blender.py),
 * between its BEGIN TYPES and END TYPES lines. Run after changing the taxonomy;
 * tests/shared/blenderAddon.test.ts fails while they differ.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const file = resolve(ROOT, 'tools', 'blender', 'jbeam_forge_blender.py');
const taxonomy = JSON.parse(readFileSync(resolve(ROOT, 'src', 'shared', 'taxonomy', 'taxonomy.json'), 'utf8'));

export function typesBlock(entries) {
  const py = (s) => JSON.stringify(String(s));
  const rows = entries.filter((e) => !['suspension_set', 'engine_set', 'gearbox_set'].includes(e.id)).map((e) => `    (${py(e.id)}, ${py(e.label)}, ${py(e.category)}),`);
  return ['# BEGIN TYPES', 'TYPES = [', ...rows, ']', '# END TYPES'].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const text = readFileSync(file, 'utf8');
  const next = text.replace(/# BEGIN TYPES[\s\S]*?# END TYPES/, typesBlock(taxonomy.entries));
  writeFileSync(file, next);
  console.log(`blender add-on: ${taxonomy.entries.length} part types written`);
}
