/**
 * Where groups of an exported car's parts reach: the box round the nodes of every part whose name
 * matches each pattern. For checking a fit (does the engine clear the bonnet, the sump the ground).
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/node-range.mts <vehicle folder> <name regex> [more…]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject } from '../../src/shared/jbeam/parse';
import { definedNodes, variableDefaults } from '../../src/shared/suspension/transplant';

const [dir, ...patterns] = process.argv.slice(2);
if (!dir || !patterns.length) {
  console.error('usage: node-range.mts <vehicle folder> <name regex> [more…]');
  process.exit(2);
}
const parts: Record<string, JbeamObject> = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.jbeam'))) {
  const v = parseJbeam(readFileSync(join(dir, f), 'utf8')).value;
  if (isJbeamObject(v)) for (const [k, p] of Object.entries(v)) if (isJbeamObject(p)) parts[k] = p;
}
const vars = variableDefaults(Object.values(parts));
for (const pattern of patterns) {
  const re = new RegExp(pattern);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  let top = '';
  for (const [name, p] of Object.entries(parts)) {
    if (!re.test(name)) continue;
    for (const [id, pos] of definedNodes(p, vars)) {
      count++;
      if (pos[2] > hi[2]!) top = `${id} (${name})`;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, pos[k]!);
        hi[k] = Math.max(hi[k]!, pos[k]!);
      }
    }
  }
  console.log(`${pattern}: ${count} nodes; x ${lo[0]!.toFixed(2)}…${hi[0]!.toFixed(2)}, y ${lo[1]!.toFixed(2)}…${hi[1]!.toFixed(2)}, z ${lo[2]!.toFixed(2)}…${hi[2]!.toFixed(2)}; highest ${top}`);
}
