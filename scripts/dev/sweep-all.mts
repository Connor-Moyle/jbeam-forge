/**
 * How many of the game's suspensions the travel rig can work, and what it says of each:
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/sweep-all.mts <sets folder> [vehicle regex]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sweepSummary, sweepSuspension } from '../../src/shared/suspension/sweep';

const [dir, only = '.'] = process.argv.slice(2);
const why = new Map<string, number>();
let worked = 0;
let total = 0;
for (const vehicle of readdirSync(dir!).filter((v) => !v.startsWith('_') && new RegExp(only).test(v))) {
  for (const part of readdirSync(join(dir!, vehicle))) {
    const folder = join(dir!, vehicle, part);
    if (!existsSync(join(folder, 'set.json'))) continue;
    const set = JSON.parse(readFileSync(join(folder, 'set.json'), 'utf8'));
    if (set.kind !== 'suspension') continue;
    total++;
    const r = sweepSuspension(JSON.parse(readFileSync(join(folder, 'jbeam.json'), 'utf8')), JSON.parse(readFileSync(join(folder, 'anchors.json'), 'utf8')));
    const s = sweepSummary(r);
    if (s) {
      worked++;
      console.log(`${vehicle}/${part}: travel ${s.travel} mm, camber ${s.camberChange}°, toe ${s.toeChange}°`);
    } else why.set(r.problem!.slice(0, 60), (why.get(r.problem!.slice(0, 60)) ?? 0) + 1);
  }
}
console.log(`\n${worked} of ${total} worked`);
for (const [k, n] of why) console.log(`  ${n}: ${k}…`);
