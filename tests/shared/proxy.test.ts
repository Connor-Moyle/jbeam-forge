import { beforeAll, describe, expect, it } from 'vitest';
import { edges, signedVolume, vertexCount, weld, type ProxyMesh } from '../../src/shared/proxy/mesh';
import { collapseShortEdges, orientOutward, removeDegenerate, subdivideLongEdges } from '../../src/shared/proxy/quality';
import { convexHull, decimate, fitBox, fitCylinder, meshoptReady, principalAxes } from '../../src/shared/proxy/shapes';
import { leftHalf, mirrorHalf, straddlesCentre } from '../../src/shared/proxy/symmetry';
import { buildProxy } from '../../src/shared/proxy/build';

/** UV sphere with duplicated seam vertices (like real exports). */
function sphere(r = 1, seg = 32, rings = 16, cx = 0): ProxyMesh {
  const p: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const th = (Math.PI * i) / rings;
    for (let j = 0; j <= seg; j++) {
      const ph = (2 * Math.PI * j) / seg;
      p.push(cx + r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

/** Gently curved open panel (a hood), centred on X = 0. */
function panel(n = 30, w = 1.4, l = 1.2): ProxyMesh {
  const p: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = -w / 2 + (w * i) / n;
      const y = -l / 2 + (l * j) / n;
      p.push(x, y, 0.8 - 0.1 * x * x);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

beforeAll(async () => {
  await meshoptReady;
});

describe('mesh basics', () => {
  it('welds seam duplicates and counts unique edges', () => {
    const s = sphere(1, 8, 4);
    const w = weld(s.positions, s.index);
    expect(vertexCount(w)).toBeLessThan(vertexCount(s));
    expect(edges(w).length).toBe((w.index.length / 3) * 1.5); // closed manifold: E = 3F/2
  });
});

describe('decimate', () => {
  it('reaches the vertex budget on a closed mesh', () => {
    const out = decimate(sphere(), 30);
    expect(vertexCount(out)).toBeLessThanOrEqual(33);
    expect(vertexCount(out)).toBeGreaterThan(10);
  });

  it('reaches the budget on fragmented meshes (hundreds of loose islands)', () => {
    const p: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < 400; i++) {
      const x = (i % 20) * 0.05;
      const y = Math.floor(i / 20) * 0.05;
      const b = p.length / 3;
      p.push(x, y, 0, x + 0.02, y, 0, x, y + 0.02, 0.01);
      idx.push(b, b + 1, b + 2);
    }
    const out = decimate({ positions: new Float32Array(p), index: new Uint32Array(idx) }, 8);
    expect(vertexCount(out)).toBeLessThanOrEqual(12);
    expect(vertexCount(out)).toBeGreaterThanOrEqual(3);
  });

  it('keeps an open panel within budget (border lock released when needed)', () => {
    const out = decimate(panel(), 30);
    expect(vertexCount(out)).toBeLessThanOrEqual(45);
  });
});

describe('hull and primitives', () => {
  it('convex hull of a sphere is closed and outward', () => {
    const out = orientOutward(convexHull(sphere(), 20));
    expect(vertexCount(out)).toBeLessThanOrEqual(23);
    expect(signedVolume(out)).toBeGreaterThan(0);
  });

  it('PCA finds the long axis of a shaft', () => {
    const shaft = sphere(1, 16, 8);
    for (let i = 0; i < shaft.positions.length; i += 3) shaft.positions[i + 1]! *= 6; // stretch along Y
    const { axes } = principalAxes(shaft.positions);
    expect(Math.abs(axes[0]![1])).toBeGreaterThan(0.99);
    const cyl = fitCylinder(shaft, 6);
    expect(vertexCount(cyl)).toBe(12);
    expect(signedVolume(orientOutward(cyl))).toBeGreaterThan(0);
  });

  it('box fit winds outward with a volume close to the bounds', () => {
    const b = fitBox(sphere(1, 16, 8));
    expect(vertexCount(b)).toBe(8);
    const v = signedVolume(b);
    expect(v).toBeGreaterThan(7);
    expect(v).toBeLessThan(8.5);
  });
});

describe('quality pass', () => {
  it('subdivides long edges without cracks and collapses short ones', () => {
    const quad: ProxyMesh = { positions: new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0]), index: new Uint32Array([0, 1, 2, 0, 2, 3]) };
    const sub = subdivideLongEdges(quad, 0.6);
    for (const [a, b] of edges(sub)) {
      const p = sub.positions;
      expect(Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!)).toBeLessThanOrEqual(0.6 + 1e-6);
    }
    // No cracks: every interior edge is shared by exactly two triangles, boundary edges by one.
    const uses = new Map<string, number>();
    for (let t = 0; t < sub.index.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = sub.index[t + k]!;
        const b = sub.index[t + ((k + 1) % 3)]!;
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
    expect([...uses.values()].every((n) => n === 1 || n === 2)).toBe(true);
    const collapsed = collapseShortEdges(sub, 0.55); // sub-edges are 0.5 m
    expect(vertexCount(collapsed)).toBeLessThan(vertexCount(sub));
  });

  it('removes slivers and duplicates, and orients a flipped shell outward', () => {
    const sliver: ProxyMesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 0.0001, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2, 0, 1, 3, 0, 1, 3]) };
    expect(removeDegenerate(sliver).index.length).toBe(3);
    const w = weld(sphere(1, 8, 4).positions, sphere(1, 8, 4).index);
    const flipped: ProxyMesh = { positions: w.positions, index: w.index.map((v, i, arr) => (i % 3 === 1 ? arr[i + 1]! : i % 3 === 2 ? arr[i - 1]! : v)) };
    expect(signedVolume(flipped)).toBeLessThan(0);
    expect(signedVolume(orientOutward(flipped))).toBeGreaterThan(0);
  });
});

