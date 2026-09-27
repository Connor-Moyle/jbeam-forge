import { describe, expect, it } from 'vitest';
import { Solver, type SimModel } from '../../src/shared/sim/solver';
import { precheck } from '../../src/shared/sim/model';
import { crash, drop, settle } from '../../src/shared/sim/scenarios';

/** Build a model from nodes and beams with uniform beam values. */
function model(nodes: [number, number, number][], beams: [number, number][], opts: Partial<{ mass: number; spring: number; damp: number; deform: number; strength: number; support: boolean; group: number[] }> = {}): SimModel {
  const n = nodes.length;
  const m = beams.length;
  return {
    nodeIds: nodes.map((_, i) => `n${i}`),
    pos: new Float64Array(nodes.flat()),
    mass: new Float64Array(n).fill(opts.mass ?? 1),
    friction: new Float64Array(n).fill(0.5),
    collide: new Uint8Array(n).fill(1),
    beamA: new Uint32Array(beams.map((b) => b[0])),
    beamB: new Uint32Array(beams.map((b) => b[1])),
    spring: new Float64Array(m).fill(opts.spring ?? 100_000),
    damp: new Float64Array(m).fill(opts.damp ?? 50),
    deform: new Float64Array(m).fill(opts.deform ?? Infinity),
    strength: new Float64Array(m).fill(opts.strength ?? Infinity),
    expansionLimit: new Float64Array(m).fill(1.1),
    compressionLimit: new Float64Array(m).fill(0.5),
    beamType: new Uint8Array(m).fill(opts.support ? 1 : 0),
    breakGroup: Int32Array.from(opts.group ?? new Array<number>(m).fill(-1)),
    breakGroups: ['g0', 'g1'],
    beamPart: new Array<string>(m).fill('p'),
  };
}

/** Unit cube, fully braced (12 edges + 4 space diagonals + 6 face diagonals). */
function cube(z0 = 0.5, size = 0.5): SimModel {
  const nodes: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) nodes.push([i & 1 ? size : 0, i & 2 ? size : 0, (i & 4 ? size : 0) + z0]);
  const beams: [number, number][] = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) beams.push([a, b]);
  return model(nodes, beams, { mass: 2, spring: 400_000, damp: 100 });
}

describe('Solver', () => {
  it('a hanging mass stretches its spring by m·g/k (no ground in the way)', () => {
    const mdl = model(
      [
        [0, 0, 10],
        [0, 0, 9],
      ],
      [[0, 1]],
      { spring: 10_000, damp: 100 },
    );
    mdl.mass[0] = 0; // mass 0 = fixed node (like BeamNG's "fixed")
    const s = new Solver(mdl);
    s.step(8000);
    const stretch = s.x[2]! - s.x[5]! - 1;
    expect(stretch).toBeCloseTo((1 * 9.81) / 10_000, 4);
  });

  it('deforms plastically past beamDeform and keeps the set', () => {
    const mdl = model(
      [
        [0, 0, 5],
        [1, 0, 5],
      ],
      [[0, 1]],
      { spring: 10_000, damp: 10, deform: 500 },
    );
    const s = new Solver(mdl, { gravity: 0 });
    s.extForce[3] = 2000; // pull node 1 along +X, 4× the yield force
    s.step(2000);
    expect(s.rest[0]!).toBeGreaterThan(1.02);
    expect(s.rest[0]!).toBeLessThanOrEqual(1.1 + 1e-9); // deformLimitExpansion 1.1
    const set = s.rest[0]!;
    s.extForce.fill(0);
    s.step(2000);
    expect(s.rest[0]).toBe(set); // the set stays
  });

  it('breaks past beamStrength and takes its breakGroup with it', () => {
    const mdl = model(
      [
        [0, 0, 5],
        [1, 0, 5],
        [0, 1, 5],
        [1, 1, 5],
      ],
      [
        [0, 1],
        [2, 3],
      ],
      { strength: 1000, group: [0, 0] },
    );
    const s = new Solver(mdl, { gravity: 0 });
    s.extForce[3] = 5000;
    s.step(100);
    expect([...s.broken]).toEqual([1, 1]);
    expect(s.breakLog).toEqual([0, 1]);
  });

  it('support beams push but never pull', () => {
    const mdl = model(
      [
        [0, 0, 5],
        [1, 0, 5],
      ],
      [[0, 1]],
      { support: true },
    );
    const s = new Solver(mdl, { gravity: 0 });
    s.v[3] = 1; // separating
    s.step(200);
    expect(s.x[3]!).toBeGreaterThan(1.09); // nothing held it back
  });

  it('a braced cube lands on the ground and comes to rest without sinking through', () => {
    const s = new Solver(cube(1));
    s.step(6000);
    let minZ = Infinity;
    for (let i = 0; i < s.n; i++) minZ = Math.min(minZ, s.x[i * 3 + 2]!);
    expect(minZ).toBeGreaterThan(-0.01);
    expect(s.kineticEnergy()).toBeLessThan(0.5);
    expect(s.divergence).toBeNull();
  });

  it('ground friction stops a sliding cube', () => {
    const s = new Solver(cube(0));
    for (let i = 0; i < s.n; i++) s.v[i * 3] = 3;
    s.step(4000);
    expect(Math.abs(s.v[0]!)).toBeLessThan(0.05);
  });

  it('reports the first node to diverge', () => {
    const mdl = model(
      [
        [0, 0, 5],
        [0.01, 0, 5],
      ],
      [[0, 1]],
      { mass: 0.001, spring: 1e9, damp: 0 },
    );
    const s = new Solver(mdl, { gravity: 0 });
    s.v[3] = 1; // kick it
    expect(s.step(200)).toBe(false);
    expect(s.divergence?.nodeId).toMatch(/^n[01]$/);
  });

  it('is deterministic and never mutates the authored model', () => {
    const mdl = cube(1);
    const before = Float64Array.from(mdl.pos);
    const a = new Solver(mdl);
    const b = new Solver(mdl);
    a.step(1000);
    b.step(1000);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(mdl.pos)).toEqual(Array.from(before));
    a.reset();
    expect(Array.from(a.x)).toEqual(Array.from(before));
  });
});

describe('scenarios', () => {
  it('settle, drop and crash run and summarise', () => {
    expect(settle(cube(0.3), 1).diverged).toBeNull();
    const d = drop(cube(0.3), 1, 1);
    expect(d.summary[0]).toMatch(/Dropped 1 m/);
    const c = crash(cube(0.3), 'wall', 30, 0.2);
    expect(c.summary[0]).toMatch(/30 km\/h into a full-width wall/);
    expect(c.beamStress.length).toBe(28);
  });
});

describe('precheck', () => {
  it('finds orphans, islands, duplicates, zero-length and unstable nodes', () => {
    const mdl = model(
      [
        [0, 0, 0],
        [1, 0, 0],
        [5, 0, 0],
        [6, 0, 0],
        [9, 9, 9],
        [1.0001, 0, 0],
      ],
      [
        [0, 1],
        [0, 1],
        [2, 3],
        [1, 5],
      ],
    );
    const codes = precheck(mdl).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['orphan', 'islands', 'duplicate-beam', 'zero-beam', 'near-orphan']));
    const heavy = model(
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      [[0, 1]],
      { mass: 0.001, spring: 4_000_000 },
    );
    expect(precheck(heavy).map((i) => i.code)).toContain('unstable');
  });
});
