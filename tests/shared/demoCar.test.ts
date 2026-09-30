import { describe, expect, it } from 'vitest';
import { demoCarObj, demoCarPieces, signedVolume } from '@shared/tutorial/demoCar';

const pieces = demoCarPieces();
const bounds = (names?: RegExp) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pieces) {
    if (names && !names.test(p.name)) continue;
    for (const t of p.tris)
      for (const v of t)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, v[k]!);
          hi[k] = Math.max(hi[k]!, v[k]!);
        }
  }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]!) };
};

describe('tutorial practice car (E30-style saloon)', () => {
  it('has every piece a car comes apart into, named for auto-classify', () => {
    const names = pieces.map((p) => p.name);
    for (const n of ['body', 'hood', 'trunk', 'fender_FL', 'fender_FR', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'door_glass_FL', 'door_glass_RR', 'windshield', 'rear_window', 'bumper_F', 'bumper_R', 'grille', 'headlight_L', 'headlight_R', 'taillight_L', 'indicator_FL', 'mirror_L', 'wheel_FL', 'tire_RR', 'brake_disc_FL', 'seat_FL', 'seat_FR', 'rear_seat', 'dashboard', 'center_console', 'steering_wheel', 'carpet', 'engine', 'radiator', 'battery', 'exhaust']) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
    for (const p of pieces) expect(p.tris.length, p.name).toBeGreaterThan(0);
  });

  it('is E30 sized: sits on the ground, faces +Z, 4.3 m long, 1.64 m wide, 1.38 m high, 2.57 m wheelbase', () => {
    const all = bounds();
    expect(all.lo[1]).toBeCloseTo(0, 2);
    expect(all.hi[1]).toBeGreaterThan(1.36);
    expect(all.hi[1]).toBeLessThan(1.4);
    expect(all.size[2]).toBeGreaterThan(4.25);
    expect(all.size[2]).toBeLessThan(4.45);
    const body = bounds(/^(body|door_..|fender_..)$/);
    expect(body.size[0]).toBeGreaterThan(1.6);
    expect(body.size[0]).toBeLessThan(1.7);
    const front = bounds(/^tire_FL$/);
    const rear = bounds(/^tire_RL$/);
    expect((front.lo[2]! + front.hi[2]!) / 2 - (rear.lo[2]! + rear.hi[2]!) / 2).toBeCloseTo(2.57, 2);
    // The front is +Z: the headlamps are ahead of the tail lamps.
    expect(bounds(/^headlight_L$/).lo[2]).toBeGreaterThan(bounds(/^taillight_L$/).hi[2]!);
  });

  it('closed pieces are wound outwards', () => {
    for (const n of ['tire_FL', 'wheel_FL', 'seat_FL', 'headlight_L', 'bumper_F']) expect(signedVolume(pieces.find((p) => p.name === n)!.tris), n).toBeGreaterThan(0);
  });

  it('panels have an inside, so they look solid with the panel next to them off', () => {
    // Every outer triangle has a turned-round twin just inside it.
    const door = pieces.find((p) => p.name === 'door_FL')!;
    expect(door.tris.length % 2).toBe(0);
    expect(Math.abs(signedVolume(door.tris))).toBeLessThan(0.01);
  });

  it('writes an OBJ with shared vertices, normals and its materials', () => {
    const { obj, mtl } = demoCarObj();
    expect(obj).toContain('mtllib demo_car.mtl');
    expect(obj).toMatch(/^o door_FL$/m);
    const lines = obj.split('\n');
    const used = [...obj.matchAll(/^usemtl (\S+)$/gm)].map((m) => m[1]);
    for (const m of new Set(used)) expect(mtl).toContain(`newmtl ${m}`);
    let verts = 0;
    let normals = 0;
    let maxV = 0;
    let maxN = 0;
    for (const l of lines) {
      if (l.startsWith('v ')) verts++;
      else if (l.startsWith('vn ')) normals++;
      else if (l.startsWith('f '))
        for (const c of l.slice(2).split(' ')) {
          const [v, , n] = c.split('/').map(Number);
          maxV = Math.max(maxV, v!);
          maxN = Math.max(maxN, n!);
        }
    }
    expect(maxV).toBe(verts);
    expect(maxN).toBe(normals);
  });
});
