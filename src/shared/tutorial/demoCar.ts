/**
 * The tutorial's practice car (fork): an E30-style saloon made in code, low
 * poly but car shaped, written as an OBJ with named pieces so the tutorial
 * can walk through the real import, auto-classify, materials, structure and
 * export steps on something that looks like a car.
 *
 * The outer skin is one loft of cross-sections along the car, cut into the
 * panels a real car comes apart into (doors with their window frames, front
 * wings, bonnet, boot lid, glass), so taking a panel off leaves an opening:
 * the engine bay under the bonnet, the cabin behind the doors. Wheels,
 * brakes, lights, bumpers, grille, mirrors, seats, dashboard, engine and
 * exhaust are their own pieces.
 *
 * Proportions after the BMW E30 318i saloon: 4.33 m long, 1.64 m wide,
 * 1.38 m high, 2.57 m wheelbase, 175/70 R14 tyres.
 *
 * Loader space, like every OBJ: +Y up, the car faces +Z, +X is its left.
 * Metres.
 */

type V3 = [number, number, number];
type Tri = [V3, V3, V3];

interface Piece {
  name: string;
  material: string;
  tris: Tri[];
}

// ---------------------------------------------------------------- dimensions

const HALF_W = 0.82; // body half width
const FRONT_Z = 2.12; // nose
const REAR_Z = -2.1; // tail
const FLOOR_Y = 0.2; // bottom of the sills
const BELT_Y = 0.975; // bottom of the side windows
const CREASE_Y = 0.82; // the waist crease
const WHEEL_R = 0.3; // 175/70 R14
const WHEEL_Y = WHEEL_R;
const AXLE_F = 1.285;
const AXLE_R = -1.285; // 2.57 m wheelbase
const TRACK_HALF = 0.705;
const ARCH_R = 0.355;

/** Where the windscreen, roof and rear window run (along the car). */
const SCREEN_BASE = 0.6;
const SCREEN_TOP = 0.02;
const ROOF_REAR = -0.98;
const DECK_FRONT = -1.42;
const ROOF_Y = 1.375;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** The height of the car's top along its centre line. */
function topY(z: number): number {
  if (z >= SCREEN_BASE) return lerp(0.995, 0.935, clamp01((z - SCREEN_BASE) / (FRONT_Z - SCREEN_BASE))); // bonnet, dropping to the nose
  if (z >= SCREEN_TOP) return lerp(ROOF_Y, 0.995, smooth((z - SCREEN_TOP) / (SCREEN_BASE - SCREEN_TOP))); // windscreen
  if (z >= ROOF_REAR) return ROOF_Y - 0.008 * ((z - (SCREEN_TOP + ROOF_REAR) / 2) / 0.55) ** 2; // roof, a little crown
  if (z >= DECK_FRONT) return lerp(1.035, ROOF_Y - 0.008, smooth((z - DECK_FRONT) / (ROOF_REAR - DECK_FRONT))); // rear window
  return lerp(1.035, 1.015, clamp01((DECK_FRONT - z) / (DECK_FRONT - REAR_Z))); // boot lid
}

/** Where the side ends and the top begins: the belt line in the cabin, the bonnet and boot shut lines elsewhere. */
function sideTop(z: number): number {
  return Math.min(BELT_Y, topY(z) - 0.015);
}

/** Half width in plan: straight sides, the corners rounded off. */
function halfWidth(z: number): number {
  if (z > 1.9) return HALF_W - 0.07 * ((z - 1.9) / (FRONT_Z - 1.9)) ** 2;
  if (z < -1.88) return HALF_W - 0.06 * ((-1.88 - z) / (-1.88 - REAR_Z)) ** 2;
  return HALF_W;
}

/** How far in the glasshouse leans at the roof (tumblehome). */
const TUMBLE = 0.15;

// ---------------------------------------------------------------- building blocks

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Signed volume of a closed mesh (positive when it's wound outwards). */
export function signedVolume(tris: readonly Tri[]): number {
  let v = 0;
  for (const [a, b, c] of tris) v += dot(a, cross(b, c)) / 6;
  return v;
}

const flip = (tris: Tri[]): Tri[] => tris.map(([a, b, c]) => [a, c, b]);
/** A closed piece wound outwards whichever way it was built. */
const outwards = (tris: Tri[]): Tri[] => (signedVolume(tris) < 0 ? flip(tris) : tris);

function quad(out: Tri[], a: V3, b: V3, c: V3, d: V3): void {
  const area = (p: V3, q: V3, r: V3) => Math.hypot(...cross(sub(q, p), sub(r, p)));
  if (area(a, b, c) > 1e-10) out.push([a, b, c]);
  if (area(a, c, d) > 1e-10) out.push([a, c, d]);
}

/** Wind every triangle to face away from `inside` (convex pieces). */
function orient(tris: Tri[], inside: V3): Tri[] {
  return tris.map((t) => {
    const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    return dot(n, sub(t[0], inside)) < 0 ? [t[0], t[2], t[1]] : t;
  });
}

function box(c: V3, s: V3): Tri[] {
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const p = (x: number, y: number, z: number): V3 => [c[0] + x * hx, c[1] + y * hy, c[2] + z * hz];
  const out: Tri[] = [];
  quad(out, p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1));
  quad(out, p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1));
  quad(out, p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1));
  quad(out, p(-1, -1, 1), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1));
  quad(out, p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));
  quad(out, p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1));
  return orient(out, c);
}

