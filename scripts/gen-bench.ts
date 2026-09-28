/**
 * Structure generation on dense meshes (the 130k-triangle dash case):
 *   npm run gen-bench -- <taxonomy id> <size> [slab|pieces] [soup] [body]
 * "pieces" scatters many small knobs (a dashboard), "soup" gives every
 * triangle its own corners (as imports deliver them), "body" generates a
 * body shell alongside. MODE=decimate|hull|surface|box and DETAIL=0..1
 * override the part's proxy settings.
 */
import shipped from '../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../src/shared/taxonomy/schema';
import { Classifier } from '../src/shared/taxonomy/classify';
import { createEmptyProject } from '../src/shared/project/io';
import { createPart } from '../src/shared/parts/ops';
import { meshoptReady } from '../src/shared/proxy/shapes';
import { defaultProxySettings, generateStructure } from '../src/shared/proxy/generate';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

/** A lumpy, dense dash-like slab: n×n grid top and bottom, ~4n² triangles. */
function slab(n: number, w: number, d: number, h: number) {
  const p: number[] = [];
  const idx: number[] = [];
  for (const top of [0, 1]) {
    const base = p.length / 3;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) p.push(-w / 2 + (w * i) / n, -d / 2 + (d * j) / n, top * h + Math.sin(i * 0.3) * Math.cos(j * 0.2) * 0.01);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = base + i * (n + 1) + j;
        if (top) idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
        else idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
      }
  }
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

/** Many small separate pieces (knobs, buttons, vents) scattered over a dash-sized area. */
function pieces(count: number, per: number) {
  const p: number[] = [];
  const idx: number[] = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < count; k++) {
    const cx = (rnd() - 0.5) * 1.4, cy = (rnd() - 0.5) * 0.45, cz = rnd() * 0.25, r = 0.005 + rnd() * 0.02;
    const seg = Math.max(3, Math.round(Math.sqrt(per / 2)));
    const base = p.length / 3;
    for (let i = 0; i <= seg; i++) {
      const th = (Math.PI * i) / seg;
      for (let j = 0; j <= seg; j++) {
        const ph = (2 * Math.PI * j) / seg;
        p.push(cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.sin(th) * Math.sin(ph), cz + r * Math.cos(th));
      }
    }
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < seg; j++) {
        const a = base + i * (seg + 1) + j;
        idx.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
      }
  }
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

await meshoptReady;
const kind = process.argv[2] ?? 'dashboard';
const n = Number(process.argv[3] ?? 180);
const doc = createEmptyProject({ name: 'B', slug: 'b' }, '0', new Date());
const body = createPart(doc, tax, { taxonomyId: 'body' });
const dash = createPart(doc, tax, { taxonomyId: kind, parentPartId: body.id });
const indexed = process.argv[4] === 'pieces' ? pieces(n, 64) : slab(n, 1.4, 0.45, 0.25);
/** As imports deliver it: every triangle with its own corners (split by normals and UVs). */
function soup(m: { positions: Float32Array; index: Uint32Array }) {
  const p = new Float32Array(m.index.length * 3);
  m.index.forEach((v, i) => p.set(m.positions.subarray(v * 3, v * 3 + 3), i * 3));
  return { positions: p, index: Uint32Array.from({ length: m.index.length }, (_, i) => i) };
}
const mesh = process.argv[5] === 'soup' ? soup(indexed) : indexed;
console.log('triangles', mesh.index.length / 3);
const mode = process.env.MODE;
if (mode) doc.proxy.parts[dash.id] = { ...defaultProxySettings(tax.entry(kind)!), mode: mode as never, detail: Number(process.env.DETAIL ?? 0.5) };
const t0 = performance.now();
const withBody = process.argv[6] === 'body';
const shell = soup(slab(40, 1.8, 4.2, 1.3));
for (let i = 0; i < shell.positions.length; i += 3) shell.positions[i + 2]! -= 0.3;
generateStructure(doc, tax, withBody ? [{ partId: body.id, mesh: shell }, { partId: dash.id, mesh }] : [{ partId: dash.id, mesh }]);
console.log('ms', Math.round(performance.now() - t0), 'nodes', doc.nodes.length, 'beams', doc.beams.length);
