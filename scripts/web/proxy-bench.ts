/**
 * Proxy-generation benchmark against an official vehicle (local only).
 *
 *   npm run proxy-bench -- sunburst2 [--parts=hood,body] [--verbose]
 *
 * For every official part that has nodes and flexbodies, the meshes its
 * flexbodies bind are fed to OUR generator (with the official part's mass), and
 * the result is compared with the mesh and with the official nodes:
 *   coverage  p90 distance from the mesh surface to the nearest node    (does the node set span the shape?)
 *   fidelity  mean distance from each node to the mesh surface          (do nodes sit on the shape?)
 *   chamfer   mean nearest-neighbour distance ours ↔ official nodes
 * All three are divided by the part's bounding-box diagonal (scale-free, lower is better).
 * Only aggregates are printed; nothing from the game is copied into the repo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { isJbeamObject, parseJbeam, type JbeamObject, type JbeamValue } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';
/** Table cell as text (ids and mesh names are strings in valid jbeam). */
function str(v: JbeamValue | undefined): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? `${v}` : JSON.stringify(v ?? null);
}

import { buildProxy } from '../../src/shared/proxy/build';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import { edges, weld } from '../../src/shared/proxy/mesh';
import { featureVertices } from '../../src/shared/proxy/remesh';
import { defaultProxySettings, massNodeCap, partRole } from '../../src/shared/proxy/generate';
import { kindDefaults, targetVertices } from '../../src/shared/proxy/presets';
import { loadMeshCache, type CachedMesh } from './meshCache';

const id = process.argv[2] ?? 'sunburst2';
const only = process.argv.find((a) => a.startsWith('--parts='))?.slice(8).split(',');
const verbose = process.argv.includes('--verbose');
const root = resolve(import.meta.dirname, '..', '..');
const studyDir = join(root, 'scratch', 'vehicle-study', id);
const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

type V3 = [number, number, number];

/** Uniform grid for nearest-point queries. */
class Grid {
  private cells = new Map<string, number[]>();
  constructor(
    private pts: Float32Array,
    private cell: number,
  ) {
    for (let i = 0; i < pts.length / 3; i++) {
      const k = this.key(pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!);
      const l = this.cells.get(k);
      if (l) l.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  nearest(x: number, y: number, z: number): number {
    if (this.pts.length / 3 <= 3000) {
      // Sparse sets (node lists): brute force beats walking empty cells.
      let best = Infinity;
      for (let i = 0; i < this.pts.length; i += 3) best = Math.min(best, Math.hypot(this.pts[i]! - x, this.pts[i + 1]! - y, this.pts[i + 2]! - z));
      return best;
    }
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = Infinity;
    for (let r = 0; r < 64; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            for (const i of this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              const d = Math.hypot(this.pts[i * 3]! - x, this.pts[i * 3 + 1]! - y, this.pts[i * 3 + 2]! - z);
              if (d < best) best = d;
            }
          }
      if (best <= r * this.cell) break; // nothing closer can be further out
    }
    return best;
  }
}

/** Points sampled on the mesh surface: vertices plus triangle centroids (dense enough for these meshes). */
function surfaceSamples(meshes: CachedMesh[], max = 6000): Float32Array {
  const out: number[] = [];
  for (const m of meshes) {
    for (let t = 0; t < m.index.length; t += 3) {
      for (let k = 0; k < 3; k++) out.push(m.positions[m.index[t]! * 3 + k]!);
      for (let k = 0; k < 3; k++) out.push((m.positions[m.index[t]! * 3 + k]! + m.positions[m.index[t + 1]! * 3 + k]! + m.positions[m.index[t + 2]! * 3 + k]!) / 3);
    }
  }
  const n = out.length / 3;
  if (n <= max) return new Float32Array(out);
  const step = n / max;
  const s = new Float32Array(max * 3);
  for (let i = 0; i < max; i++) {
    const j = Math.floor(i * step);
    s[i * 3] = out[j * 3]!;
    s[i * 3 + 1] = out[j * 3 + 1]!;
    s[i * 3 + 2] = out[j * 3 + 2]!;
  }
  return s;
}

function stats(a: Float32Array, b: Float32Array, cell: number) {
  const g = new Grid(b, cell);
  const d: number[] = [];
  for (let i = 0; i < a.length / 3; i++) d.push(g.nearest(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!));
  d.sort((x, y) => x - y);
  return { mean: d.reduce((s, x) => s + x, 0) / Math.max(1, d.length), p90: d[Math.floor(0.9 * (d.length - 1))] ?? 0 };
}

function diag(p: Float32Array): number {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k]!, p[i + k]!);
    hi[k] = Math.max(hi[k]!, p[i + k]!);
  }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
}

