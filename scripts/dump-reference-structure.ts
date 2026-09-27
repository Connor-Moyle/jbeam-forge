/**
 * Dump an official configuration's nodes and beams (selected part kinds) to a
 * local JSON for the visual comparison overlay (scripts/visual-structure.mjs).
 * Local only: the output stays in scratch/ and is never committed.
 *
 *   npm run dump-reference -- sunburst2 base_CVT "body|hood|door|fender|bumper|trunk|glass|windshield|quarter|sideskirt"
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject, type JbeamValue } from '../src/shared/jbeam/parse';
import { readTable } from '../src/shared/jbeam/tables';
/** Table cell as text (ids and mesh names are strings in valid jbeam). */
function str(v: JbeamValue | undefined): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? `${v}` : JSON.stringify(v ?? null);
}


const [id = 'sunburst2', config = 'base_CVT', pattern = 'body|hood|door|fender|bumper|trunk|glass|windshield|quarter|sideskirt'] = process.argv.slice(2);
const dir = resolve(import.meta.dirname, '..', 'scratch', 'vehicle-study', id);
const re = new RegExp(pattern);
const parts = new Map<string, JbeamObject>();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.jbeam'))) {
  try {
    const v = parseJbeam(readFileSync(join(dir, f), 'utf8')).value;
    if (isJbeamObject(v)) for (const [k, p] of Object.entries(v)) if (isJbeamObject(p)) parts.set(k, p);
  } catch {
    /* skip */
  }
}
const pc = JSON.parse(readFileSync(join(dir, `${config}.pc`), 'utf8')) as { parts: Record<string, string> };
const installed = new Set(Object.values(pc.parts).filter((p) => p && re.test(p)));
const nodes: { id: string; pos: [number, number, number]; part: string }[] = [];
const beams: [string, string][] = [];
for (const name of installed) {
  const p = parts.get(name);
  if (!p) continue;
  try {
    if (p.nodes) for (const r of readTable(p.nodes).records) nodes.push({ id: str(r.values.id), pos: [Number(r.values.posX), Number(r.values.posY), Number(r.values.posZ)], part: name });
    if (p.beams) for (const r of readTable(p.beams).records) beams.push([str(r.values['id1:']), str(r.values['id2:'])]);
  } catch {
    /* skip odd tables */
  }
}
const out = join(dir, 'reference-structure.json');
writeFileSync(out, JSON.stringify({ config, parts: [...installed], nodes, beams }));
console.log(`${installed.size} parts, ${nodes.length} nodes, ${beams.length} beams → ${out}`);
