/**
 * The powertrain of an exported car as the game wires it: every device, what it takes its input
 * from, and the parts that define them. A device whose input names no other device breaks the chain.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/powertrain-chain.mts <mod>/vehicles/<car>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';

const dir = process.argv[2]!;
const pc = JSON.parse(readFileSync(join(dir, 'default.pc'), 'utf8')) as { parts: Record<string, string> };
const installed = new Set(Object.values(pc.parts));
const devices: { type: string; name: string; input: string; gear: unknown; part: string; inPc: boolean }[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
  const doc = parseJbeam(readFileSync(join(dir, f), 'utf8')).value;
  if (!isJbeamObject(doc)) continue;
  for (const [name, p] of Object.entries(doc)) {
    if (!isJbeamObject(p) || !Array.isArray(p.powertrain)) continue;
    for (const r of readTable(p.powertrain).records) devices.push({ type: String(r.values.type), name: String(r.values.name), input: String(r.values.inputName), gear: r.values.inputIndex, part: name.replace(/^forge_[a-z0-9]+_/, ''), inPc: installed.has(name) });
  }
}
const names = new Set(devices.map((d) => d.name));
for (const d of devices) console.log(`${d.name.padEnd(22)} ${d.type.padEnd(20)} ← ${d.input.padEnd(18)}${names.has(d.input) || d.input === 'dummy' ? '' : ' (NO SUCH DEVICE)'}  ${d.part}`);
