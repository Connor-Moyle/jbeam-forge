import { describe, expect, it } from 'vitest';
import { deriveStructure, stiffenerPositions } from '../../src/shared/proxy/derive';

/** A bonnet-like sheet: `nx` by `ny` nodes, 1.4 m long and 1.1 m wide, slightly crowned, at z ≈ 0.9. */
function sheet(nx = 5, ny = 4) {
  const positions: number[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const x = -0.55 + (1.1 * j) / (ny - 1);
      const y = -2 + (1.4 * i) / (nx - 1);
      positions.push(x, y, 0.9 - 0.08 * x * x);
    }
  const index: number[] = [];
  const at = (i: number, j: number) => i * ny + j;
  for (let i = 0; i + 1 < nx; i++)
    for (let j = 0; j + 1 < ny; j++) index.push(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

describe('stiffeners under a thin panel', () => {
  it('go on the side facing the middle of the car, well clear of the skin', () => {
    const at = stiffenerPositions(sheet().positions, [0, 0, 0.4]);
    // A panel this long gets two, on the centre line, a good 10 cm under the skin.
    expect(at).toHaveLength(2);
    for (const p of at) {
      expect(Math.abs(p[0])).toBeLessThan(0.01);
      expect(p[2]).toBeLessThan(0.9 - 0.1);
      expect(p[2]).toBeGreaterThan(0.9 - 0.35);
    }
    // The same panel as a roof over the cabin's middle point above it: they go up instead.
    expect(stiffenerPositions(sheet().positions, [0, 0, 1.6]).every((p) => p[2] > 0.95)).toBe(true);
  });

  it('are left out of a part with depth of its own, and of small trim', () => {
    const box: number[] = [];
    for (const x of [-0.3, 0.3]) for (const y of [-0.4, 0.4]) for (const z of [0.2, 0.7]) box.push(x, y, z);
    expect(stiffenerPositions(box, [0, 0, 0])).toEqual([]);
    const strip = sheet(5, 2).positions.map((v, i) => (i % 3 === 0 ? v * 0.1 : v));
    expect(stiffenerPositions(strip, [0, 0, 0])).toEqual([]);
  });

  it('become nodes that collide with nothing, tied to the skin and to each other', () => {
    const plain = deriveStructure({ partId: 'p', mesh: sheet(), prefix: 'h', massKg: 22, bracing: 'standard' });
    const made = deriveStructure({ partId: 'p', mesh: sheet(), prefix: 'h', massKg: 22, bracing: 'standard', stiffenTowards: [0, 0, 0.4] });
    const extra = made.nodes.filter((n) => !plain.nodes.some((m) => m.id === n.id));
    expect(extra.map((n) => n.id)).toEqual(['hs1', 'hs2']);
    for (const n of extra) expect(n.options).toEqual({ collision: false, selfCollision: false });
    // Ten skin nodes each, and one between the two.
    expect(made.beams.length - plain.beams.length).toBe(21);
    expect(made.tris).toEqual(plain.tris);
    // The part's mass is shared out over all of its nodes.
    expect(made.nodes.reduce((s, n) => s + n.weight, 0)).toBeCloseTo(22, 1);
  });
});
