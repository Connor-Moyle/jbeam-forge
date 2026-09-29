import { describe, expect, it } from 'vitest';
import { demoCarObj, demoCarPieces } from '@shared/tutorial/demoCar';

describe('tutorial practice car', () => {
  it('has the pieces a car has, named for auto-classify', () => {
    const names = demoCarPieces().map((p) => p.name);
    for (const n of ['body', 'hood', 'trunk', 'door_FL', 'door_RR', 'bumper_F', 'wheel_FL', 'tire_RR', 'windshield', 'seat_FL', 'engine']) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it('sits on the ground, faces +Z, is car sized', () => {
    const ys: number[] = [];
    const zs: number[] = [];
    const xs: number[] = [];
    for (const p of demoCarPieces())
      for (const t of p.tris)
        for (const v of t) {
          xs.push(v[0]);
          ys.push(v[1]);
          zs.push(v[2]);
        }
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(4);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2.1);
    expect(Math.max(...ys)).toBeLessThan(1.5);
  });

  it('faces point outwards on closed pieces', () => {
    const tyre = demoCarPieces().find((p) => p.name === 'tire_FL')!;
    // Signed volume of a closed, outward-wound mesh is positive.
    let vol = 0;
    for (const [a, b, c] of tyre.tris as [number, number, number][][]) vol += (a![0] * (b![1] * c![2] - b![2] * c![1]) - a![1] * (b![0] * c![2] - b![2] * c![0]) + a![2] * (b![0] * c![1] - b![1] * c![0])) / 6;
    expect(vol).toBeGreaterThan(0);
  });

  it('writes an OBJ with its materials', () => {
    const { obj, mtl } = demoCarObj();
    expect(obj).toContain('mtllib demo_car.mtl');
    expect(obj).toMatch(/^o door_FL$/m);
    const used = [...obj.matchAll(/^usemtl (\S+)$/gm)].map((m) => m[1]);
    for (const m of new Set(used)) expect(mtl).toContain(`newmtl ${m}`);
    const verts = obj.split('\n').filter((l) => l.startsWith('v ')).length;
    const maxIndex = Math.max(...obj.split('\n').filter((l) => l.startsWith('f ')).flatMap((l) => l.slice(2).split(' ').map(Number)));
    expect(maxIndex).toBe(verts);
  });
});