/** A box with its edges bevelled (seat cushions, the dashboard): a lathe-free rounded block. */
function roundedBox(c: V3, s: V3, r: number): Tri[] {
  // Eight corner points per face ring: a box with 45° chamfers on every edge.
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const rr = Math.min(r, hx, hy, hz);
  const ring = (y: number, inset: number): V3[] => {
    const ax = hx - inset;
    const az = hz - inset;
    const cx = ax - rr;
    const cz = az - rr;
    return [
      [cx, y, az],
      [ax, y, cz],
      [ax, y, -cz],
      [cx, y, -az],
      [-cx, y, -az],
      [-ax, y, -cz],
      [-ax, y, cz],
      [-cx, y, az],
    ].map(([x, yy, z]): V3 => [c[0] + x!, c[1] + yy!, c[2] + z!]);
  };
  const rings = [ring(-hy, rr), ring(-hy + rr, 0), ring(hy - rr, 0), ring(hy, rr)];
  const out: Tri[] = [];
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      quad(out, rings[k]![i]!, rings[k]![j]!, rings[k + 1]![j]!, rings[k + 1]![i]!);
    }
  const cap = (ring: V3[], y: number) => {
    const mid: V3 = [c[0], c[1] + y, c[2]];
    for (let i = 0; i < 8; i++) out.push([mid, ring[i]!, ring[(i + 1) % 8]!]);
  };
  cap(rings[0]!, -hy);
  cap(rings[3]!, hy);
  return outwards(out);
}

/**
 * A lathe about an axis through `c`: the profile is (radius, along-axis)
 * pairs, a closed loop; `axis` 'x' for wheels, 'z' for round lamps.
 */
function lathe(c: V3, profile: [number, number][], segments: number, axis: 'x' | 'y' | 'z' = 'x'): Tri[] {
  const at = (r: number, a: number, t: number): V3 => {
    const u = Math.cos(a) * r;
    const v = Math.sin(a) * r;
    if (axis === 'x') return [c[0] + t, c[1] + v, c[2] + u];
    if (axis === 'y') return [c[0] + u, c[1] + t, c[2] + v];
    return [c[0] + u, c[1] + v, c[2] + t];
  };
  const out: Tri[] = [];
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    const b = ((s + 1) / segments) * Math.PI * 2;
    for (let i = 0; i < profile.length; i++) {
      const [r0, t0] = profile[i]!;
      const [r1, t1] = profile[(i + 1) % profile.length]!;
      quad(out, at(r0, a, t0), at(r1, a, t1), at(r1, b, t1), at(r0, b, t0));
    }
  }
  return outwards(out);
}

/** A plain cylinder along an axis (pipes, lamps, discs). */
function cylinder(c: V3, radius: number, length: number, segments = 20, axis: 'x' | 'y' | 'z' = 'x'): Tri[] {
  const h = length / 2;
  return lathe(c, [[0, -h], [radius, -h], [radius, h], [0, h]], segments, axis);
}

/** Turn triangles about an axis through a pivot (Rodrigues). */
function rotate(tris: Tri[], pivot: V3, axis: V3, degrees: number): Tri[] {
  const len = Math.hypot(...axis);
  const k: V3 = [axis[0] / len, axis[1] / len, axis[2] / len];
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const turn = (p: V3): V3 => {
    const v = sub(p, pivot);
    const kv = cross(k, v);
    const kd = dot(k, v) * (1 - cos);
    return [pivot[0] + v[0] * cos + kv[0] * sin + k[0] * kd, pivot[1] + v[1] * cos + kv[1] * sin + k[1] * kd, pivot[2] + v[2] * cos + kv[2] * sin + k[2] * kd];
  };
  return tris.map((t) => [turn(t[0]), turn(t[1]), turn(t[2])]);
}


/** A torus (the steering wheel rim) about the Z axis through `c`. */
function torus(c: V3, radius: number, tube: number, segments = 32, sides = 8): Tri[] {
  const profile: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    profile.push([radius + Math.cos(a) * tube, Math.sin(a) * tube]);
  }
  return lathe(c, profile, segments, 'z');
}

/**
 * A bar swept along a path in plan (x, z) at a height: bumpers. The profile
 * is (outward, up) offsets from the path.
 */
