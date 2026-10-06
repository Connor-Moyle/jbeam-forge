/**
 * The stability predictor over an exported car as the game assembles it: every part in its folder,
 * each node once (the first definition), every beam on it. Prints the nodes past the "ok" limit,
 * worst first, with the part that defines them and their heaviest beams.
 *
 *   npx tsx scripts/dev/stability-of-mod.mts <mod>/vehicles/<car> [more cars…]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';
import { coordinate, variableDefaults } from '../../src/shared/suspension/transplant';
import { STABILITY_DT, STABILITY_OK } from '../../src/shared/proxy/derive';

for (const dir of process.argv.slice(2)) {
  const parts = new Map<string, JbeamObject>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
    const doc = parseJbeam(readFileSync(join(dir, f), 'utf8')).value;
    if (isJbeamObject(doc)) for (const [n, p] of Object.entries(doc)) if (isJbeamObject(p)) parts.set(n, p);
  }
  const vars = variableDefaults([...parts.values()]);
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : typeof v === 'string' && v.startsWith('$') ? (Number.isFinite(coordinate(v, vars)) ? coordinate(v, vars) : d) : d);
  const weight = new Map<string, { w: number; part: string }>();
  for (const [name, p] of parts) {
    if (!Array.isArray(p.nodes)) continue;
    for (const r of readTable(p.nodes).records) if (typeof r.values.id === 'string' && !weight.has(r.values.id)) weight.set(r.values.id, { w: num(r.options.nodeWeight, 25), part: name });
  }
  const springs = new Map<string, { k: number; beams: [string, number, string][] }>();
  for (const [name, p] of parts) {
    if (!Array.isArray(p.beams)) continue;
    for (const r of readTable(p.beams).records) {
      const a = r.values['id1:'];
      const b = r.values['id2:'];
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      const k = num(r.options.beamSpring, 4_300_000);
      if (!(k > 0)) continue;
      for (const [x, y] of [[a, b], [b, a]] as const) {
        const s = springs.get(x) ?? { k: 0, beams: [] };
        s.k += k;
        s.beams.push([y, k, name]);
        springs.set(x, s);
      }
    }
  }
  const rows = [...weight].flatMap(([id, { w, part }]) => {
    const s = springs.get(id);
    return s && w > 0 ? [{ id, w, part, k: s.k, ratio: Math.sqrt(s.k / w) * STABILITY_DT, beams: s.beams }] : [];
  });
  rows.sort((a, b) => b.ratio - a.ratio);
  const bad = rows.filter((r) => r.ratio > STABILITY_OK);
  console.log(`\n${basename(dir)}: ${rows.length} nodes, ${bad.length} past ${STABILITY_OK}`);
  for (const r of bad.slice(0, 12)) {
    const top = [...r.beams].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([to, k, p]) => `${to} ${(k / 1e6).toFixed(1)}M (${p.replace(/^forge_[a-z0-9]+_/, '')})`);
    console.log(`  ${r.id.padEnd(10)} ${r.ratio.toFixed(2)}  ${r.w} kg  Σk ${(r.k / 1e6).toFixed(1)}M  ${r.part.replace(/^forge_[a-z0-9]+_/, '')}  ← ${top.join(', ')}`);
  }
}
