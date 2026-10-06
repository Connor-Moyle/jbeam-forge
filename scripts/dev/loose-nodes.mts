/**
 * Nodes of an exported car held by fewer than three beams (counting every part in its folder): on
 * their own car the body added more, and here they dangle. Prints them with their beams.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/loose-nodes.mts <mod>/vehicles/<car> [more…]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';
import { definedNodes, variableDefaults } from '../../src/shared/suspension/transplant';

for (const dir of process.argv.slice(2)) {
  const parts = new Map<string, JbeamObject>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
    const d = parseJbeam(readFileSync(join(dir, f), 'utf8')).value;
    if (isJbeamObject(d)) for (const [n, p] of Object.entries(d)) if (isJbeamObject(p)) parts.set(n, p);
  }
  const vars = variableDefaults([...parts.values()]);
  const owner = new Map<string, string>();
  for (const [n, p] of parts) for (const id of definedNodes(p, vars).keys()) if (!owner.has(id)) owner.set(id, n);
  const links = new Map<string, string[]>();
  for (const p of parts.values()) {
    if (!Array.isArray(p.beams)) continue;
    for (const r of readTable(p.beams).records) {
      const a = r.values['id1:'];
      const b = r.values['id2:'];
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      links.set(a, [...(links.get(a) ?? []), b]);
      links.set(b, [...(links.get(b) ?? []), a]);
    }
  }
  const loose = [...owner].filter(([id, p]) => /_[FREG]\d?_/.test(p) && (links.get(id)?.length ?? 0) > 0 && (links.get(id)?.length ?? 0) < 3);
  console.log(`${basename(dir)}: ${loose.length} borrowed nodes on fewer than three beams`);
  for (const [id, p] of loose) console.log(`  ${id.padEnd(10)} ${p.replace(/^forge_[a-z0-9]+_/, '').padEnd(36)} ← ${links.get(id)!.join(', ')}`);
}