function sweep(path: [number, number][], y: number, profile: [number, number][]): Tri[] {
  const frames = path.map(([x, z], i) => {
    const [px, pz] = path[Math.max(0, i - 1)]!;
    const [nx, nz] = path[Math.min(path.length - 1, i + 1)]!;
    const tx = nx - px;
    const tz = nz - pz;
    const l = Math.hypot(tx, tz) || 1;
    // Outward normal in plan: the tangent turned a quarter (paths run left to right across the front).
    return { x, z, ox: -tz / l, oz: tx / l };
  });
  const rings = frames.map((f) => profile.map(([o, u]): V3 => [f.x + f.ox * o, y + u, f.z + f.oz * o]));
  const out: Tri[] = [];
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      quad(out, rings[k]![i]!, rings[k]![j]!, rings[k + 1]![j]!, rings[k + 1]![i]!);
    }
  for (const ring of [rings[0]!, rings[rings.length - 1]!]) {
    const mid = ring.reduce<V3>((m, p) => [m[0] + p[0] / ring.length, m[1] + p[1] / ring.length, m[2] + p[2] / ring.length], [0, 0, 0]);
    for (let i = 0; i < ring.length; i++) out.push([mid, ring[i]!, ring[(i + 1) % ring.length]!]);
  }
  return outwards(out);
}

// ---------------------------------------------------------------- the skin

type Seg = 'floor' | 'side' | 'green' | 'top';

interface SectionPoint {
  x: number;
  y: number;
}

/** One half cross-section (x ≥ 0), bottom centre to top centre, and what each segment of it is. */
function halfSection(z: number): { pts: SectionPoint[]; segs: Seg[] } {
  const w = halfWidth(z);
  const st = sideTop(z);
  const ty = topY(z);
  const pts: SectionPoint[] = [];
  const segs: Seg[] = [];
  const push = (x: number, y: number, seg: Seg | null) => {
    if (seg) segs.push(seg);
    pts.push({ x, y });
  };
  // Floor, centre outwards.
  for (const f of [0, 0.2, 0.4, 0.6, 0.8]) push(f * (w - 0.07), FLOOR_Y, pts.length ? 'floor' : null);
  push(w - 0.07, FLOOR_Y, 'floor');
  // The side: the sill tucks under, the flat door skin, the waist crease, rolling in at the belt.
  const side: [number, number][] = [
    [w - 0.025, FLOOR_Y + 0.02],
    [w - 0.006, FLOOR_Y + 0.055],
    [w, 0.3],
    [w, 0.38],
    [w, 0.46],
    [w, 0.54],
    [w, 0.62],
    [w, 0.7],
    [w + 0.002, 0.77],
    [w + 0.008, CREASE_Y],
    [w + 0.002, CREASE_Y + 0.025],
    [w - 0.004, lerp(CREASE_Y + 0.025, st, 0.5)],
    [w - 0.012, st],
  ];
  // Round wheel arches: skin below the arch's curve lifts onto it (those patches collapse, leaving a clean opening).
  const axle = Math.abs(z - AXLE_F) < Math.abs(z - AXLE_R) ? AXLE_F : AXLE_R;
  const dz = z - axle;
  const archTop = Math.abs(dz) < ARCH_R ? WHEEL_Y + Math.sqrt(ARCH_R * ARCH_R - dz * dz) : -Infinity;
  for (const [x, y] of side) push(x, Math.max(Math.min(y, st), Math.min(archTop, st)), 'side');
  // The glasshouse side: up and in to the roof edge (collapses to nothing on the bonnet and boot).
  const rise = Math.max(0, ty - 0.035 - st);
  const edgeX = w - 0.012 - TUMBLE * clamp01(rise / (ROOF_Y - 0.035 - BELT_Y));
  for (let k = 1; k <= 10; k++) {
    const t = k / 10;
    push(lerp(w - 0.012, edgeX, t) - 0.01 * Math.sin(t * Math.PI), st + rise * t, 'green');
  }
  // The roof edge rounds over, then across the top to the centre (a little crown).
  const topEdge = st + rise;
  for (let k = 1; k <= 8; k++) {
    const t = k / 8;
    const x = edgeX * (1 - t) * (1 - 0.04 * Math.sin(t * Math.PI));
    const y = lerp(topEdge, ty, Math.sin((t * Math.PI) / 2) ** 0.6);
    push(x, y, 'top');
  }
  return { pts, segs };
}

