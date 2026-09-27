import { describe, expect, it } from 'vitest';
import { featureVertices, remeshSurface } from '../../src/shared/proxy/remesh';
import { mirrorGraph } from '../../src/shared/proxy/symmetry';
import { edges, type ProxyMesh } from '../../src/shared/proxy/mesh';

function sphere(r = 1, seg = 48, rings = 24): ProxyMesh {
  const p: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const th = (Math.PI * i) / rings;
    for (let j = 0; j <= seg; j++) {
      const ph = (2 * Math.PI * j) / seg;
      p.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th));
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

/** Flat 2 × 1 m plate with a 0.8 × 0.4 m window cut out (grid of quads). */
function plateWithWindow(n = 40): ProxyMesh {
  const p: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n / 2; j++) p.push((2 * i) / n - 1, (2 * j) / n - 0.5, 0);
  const at = (i: number, j: number) => i * (n / 2 + 1) + j;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n / 2; j++) {
      const cx = (2 * (i + 0.5)) / n - 1;
      const cy = (2 * (j + 0.5)) / n - 0.5;
      if (Math.abs(cx) < 0.4 && Math.abs(cy) < 0.2) continue; // the window
      idx.push(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

function components(m: ProxyMesh): number {
  const n = m.positions.length / 3;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (const [a, b] of edges(m)) parent[find(a)] = find(b);
  return new Set(Array.from({ length: n }, (_, i) => find(i))).size;
}

describe('remeshSurface', () => {
  it('places about the requested number of nodes, all on the surface, as one connected shell', () => {
    const r = remeshSurface(sphere(), { targetVertices: 60 });
    const n = r.positions.length / 3;
    expect(n).toBeGreaterThanOrEqual(54);
    expect(n).toBeLessThanOrEqual(60);
    for (let i = 0; i < n; i++) expect(Math.hypot(r.positions[i * 3]!, r.positions[i * 3 + 1]!, r.positions[i * 3 + 2]!)).toBeCloseTo(1, 2);
    expect(r.index.length / 3).toBeGreaterThan(n); // a real triangulated shell (≈ 2n for a sphere)
    expect(components(r)).toBe(1);
  });

  it('spaces beams evenly (coefficient of variation well below official content’s ~0.37)', () => {
    const r = remeshSurface(sphere(), { targetVertices: 80 });
    const p = r.positions;
    const ls = edges(r).map(([a, b]) => Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!));
    const m = ls.reduce((s, x) => s + x, 0) / ls.length;
    const cv = Math.sqrt(ls.reduce((s, x) => s + (x - m) ** 2, 0) / ls.length) / m;
    expect(cv).toBeLessThan(0.3);
  });

  it('puts nodes on outlines: the window opening and outer edge are traced', () => {
    const plate = plateWithWindow();
    const r = remeshSurface(plate, { targetVertices: 40 });
    const p = r.positions;
    const near = (x: number, y: number) => {
      let best = Infinity;
      for (let i = 0; i < p.length; i += 3) best = Math.min(best, Math.hypot(p[i]! - x, p[i + 1]! - y));
      return best;
    };
    // Window corners and outer corners each have a node close by.
    for (const [x, y] of [
      [-0.4, -0.2],
      [0.4, 0.2],
      [-1, -0.5],
      [1, 0.5],
    ] as const)
      expect(near(x, y)).toBeLessThan(0.2);
    // No node lies inside the window.
    for (let i = 0; i < p.length; i += 3) expect(Math.abs(p[i]!) < 0.35 && Math.abs(p[i + 1]!) < 0.15).toBe(false);
  });

  it('ties separate islands together (fragmented meshes still form one structure)', () => {
    const a = sphere(0.3, 16, 8);
    const b = sphere(0.3, 16, 8);
    const both: ProxyMesh = {
      positions: new Float32Array([...a.positions, ...Array.from(b.positions, (v, i) => (i % 3 === 0 ? v + 2 : v))]),
      index: new Uint32Array([...a.index, ...Array.from(b.index, (v) => v + a.positions.length / 3)]),
    };
    expect(components(remeshSurface(both, { targetVertices: 30 }))).toBe(1);
  });

  it('flags boundary and crease vertices as features', () => {
    const f = featureVertices(plateWithWindow(8).positions, plateWithWindow(8).index, 35);
    expect(f.reduce((s, x) => s + x, 0)).toBeGreaterThan(0);
  });
});

describe('mirrorGraph', () => {
  it('mirrors the half into exact twins and ties the halves across the centre', () => {
    const half: ProxyMesh = {
      positions: new Float32Array([0.05, 0, 0, 0.5, 0, 0, 0.5, 1, 0, 0.05, 1, 0]),
      index: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    const full = mirrorGraph(half, 0.01);
    const p = full.positions;
    const keys = new Set<string>();
    for (let i = 0; i < p.length; i += 3) keys.add(`${p[i]!.toFixed(4)},${p[i + 1]!.toFixed(4)}`);
    for (let i = 0; i < p.length; i += 3) expect(keys.has(`${(-p[i]! || 0).toFixed(4)},${p[i + 1]!.toFixed(4)}`)).toBe(true);
    expect(components(full)).toBe(1);
  });
});
