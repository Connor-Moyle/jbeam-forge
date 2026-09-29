/**
 * The tutorial's practice car (fork): a simple car made in code, written as
 * an OBJ with named pieces (body, hood, doors, bumpers, wheels, seats…) so
 * the tutorial can walk through the real import, auto-classify, materials,
 * structure and export steps on something that looks like a car.
 *
 * Loader space, like every OBJ: +Y up, the car faces +Z, +X is its left.
 * Metres.
 */

type V3 = [number, number, number];

interface Piece {
  name: string;
  material: string;
  tris: V3[][];
}

/** A convex profile in the side view (z, y), extruded across the car; `half(y)` is the half width at height y. */
function extrude(profile: [number, number][], half: (y: number) => number, x0 = 0): V3[][] {
  const tris: V3[][] = [];
  const left = profile.map(([z, y]): V3 => [x0 + half(y), y, z]);
  const right = profile.map(([z, y]): V3 => [x0 - half(y), y, z]);
  for (let i = 1; i < profile.length - 1; i++) {
    tris.push([left[0]!, left[i]!, left[i + 1]!]);
    tris.push([right[0]!, right[i + 1]!, right[i]!]);
  }
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    tris.push([left[i]!, right[i]!, right[j]!], [left[i]!, right[j]!, left[j]!]);
  }
  return orient(tris, centroid(tris));
}

function box(c: V3, s: V3): V3[][] {
  const [cx, cy, cz] = c;
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const p = (x: number, y: number, z: number): V3 => [cx + x * hx, cy + y * hy, cz + z * hz];
  const faces: V3[][] = [
    [p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)],
    [p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1)],
    [p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)],
    [p(-1, -1, 1), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1)],
    [p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)],
    [p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1)],
  ];
  return orient(faces.flatMap((q) => [[q[0]!, q[1]!, q[2]!], [q[0]!, q[2]!, q[3]!]]), c);
}

/** A cylinder along X (wheels, the steering column is close enough). */
function cylinder(c: V3, radius: number, width: number, segments = 24, axis: 'x' | 'z' = 'x'): V3[][] {
  const tris: V3[][] = [];
  const at = (a: number, side: number): V3 => {
    const u = Math.cos(a) * radius;
    const v = Math.sin(a) * radius;
    return axis === 'x' ? [c[0] + side * width / 2, c[1] + v, c[2] + u] : [c[0] + u, c[1] + v, c[2] + side * width / 2];
  };
  const capA: V3 = axis === 'x' ? [c[0] + width / 2, c[1], c[2]] : [c[0], c[1], c[2] + width / 2];
  const capB: V3 = axis === 'x' ? [c[0] - width / 2, c[1], c[2]] : [c[0], c[1], c[2] - width / 2];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const b = ((i + 1) / segments) * Math.PI * 2;
    tris.push([at(a, 1), at(a, -1), at(b, -1)], [at(a, 1), at(b, -1), at(b, 1)], [capA, at(a, 1), at(b, 1)], [capB, at(b, -1), at(a, -1)]);
  }
  return orient(tris, c);
}

/** A thin slab between four corners (glass). */
function slab(corners: [V3, V3, V3, V3], thickness: number): V3[][] {
  const [a, b, c] = corners;
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n) || 1;
  const off = n.map((x) => (x / len) * thickness) as V3;
  const top = corners;
  const bottom = corners.map((p): V3 => [p[0] - off[0], p[1] - off[1], p[2] - off[2]]);
  const tris: V3[][] = [];
  const q = (p: V3[]) => tris.push([p[0]!, p[1]!, p[2]!], [p[0]!, p[2]!, p[3]!]);
  q([...top]);
  q([...bottom]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    q([top[i]!, top[j]!, bottom[j]!, bottom[i]!]);
  }
  const all = [...top, ...bottom];
  const mid = all.reduce<V3>((m, p) => [m[0] + p[0] / 8, m[1] + p[1] / 8, m[2] + p[2] / 8], [0, 0, 0]);
  return orient(tris, mid);
}