/** Which panel a patch of the skin belongs to; null leaves a hole (the wheel arches). */
function panelOf(seg: Seg, x: number, y: number, z: number): string | null {
  const side = x > 0 ? 'L' : 'R';
  const nearAxle = Math.abs(z - AXLE_F) < Math.abs(z - AXLE_R) ? AXLE_F : AXLE_R;
  const archDist = Math.hypot(z - nearAxle, y - WHEEL_Y);
  if (seg === 'floor') return Math.abs(x) > 0.5 && Math.abs(z - nearAxle) < ARCH_R + 0.05 ? null : 'body';
  if (seg === 'side') {
    if (archDist < ARCH_R) return null;
    if (z > FRONT_DOOR[0] + 0.02 && y > FLOOR_Y + 0.03) return `fender_F${side}`;
    if (z <= FRONT_DOOR[0] && z >= FRONT_DOOR[1] && y > 0.25) return `door_F${side}`;
    if (z < REAR_DOOR[0] && z >= REAR_DOOR[1] && y > 0.25 && !(z < AXLE_R + ARCH_R + 0.03 && y < 0.64)) return `door_R${side}`;
    return 'body';
  }
  if (seg === 'green') {
    // The A-pillar runs up the windscreen's edge; windows sit inside the door frames.
    const pillarA = aPillarZ(y);
    if (z > pillarA - 0.075) return 'body';
    const inFrame = y > BELT_Y + 0.02 && y < ROOF_Y - 0.075;
    if (z <= FRONT_DOOR[0] && z >= FRONT_DOOR[1]) return inFrame && z > FRONT_DOOR[1] + 0.035 && z < pillarA - 0.11 ? `door_glass_F${side}` : `door_F${side}`;
    if (z < REAR_DOOR[0] && z >= REAR_DOOR[1]) return inFrame && z < REAR_DOOR[0] - 0.035 && z > cPillarZ(y) + 0.06 ? `door_glass_R${side}` : `door_R${side}`;
    return 'body';
  }
  // The top.
  if (z > SCREEN_BASE + 0.02) return 'hood';
  if (z > SCREEN_TOP) return 'windshield';
  if (z > ROOF_REAR) return 'body';
  if (z > DECK_FRONT) return 'rear_window';
  if (z > REAR_Z + 0.015) return 'trunk';
  return 'body';
}

/** The doors' front and rear edges (along the car). */
const FRONT_DOOR: [number, number] = [SCREEN_BASE - 0.02, -0.36];
const REAR_DOOR: [number, number] = [-0.39, -1.16];

/** The rear door window's back edge follows the C-pillar, leaning back towards the belt. */
function cPillarZ(y: number): number {
  return lerp(REAR_DOOR[1] + 0.02, ROOF_REAR + 0.02, clamp01((y - BELT_Y) / (ROOF_Y - BELT_Y)));
}