await meshoptReady;
const cache = await loadMeshCache(join(root, 'scratch', 'test-models', id, `${id}.dae`), join(root, 'scratch', 'test-models', id, 'mesh-cache.json'));
const byName = new Map(cache.map((m) => [m.name, m]));

interface Row {
  part: string;
  kind: string;
  mode: string;
  offNodes: number;
  ourNodes: number;
  ourBeams: number;
  cov: number;
  covOff: number;
  fid: number;
  fidOff: number;
  chamfer: number;
  beamOff: number;
  beamOffOff: number;
  outline: number;
  outlineOff: number;
  cv: number;
  cvOff: number;
}
const rows: Row[] = [];
for (const f of readdirSync(studyDir).filter((x) => x.endsWith('.jbeam'))) {
  let doc: JbeamObject;
  try {
    const v = parseJbeam(readFileSync(join(studyDir, f), 'utf8')).value;
    if (!isJbeamObject(v)) continue;
    doc = v;
  } catch {
    continue;
  }
  for (const [partName, raw] of Object.entries(doc)) {
    if (!isJbeamObject(raw) || !raw.nodes || !raw.flexbodies) continue;
    if (only && !only.some((o) => partName.includes(o))) continue;
    let offNodes: V3[] = [];
    const offById = new Map<string, V3>();
    let mass = 0;
    try {
      for (const r of readTable(raw.nodes).records) {
        offNodes.push([Number(r.values.posX), Number(r.values.posY), Number(r.values.posZ)]);
        offById.set(str(r.values.id), offNodes[offNodes.length - 1]!);
        if (typeof r.options.nodeWeight === 'number') mass += r.options.nodeWeight;
      }
    } catch {
      continue;
    }
    offNodes = offNodes.filter((p) => p.every(Number.isFinite));
    if (offNodes.length < 6) continue;
    const meshNames = readTable(raw.flexbodies).records.map((r) => str(r.values.mesh));
    const meshes = meshNames.map((n) => byName.get(n)).filter((m): m is CachedMesh => !!m);
    if (!meshes.length) continue;
    const c = tax.classify(partName.replace(new RegExp(`^${id}_`), ''));
    const entry = c.taxonomyId ? tax.entry(c.taxonomyId) : undefined;
    if (!entry) continue;
    const settings = defaultProxySettings(entry);
    if (partRole(entry, settings) !== 'own') continue;
    // Merge meshes.
    const pos: number[] = [];
    const idx: number[] = [];
    for (const m of meshes) {
      const base = pos.length / 3;
      for (const v of m.positions) pos.push(v);
      for (const i of m.index) idx.push(i + base);
    }
    const mesh = { positions: new Float32Array(pos), index: new Uint32Array(idx) };
    const massKg = mass || 5;
    const cap = massNodeCap(entry, massKg);
    const target = Math.min(targetVertices(kindDefaults(entry).budget, settings.detail), cap);
    const built = buildProxy(mesh, { mode: settings.mode, targetVertices: target, symmetry: settings.symmetry, maxEdge: settings.maxEdge, minEdge: settings.minEdge, inset: settings.inset, maxVertices: cap });
    const ours = built.mesh.positions;
    const off = new Float32Array(offNodes.flat());
    const surf = surfaceSamples(meshes);
    const size = diag(surf);
    const cell = Math.max(0.02, size / 40);
    const cov = stats(surf, ours, cell).p90 / size;
    const covOff = stats(surf, off, cell).p90 / size;
    const fid = stats(ours, surf, cell).mean / size;
    const fidOff = stats(off, surf, cell).mean / size;
    const chamfer = (stats(ours, off, cell).mean + stats(off, ours, cell).mean) / 2 / size;
    // Beam midpoints vs the surface: beams that cut through air (p90).
    const mids: number[] = [];
    for (const [a, b] of edges(built.mesh)) for (let k = 0; k < 3; k++) mids.push((ours[a * 3 + k]! + ours[b * 3 + k]!) / 2);
    const offMids: number[] = [];
    if (raw.beams)
      for (const r of readTable(raw.beams).records) {
        const a = offById.get(str(r.values['id1:']));
        const b = offById.get(str(r.values['id2:']));
        if (a && b) offMids.push((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      }
    // Outline: feature lines of the input mesh (boundaries + creases) vs nearest node (p90).
    const welded = weld(mesh.positions, mesh.index, 1e-4);
    const fv = featureVertices(welded.positions, welded.index, 35);
    const fpts: number[] = [];
    for (let v = 0; v < fv.length; v++) if (fv[v]) fpts.push(welded.positions[v * 3]!, welded.positions[v * 3 + 1]!, welded.positions[v * 3 + 2]!);
    const fp = new Float32Array(fpts);
    const outline = fp.length ? stats(fp, ours, cell).p90 / size : 0;
    const outlineOff = fp.length ? stats(fp, off, cell).p90 / size : 0;
    // Beam-length uniformity: coefficient of variation of edge lengths (lower = more even).
    const cvOf = (ls: number[]) => {
      const m = ls.reduce((a, b) => a + b, 0) / Math.max(1, ls.length);
      return m ? Math.sqrt(ls.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, ls.length)) / m : 0;
    };
    const cv = cvOf(edges(built.mesh).map(([a, b]) => Math.hypot(ours[a * 3]! - ours[b * 3]!, ours[a * 3 + 1]! - ours[b * 3 + 1]!, ours[a * 3 + 2]! - ours[b * 3 + 2]!)));
    const offLens: number[] = [];
    if (raw.beams)
      for (const r of readTable(raw.beams).records) {
        const a = offById.get(str(r.values['id1:']));
        const b = offById.get(str(r.values['id2:']));
        if (a && b) offLens.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    const cvOff = cvOf(offLens);
    const beamOff = mids.length ? stats(new Float32Array(mids), surf, cell).p90 / size : 0;
    const beamOffOff = offMids.length ? stats(new Float32Array(offMids), surf, cell).p90 / size : 0;
    rows.push({ part: partName.replace(`${id}_`, ''), kind: entry.id, mode: settings.mode, offNodes: offNodes.length, ourNodes: ours.length / 3, ourBeams: edges(built.mesh).length, cov, covOff, fid, fidOff, chamfer, beamOff, beamOffOff, outline, outlineOff, cv, cvOff });
  }
}

const f3 = (n: number) => n.toFixed(3);
rows.sort((a, b) => b.offNodes - a.offNodes);
if (verbose || only) {
  console.log('part'.padEnd(34), 'kind'.padEnd(16), 'mode'.padEnd(9), 'nodes off/ours', ' cov ours/off', ' fid ours/off', ' chamfer', ' beam-off ours/off', '  outline ours/off');
  for (const r of rows) console.log(r.part.slice(0, 33).padEnd(34), r.kind.padEnd(16), r.mode.padEnd(9), `${r.offNodes}/${r.ourNodes}`.padStart(14), `${f3(r.cov)}/${f3(r.covOff)}`.padStart(14), `${f3(r.fid)}/${f3(r.fidOff)}`.padStart(14), f3(r.chamfer).padStart(8), `${f3(r.beamOff)}/${f3(r.beamOffOff)}`.padStart(14), `${f3(r.outline)}/${f3(r.outlineOff)}`.padStart(14));
}
const ok = rows.filter((r) => Number.isFinite(r.cov) && r.ourNodes > 0);
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};
const failed = rows.length - ok.length;
const worse = ok.filter((r) => r.cov > r.covOff * 1.25).length;
console.log(
  `
${rows.length} parts · empty ${failed} · coverage/official median ${f3(med(ok.map((r) => r.cov / r.covOff)))} · fidelity ours ${f3(med(ok.map((r) => r.fid)))} vs official ${f3(med(ok.map((r) => r.fidOff)))} · chamfer ${f3(med(ok.map((r) => r.chamfer)))} · nodes ours/official ${f3(med(ok.map((r) => r.ourNodes / r.offNodes)))} · beams off-surface p90 ours ${f3(med(ok.map((r) => r.beamOff)))} vs official ${f3(med(ok.map((r) => r.beamOffOff)))} · outline/official median ${f3(med(ok.filter((r) => r.outlineOff > 0).map((r) => r.outline / r.outlineOff)))} · beam-length CV ours ${f3(med(ok.map((r) => r.cv)))} vs official ${f3(med(ok.map((r) => r.cvOff)))} · coverage >25% worse than official: ${worse}`,
);