function centroid(tris: V3[][]): V3 {
  const m: V3 = [0, 0, 0];
  let n = 0;
  for (const t of tris)
    for (const p of t) {
      m[0] += p[0];
      m[1] += p[1];
      m[2] += p[2];
      n++;
    }
  return [m[0] / n, m[1] / n, m[2] / n];
}

/** Wind every triangle to face away from `inside` (convex pieces). */
function orient(tris: V3[][], inside: V3): V3[][] {
  return tris.map((t) => {
    const [a, b, c] = t as [V3, V3, V3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const out = [a[0] - inside[0], a[1] - inside[1], a[2] - inside[2]];
    return n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]! < 0 ? [a, c, b] : t;
  });
}

const MATERIALS: Record<string, { kd: V3; d?: number; ns?: number }> = {
  demo_paint: { kd: [0.72, 0.08, 0.06], ns: 200 },
  demo_glass: { kd: [0.08, 0.1, 0.12], d: 0.45, ns: 400 },
  demo_tyre: { kd: [0.03, 0.03, 0.03], ns: 10 },
  demo_rim: { kd: [0.75, 0.76, 0.78], ns: 300 },
  demo_trim: { kd: [0.08, 0.08, 0.08], ns: 40 },
  demo_headlight: { kd: [0.95, 0.95, 0.9], ns: 300 },
  demo_taillight: { kd: [0.6, 0.02, 0.02], ns: 300 },
  demo_interior: { kd: [0.22, 0.2, 0.19], ns: 20 },
  demo_engine: { kd: [0.3, 0.3, 0.32], ns: 80 },
};