/** Where the windscreen's edge (the A-pillar) is at a height. */
function aPillarZ(y: number): number {
  // Invert the windscreen part of topY by bisection.
  let lo = SCREEN_TOP;
  let hi = SCREEN_BASE;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (topY(mid) - 0.035 > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The outer skin, cut into its panels. */
function skin(): Map<string, Tri[]> {
  const stations: number[] = [];
  for (let z = FRONT_Z; z > REAR_Z - 1e-9; z -= 0.025) stations.push(Math.max(REAR_Z, z));
  if (stations[stations.length - 1] !== REAR_Z) stations.push(REAR_Z);
  const loops = stations.map((z) => {
    const { pts, segs } = halfSection(z);
    // Full loop: the left half up, the right half (mirrored) back down.
    const left = pts.map((p): V3 => [p.x, p.y, z]);
    const right = pts
      .slice(1, -1)
      .reverse()
      .map((p): V3 => [-p.x, p.y, z]);
    const loopSegs: Seg[] = [...segs, ...[...segs].reverse()];
    return { pts: [...left, ...right], segs: loopSegs };
  });
  const panels = new Map<string, Tri[]>();
  const add = (name: string, t: Tri[]) => {
    const list = panels.get(name) ?? [];
    list.push(...t);
    panels.set(name, list);
  };
  for (let s = 0; s < loops.length - 1; s++) {
    const a = loops[s]!;
    const b = loops[s + 1]!;
    const n = a.pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const seg = a.segs[i] ?? 'floor';
      const raw: Tri[] = [];
      quad(raw, a.pts[i]!, b.pts[i]!, b.pts[j]!, a.pts[j]!);
      const c = [a.pts[i]!, a.pts[j]!, b.pts[i]!, b.pts[j]!].reduce<V3>((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4, m[2] + p[2] / 4], [0, 0, 0]);
      // Every section is star-shaped about the car's centre line: face away from it.
      const away: V3 = [c[0], c[1] - 0.7, 0];
      const t = raw.map((tr): Tri => (dot(cross(sub(tr[1], tr[0]), sub(tr[2], tr[0])), away) < 0 ? [tr[0], tr[2], tr[1]] : tr));
      const panel = panelOf(seg, c[0], c[1], c[2]);
      if (panel) add(panel, t);
    }
  }
  // The nose and tail panels close the ends.
  for (const [loop, name] of [
    [loops[0]!, 'body'],
    [loops[loops.length - 1]!, 'body'],
  ] as const) {
    const mid = loop.pts.reduce<V3>((m, p) => [m[0] + p[0] / loop.pts.length, m[1] + p[1] / loop.pts.length, m[2] + p[2] / loop.pts.length], [0, 0, 0]);
    const t: Tri[] = [];
    for (let i = 0; i < loop.pts.length; i++) t.push([mid, loop.pts[i]!, loop.pts[(i + 1) % loop.pts.length]!]);
    const outward: V3 = [0, 0, loop === loops[0] ? 1 : -1];
    add(name, t.map((tr) => (dot(cross(sub(tr[1], tr[0]), sub(tr[2], tr[0])), outward) < 0 ? [tr[0], tr[2], tr[1]] : tr)));
  }
  return panels;
}

/**
 * Give a single-sided panel an inside: a copy set in by `thickness` along the
 * vertex normals and turned round, so it looks solid from inside the car (and
 * when the panel next to it is off).
 */
function withInside(tris: Tri[], thickness = 0.005): Tri[] {
  const key = (p: V3) => `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(5)}`;
  const normals = new Map<string, V3>();
  for (const t of tris) {
    const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    for (const p of t) {
      const k = key(p);
      const m = normals.get(k) ?? [0, 0, 0];
      normals.set(k, [m[0] + n[0], m[1] + n[1], m[2] + n[2]]);
    }
  }
  const inset = (p: V3): V3 => {
    const n = normals.get(key(p))!;
    const l = Math.hypot(...n) || 1;
    return [p[0] - (n[0] / l) * thickness, p[1] - (n[1] / l) * thickness, p[2] - (n[2] / l) * thickness];
  };
  return [...tris, ...tris.map((t): Tri => [inset(t[0]), inset(t[2]), inset(t[1])])];
}

/** Wheel wells: the inside of each arch, so you don't look into the car through them. */
function wheelWells(): Tri[] {
  const out: Tri[] = [];
  for (const z0 of [AXLE_F, AXLE_R])
    for (const side of [1, -1]) {
      const r = ARCH_R + 0.01;
      const x0 = side * (HALF_W - 0.005);
      const x1 = side * (HALF_W - 0.27);
      const steps = 16;
      for (let k = 0; k < steps; k++) {
        const a0 = Math.PI * (-0.08 + (1.16 * k) / steps);
        const a1 = Math.PI * (-0.08 + (1.16 * (k + 1)) / steps);
        const p = (x: number, a: number): V3 => [x, WHEEL_Y + Math.sin(a) * r, z0 + Math.cos(a) * r];
        const t: Tri[] = [];
        quad(t, p(x0, a0), p(x1, a0), p(x1, a1), p(x0, a1));
        // Facing the wheel (inwards, towards the arch's centre).
        out.push(...t.map((tr): Tri => (dot(cross(sub(tr[1], tr[0]), sub(tr[2], tr[0])), sub([tr[0][0], WHEEL_Y, z0], tr[0])) < 0 ? [tr[0], tr[2], tr[1]] : tr)));
      }
      // The inner wall of the well.
      const wall: Tri[] = [];
      for (let k = 0; k < steps; k++) {
        const a0 = Math.PI * (-0.08 + (1.16 * k) / steps);
        const a1 = Math.PI * (-0.08 + (1.16 * (k + 1)) / steps);
        wall.push([
          [x1, WHEEL_Y, z0],
          [x1, WHEEL_Y + Math.sin(a0) * r, z0 + Math.cos(a0) * r],
          [x1, WHEEL_Y + Math.sin(a1) * r, z0 + Math.cos(a1) * r],
        ]);
      }
      out.push(...wall.map((tr): Tri => (dot(cross(sub(tr[1], tr[0]), sub(tr[2], tr[0])), [side, 0, 0]) < 0 ? [tr[0], tr[2], tr[1]] : tr)));
    }
  return out;
}

// ---------------------------------------------------------------- the rest of the car

const MATERIALS: Record<string, { kd: V3; d?: number; ns?: number; ks?: number }> = {
  demo_paint: { kd: [0.62, 0.05, 0.04], ns: 250, ks: 0.6 },
  demo_glass: { kd: [0.06, 0.08, 0.09], d: 0.4, ns: 400, ks: 0.8 },
  demo_tyre: { kd: [0.035, 0.035, 0.035], ns: 8, ks: 0.05 },
  demo_rim: { kd: [0.7, 0.71, 0.72], ns: 300, ks: 0.7 },
  demo_chrome: { kd: [0.5, 0.51, 0.53], ns: 600, ks: 0.95 },
  demo_trim: { kd: [0.05, 0.05, 0.05], ns: 40, ks: 0.2 },
  demo_headlight: { kd: [0.9, 0.9, 0.86], ns: 400, ks: 0.8 },
  demo_taillight: { kd: [0.55, 0.02, 0.02], ns: 300, ks: 0.6 },
  demo_indicator: { kd: [0.9, 0.45, 0.05], ns: 300, ks: 0.6 },
  demo_interior: { kd: [0.16, 0.15, 0.14], ns: 15, ks: 0.05 },
  demo_seat: { kd: [0.2, 0.19, 0.18], ns: 10, ks: 0.05 },
  demo_engine: { kd: [0.32, 0.32, 0.34], ns: 80, ks: 0.3 },
  demo_brake: { kd: [0.35, 0.34, 0.33], ns: 60, ks: 0.3 },
};

/** The pieces, named the way modellers usually name them (so auto-classify finds them). */
export function demoCarPieces(): Piece[] {
  const pieces: Piece[] = [];
  const add = (name: string, material: string, tris: Tri[]) => pieces.push({ name, material, tris });

  // The skin's panels (the body shell gets the wheel wells and the bulkhead too).
  const panels = skin();
  const glass = new Set(['windshield', 'rear_window']);
  const order = ['body', 'hood', 'trunk', 'fender_FL', 'fender_FR', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'windshield', 'rear_window', 'door_glass_FL', 'door_glass_FR', 'door_glass_RL', 'door_glass_RR'];
  for (const name of order) {
    let tris = withInside(panels.get(name) ?? []);
    if (name === 'body') {
      // The bulkhead between engine bay and cabin, and the parcel shelf behind the rear seat.
      tris = [...tris, ...wheelWells(), ...box([0, 0.6, SCREEN_BASE - 0.03], [2 * HALF_W - 0.06, 0.78, 0.02]), ...box([0, 1.02, DECK_FRONT + 0.02], [2 * HALF_W - 0.1, 0.015, 0.34])];
    }
    add(name, glass.has(name) || name.startsWith('door_glass') ? 'demo_glass' : 'demo_paint', tris);
  }

  // Chrome bumpers with their black end caps, wrapping round the corners.
  const bumper = (z: number, dir: 1 | -1, y: number): Tri[] => {
    const path: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const t = -1 + (2 * i) / 20;
      const x = t * (HALF_W + 0.02);
      const back = Math.max(0, Math.abs(t) - 0.78) / 0.22;
      path.push([x, z + dir * (0.045 - 0.16 * back * back)]);
    }
    const prof: [number, number][] = [
      [0.02, -0.055],
      [0.04, -0.035],
      [0.045, 0.02],
      [0.03, 0.05],
      [-0.03, 0.05],
      [-0.03, -0.055],
    ];
    const p = dir === 1 ? path : [...path].reverse();
    return sweep(p, y, prof);
  };
  add('bumper_F', 'demo_chrome', bumper(FRONT_Z, 1, 0.42));
  add('bumper_R', 'demo_chrome', bumper(REAR_Z, -1, 0.44));

  // The black nose panel round the lamps, and the kidney grille.
  const nose: Tri[] = [...box([0, 0.795, FRONT_Z + 0.008], [1.5, 0.19, 0.016])];
  for (const side of [1, -1]) {
    const kidney = roundedBox([side * 0.078, 0.8, FRONT_Z + 0.022], [0.12, 0.18, 0.03], 0.03);
    nose.push(...kidney);
  }
  add('grille', 'demo_trim', nose);

  // Four round headlamps and the front indicators in the bumper corners.
  for (const [side, tag] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const lamps = [
      ...lathe([side * 0.3, 0.8, FRONT_Z + 0.026], [[0, -0.012], [0.07, -0.012], [0.072, 0.008], [0.05, 0.02], [0, 0.024]], 24, 'z'),
      ...lathe([side * 0.52, 0.8, FRONT_Z + 0.026], [[0, -0.012], [0.08, -0.012], [0.082, 0.008], [0.058, 0.02], [0, 0.024]], 24, 'z'),
    ];
    add(`headlight_${tag}`, 'demo_headlight', lamps);
    add(`indicator_F${tag}`, 'demo_indicator', roundedBox([side * 0.64, 0.36, FRONT_Z + 0.03], [0.16, 0.05, 0.03], 0.012));
    // Wide tail lamps that wrap round onto the side.
    const tail = [...roundedBox([side * 0.56, 0.84, REAR_Z - 0.008], [0.5, 0.16, 0.024], 0.012), ...box([side * (halfWidth(REAR_Z + 0.06) + 0.002), 0.84, REAR_Z + 0.05], [0.012, 0.16, 0.1])];
    add(`taillight_${tag}`, 'demo_taillight', tail);
    // Door mirrors on the front corner of the front doors.
    const mirror = [...roundedBox([side * (HALF_W + 0.1), 1.03, 0.55], [0.13, 0.085, 0.085], 0.025), ...box([side * (HALF_W + 0.035), 1.01, 0.56], [0.05, 0.02, 0.03])];
    add(`mirror_${tag}`, 'demo_trim', mirror);
  }

  // Wheels: a rounded 175/70 R14 tyre, a spoked rim, and a brake disc behind it.
  for (const [corner, x, z] of [
    ['FL', TRACK_HALF, AXLE_F],
    ['FR', -TRACK_HALF, AXLE_F],
    ['RL', TRACK_HALF, AXLE_R],
    ['RR', -TRACK_HALF, AXLE_R],
  ] as const) {
    const out = Math.sign(x);
    const tyreProfile: [number, number][] = [
      [0.182, 0.075],
      [0.25, 0.085],
      [0.288, 0.08],
      [WHEEL_R, 0.06],
      [WHEEL_R, -0.06],
      [0.288, -0.08],
      [0.25, -0.085],
      [0.182, -0.075],
    ];
    add(`tire_${corner}`, 'demo_tyre', lathe([x, WHEEL_Y, z], tyreProfile, 36));
    const rim: Tri[] = [
      // The barrel and lip.
      ...lathe([x, WHEEL_Y, z], ([[0.16, -0.07], [0.182, -0.075], [0.182, 0.07], [0.172, 0.075], [0.16, 0.06]] as [number, number][]).map(([r, t]): [number, number] => [r, t * out]), 28),
      // The centre: hub and cap.
      ...cylinder([x + out * 0.035, WHEEL_Y, z], 0.055, 0.03, 16),
    ];
    // Eight spokes from the hub to the rim.
    for (let k = 0; k < 8; k++) rim.push(...rotate(box([x + out * 0.03, WHEEL_Y + 0.105, z], [0.018, 0.12, 0.028]), [x, WHEEL_Y, z], [1, 0, 0], k * 45));
    add(`wheel_${corner}`, 'demo_rim', rim);
    add(`brake_disc_${corner}`, 'demo_brake', lathe([x - out * 0.045, WHEEL_Y, z], [[0.06, -0.011], [0.128, -0.011], [0.128, 0.011], [0.06, 0.011]], 28));
  }

  // The cabin: carpet, dashboard, console, steering wheel (left-hand drive), front seats and the rear bench.
  add('carpet', 'demo_interior', box([0, FLOOR_Y + 0.045, -0.3], [2 * HALF_W - 0.18, 0.02, 1.9]));
  const dash: Tri[] = [
    ...roundedBox([0, 0.83, 0.44], [2 * HALF_W - 0.1, 0.2, 0.26], 0.05),
    ...rotate(roundedBox([0, 0.92, 0.38], [2 * HALF_W - 0.14, 0.05, 0.22], 0.02), [0, 0.92, 0.49], [1, 0, 0], -12),
    // The instrument binnacle ahead of the driver.
    ...roundedBox([0.37, 0.96, 0.35], [0.4, 0.08, 0.14], 0.03),
  ];
  add('dashboard', 'demo_interior', dash);
  add('center_console', 'demo_interior', [...roundedBox([0, 0.42, 0.02], [0.24, 0.36, 0.66], 0.04), ...cylinder([0, 0.64, -0.02], 0.012, 0.18, 10, 'y'), ...lathe([0, 0.74, -0.02], [[0, -0.02], [0.022, -0.012], [0.022, 0.012], [0, 0.02]], 12, 'y')]);
  const wheelC: V3 = [0.37, 0.93, 0.2];
  const steering: Tri[] = [
    ...torus([0, 0, 0], 0.19, 0.016, 36, 8),
    ...roundedBox([0, 0, 0], [0.09, 0.09, 0.05], 0.02),
    ...box([0, -0.09, 0], [0.03, 0.16, 0.02]),
    ...rotate(box([0.09, 0.01, 0], [0.17, 0.03, 0.02]), [0, 0, 0], [0, 0, 1], -8),
    ...rotate(box([-0.09, 0.01, 0], [0.17, 0.03, 0.02]), [0, 0, 0], [0, 0, 1], 8),
    ...cylinder([0, 0, 0.15], 0.022, 0.3, 10, 'z'),
  ];
  // Raked back like a real column, then moved to the driver's side.
  add('steering_wheel', 'demo_trim', rotate(steering, [0, 0, 0], [1, 0, 0], -24).map((t) => t.map((p): V3 => [p[0] + wheelC[0], p[1] + wheelC[1], p[2] + wheelC[2]]) as Tri));
  const frontSeat = (x: number): Tri[] => {
    const cushion = roundedBox([x, 0.42, -0.26], [0.5, 0.13, 0.52], 0.04);
    const backrest = rotate(roundedBox([x, 0.76, -0.5], [0.48, 0.62, 0.12], 0.05), [x, 0.48, -0.5], [1, 0, 0], -14);
    const headrest = rotate(roundedBox([x, 1.14, -0.54], [0.26, 0.16, 0.08], 0.03), [x, 0.48, -0.5], [1, 0, 0], -14);
    const frame = box([x, 0.3, -0.26], [0.36, 0.12, 0.42]);
    return [...cushion, ...backrest, ...headrest, ...frame];
  };
  add('seat_FL', 'demo_seat', frontSeat(0.37));
  add('seat_FR', 'demo_seat', frontSeat(-0.37));
  add('rear_seat', 'demo_seat', [...roundedBox([0, 0.38, -1.12], [2 * HALF_W - 0.3, 0.14, 0.5], 0.05), ...rotate(roundedBox([0, 0.72, -1.36], [2 * HALF_W - 0.3, 0.6, 0.12], 0.05), [0, 0.45, -1.36], [1, 0, 0], -18)]);

  // Under the bonnet: a slanted four-cylinder (block, head, cam cover, sump, pulleys, intake), the radiator and fan, the battery.
  const engine: Tri[] = [
    ...rotate([...box([0, 0.46, 1.3], [0.3, 0.3, 0.58]), ...box([0, 0.66, 1.3], [0.26, 0.12, 0.56]), ...roundedBox([0, 0.75, 1.3], [0.2, 0.07, 0.5], 0.025)], [0, 0.35, 1.3], [0, 0, 1], -30),
    ...box([0, 0.3, 1.3], [0.26, 0.12, 0.48]),
    ...cylinder([0.02, 0.4, 1.62], 0.07, 0.04, 20, 'z'),
    ...cylinder([0.14, 0.52, 1.6], 0.045, 0.06, 16, 'z'),
    ...box([-0.26, 0.64, 1.3], [0.12, 0.08, 0.42]),
    ...cylinder([-0.36, 0.72, 1.45], 0.09, 0.12, 20, 'x'),
  ];
  add('engine', 'demo_engine', engine);
  add('radiator', 'demo_engine', [...box([0, 0.6, 1.93], [0.64, 0.36, 0.05]), ...cylinder([0, 0.6, 1.88], 0.15, 0.03, 20, 'z')]);
  add('battery', 'demo_trim', box([-0.56, 0.62, 0.9], [0.18, 0.18, 0.26]));

  // The exhaust: down the underside, a silencer at the back, out under the rear right.
  add('exhaust', 'demo_trim', [...cylinder([-0.18, 0.2, -0.2], 0.03, 2.8, 12, 'z'), ...roundedBox([-0.3, 0.21, -1.75], [0.36, 0.12, 0.4], 0.04), ...cylinder([-0.48, 0.21, -2.06], 0.028, 0.22, 12, 'z')]);

  return pieces;
}

