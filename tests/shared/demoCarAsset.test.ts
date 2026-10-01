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
    for (const n of ['body', 'hood', 'trunk', 'spoiler', 'fender_FL', 'fender_FR', 'door_FL', 'door_FR', 'skirt_L', 'skirt_R', 'bumper_F', 'bumper_R', 'grille', 'windshield', 'rear_window', 'door_glass_FL', 'headlight_L', 'headlight_R', 'taillight_L', 'taillight_R', 'mirror_L', 'wheel_FL', 'tire_RR', 'seat_FL', 'seat_FR', 'steering_wheel', 'engine', 'engine_bay', 'radiator'])
      expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has every material it uses, and every texture they name', () => {
    for (const m of new Set([...obj.matchAll(/^usemtl (\S+)$/gm)].map((x) => x[1]))) expect(mtl).toContain(`newmtl ${m}`);
    for (const [, tex] of mtl.matchAll(/^map_Kd (\S+)$/gm)) expect(existsSync(join(DIR, tex!)), tex).toBe(true);
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
