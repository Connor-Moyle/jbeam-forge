/**
 * Work one of the game's suspensions through its travel, from the parts library:
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/sweep-set.mts <sets folder> <vehicle/part>…
 *
 * The sets folder is <user data>/library-scan/beamng/parts/sets.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sweepSummary, sweepSuspension } from '../../src/shared/suspension/sweep';

const [dir, ...ids] = process.argv.slice(2);
for (const id of ids) {
  const parts = JSON.parse(readFileSync(join(dir!, id, 'jbeam.json'), 'utf8'));
  const anchors = JSON.parse(readFileSync(join(dir!, id, 'anchors.json'), 'utf8'));
  const started = Date.now();
  const r = sweepSuspension(parts, anchors);
  console.log(`${id} (${Date.now() - started} ms)${r.problem ? `: ${r.problem}` : ''}`);
  for (const w of r.wheels) console.log(`  ${w.wheel}: ${w.points.map((p) => `${p.load}N ${p.travel}mm c${p.camber} t${p.toeIn}`).join(' | ')}`);
  const s = sweepSummary(r);
  if (s) console.log(`  travel ${s.travel} mm, camber change ${s.camberChange}°, toe change ${s.toeChange}°`);
}