/**
 * Smooth normals within a piece, keeping edges sharper than `creaseDeg` as
 * creases: each corner averages the neighbouring faces that turn less than
 * that from its own.
 */
function smoothNormals(tris: readonly Tri[], creaseDeg = 38): V3[][] {
  const key = (p: V3) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
  const faceN = tris.map((t) => {
    const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    const l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l, n[2] / l] as V3;
  });
  const around = new Map<string, number[]>();
  tris.forEach((t, i) => {
    for (const p of t) {
      const k = key(p);
      const list = around.get(k) ?? [];
      list.push(i);
      around.set(k, list);
    }
  });
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  return tris.map((t, i) =>
    t.map((p) => {
      const sum: V3 = [0, 0, 0];
      for (const j of around.get(key(p)) ?? [i]) {
        if (dot(faceN[i]!, faceN[j]!) < cosCrease) continue;
        sum[0] += faceN[j]![0];
        sum[1] += faceN[j]![1];
        sum[2] += faceN[j]![2];
      }
      const l = Math.hypot(...sum) || 1;
      return [sum[0] / l, sum[1] / l, sum[2] / l] as V3;
    }),
  );
}

/** The practice car as OBJ text (with `mtllib demo_car.mtl`) and its MTL. */
export function demoCarObj(): { obj: string; mtl: string } {
  const lines = ['# JBeam Forge practice car (tutorial): an E30-style saloon', 'mtllib demo_car.mtl'];
  let vBase = 1;
  let nBase = 1;
  for (const p of demoCarPieces()) {
    if (!p.tris.length) continue;
    lines.push(`o ${p.name}`, `usemtl ${p.material}`);
    // Shared vertices and normals within the piece.
    const vIndex = new Map<string, number>();
    const nIndex = new Map<string, number>();
    const vLines: string[] = [];
    const nLines: string[] = [];
    const fLines: string[] = [];
    const normals = smoothNormals(p.tris);
    p.tris.forEach((t, i) => {
      const f = t.map((v, k) => {
        const vk = `${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`;
        let vi = vIndex.get(vk);
        if (vi === undefined) {
          vi = vBase + vIndex.size;
          vIndex.set(vk, vi);
          vLines.push(`v ${vk}`);
        }
        const n = normals[i]![k]!;
        const nk = `${n[0].toFixed(3)} ${n[1].toFixed(3)} ${n[2].toFixed(3)}`;
        let ni = nIndex.get(nk);
        if (ni === undefined) {
          ni = nBase + nIndex.size;
          nIndex.set(nk, ni);
          nLines.push(`vn ${nk}`);
        }
        return `${vi}//${ni}`;
      });
      fLines.push(`f ${f.join(' ')}`);
    });
    lines.push(...vLines, ...nLines, ...fLines);
    vBase += vIndex.size;
    nBase += nIndex.size;
  }
  const mtl = Object.entries(MATERIALS)
    .map(([name, m]) => [`newmtl ${name}`, `Kd ${m.kd.join(' ')}`, `Ks ${m.ks ?? 0.5} ${m.ks ?? 0.5} ${m.ks ?? 0.5}`, `Ns ${m.ns ?? 50}`, `d ${m.d ?? 1}`].join('\n'))
    .join('\n\n');
  return { obj: `${lines.join('\n')}\n`, mtl: `${mtl}\n` };
}
