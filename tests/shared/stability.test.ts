import { describe, expect, it } from 'vitest';
import { PHYSICS_DT, SAFE_RATIO, softenedValue, stabilise, stabilityLoad, WEIGHT_ALLOWANCE, type StabiliseBeam } from '@shared/proxy/stability';

/** A light panel: a 5×5 grid of 0.3 kg nodes with skin and cross braces at 800 kN/m (the practice car's fenders). */
function panel(): { weights: Map<string, number>; beams: StabiliseBeam[]; pos: Map<string, [number, number, number]> } {
  const weights = new Map<string, number>();
  const pos = new Map<string, [number, number, number]>();
  const beams: StabiliseBeam[] = [];
  const id = (i: number, j: number) => `n${i}_${j}`;
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      weights.set(id(i, j), 0.3);
      pos.set(id(i, j), [i * 0.15, 0, 1 + j * 0.15]);
    }
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++)
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1], [2, 0], [0, 2]] as const) {
        const a = i + di;
        const b = j + dj;
        if (a < 5 && b >= 0 && b < 5) beams.push({ id1: id(i, j), id2: id(a, b), spring: 800_000, damp: 60, fixed: false });
      }
  return { weights, beams, pos };
}

/** Plain explicit steps at 2000 Hz (no sub-steps, as the game): does any node run away? */
function blowsUp(weights: ReadonlyMap<string, number>, beams: readonly StabiliseBeam[], pos: ReadonlyMap<string, [number, number, number]>): boolean {
  const ids = [...weights.keys()];
  const at = new Map(ids.map((id, i) => [id, i]));
  const x = ids.flatMap((id) => pos.get(id)!);
  // A small knock, as the game's spawn gives.
  x[0]! += 0.002;
  const v = new Array<number>(x.length).fill(0);
  const rest = beams.map((b) => {
    const p = pos.get(b.id1)!;
    const q = pos.get(b.id2)!;
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  });
  for (let s = 0; s < 4000; s++) {
    const f = new Array<number>(x.length).fill(0);
    beams.forEach((b, k) => {
      const i = at.get(b.id1)! * 3;
      const j = at.get(b.id2)! * 3;
      const d = [x[j]! - x[i]!, x[j + 1]! - x[i + 1]!, x[j + 2]! - x[i + 2]!];
      const len = Math.hypot(...d);
      const u = d.map((c) => c / len);
      const rv = (v[j]! - v[i]!) * u[0]! + (v[j + 1]! - v[i + 1]!) * u[1]! + (v[j + 2]! - v[i + 2]!) * u[2]!;
      const t = b.spring * (len - rest[k]!) + b.damp * rv;
      for (let a = 0; a < 3; a++) {
        f[i + a]! += t * u[a]!;
        f[j + a]! -= t * u[a]!;
      }
    });
    for (let n = 0; n < ids.length; n++) {
      const m = weights.get(ids[n]!)!;
      for (let a = 0; a < 3; a++) {
        v[n * 3 + a]! += (f[n * 3 + a]! / m) * PHYSICS_DT;
        x[n * 3 + a]! += v[n * 3 + a]! * PHYSICS_DT;
      }
      if (!(Math.hypot(v[n * 3]!, v[n * 3 + 1]!, v[n * 3 + 2]!) < 100)) return true;
    }
  }
  return false;
}

describe('stability at the game physics rate', () => {
  it('a light, densely braced panel blows up as generated, and holds once eased', () => {
    const { weights, beams, pos } = panel();
    expect(blowsUp(weights, beams, pos)).toBe(true);
    const r = stabilise(weights, beams);
    expect(r.softened).toBeGreaterThan(0);
    // Some weight first, never past the allowance.
    expect(r.addedKg).toBeGreaterThan(0);
    for (const [id, w] of r.weights) expect(w).toBeLessThanOrEqual(weights.get(id)! * WEIGHT_ALLOWANCE + 1e-3);
    const after = new Map([...weights].map(([id, w]) => [id, r.weights.get(id) ?? w]));
    const eased = beams.map((b, i) => ({ ...b, spring: b.spring * r.springScale[i]!, damp: b.damp * r.dampScale[i]! }));
    expect(blowsUp(after, eased, pos)).toBe(false);
    // Every node is now within its limit.
    for (const id of weights.keys()) {
      const k = eased.filter((b) => b.id1 === id || b.id2 === id).reduce((s, b) => s + b.spring, 0);
      const c = eased.filter((b) => b.id1 === id || b.id2 === id).reduce((s, b) => s + b.damp, 0);
      expect(stabilityLoad(after.get(id)!, k, c)).toBeLessThanOrEqual(1);
    }
  });

  it('leaves a node alone when it is within its limit', () => {
    const weights = new Map([
      ['a', 2],
      ['b', 2],
    ]);
    const r = stabilise(weights, [{ id1: 'a', id2: 'b', spring: 500_000, damp: 50, fixed: false }]);
    expect([...r.springScale]).toEqual([1]);
    expect(r.softened).toBe(0);
    expect(r.weights.size).toBe(0);
  });

  it('never changes a fixed beam: the node it loads gets weight instead', () => {
    // A game subframe beam (10 MN/m) bolted to a 0.5 kg body node.
    const weights = new Map([['body', 0.5]]);
    const r = stabilise(weights, [
      { id1: 'body', id2: 'game_node', spring: 10_000_000, damp: 200, fixed: true },
      { id1: 'body', id2: 'other', spring: 800_000, damp: 60, fixed: false },
    ]);
    expect(r.springScale[0]).toBe(1);
    const w = r.weights.get('body')!;
    expect(w).toBeGreaterThan(0.5);
    expect(Math.sqrt((10_000_000 + 800_000 * r.springScale[1]!) / w) * PHYSICS_DT).toBeLessThanOrEqual(SAFE_RATIO + 1e-6);
  });

  it('eased values are written to two figures', () => {
    expect(softenedValue(800_000, 0.42)).toBe(330_000);
    expect(softenedValue(60, 0.5)).toBe(30);
    expect(softenedValue(800_000, 1)).toBe(800_000);
  });
});