/** The pieces, named the way modellers usually name them (so auto-classify finds them). */
export function demoCarPieces(): Piece[] {
  const W = 0.86; // half width of the body
  const pieces: Piece[] = [];
  const add = (name: string, material: string, tris: V3[][]) => pieces.push({ name, material, tris });

  // Lower body: a side profile from the front bumper line to the rear, wheel height to the shoulder line.
  add(
    'body',
    'demo_paint',
    extrude(
      [
        [2.05, 0.3],
        [2.1, 0.55],
        [1.95, 0.78],
        [0.55, 0.9],
        [-1.6, 0.92],
        [-2.05, 0.82],
        [-2.1, 0.45],
        [-1.95, 0.25],
      ],
      () => W,
    ),
  );
  // Roof and pillars: narrower towards the top.
  add(
    'roof',
    'demo_paint',
    extrude(
      [
        [0.45, 0.9],
        [-0.15, 1.33],
        [-1.05, 1.33],
        [-1.55, 0.92],
      ],
      (y) => W - 0.04 - (y - 0.9) * 0.3,
    ),
  );
  add('hood', 'demo_paint', box([0, 0.915, 1.28], [1.6, 0.03, 1.4]));
  add('trunk', 'demo_paint', box([0, 0.935, -1.8], [1.5, 0.03, 0.5]));
  for (const [tag, z] of [
    ['F', 0.05],
    ['R', -0.95],
  ] as const) {
    add(`door_${tag}L`, 'demo_paint', box([W + 0.012, 0.6, z], [0.02, 0.5, 0.95]));
    add(`door_${tag}R`, 'demo_paint', box([-W - 0.012, 0.6, z], [0.02, 0.5, 0.95]));
    add(`door_glass_${tag}L`, 'demo_glass', slab([[W - 0.05, 0.93, z + 0.42], [W - 0.05, 0.93, z - 0.42], [W - 0.14, 1.28, z - 0.3], [W - 0.14, 1.28, z + 0.3]], 0.01));
    add(`door_glass_${tag}R`, 'demo_glass', slab([[-W + 0.05, 0.93, z - 0.42], [-W + 0.05, 0.93, z + 0.42], [-W + 0.14, 1.28, z + 0.3], [-W + 0.14, 1.28, z - 0.3]], 0.01));
  }
  add('bumper_F', 'demo_trim', box([0, 0.38, 2.12], [1.76, 0.2, 0.12]));
  add('bumper_R', 'demo_trim', box([0, 0.4, -2.12], [1.76, 0.2, 0.12]));
  add('windshield', 'demo_glass', slab([[W - 0.08, 0.92, 0.47], [-W + 0.08, 0.92, 0.47], [-W + 0.2, 1.32, -0.13], [W - 0.2, 1.32, -0.13]], 0.01));
  add('rear_window', 'demo_glass', slab([[-W + 0.08, 0.93, -1.57], [W - 0.08, 0.93, -1.57], [W - 0.2, 1.32, -1.07], [-W + 0.2, 1.32, -1.07]], 0.01));
  add('headlight_L', 'demo_headlight', box([0.6, 0.66, 2.03], [0.32, 0.1, 0.1]));
  add('headlight_R', 'demo_headlight', box([-0.6, 0.66, 2.03], [0.32, 0.1, 0.1]));
  add('taillight_L', 'demo_taillight', box([0.62, 0.72, -2.06], [0.3, 0.1, 0.06]));
  add('taillight_R', 'demo_taillight', box([-0.62, 0.72, -2.06], [0.3, 0.1, 0.06]));
  add('mirror_L', 'demo_paint', box([W + 0.1, 0.98, 0.3], [0.16, 0.09, 0.07]));
  add('mirror_R', 'demo_paint', box([-W - 0.1, 0.98, 0.3], [0.16, 0.09, 0.07]));

  // Wheels: tyre and rim per corner.
  for (const [corner, x, z] of [
    ['FL', 0.74, 1.3],
    ['FR', -0.74, 1.3],
    ['RL', 0.74, -1.3],
    ['RR', -0.74, -1.3],
  ] as const) {
    add(`tire_${corner}`, 'demo_tyre', cylinder([x, 0.32, z], 0.32, 0.21));
    add(`wheel_${corner}`, 'demo_rim', cylinder([x + Math.sign(x) * 0.005, 0.32, z], 0.21, 0.2, 16));
  }

  // Inside: seats, steering wheel, dashboard, engine, exhaust.
  add('seat_FL', 'demo_interior', box([0.38, 0.62, -0.35], [0.5, 0.14, 0.5]));
  add('seat_FR', 'demo_interior', box([-0.38, 0.62, -0.35], [0.5, 0.14, 0.5]));
  add('dashboard', 'demo_interior', box([0, 0.88, 0.35], [1.6, 0.14, 0.3]));
  add('steering_wheel', 'demo_trim', cylinder([0.38, 0.98, 0.1], 0.18, 0.03, 20, 'z'));
  add('engine', 'demo_engine', box([0, 0.6, 1.3], [0.6, 0.45, 0.6]));
  add('radiator', 'demo_engine', box([0, 0.6, 1.9], [1.0, 0.4, 0.05]));
  add('exhaust', 'demo_trim', cylinder([-0.5, 0.22, -2.1], 0.04, 0.3, 12, 'z'));
  return pieces;
}

/** The practice car as OBJ text (with `mtllib demo_car.mtl`) and its MTL. */
export function demoCarObj(): { obj: string; mtl: string } {
  const lines = ['# JBeam Forge practice car (tutorial)', 'mtllib demo_car.mtl'];
  let base = 1;
  for (const p of demoCarPieces()) {
    lines.push(`o ${p.name}`, `usemtl ${p.material}`);
    for (const t of p.tris) for (const v of t) lines.push(`v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`);
    for (let i = 0; i < p.tris.length; i++, base += 3) lines.push(`f ${base} ${base + 1} ${base + 2}`);
  }
  const mtl = Object.entries(MATERIALS)
    .map(([name, m]) => [`newmtl ${name}`, `Kd ${m.kd.join(' ')}`, `Ks 0.5 0.5 0.5`, `Ns ${m.ns ?? 50}`, `d ${m.d ?? 1}`].join('\n'))
    .join('\n\n');
  return { obj: `${lines.join('\n')}\n`, mtl: `${mtl}\n` };
}
