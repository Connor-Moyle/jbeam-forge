import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The practice car the tutorial loads (assets/demo-car, built by scripts/dev/buildDemoCar.mts). */
const DIR = join(__dirname, '..', '..', 'assets', 'demo-car');

describe('shipped practice car', () => {
  const obj = readFileSync(join(DIR, 'demo_car.obj'), 'utf8');
  const mtl = readFileSync(join(DIR, 'demo_car.mtl'), 'utf8');
  const names = [...obj.matchAll(/^o (\S+)$/gm)].map((m) => m[1]);

  it('comes in the parts a car comes apart into, named for auto-classify', () => {
    for (const n of ['body', 'hood', 'trunk', 'spoiler', 'fender_FL', 'fender_FR', 'door_FL', 'door_FR', 'skirt_L', 'skirt_R', 'bumper_F', 'bumper_R', 'grille', 'windshield', 'rear_window', 'door_glass_FL', 'headlight_L', 'headlight_R', 'taillight_L', 'taillight_R', 'mirror_L', 'wheel_FL', 'tire_RR', 'seat_FL', 'seat_FR', 'steering_wheel', 'engine', 'engine_bay', 'radiator', 'intake', 'exhaust_manifold', 'battery', 'trunk_trim'])
      expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has every material it uses, and every texture they name', () => {
    for (const m of new Set([...obj.matchAll(/^usemtl (\S+)$/gm)].map((x) => x[1]))) expect(mtl).toContain(`newmtl ${m}`);
    for (const [, tex] of mtl.matchAll(/^map_Kd (\S+)$/gm)) expect(existsSync(join(DIR, tex!)), tex).toBe(true);
  });

  it('has each front seat on its own side of the car, and the engine under the bonnet', () => {
    const bounds = new Map<string, { lo: number[]; hi: number[] }>();
    const verts: number[][] = [];
    let cur = '';
    for (const line of obj.split('\n')) {
      if (line.startsWith('v ')) verts.push(line.split(' ').slice(1, 4).map(Number));
      else if (line.startsWith('o ')) cur = line.slice(2);
      else if (line.startsWith('f ')) {
        let b = bounds.get(cur);
        if (!b) bounds.set(cur, (b = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }));
        for (const c of line.split(' ').slice(1)) {
          const v = verts[Number(c.split('/')[0]) - 1]!;
          for (let k = 0; k < 3; k++) {
            b.lo[k] = Math.min(b.lo[k]!, v[k]!);
            b.hi[k] = Math.max(b.hi[k]!, v[k]!);
          }
        }
      }
    }
    expect(bounds.get('seat_FL')!.lo[0]).toBeGreaterThan(0.05);
    expect(bounds.get('seat_FR')!.hi[0]).toBeLessThan(-0.05);
    for (const s of ['seat_FL', 'seat_FR']) expect(bounds.get(s)!.hi[1]).toBeLessThan(1.2); // not the mirror on the windscreen
    for (const part of ['engine', 'intake', 'radiator']) expect(bounds.get(part)!.hi[1], part).toBeLessThan(bounds.get('hood')!.hi[1]! - 0.1);
  });

  it('is car sized and sits on the ground (+Y up, facing +Z)', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const [, x, y, z] of obj.matchAll(/^v (\S+) (\S+) (\S+)$/gm))
      [x, y, z].forEach((c, k) => {
        lo[k] = Math.min(lo[k]!, Number(c));
        hi[k] = Math.max(hi[k]!, Number(c));
      });
    expect(lo[1]).toBeCloseTo(0, 2);
    expect(hi[1]! - lo[1]!).toBeGreaterThan(1.3);
    expect(hi[1]! - lo[1]!).toBeLessThan(1.45);
    expect(hi[2]! - lo[2]!).toBeGreaterThan(4.2);
    expect(hi[2]! - lo[2]!).toBeLessThan(4.5);
  });
});
