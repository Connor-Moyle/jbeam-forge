/**
 * Solver benchmark (SPEC §4.6): a braced lattice of ~2,000 nodes / ~20,000 beams.
 * Real time = 2,000 steps per simulated second.   npm run bench:solver
 */
import { Solver, type SimModel } from '../src/shared/sim/solver';

function lattice(nx: number, ny: number, nz: number): SimModel {
  const nodes: number[] = [];
  const idx = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) nodes.push(i * 0.3, j * 0.3, 0.3 + k * 0.3);
  const beams: [number, number][] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++)
        for (let di = 0; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++)
            for (let dk = -1; dk <= 1; dk++) {
              if (di === 0 && (dj < 0 || (dj === 0 && dk <= 0))) continue;
              const a = i + di;
              const b = j + dj;
              const c = k + dk;
              if (a < nx && b >= 0 && b < ny && c >= 0 && c < nz) beams.push([idx(i, j, k), idx(a, b, c)]);
            }
  const n = nodes.length / 3;
  const m = beams.length;
  return {
    nodeIds: Array.from({ length: n }, (_, i) => `n${i}`),
    pos: new Float64Array(nodes),
    mass: new Float64Array(n).fill(2),
    friction: new Float64Array(n).fill(0.5),
    collide: new Uint8Array(n).fill(1),
    beamA: new Uint32Array(beams.map((b) => b[0])),
    beamB: new Uint32Array(beams.map((b) => b[1])),
    spring: new Float64Array(m).fill(800_000),
    damp: new Float64Array(m).fill(60),
    deform: new Float64Array(m).fill(20_000),
    strength: new Float64Array(m).fill(60_000),
    expansionLimit: new Float64Array(m).fill(1.1),
    compressionLimit: new Float64Array(m).fill(0.5),
    beamType: new Uint8Array(m),
    breakGroup: new Int32Array(m).fill(-1),
    breakGroups: [],
    beamPart: new Array<string>(m).fill('p'),
  };
}

const model = lattice(20, 10, 10);
const s = new Solver(model);
s.step(200); // warm up the JIT
const steps = 2000;
const t = performance.now();
s.step(steps);
const ms = performance.now() - t;
const realtime = (steps / 2000) / (ms / 1000);
console.log(`${s.n} nodes, ${s.m} beams: ${steps} steps in ${ms.toFixed(0)} ms → ${(steps / (ms / 1000)).toFixed(0)} steps/s = ${realtime.toFixed(2)}× real time${s.divergence ? ' (DIVERGED)' : ''}`);