describe('symmetry', () => {
  it('mirrors a half into exact l/r pairs', () => {
    const p = panel();
    expect(straddlesCentre(p.positions)).toBe(true);
    const full = mirrorHalf(decimate(leftHalf(p), 16), 0.01);
    const pos = full.positions;
    const key = (x: number, y: number, z: number) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    const set = new Set<string>();
    for (let i = 0; i < pos.length; i += 3) set.add(key(pos[i]!, pos[i + 1]!, pos[i + 2]!));
    for (let i = 0; i < pos.length; i += 3) expect(set.has(key(-pos[i]! || 0, pos[i + 1]!, pos[i + 2]!))).toBe(true);
    expect(straddlesCentre(sphere(1, 8, 4, 3).positions)).toBe(false); // a part off to one side
  });
});

describe('buildProxy', () => {
  it('produces a budgeted, clean, symmetric hood proxy', () => {
    const r = buildProxy(panel(), { mode: 'decimate', targetVertices: 30, symmetry: true, maxEdge: 0.6, minEdge: 0.05, inset: 0.01 });
    expect(r.mirrored).toBe(true);
    expect(r.stats.vertices).toBeGreaterThan(10);
    expect(r.stats.vertices).toBeLessThanOrEqual(60);
    const p = r.mesh.positions;
    const lengths = edges(r.mesh).map(([a, b]) => Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!));
    expect(Math.max(...lengths)).toBeLessThan(0.9); // subdivision stops at the budget; most edges within maxEdge
    expect(lengths.filter((l) => l <= 0.6 + 1e-3).length / lengths.length).toBeGreaterThan(0.55);
    expect(r.stats.vertices).toBeLessThanOrEqual(30);
  });

  it('hull and cylinder modes give closed outward shells', () => {
    for (const mode of ['hull', 'cylinder', 'box'] as const) {
      const r = buildProxy(sphere(0.3), { mode, targetVertices: 16, symmetry: false, maxEdge: 0, minEdge: 0, inset: 0 });
      expect(signedVolume(r.mesh), mode).toBeGreaterThan(0);
    }
  });
});
