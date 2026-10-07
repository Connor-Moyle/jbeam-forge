/**
 * What a vehicle's structure is made of, part by part: nodes and their weights, beams by kind, how
 * many beams hold each node, beam lengths, spring, damping, deform and strength. For reading a
 * generated car against one of the game's (a folder, or a vehicle zip in the install's
 * content/vehicles).
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/structure-stats.mts <vehicle folder | vehicle.zip> [part name filter]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { isJbeamObject, parseJbeam, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';

const [src, filter] = process.argv.slice(2);
if (!src || !existsSync(src)) {
  console.error('usage: structure-stats.mts <vehicle folder | vehicle.zip> [part name filter]');
  process.exit(2);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith('.jbeam') ? [join(dir, f)] : []));
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

const texts = statSync(src).isDirectory() ? walk(src).map((f) => readFileSync(f, 'utf8')) : await zipTexts(src);
const parts: Record<string, JbeamObject> = {};
for (const t of texts) {
  try {
    const v = parseJbeam(t).value;
    if (isJbeamObject(v)) for (const [k, p] of Object.entries(v)) if (isJbeamObject(p)) parts[k] = p;
  } catch {
    // a file the lenient parser can't read: left out
  }
}

type Node = { pos: [number, number, number]; weight: number; part: string };
const nodes = new Map<string, Node>();
for (const [name, p] of Object.entries(parts)) {
  if (!Array.isArray(p.nodes)) continue;
  try {
    for (const r of readTable(p.nodes).records) {
      const pos = [Number(r.values.posX), Number(r.values.posY), Number(r.values.posZ)] as [number, number, number];
      if (typeof r.values.id === 'string' && pos.every(Number.isFinite) && !nodes.has(r.values.id)) nodes.set(r.values.id, { pos, weight: Number(r.options.nodeWeight ?? 25), part: name });
    }
  } catch {
    // not a table
  }
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : v === 'FLT_MAX' ? Infinity : fallback);
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN);
const range = (a: number[], digits = 0) => (a.length ? `${Math.min(...a).toFixed(digits)}–${median(a).toFixed(digits)}–${Math.max(...a).toFixed(digits)}` : '-');
const big = (a: number[]) => {
  const f = a.filter(Number.isFinite);
  const k = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(0)}k` : x.toFixed(0));
  return f.length ? `${k(Math.min(...f))}–${k(median(f))}–${k(Math.max(...f))}${f.length < a.length ? ' (+∞)' : ''}` : a.length ? '∞' : '-';
};

console.log(`${Object.keys(parts).length} parts, ${nodes.size} nodes. Columns: low–median–high.`);
console.log('part | nodes | kg/node | beams | beams per node | own/cross | length m | spring | damp | deform | strength | tris');
const rows: [number, string][] = [];
for (const [name, p] of Object.entries(parts)) {
  if (filter && !name.includes(filter)) continue;
  const own = [...nodes.values()].filter((n) => n.part === name);
  let beams: { a: string; b: string; spring: number; damp: number; deform: number; strength: number; type: string }[] = [];
  if (Array.isArray(p.beams)) {
    try {
      beams = readTable(p.beams).records.map((r) => ({ a: String(r.values['id1:']), b: String(r.values['id2:']), spring: num(r.options.beamSpring, 4_300_000), damp: num(r.options.beamDamp, 580), deform: num(r.options.beamDeform, 220_000), strength: num(r.options.beamStrength, 2_200_000), type: String(r.options.beamType ?? '|NORMAL') }));
    } catch {
      // not a table
    }
  }
  if (!own.length && !beams.length) continue;
  const normal = beams.filter((b) => b.type === '|NORMAL');
  const per = new Map<string, number>();
  let cross = 0;
  const lengths: number[] = [];
  for (const b of normal) {
    const A = nodes.get(b.a);
    const B = nodes.get(b.b);
    if (A?.part === name) per.set(b.a, (per.get(b.a) ?? 0) + 1);
    if (B?.part === name) per.set(b.b, (per.get(b.b) ?? 0) + 1);
    if (A && B && (A.part !== name || B.part !== name)) cross++;
    if (A && B) lengths.push(Math.hypot(A.pos[0] - B.pos[0], A.pos[1] - B.pos[1], A.pos[2] - B.pos[2]));
  }
  const tris = Array.isArray(p.triangles) ? p.triangles.filter((r) => Array.isArray(r)).length - 1 : 0;
  const other = beams.length - normal.length;
  rows.push([own.length, `${name} | ${own.length} | ${range(own.map((n) => n.weight), 2)} | ${normal.length}${other ? ` (+${other} other)` : ''} | ${range([...per.values()])} | ${normal.length - cross}/${cross} | ${range(lengths, 2)} | ${big(normal.map((b) => b.spring))} | ${big(normal.map((b) => b.damp))} | ${big(normal.map((b) => b.deform))} | ${big(normal.map((b) => b.strength))} | ${Math.max(0, tris)}`]);
}
for (const [, line] of rows.sort((a, b) => b[0] - a[0]).slice(0, Number(process.env.TOP ?? 40))) console.log(line);
