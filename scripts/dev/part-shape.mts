/**
 * The shape of a part's node cloud: how far it reaches along its three principal axes, and its
 * nodes laid out (along, across, depth). A panel that is all one layer has next to no depth, and
 * nothing to resist bending with; the game's panels carry nodes off the skin for that.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/part-shape.mts <vehicle folder | vehicle.zip> <part name> [more parts…]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { isJbeamObject, parseJbeam, type JbeamObject } from '../../src/shared/jbeam/parse';
import { principalAxes } from '../../src/shared/proxy/shapes';
import { definedNodes, variableDefaults } from '../../src/shared/suspension/transplant';

const [src, ...names] = process.argv.slice(2);
if (!src || !existsSync(src) || !names.length) {
  console.error('usage: part-shape.mts <vehicle folder | vehicle.zip> <part name> [more parts…]');
  process.exit(2);
}

function zipTexts(file: string): Promise<string[]> {
  return new Promise((res, rej) => {
    const out: string[] = [];
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return rej(err ?? new Error('not a zip'));
      zip.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.endsWith('.jbeam')) return zip.readEntry();
        zip.openReadStream(e, (err2, stream) => {
          if (err2 || !stream) return rej(err2 ?? new Error('unreadable entry'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            out.push(Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => res(out));
      zip.readEntry();
    });
  });
}

const texts = statSync(src).isDirectory() ? readdirSync(src).filter((f) => f.endsWith('.jbeam')).map((f) => readFileSync(join(src, f), 'utf8')) : await zipTexts(src);
const parts: Record<string, JbeamObject> = {};
for (const t of texts) {
  try {
    const v = parseJbeam(t).value;
    if (isJbeamObject(v)) for (const [k, p] of Object.entries(v)) if (isJbeamObject(p)) parts[k] = p;
  } catch {
    // unreadable: left out
  }
}
const vars = variableDefaults(Object.values(parts));
for (const name of names) {
  const part = parts[name];
  if (!part) {
    console.log(`${name}: no such part`);
    continue;
  }
  const nodes = [...definedNodes(part, vars)];
  const flat = nodes.flatMap(([, p]) => p);
  const { center, axes } = principalAxes(flat);
  const local = nodes.map(([id, p]) => [id, ...axes.map((a) => (p[0] - center[0]) * a[0]! + (p[1] - center[1]) * a[1]! + (p[2] - center[2]) * a[2]!)] as [string, number, number, number]);
  const span = [1, 2, 3].map((k) => Math.max(...local.map((r) => r[k] as number)) - Math.min(...local.map((r) => r[k] as number)));
  console.log(`${name}: ${nodes.length} nodes, ${span.map((s) => s.toFixed(2)).join(' × ')} m (along × across × depth)`);
  if (process.env.ROWS) for (const [id, a, b, c] of local.sort((x, y) => x[1] - y[1])) console.log(`   ${id.padEnd(8)} ${a.toFixed(2).padStart(6)} ${b.toFixed(2).padStart(6)} ${c.toFixed(3).padStart(7)}`);
}
