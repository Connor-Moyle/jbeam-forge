/**
 * Dev tool: how closely generated structure follows a practice car piece.
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/fidelity.ts body 270 heavy
 * Prints node/beam counts, how far the surface is from the nearest node (p50/p95/max, m)
 * and how many beams run through the air instead of along the skin.
 */
import { demoCarPieces } from '../../src/shared/tutorial/demoCar';
import { buildProxy } from '../../src/shared/proxy/build';
import { deriveStructure } from '../../src/shared/proxy/derive';
import { meshoptReady } from '../../src/shared/proxy/shapes';

await meshoptReady;
const which = process.argv[2] ?? 'body';
const target = Number(process.argv[3] ?? 200);
const bracing = (process.argv[4] ?? 'heavy') as 'heavy';
const piece = demoCarPieces().find((p) => p.name === which)!;
// Loader → BeamNG: (x, y, z) → (x, -z, y)
const pos: number[] = [];
for (const t of piece.tris) for (const v of t) pos.push(v[0], -v[2], v[1]);
const index = Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
const mesh = { positions: Float32Array.from(pos), index };
const r = buildProxy(mesh, { mode: 'surface', targetVertices: target, symmetry: true, maxEdge: 0.75, minEdge: 0.04, inset: 0.005 });
const s = deriveStructure({ partId: 'p', mesh: r.mesh, prefix: 'b', massKg: 300, bracing });
const nodes = s.nodes.map((n) => n.pos);
// Surface samples: triangle centroids.
const samples: number[][] = [];
for (let i = 0; i < pos.length; i += 9) samples.push([(pos[i]! + pos[i + 3]! + pos[i + 6]!) / 3, (pos[i + 1]! + pos[i + 4]! + pos[i + 7]!) / 3, (pos[i + 2]! + pos[i + 5]! + pos[i + 8]!) / 3]);
const nearest = (p: number[], set: number[][]) => { let b = Infinity; for (const q of set) b = Math.min(b, (p[0]! - q[0]!) ** 2 + (p[1]! - q[1]!) ** 2 + (p[2]! - q[2]!) ** 2); return Math.sqrt(b); };
const scored = samples.filter((_, i) => i % 7 === 0).map((p) => ({ p, d: nearest(p, nodes) }));
const worst = [...scored].sort((a, b) => b.d - a.d).slice(0, 5).map((x) => x.p.map((v) => +v.toFixed(2)).join(',') + '@' + x.d.toFixed(2));
console.log('worst', worst.join(' '));
const d = scored.map((x) => x.d).sort((a, b) => a - b);
const byId = new Map(s.nodes.map((n) => [n.id, n.pos]));
let air = 0;
const sub = samples.filter((_, i) => i % 5 === 0);
for (const b of s.beams) {
  const a = byId.get(b.id1)!;
  const c = byId.get(b.id2)!;
  const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
  if (nearest(mid, sub) > 0.12) air++;
}
console.log(JSON.stringify({ which, nodes: s.nodes.length, beams: s.beams.length, tris: s.tris.length, p50: +d[Math.floor(d.length * 0.5)]!.toFixed(3), p95: +d[Math.floor(d.length * 0.95)]!.toFixed(3), max: +d[d.length - 1]!.toFixed(3), beamsThroughAir: air, share: +(air / s.beams.length).toFixed(2) }));
