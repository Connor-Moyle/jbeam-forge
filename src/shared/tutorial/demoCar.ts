/**
 * The tutorial's practice car (fork): a BMW E30 318i saloon made in code and
 * written as an OBJ with named pieces, so the tutorial can walk through the
 * real import, auto-classify, materials, structure and export steps on
 * something that looks like the real car.
 *
 * Built like a modeller would: every panel is its own clean grid of quads
 * (written to the OBJ as quads), cut exactly on its shut lines, with edge
 * loops round the wheel arches, along the waist crease and round the window
 * frames. Each panel has an inside and edges (a thin shell), so taking one
 * off shows the car behind it: the engine bay under the bonnet, the cabin
 * behind the doors.
 *
 * E30 details: the shark nose with the kidney grille and four round lamps in
 * a black band, chrome bumpers with a rubber strip and black end caps, the
 * waist crease running nose to tail, thin pillars, the Hofmeister kink in
 * the rear side window, a short flat boot and wide ribbed tail lamps,
 * cross-spoke wheels.
 *
 * Dimensions (E30 318i saloon): 4.325 m long, 1.645 m wide, 1.38 m high,
 * 2.57 m wheelbase, 1.407 m front track, 175/70 R14 tyres.
 *
 * Loader space, like every OBJ: +Y up, the car faces +Z, +X is its left.
 * Metres.
 */

type V3 = [number, number, number];
type Tri = [V3, V3, V3];
/** A face: 3 or 4 corners, wound anticlockwise seen from outside. */
type Face = V3[];
type Grid = V3[][];

interface Group {
  material: string;
  faces: Face[];
}

interface Piece {
  name: string;
  /** The piece's main material. */
  material: string;
  /** Every face as triangles. */
  tris: Tri[];
  /** The faces by material, quads kept (what the OBJ holds). */
  groups: Group[];
}

// ---------------------------------------------------------------- dimensions

const W = 0.8225; // body half width
const NOSE_Z = 2.065; // front face of the body (the bumper stands 0.1 m proud)
const TAIL_Z = -2.07;
const AXLE_F = 1.315;
const AXLE_R = -1.255; // 2.57 m wheelbase
const TRACK_F = 0.7035;
const TRACK_R = 0.7075;
const WHEEL_R = 0.3; // 175/70 R14
const WHEEL_Y = 0.3;
const ARCH_R = 0.372;
const ARCH_Y = 0.318;
const SILL_Y = 0.2; // bottom of the sills
const DOOR_BOTTOM = 0.27;
/** Where the lower sides (round the arches) meet the upper band with the crease. */
const MID_Y = 0.74;
const COWL_Z = 0.44; // bonnet's back edge, windscreen's foot
const DECK_Z = -1.72; // boot lid's front edge, rear window's foot
const RAIL_Y = 1.335; // roof side rails
const ROOF_Y = 1.378; // roof centre
const TUMBLE = 0.15; // how far the glasshouse leans in at the roof
const GAP = 0.0025; // half a shut line

/** The doors' edges along the car, below the windows. */
const FRONT_DOOR: [number, number] = [0.445, -0.52];
const REAR_DOOR_FRONT = -0.52;
/** Where the arches' surrounds end (the lower sides are built as rings round them). */
const ARCH_F: [number, number] = [AXLE_F + 0.43, AXLE_F - 0.43];
const ARCH_B: [number, number] = [AXLE_R + 0.4, AXLE_R - 0.4];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => t * t * (3 - 2 * t);
const linspace = (a: number, b: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
/** Points from a to b bunched towards b (for rounded ends). */
const easeTo = (a: number, b: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, Math.sin(((i / n) * Math.PI) / 2)));
const joinRuns = (...runs: number[][]): number[] => runs.flatMap((r, i) => (i ? r.slice(1) : r));

/** Half width in plan: straight sides, the corners rounded off. */
function halfW(z: number): number {
  if (z > 1.93) return W - 0.045 * ((z - 1.93) / (NOSE_Z - 1.93)) ** 2;
  if (z < -1.95) return W - 0.035 * ((-1.95 - z) / (-1.95 - TAIL_Z)) ** 2;
  return W;
}

/** The waist crease: from the top of the lamps at the front to the top of the tail lamps. */
const creaseY = (z: number) => lerp(0.842, 0.858, (NOSE_Z - z) / (NOSE_Z - TAIL_Z));
/** Bottom of the side windows. */
const beltY = (z: number) => lerp(0.915, 0.945, clamp01((COWL_Z - z) / (COWL_Z - DECK_Z)));
const HOOD_FRONT_Y = 0.872;
const BOOT_Y = 0.975;

/** Where the lower side ends and the bonnet, windows or boot lid begin. */
function topEdgeY(z: number): number {
  if (z >= COWL_Z) return lerp(beltY(COWL_Z), HOOD_FRONT_Y, (z - COWL_Z) / (NOSE_Z - COWL_Z));
  if (z >= DECK_Z) return beltY(z);
  return lerp(beltY(DECK_Z), BOOT_Y, smooth(clamp01((DECK_Z - z) / 0.12)));
}
/** The shoulder's top edge sits this far in from the widest point. */
const SHOULDER_IN = 0.039;

/** The body side's half width at a height: tucked-under sill, flat door skin, the crease, the shoulder leaning in. */
function sideX(y: number, z: number): number {
  const hw = halfW(z);
  const c = creaseY(z);
  const top = topEdgeY(z);
  if (y <= 0.34) {
    const t = (0.34 - y) / (0.34 - SILL_Y);
    return hw - 0.004 - 0.05 * t * t;
  }
  if (y <= c) {
    const t = (y - 0.34) / (c - 0.34);
    return hw - 0.004 + 0.007 * t ** 4;
  }
  const s = clamp01((y - c) / Math.max(0.01, top - c));
  return hw + 0.003 - (SHOULDER_IN + 0.003) * (0.35 * s + 0.65 * s * s);
}

/** The glasshouse side: from the shoulder's top edge leaning in to the roof rail. */
const XR = W - SHOULDER_IN - TUMBLE; // roof rail half width
function ghPoint(z: number, t: number): V3 {
  const y = lerp(beltY(z), RAIL_Y, t);
  const x = halfW(z) - SHOULDER_IN - TUMBLE * t ** 1.15;
  return [x, y, z];
}

/** The windscreen's side edge along the car (its rake), and the A-pillar's rear edge behind it. */
const screenZ = (t: number) => lerp(COWL_Z - 0.02, -0.16, t);
const aRear = (t: number) => screenZ(t) - 0.075;

/** The rear side window's back edge: up from the belt, the Hofmeister kink, then forward up the C-pillar. */
function cEdge(t: number): number {
  const pts: [number, number][] = [
    [0, -1.09],
    [0.16, -1.155],
    [0.3, -1.172],
    [0.45, -1.15],
    [0.7, -1.07],
    [1, -0.99],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, z0] = pts[i]!;
    const [t1, z1] = pts[i + 1]!;
    if (t <= t1) {
      // Catmull-Rom through the neighbours for a smooth kink.
      const zm = pts[Math.max(0, i - 1)]![1];
      const zp = pts[Math.min(pts.length - 1, i + 2)]![1];
      const s = (t - t0) / (t1 - t0);
      const m0 = (z1 - zm) / 2;
      const m1 = (zp - z0) / 2;
      const s2 = s * s;
      const s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * z0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * z1 + (s3 - s2) * m1;
    }
  }
  return pts[pts.length - 1]![1];
}
const REAR_DOOR_BACK = cEdge(0);
/** Roof: the rear window's top corners and centre. */
const ROOF_BACK_SIDE_Z = -1.13;
const ROOF_BACK_Z = -1.22;
const roofY = (u: number) => RAIL_Y + (ROOF_Y - RAIL_Y) * (1 - u ** 4);

// ---------------------------------------------------------------- vector helpers

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mirrorX = (p: V3): V3 => [-p[0], p[1], p[2]];

/** Newell normal of a face (not normalised). */
function faceNormal(f: Face): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < f.length; i++) {
    const a = f[i]!;
    const b = f[(i + 1) % f.length]!;
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

const flipFace = (f: Face): Face => [f[0]!, ...f.slice(1).reverse()];

/** Signed volume of a closed mesh (positive when it's wound outwards). */
export function signedVolume(tris: readonly Tri[]): number {
  let v = 0;
  for (const [a, b, c] of tris) v += dot(a, cross(b, c)) / 6;
  return v;
}

function triangulate(faces: readonly Face[]): Tri[] {
  const out: Tri[] = [];
  for (const f of faces) for (let i = 1; i + 1 < f.length; i++) out.push([f[0]!, f[i]!, f[i + 1]!]);
  return out;
}

/** Drop repeated corners; null when too little is left to be a face. */
function clean(f: Face): Face | null {
  const out: Face = [];
  for (const p of f) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1e-7) out.push(p);
  }
  while (out.length > 1 && Math.hypot(...sub(out[0]!, out[out.length - 1]!)) <= 1e-7) out.pop();
  if (out.length < 3) return null;
  return Math.hypot(...faceNormal(out)) > 1e-10 ? out : null;
}

/** Closed pieces wound outwards whichever way they were built. */
function outwards(faces: Face[]): Face[] {
  return signedVolume(triangulate(faces)) < 0 ? faces.map(flipFace) : faces;
}

// ---------------------------------------------------------------- patches

/** A grid of points: rows along `vs`, columns along `us`. */
function sample(us: readonly number[], vs: readonly number[], f: (u: number, v: number) => V3): Grid {
  return vs.map((v) => us.map((u) => f(u, v)));
}

/**
 * Coons patch through four boundary curves: c0(u) at v = 0, c1(u) at v = 1,
 * d0(v) at u = 0, d1(v) at u = 1 (the corners must meet).
 */
function coons(c0: (u: number) => V3, c1: (u: number) => V3, d0: (v: number) => V3, d1: (v: number) => V3): (u: number, v: number) => V3 {
  const p00 = c0(0);
  const p10 = c0(1);
  const p01 = c1(0);
  const p11 = c1(1);
  return (u, v) => {
    const a = add(scale(c0(u), 1 - v), scale(c1(u), v));
    const b = add(scale(d0(v), 1 - u), scale(d1(v), u));
    const c = add(add(scale(p00, (1 - u) * (1 - v)), scale(p10, u * (1 - v))), add(scale(p01, (1 - u) * v), scale(p11, u * v)));
    return sub(add(a, b), c);
  };
}

/** The grid's quads, wound so they face `out` (a direction, or a function of the patch's middle). */
function gridFaces(g: Grid, out: V3): Face[] {
  const faces: Face[] = [];
  for (let r = 0; r + 1 < g.length; r++)
    for (let c = 0; c + 1 < g[r]!.length; c++) {
      const f = clean([g[r]![c]!, g[r]![c + 1]!, g[r + 1]![c + 1]!, g[r + 1]![c]!]);
      if (f) faces.push(f);
    }
  // One winding for the whole patch, chosen by its faces' average normal.
  const sum = faces.reduce<V3>((s, f) => add(s, faceNormal(f)), [0, 0, 0]);
  return dot(sum, out) < 0 ? faces.map(flipFace) : faces;
}

/**
 * A panel with thickness: the outer skin facing `out`, an inner skin set in
 * along the normals, and the edges between them, so it is a closed shell.
 */
function shell(g: Grid, out: V3, thickness = 0.006): Face[] {
  const rows = g.length;
  const cols = g[0]!.length;
  const outer = gridFaces(g, out);
  const flipped = outer.length > 0 && (() => {
    const sum = outer.reduce<V3>((s, f) => add(s, faceNormal(f)), [0, 0, 0]);
    // The grid's own winding faces sum·out < 0 when gridFaces turned it round.
    const raw: V3 = [0, 0, 0];
    for (let r = 0; r + 1 < rows; r++)
      for (let c = 0; c + 1 < cols; c++) {
        const f = clean([g[r]![c]!, g[r]![c + 1]!, g[r + 1]![c + 1]!, g[r + 1]![c]!]);
        if (f) {
          const n = faceNormal(f);
          raw[0] += n[0];
          raw[1] += n[1];
          raw[2] += n[2];
        }
      }
    return dot(raw, sum) < 0;
  })();
  // Vertex normals from the grid's neighbours (facing out).
  const nrm = (r: number, c: number): V3 => {
    const du = sub(g[r]![Math.min(cols - 1, c + 1)]!, g[r]![Math.max(0, c - 1)]!);
    const dv = sub(g[Math.min(rows - 1, r + 1)]![c]!, g[Math.max(0, r - 1)]![c]!);
    let n = cross(du, dv);
    if (Math.hypot(...n) < 1e-12) n = out;
    n = norm(n);
    return flipped ? scale(n, -1) : n;
  };
  const inner: Grid = g.map((row, r) => row.map((p, c) => sub(p, scale(nrm(r, c), thickness))));
  const faces = [...outer];
  for (const f of gridFaces(inner, scale(out, -1))) faces.push(f);
  // The edges: walk the border and close it with a strip.
  const border: [number, number][] = [];
  for (let c = 0; c < cols - 1; c++) border.push([0, c]);
  for (let r = 0; r < rows - 1; r++) border.push([r, cols - 1]);
  for (let c = cols - 1; c > 0; c--) border.push([rows - 1, c]);
  for (let r = rows - 1; r > 0; r--) border.push([r, 0]);
  const rim: Face[] = [];
  for (let i = 0; i < border.length; i++) {
    const [r0, c0] = border[i]!;
    const [r1, c1] = border[(i + 1) % border.length]!;
    const f = clean([g[r0]![c0]!, inner[r0]![c0]!, inner[r1]![c1]!, g[r1]![c1]!]);
    if (f) rim.push(f);
  }
  // The rim faces away from the panel's middle.
  const mid = g[Math.floor(rows / 2)]![Math.floor(cols / 2)]!;
  for (const f of rim) {
    const c = scale(f.reduce<V3>((s, p) => add(s, p), [0, 0, 0]), 1 / f.length);
    faces.push(dot(faceNormal(f), sub(c, mid)) < 0 ? flipFace(f) : f);
  }
  return faces;
}

const mirrorGrid = (g: Grid): Grid => g.map((row) => row.map(mirrorX));

/**
 * A strip of the body side between two stations lists: rows at heights from
 * `rows(z)`, each point on the side surface (sideX), or on another surface.
 */
function sidePatch(stations: readonly number[], rows: (z: number) => number[], x: (y: number, z: number) => number = sideX): Grid {
  const n = rows(stations[0]!).length;
  const g: Grid = [];
  for (let r = 0; r < n; r++) g.push(stations.map((z) => {
    const y = rows(z)[r]!;
    return [x(y, z), y, z];
  }));
  return g;
}

/** Heights up the lower side (tucked sill, flat skin). */
const LOWER_FRACTIONS = [0, 0.05, 0.12, 0.21, 0.32, 0.45, 0.6, 0.75, 0.88, 1];
const lowerRows = (bottom: number) => () => LOWER_FRACTIONS.map((f) => lerp(bottom, MID_Y, f));
/** Heights up the upper band: an edge loop on the crease, then the shoulder rolling in. */
function upperRows(z: number): number[] {
  const c = creaseY(z);
  const top = topEdgeY(z);
  return [MID_Y, lerp(MID_Y, c, 0.4), lerp(MID_Y, c, 0.75), c - 0.006, c, ...[0.25, 0.5, 0.75, 1].map((f) => lerp(c, top, f))];
}

/**
 * The side round a wheel arch, as rings of quads following the arch: from
 * the opening (with a lip rolled in) out to the rectangle [zFront, zBack] ×
 * [SILL_Y, MID_Y]. Columns: up the front, over the top (at `topZ`), down
 * the back; rows: out from the arch.
 */
function archRing(axle: number, zFront: number, zBack: number, topZ: readonly number[]): Grid {
  const R = ARCH_R;
  const nLeg = LOWER_FRACTIONS.length - 1;
  // The opening: a leg up from the sill, the arc, a leg down. Split at 38° and 142° to match the rectangle's corners.
  const a0 = (38 * Math.PI) / 180;
  const a1 = Math.PI - a0;
  const legH = ARCH_Y - SILL_Y;
  const arcAt = (a: number): [number, number] => [axle + R * Math.cos(a), ARCH_Y + R * Math.sin(a)];
  const frontIn = (s: number): [number, number] => {
    // Leg then arc up to a0, by length.
    const L = legH + R * a0;
    const d = s * L;
    return d <= legH ? [axle + R, SILL_Y + d] : arcAt((d - legH) / R);
  };
  const backIn = (s: number): [number, number] => {
    const L = legH + R * a0;
    const d = s * L;
    return d <= R * a0 ? arcAt(a1 + d / R) : [axle - R, ARCH_Y - (d - R * a0)];
  };
  const cols: { inner: [number, number]; outer: [number, number] }[] = [];
  for (let i = 0; i <= nLeg; i++) {
    const f = LOWER_FRACTIONS[i]!;
    cols.push({ inner: frontIn(f), outer: [zFront, lerp(SILL_Y, MID_Y, f)] });
  }
  const nTop = topZ.length - 1;
  for (let i = 1; i < nTop; i++) {
    const s = (zFront - topZ[i]!) / (zFront - zBack);
    cols.push({ inner: arcAt(lerp(a0, a1, s)), outer: [topZ[i]!, MID_Y] });
  }
  for (let i = nLeg; i >= 0; i--) {
    const f = LOWER_FRACTIONS[i]!;
    cols.push({ inner: backIn(1 - f), outer: [zBack, lerp(SILL_Y, MID_Y, f)] });
  }
  const RING = [0, 0.02, 0.06, 0.14, 0.26, 0.42, 0.6, 0.8, 1];
  return RING.map((r) =>
    cols.map(({ inner, outer }) => {
      const z = lerp(inner[0], outer[0], r);
      const y = lerp(inner[1], outer[1], r);
      // The arch lip: rolled in at the very edge, standing a little proud just outside it.
      const lip = r === 0 ? -0.022 : r <= 0.02 ? 0.002 : r <= 0.06 ? 0.003 : 0;
      return [sideX(y, z) + lip, y, z];
    }),
  );
}

// ---------------------------------------------------------------- primitives for the smaller parts

function box(c: V3, s: V3): Face[] {
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const p = (x: number, y: number, z: number): V3 => [c[0] + x * hx, c[1] + y * hy, c[2] + z * hz];
  return outwards([
    [p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)],
    [p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1)],
    [p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)],
    [p(-1, -1, 1), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1)],
    [p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)],
    [p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1)],
  ]);
}

/** A bar of width w and depth d from a to b, its depth along `depthAxis`. */
function bar(a: V3, b: V3, w: number, d: number, depthAxis: V3): Face[] {
  const along = norm(sub(b, a));
  const dAx = norm(depthAxis);
  const side = norm(cross(along, dAx));
  const corners = (p: V3): V3[] => [add(add(p, scale(side, w / 2)), scale(dAx, d / 2)), add(add(p, scale(side, -w / 2)), scale(dAx, d / 2)), add(add(p, scale(side, -w / 2)), scale(dAx, -d / 2)), add(add(p, scale(side, w / 2)), scale(dAx, -d / 2))];
  const A = corners(a);
  const B = corners(b);
  const faces: Face[] = [];
  for (let i = 0; i < 4; i++) faces.push([A[i]!, A[(i + 1) % 4]!, B[(i + 1) % 4]!, B[i]!]);
  faces.push([A[3]!, A[2]!, A[1]!, A[0]!], [B[0]!, B[1]!, B[2]!, B[3]!]);
  return outwards(faces);
}

/** A block with its edges bevelled (cushions, the dashboard). */
function roundedBox(c: V3, s: V3, r: number): Face[] {
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const rr = Math.min(r, hx, hy, hz);
  const ring = (y: number, inset: number): V3[] => {
    const ax = hx - inset;
    const az = hz - inset;
    const cx = ax - rr;
    const cz = az - rr;
    return (
      [
        [cx, y, az],
        [ax, y, cz],
        [ax, y, -cz],
        [cx, y, -az],
        [-cx, y, -az],
        [-ax, y, -cz],
        [-ax, y, cz],
        [-cx, y, az],
      ] as V3[]
    ).map(([x, yy, z]): V3 => [c[0] + x, c[1] + yy, c[2] + z]);
  };
  const rings = [ring(-hy, rr), ring(-hy + rr, 0), ring(hy - rr, 0), ring(hy, rr)];
  const faces: Face[] = [];
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      faces.push([rings[k]![i]!, rings[k]![j]!, rings[k + 1]![j]!, rings[k + 1]![i]!]);
    }
  // Caps as quads round a middle ring of four.
  for (const [ringPts, y] of [
    [rings[0]!, -hy],
    [rings[3]!, hy],
  ] as const) {
    const mid: V3 = [c[0], c[1] + y, c[2]];
    for (let i = 0; i < 8; i += 2) faces.push([mid, ringPts[i]!, ringPts[i + 1]!, ringPts[(i + 2) % 8]!]);
  }
  return outwards(faces);
}

/**
 * A lathe about an axis through `c`: the profile is (radius, along-axis)
 * pairs, a closed loop; `axis` 'x' for wheels, 'z' for round lamps.
 */
function lathe(c: V3, profile: readonly [number, number][], segments: number, axis: 'x' | 'y' | 'z' = 'x', closed = true): Face[] {
  const at = (r: number, a: number, t: number): V3 => {
    const u = Math.cos(a) * r;
    const v = Math.sin(a) * r;
    if (axis === 'x') return [c[0] + t, c[1] + v, c[2] + u];
    if (axis === 'y') return [c[0] + u, c[1] + t, c[2] + v];
    return [c[0] + u, c[1] + v, c[2] + t];
  };
  const faces: Face[] = [];
  const n = closed ? profile.length : profile.length - 1;
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    const b = ((s + 1) / segments) * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const [r0, t0] = profile[i]!;
      const [r1, t1] = profile[(i + 1) % profile.length]!;
      const f = clean([at(r0, a, t0), at(r1, a, t1), at(r1, b, t1), at(r0, b, t0)]);
      if (f) faces.push(f);
    }
  }
  return outwards(faces);
}

function cylinder(c: V3, radius: number, length: number, segments = 20, axis: 'x' | 'y' | 'z' = 'x'): Face[] {
  const h = length / 2;
  return lathe(c, [[0, -h], [radius, -h], [radius, h], [0, h]], segments, axis);
}

/** Turn about an axis through a pivot (Rodrigues). */
function rotate(faces: Face[], pivot: V3, axis: V3, degrees: number): Face[] {
  const k = norm(axis);
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const turn = (p: V3): V3 => {
    const v = sub(p, pivot);
    const kv = cross(k, v);
    const kd = dot(k, v) * (1 - cos);
    return [pivot[0] + v[0] * cos + kv[0] * sin + k[0] * kd, pivot[1] + v[1] * cos + kv[1] * sin + k[1] * kd, pivot[2] + v[2] * cos + kv[2] * sin + k[2] * kd];
  };
  return faces.map((f) => f.map(turn));
}

const moveBy = (faces: Face[], d: V3): Face[] => faces.map((f) => f.map((p) => add(p, d)));

/** A torus about the Z axis through `c` (the steering wheel rim). */
function torus(c: V3, radius: number, tube: number, segments = 32, sides = 8): Face[] {
  const profile: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    profile.push([radius + Math.cos(a) * tube, Math.sin(a) * tube]);
  }
  return lathe(c, profile, segments, 'z');
}

/**
 * A profile swept along a path in plan (x, z) at a height, closed at both
 * ends: bumpers, mouldings. The profile is (outward, up) offsets; `mat`
 * picks each face's material from its path and profile segment.
 */
function sweep(path: readonly [number, number][], y: number, profile: readonly [number, number][], mat: (pathSeg: number, profSeg: number) => string): Map<string, Face[]> {
  const frames = path.map(([x, z], i) => {
    const [px, pz] = path[Math.max(0, i - 1)]!;
    const [nx, nz] = path[Math.min(path.length - 1, i + 1)]!;
    const tx = nx - px;
    const tz = nz - pz;
    const l = Math.hypot(tx, tz) || 1;
    let ox = tz / l;
    let oz = -tx / l;
    // Outward: away from the car's middle.
    if (ox * x + oz * z < 0) {
      ox = -ox;
      oz = -oz;
    }
    return { x, z, ox, oz };
  });
  const rings = frames.map((f) => profile.map(([o, u]): V3 => [f.x + f.ox * o, y + u, f.z + f.oz * o]));
  const out = new Map<string, Face[]>();
  const put = (m: string, f: Face | null) => {
    if (!f) return;
    const list = out.get(m) ?? [];
    list.push(f);
    out.set(m, list);
  };
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      put(mat(k, i), clean([rings[k]![i]!, rings[k + 1]![i]!, rings[k + 1]![j]!, rings[k]![j]!]));
    }
  for (const [ring, k] of [
    [rings[0]!, 0],
    [rings[rings.length - 1]!, rings.length - 2],
  ] as const) {
    const mid = scale(ring.reduce<V3>((m, p) => add(m, p), [0, 0, 0]), 1 / ring.length);
    for (let i = 0; i < ring.length; i++) put(mat(k, -1), clean([mid, ring[i]!, ring[(i + 1) % ring.length]!]));
  }
  // Wound outwards as one closed piece.
  const all = [...out.values()].flat();
  if (signedVolume(triangulate(all)) < 0) for (const [m, faces] of out) out.set(m, faces.map(flipFace));
  return out;
}

// ---------------------------------------------------------------- the car

const MATERIALS: Record<string, { kd: V3; d?: number; ns?: number; ks?: number }> = {
  demo_paint: { kd: [0.62, 0.05, 0.04], ns: 250, ks: 0.6 },
  demo_glass: { kd: [0.06, 0.08, 0.09], d: 0.4, ns: 400, ks: 0.8 },
  demo_tyre: { kd: [0.035, 0.035, 0.035], ns: 8, ks: 0.05 },
  demo_rim: { kd: [0.7, 0.71, 0.72], ns: 300, ks: 0.7 },
  demo_chrome: { kd: [0.5, 0.51, 0.53], ns: 600, ks: 0.95 },
  demo_trim: { kd: [0.05, 0.05, 0.05], ns: 40, ks: 0.2 },
  demo_rubber: { kd: [0.025, 0.025, 0.025], ns: 10, ks: 0.05 },
  demo_headlight: { kd: [0.9, 0.9, 0.86], ns: 400, ks: 0.8 },
  demo_taillight: { kd: [0.55, 0.02, 0.02], ns: 300, ks: 0.6 },
  demo_indicator: { kd: [0.9, 0.45, 0.05], ns: 300, ks: 0.6 },
  demo_reverse: { kd: [0.85, 0.85, 0.82], ns: 300, ks: 0.6 },
  demo_badge: { kd: [0.08, 0.28, 0.7], ns: 300, ks: 0.6 },
  demo_interior: { kd: [0.16, 0.15, 0.14], ns: 15, ks: 0.05 },
  demo_seat: { kd: [0.2, 0.19, 0.18], ns: 10, ks: 0.05 },
  demo_engine: { kd: [0.32, 0.32, 0.34], ns: 80, ks: 0.3 },
  demo_brake: { kd: [0.35, 0.34, 0.33], ns: 60, ks: 0.3 },
};

class Builder {
  private readonly pieces = new Map<string, { material: string; groups: Map<string, Face[]> }>();

  add(name: string, material: string, faces: Face[]): void {
    let p = this.pieces.get(name);
    if (!p) this.pieces.set(name, (p = { material, groups: new Map() }));
    const list = p.groups.get(material) ?? [];
    list.push(...faces);
    p.groups.set(material, list);
  }

  addMap(name: string, byMaterial: Map<string, Face[]>, main: string): void {
    if (!this.pieces.has(name)) this.pieces.set(name, { material: main, groups: new Map() });
    for (const [m, f] of byMaterial) this.add(name, m, f);
  }

  /** A left-hand panel and its mirror on the right. */
  both(nameL: string, nameR: string, material: string, g: Grid, out: V3, thickness = 0.006): void {
    this.add(nameL, material, shell(g, out, thickness));
    this.add(nameR, material, shell(mirrorGrid(g), [-out[0], out[1], out[2]], thickness));
  }

  done(): Piece[] {
    return [...this.pieces].map(([name, p]) => {
      const groups = [...p.groups].map(([material, faces]) => ({ material, faces }));
      return { name, material: p.material, groups, tris: triangulate(groups.flatMap((g) => g.faces)) };
    });
  }
}

/** Station lists along the car for each stretch of the sides (shared by the lower and upper bands so their edges meet). */
const ST = {
  fenderFront: joinRuns(linspace(ARCH_F[0], 1.93, 4), easeTo(1.93, NOSE_Z, 6)),
  fenderArchTop: linspace(ARCH_F[0], ARCH_F[1], 16),
  fenderBack: linspace(ARCH_F[1], FRONT_DOOR[0] + GAP, 9),
  doorF: linspace(FRONT_DOOR[0] - GAP, FRONT_DOOR[1] + GAP, 20),
  doorRLower: linspace(REAR_DOOR_FRONT - GAP, ARCH_B[0] + GAP, 8),
  // Over the rear arch: the rear door's upper band ends at the C-pillar's foot.
  rearArchTop: joinRuns(linspace(ARCH_B[0], REAR_DOOR_BACK, 5), linspace(REAR_DOOR_BACK, ARCH_B[1], 11)),
  quarterBack: joinRuns(linspace(ARCH_B[1], -1.95, 6), easeTo(-1.95, TAIL_Z, 6)),
};

function bodySides(b: Builder): void {
  const L: V3 = [1, 0, 0];
  // Front wings: round the arch, ahead of it, behind it; the band with the crease above.
  const fFront = [...ST.fenderFront].reverse(); // nose → arch
  b.both('fender_FL', 'fender_FR', 'demo_paint', sidePatch(fFront, lowerRows(SILL_Y)), L);
  b.both('fender_FL', 'fender_FR', 'demo_paint', archRing(AXLE_F, ARCH_F[0], ARCH_F[1], ST.fenderArchTop), L);
  b.both('fender_FL', 'fender_FR', 'demo_paint', sidePatch(ST.fenderBack, lowerRows(SILL_Y)), L);
  const fenderTop = joinRuns(fFront, ST.fenderArchTop, ST.fenderBack);
  b.both('fender_FL', 'fender_FR', 'demo_paint', sidePatch(fenderTop, upperRows), L);
  // Front doors: skin from the sill line to the shoulder.
  b.both('door_FL', 'door_FR', 'demo_paint', sidePatch(ST.doorF, lowerRows(DOOR_BOTTOM)), L);
  b.both('door_FL', 'door_FR', 'demo_paint', sidePatch(ST.doorF, upperRows), L);
  // Rear doors: the lower part stops at the arch, the band above runs on to the C-pillar's foot.
  b.both('door_RL', 'door_RR', 'demo_paint', sidePatch(ST.doorRLower, lowerRows(DOOR_BOTTOM)), L);
  const rearUpperIdx = ST.rearArchTop.indexOf(REAR_DOOR_BACK);
  const doorRUpper = joinRuns(ST.doorRLower, ST.rearArchTop.slice(0, rearUpperIdx + 1).map((z, i, a) => (i === a.length - 1 ? z + GAP : z)));
  b.both('door_RL', 'door_RR', 'demo_paint', sidePatch(doorRUpper, upperRows), L);
  // The body: sills, the rear quarters round the arch to the tail.
  b.both('body', 'body', 'demo_paint', sidePatch(linspace(FRONT_DOOR[0] - GAP, ARCH_B[0], 26), () => linspace(SILL_Y, DOOR_BOTTOM - GAP, 3)), L);
  b.both('body', 'body', 'demo_paint', archRing(AXLE_R, ARCH_B[0], ARCH_B[1], ST.rearArchTop), L);
  b.both('body', 'body', 'demo_paint', sidePatch(ST.quarterBack, lowerRows(SILL_Y)), L);
  const quarterTop = joinRuns(ST.rearArchTop.slice(rearUpperIdx).map((z, i) => (i === 0 ? z - GAP : z)), ST.quarterBack);
  b.both('body', 'body', 'demo_paint', sidePatch(quarterTop, upperRows), L);

  // Rubbing strips along the sides at bumper height, broken at the arches and shut lines.
  const strip = (name: string, z0: number, z1: number) => {
    const path: [number, number][] = linspace(z0, z1, Math.max(2, Math.round(Math.abs(z1 - z0) / 0.08))).map((z) => [sideX(0.47, z), z]);
    const prof: [number, number][] = [
      [-0.004, -0.017],
      [0.008, -0.015],
      [0.012, 0],
      [0.008, 0.015],
      [-0.004, 0.017],
    ];
    const m = sweep(path, 0.47, prof, () => 'demo_rubber');
    b.add(name.replace('*', 'L'), 'demo_rubber', m.get('demo_rubber')!);
    b.add(name.replace('*', 'R'), 'demo_rubber', m.get('demo_rubber')!.map((f) => flipFace(f.map(mirrorX))));
  };
  const archEdge = Math.sqrt(ARCH_R ** 2 - (0.47 - ARCH_Y) ** 2) + 0.025;
  strip('fender_F*', AXLE_F - archEdge, FRONT_DOOR[0] + 0.006);
  strip('door_F*', FRONT_DOOR[0] - 0.006, FRONT_DOOR[1] + 0.006);
  strip('door_R*', REAR_DOOR_FRONT - 0.006, ARCH_B[0] + 0.006);
  strip('fender_F*', 1.79, AXLE_F + archEdge);

  // Door handles: black pulls on the shoulder near each door's back edge.
  for (const [door, z] of [
    ['door_F', FRONT_DOOR[1] + 0.13],
    ['door_R', -0.98],
  ] as const) {
    const y = 0.892;
    const x = sideX(y, z) + 0.004;
    const h = rotate(roundedBox([x, y, z], [0.02, 0.028, 0.12], 0.008), [x, y, z], [0, 0, 1], 22);
    b.add(`${door}L`, 'demo_trim', h);
    b.add(`${door}R`, 'demo_trim', h.map((f) => flipFace(f.map(mirrorX))));
  }
  // Side repeaters on the front wings.
  const rep = roundedBox([sideX(0.77, 1.83) + 0.004, 0.77, 1.83], [0.01, 0.026, 0.055], 0.006);
  b.add('indicator_FL', 'demo_indicator', rep);
  b.add('indicator_FR', 'demo_indicator', rep.map((f) => flipFace(f.map(mirrorX))));
}

/** The bonnet: a Coons patch between the wing tops, crowned, its front edge rolled down over the grille band (the shark nose). */
function bonnet(b: Builder): void {
  const xs = (z: number) => halfW(z) - SHOULDER_IN - 0.004;
  const z0 = COWL_Z + GAP;
  const z1 = NOSE_Z + 0.012;
  const crown = 0.018;
  const edge = (z: number): V3 => [xs(Math.min(z, NOSE_Z)), topEdgeY(Math.min(z, NOSE_Z)), z];
  const f = coons(
    (u) => [lerp(-1, 1, u) * xs(z0), topEdgeY(z0) + crown * (1 - lerp(-1, 1, u) ** 2), z0],
    (u) => [lerp(-1, 1, u) * xs(NOSE_Z), HOOD_FRONT_Y + crown * 0.6 * (1 - lerp(-1, 1, u) ** 2), z1],
    (v) => mirrorX(edge(lerp(z0, z1, v))),
    (v) => edge(lerp(z0, z1, v)),
  );
  const us = linspace(0, 1, 26);
  const vs = joinRuns(linspace(0, 0.9, 18), easeTo(0.9, 1, 3));
  const top = sample(us, vs, (u, v) => {
    const p = f(u, v);
    // A touch more crown through the middle of the bonnet's length.
    return [p[0], p[1] + 0.006 * Math.sin(Math.PI * v) * (1 - lerp(-1, 1, u) ** 2), p[2]];
  });
  // The front lip: two more rows rolling down to the top of the grille band.
  const front = top[top.length - 1]!;
  top.push(front.map((p) => [p[0] * 0.998, p[1] - 0.012, p[2] + 0.009] as V3));
  top.push(front.map((p) => [p[0] * 0.992, 0.842, p[2] + 0.011] as V3));
  b.add('hood', 'demo_paint', shell(top, [0, 1, 0]));
  // The roundel on the lip, above the kidneys.
  const badgeC: V3 = [0, 0.858, NOSE_Z + 0.024];
  const badge = rotate(lathe([0, 0, 0], [[0, -0.004], [0.036, -0.004], [0.036, 0.004], [0.03, 0.006], [0, 0.006]], 24, 'z'), [0, 0, 0], [1, 0, 0], -35);
  b.add('hood', 'demo_badge', moveBy(badge, badgeC));
}

/** Windscreen, A-pillars, roof, rear window, C-pillars, the doors' window frames and glass. */
function glasshouse(b: Builder): void {
  const xE = (t: number) => lerp(halfW(COWL_Z) - SHOULDER_IN - 0.06, XR, t);
  const yE = (t: number) => lerp(beltY(COWL_Z) + 0.008, RAIL_Y, t);
  const E = (t: number): V3 => [xE(t), yE(t), screenZ(t)];
  const screenBase = (u: number): V3 => [u * xE(0), yE(0) + 0.004 * (1 - u * u), COWL_Z - 0.02 + 0.02 * (1 - u * u)];
  const screenTop = (u: number): V3 => [u * XR, roofY(u), screenZ(1) - 0.04 * (1 - u * u)];
  const us = linspace(0, 1, 24);
  // Windscreen, bulging a little.
  const ws = coons(
    (u) => screenBase(lerp(-1, 1, u)),
    (u) => screenTop(lerp(-1, 1, u)),
    (v) => mirrorX(E(v)),
    (v) => E(v),
  );
  const up: V3 = norm([0, 0.55, 0.83]);
  b.add('windshield', 'demo_glass', shell(sample(us, linspace(0, 1, 12), (u, v) => add(ws(u, v), scale(up, 0.012 * Math.sin(Math.PI * v) * (1 - lerp(-1, 1, u) ** 2)))), up, 0.005));
  // A-pillars: from the windscreen's edge round to the side glass.
  const Ga = (t: number): V3 => ghPoint(aRear(t), t);
  const ap = coons(
    (s) => lerp3(E(0), Ga(0), s),
    (s) => lerp3(E(1), Ga(1), s),
    (t) => E(t),
    (t) => Ga(t),
  );
  const apOut: V3 = norm([1, 0.4, 0.5]);
  b.both('body', 'body', 'demo_paint', sample(linspace(0, 1, 4), linspace(0, 1, 12), (s, t) => add(ap(s, t), scale(apOut, 0.012 * Math.sin(Math.PI * s) * (0.3 + 0.7 * (1 - t))))), apOut);
  // Roof.
  const railAt = (z: number): V3 => [XR, RAIL_Y, z];
  const rearTop = (u: number): V3 => [u * XR, roofY(u), lerp(ROOF_BACK_SIDE_Z, ROOF_BACK_Z, 1 - u * u)];
  const roof = coons(
    (u) => screenTop(lerp(-1, 1, u)),
    (u) => rearTop(lerp(-1, 1, u)),
    (w) => mirrorX(railAt(lerp(screenZ(1), ROOF_BACK_SIDE_Z, w))),
    (w) => railAt(lerp(screenZ(1), ROOF_BACK_SIDE_Z, w)),
  );
  b.add('body', 'demo_paint', shell(sample(us, linspace(0, 1, 18), (u, w) => add(roof(u, w), [0, 0.006 * Math.sin(Math.PI * w) * (1 - lerp(-1, 1, u) ** 4), 0])), [0, 1, 0]));
  // Rear window.
  const RW_X = 0.7;
  const RW_CORNER_Z = -1.64;
  const rwSide = (v: number): V3 => lerp3([RW_X, 1.0, RW_CORNER_Z], [XR, RAIL_Y, ROOF_BACK_SIDE_Z], v);
  const rwBottom = (u: number): V3 => [u * RW_X, 1.0 + 0.004 * (1 - u * u), lerp(RW_CORNER_Z, DECK_Z, 1 - u * u)];
  const rw = coons(
    (u) => rwBottom(lerp(-1, 1, u)),
    (u) => rearTop(lerp(-1, 1, u)),
    (v) => mirrorX(rwSide(v)),
    (v) => rwSide(v),
  );
  const back: V3 = norm([0, 0.6, -0.8]);
  b.add('rear_window', 'demo_glass', shell(sample(us, linspace(0, 1, 10), (u, v) => add(rw(u, v), scale(back, 0.01 * Math.sin(Math.PI * v) * (1 - lerp(-1, 1, u) ** 2)))), back, 0.005));
  // C-pillars: from the side window's kinked edge back round to the rear window, down to the shoulder.
  const Gc = (t: number): V3 => ghPoint(cEdge(t), t);
  const TW = 0.13;
  const pillarFoot: V3 = [halfW(DECK_Z) - SHOULDER_IN, beltY(DECK_Z), DECK_Z];
  const D = (t: number): V3 => (t <= TW ? lerp3(pillarFoot, [RW_X, 1.0, RW_CORNER_Z], t / TW) : rwSide((t - TW) / (1 - TW)));
  const cp = coons(
    (s) => {
      const z = lerp(cEdge(0), DECK_Z, s);
      return [halfW(z) - SHOULDER_IN, beltY(z), z];
    },
    (s) => lerp3(Gc(1), D(1), s),
    (t) => Gc(t),
    (t) => D(t),
  );
  const cOut: V3 = norm([1, 0.3, -0.6]);
  b.both('body', 'body', 'demo_paint', sample(linspace(0, 1, 10), linspace(0, 1, 14), (s, t) => add(cp(s, t), scale(cOut, 0.006 * Math.sin(Math.PI * s) * Math.sin(Math.PI * t)))), cOut);
  // The shelf under the rear window's corners, down to the boot lid.
  const shelf = coons(
    (u) => [lerp(-1, 1, u) * pillarFoot[0], pillarFoot[1], DECK_Z],
    (u) => rwBottom(lerp(-1, 1, u)),
    (v) => mirrorX(D(v * TW)),
    (v) => D(v * TW),
  );
  b.add('body', 'demo_paint', shell(sample(us, linspace(0, 1, 3), shelf), [0, 1, 0]));

  // Side windows and their frames, per door. Rows run up from the belt (t), columns along the car.
  const L: V3 = [1, 0, 0];
  const ts = (a: number, b2: number, n: number) => linspace(a, b2, n);
  const strip = (z0: (t: number) => number, z1: (t: number) => number, t0: number, t1: number, nz: number, nt: number, inset = 0): Grid =>
    sample(linspace(0, 1, nz), ts(t0, t1, nt), (s, t) => {
      const p = ghPoint(lerp(z0(t), z1(t), s), t);
      return [p[0] - inset, p[1], p[2]];
    });
  const BOT = 0.035;
  const TOP = 0.9;
  const FR = 0.026;
  const frame = (name: string, zf: (t: number) => number, zr: (t: number) => number, glass: [(t: number) => number, (t: number) => number][]) => {
    const nameL = `${name}L`;
    const nameR = `${name}R`;
    b.both(nameL, nameR, 'demo_trim', strip(zf, zr, 0, BOT, 16, 1), L, 0.008);
    b.both(nameL, nameR, 'demo_trim', strip(zf, zr, TOP, 1, 16, 2), L, 0.008);
    // Uprights: in front of, between and behind the panes.
    const edges = [zf, ...glass.flat(), zr];
    for (let i = 0; i < edges.length; i += 2) b.both(nameL, nameR, 'demo_trim', strip(edges[i]!, edges[i + 1]!, BOT, TOP, 2, 10), L, 0.008);
    for (const [g0, g1] of glass) b.both(`${name.replace('door_', 'door_glass_')}L`, `${name.replace('door_', 'door_glass_')}R`, 'demo_glass', strip(g0, g1, BOT, TOP, 10, 10, 0.008), L, 0.005);
  };
  frame('door_F', (t) => aRear(t) - GAP, () => -0.518, [[(t) => aRear(t) - FR, () => -0.47]]);
  frame('door_R', () => -0.522, (t) => cEdge(t) + GAP, [
    [() => -0.565, () => -0.925],
    [() => -0.945, (t) => cEdge(t) + 0.022],
  ]);
  // The B-pillar behind the door frames, for when the doors are off.
  b.both('body', 'body', 'demo_trim', sample(linspace(-0.505, -0.555, 2), linspace(0, 1, 6), (z, t) => {
    const p = ghPoint(z, t);
    return [p[0] - 0.03, p[1], p[2]];
  }), L);
  b.both('body', 'body', 'demo_paint', sample(linspace(-0.505, -0.555, 2), linspace(SILL_Y, beltY(-0.53), 6), (z, y) => [sideX(y, z) - 0.03, y, z]), L);

  // Door cards: the trim inside each door.
  for (const [name, z0, z1] of [
    ['door_F', FRONT_DOOR[0] - 0.03, FRONT_DOOR[1] + 0.03],
    ['door_R', REAR_DOOR_FRONT - 0.03, ARCH_B[0] - 0.02],
  ] as const) {
    const card = sample(linspace(z0, z1, 12), linspace(DOOR_BOTTOM + 0.03, beltY(z0) - 0.01, 8), (z, y) => [sideX(y, z) - 0.07 - 0.02 * clamp01((y - 0.8) / 0.12), y, z]);
    b.both(`${name}L`, `${name}R`, 'demo_interior', card, [-1, 0, 0], 0.012);
  }
  // Door mirrors on the front corner of the front door windows.
  const mirror = [
    ...rotate(roundedBox([W + 0.075, 1.0, 0.27], [0.13, 0.085, 0.09], 0.025), [W + 0.075, 1.0, 0.27], [0, 1, 0], -8),
    ...roundedBox([W + 0.015, 0.985, 0.29], [0.05, 0.04, 0.05], 0.012),
  ];
  b.add('mirror_L', 'demo_trim', mirror);
  b.add('mirror_R', 'demo_trim', mirror.map((f) => flipFace(f.map(mirrorX))));
}

/** The boot lid (with the panel between the tail lamps) and the tail panel. */
function boot(b: Builder): void {
  const xs = (z: number) => halfW(z) - SHOULDER_IN - 0.004;
  const z0 = DECK_Z - 0.008;
  const z1 = TAIL_Z + 0.03;
  const edge = (z: number): V3 => [xs(z), topEdgeY(z) + 0.002, z];
  const f = coons(
    (u) => [lerp(-1, 1, u) * xs(z0), topEdgeY(z0) + 0.002 + 0.01 * (1 - lerp(-1, 1, u) ** 2), z0],
    (u) => [lerp(-1, 1, u) * xs(z1), BOOT_Y + 0.002 + 0.01 * (1 - lerp(-1, 1, u) ** 2), z1],
    (v) => mirrorX(edge(lerp(z0, z1, v))),
    (v) => edge(lerp(z0, z1, v)),
  );
  const top = sample(linspace(0, 1, 26), linspace(0, 1, 8), f);
  const last = top[top.length - 1]!;
  // The rear edge rolls down onto the tail.
  top.push(last.map((p) => [p[0] * 0.997, p[1] - 0.008, TAIL_Z + 0.012] as V3));
  top.push(last.map((p) => [p[0] * 0.99, p[1] - 0.026, TAIL_Z - 0.002] as V3));
  b.add('trunk', 'demo_paint', shell(top, [0, 1, 0]));
  // The panel between the lamps, down to the bumper (the plate goes here).
  const PL = 0.36;
  b.add('trunk', 'demo_paint', shell(sample(linspace(-PL, PL, 12), linspace(0.955, 0.64, 8), (x, y) => [x, y, TAIL_Z - 0.004 + 0.012 * ((y - 0.64) / 0.32) ** 2]), [0, 0, -1]));
  // The tail panel behind it all (lamps and boot lid off: still a car).
  const hw = halfW(TAIL_Z);
  b.add('body', 'demo_paint', shell(sample(linspace(-hw, hw, 24), linspace(0.26, BOOT_Y - 0.01, 10), (x, y) => [x, y, TAIL_Z + 0.006]), [0, 0, -1]));
}

/** The nose: the black band with the kidneys, the four lamps, the apron and the chin spoiler. */
function nose(b: Builder): void {
  const hw = halfW(NOSE_Z);
  const BAND_Y = 0.575;
  const bandZ = (y: number) => NOSE_Z + 0.004 + 0.018 * clamp01((y - BAND_Y) / (0.838 - BAND_Y));
  b.add('grille', 'demo_trim', shell(sample(linspace(-hw, hw, 28), linspace(BAND_Y, 0.838, 6), (x, y) => [x, y, bandZ(y) - 0.01 * (x / hw) ** 6]), [0, 0, 1], 0.01));
  // The kidneys: chrome surrounds with black slats, a touch narrower at the foot.
  for (const side of [1, -1]) {
    const cx = side * 0.064;
    const cy = 0.705;
    const kidney = (s: number): [number, number] => {
      // A superellipse (rounded rectangle), 0.106 wide and 0.2 high.
      const a = s * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const e = 0.35;
      const x = Math.sign(c) * Math.abs(c) ** e * 0.053 * (sn < 0 ? 1 - 0.12 * -sn : 1);
      const y = Math.sign(sn) * Math.abs(sn) ** e * 0.1;
      return [cx + x, cy + y];
    };
    const ring: V3[][] = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const [x, y] = kidney(i / n);
      const [ix, iy] = [cx + (x - cx) * 0.8, cy + (y - cy) * 0.86];
      const z = bandZ(y) + 0.005;
      ring.push([
        [ix, iy, z + 0.018],
        [x, y, z + 0.018],
        [x, y, z],
        [ix, iy, z],
      ]);
    }
    const surround: Face[] = [];
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 4; k++) {
        const f = clean([ring[i]![k]!, ring[i + 1]![k]!, ring[i + 1]![(k + 1) % 4]!, ring[i]![(k + 1) % 4]!]);
        if (f) surround.push(f);
      }
    b.add('grille', 'demo_chrome', outwards(surround));
    for (let k = -3; k <= 3; k++) b.add('grille', 'demo_rubber', box([cx + k * 0.012, cy - 0.004, bandZ(cy) + 0.012], [0.004, 0.17, 0.012]));
  }
  // Four round lamps: chrome bezel, reflector, domed lens.
  for (const [side, tag] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    for (const [x, r] of [
      [0.255, 0.083],
      [0.48, 0.093],
    ] as const) {
      const c: V3 = [side * x, 0.702, bandZ(0.702) + 0.002];
      b.add(`headlight_${tag}`, 'demo_chrome', lathe(c, [[r - 0.004, 0], [r + 0.012, 0], [r + 0.012, 0.016], [r + 0.004, 0.022], [r - 0.004, 0.018]], 32, 'z'));
      b.add(`headlight_${tag}`, 'demo_headlight', lathe(c, [[0, 0.002], [r, 0.002], [r, 0.014], [r * 0.7, 0.024], [0, 0.028]], 32, 'z'));
    }
  }
  // The apron under the band, behind the bumper, with the black chin spoiler below.
  b.add('body', 'demo_paint', shell(sample(linspace(-hw + 0.01, hw - 0.01, 24), linspace(0.24, BAND_Y, 6), (x, y) => [x, y, NOSE_Z - 0.004 - 0.02 * ((BAND_Y - y) / (BAND_Y - 0.24)) ** 2]), [0, 0, 1]));
  const spoilerPath: [number, number][] = linspace(-1, 1, 20).map((t) => [t * (hw - 0.03), NOSE_Z - 0.02 - 0.05 * t ** 4]);
  const spoiler = sweep(spoilerPath, 0.225, [[-0.03, -0.018], [0.03, -0.012], [0.035, 0.008], [-0.03, 0.02]], () => 'demo_trim');
  b.addMap('body', spoiler, 'demo_paint');
}

/**
 * Chrome bumpers with a rubber strip, black end caps wrapping round the
 * corners to the wheel arches, and the front indicators set into them.
 */
function bumpers(b: Builder): void {
  const prof: [number, number][] = [
    [-0.05, -0.066],
    [0, -0.066],
    [0.012, -0.056],
    [0.016, -0.032],
    [0.03, -0.029],
    [0.035, 0],
    [0.03, 0.029],
    [0.016, 0.032],
    [0.014, 0.056],
    [0, 0.067],
    [-0.05, 0.067],
  ];
  const rubber = new Set([3, 4, 5, 6]);
  const build = (name: string, face: number, sideEnd: number, y: number) => {
    const dir = Math.sign(face);
    const R = 0.14;
    const xw = W + 0.018;
    const path: [number, number][] = [];
    const sideSteps = 4;
    const arcSteps = 8;
    const frontSteps = 16;
    const endL: [number, number][] = [];
    for (let i = 0; i <= sideSteps; i++) endL.push([xw, lerp(sideEnd, face - dir * R, i / sideSteps)]);
    for (let i = 1; i <= arcSteps; i++) {
      const a = ((i / arcSteps) * Math.PI) / 2;
      endL.push([xw - R + R * Math.cos(a), face - dir * R + dir * R * Math.sin(a)]);
    }
    for (let i = 1; i <= frontSteps / 2; i++) endL.push([lerp(xw - R, 0, i / (frontSteps / 2)), face]);
    path.push(...endL);
    for (let i = endL.length - 2; i >= 0; i--) path.push([-endL[i]![0], endL[i]![1]]);
    const capSegs = sideSteps + 3; // the end caps: the side run and the start of the corner
    const last = path.length - 1;
    const m = sweep(path, y, prof, (seg, p) => (seg < capSegs || seg >= last - capSegs || p === -1 ? 'demo_rubber' : rubber.has(p) ? 'demo_rubber' : 'demo_chrome'));
    b.addMap(name, m, 'demo_chrome');
  };
  build('bumper_F', NOSE_Z + 0.085, 1.78, 0.49);
  build('bumper_R', TAIL_Z - 0.085, -1.64, 0.47);
  // Front indicators in the bumper's rubber, under the outer lamps.
  for (const [side, tag] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) b.add(`indicator_F${tag}`, 'demo_indicator', roundedBox([side * 0.56, 0.49, NOSE_Z + 0.123], [0.15, 0.04, 0.012], 0.006));
}

/** Wide tail lamps with ribbed lenses: red, an amber band, white reversing lamps by the plate. */
function tailLamps(b: Builder): void {
  for (const [side, tag] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const x0 = 0.37;
    const x1 = halfW(TAIL_Z) - 0.012;
    const y0 = 0.665;
    const y1 = 0.94;
    const name = `taillight_${tag}`;
    // The housing behind the lenses (black).
    b.add(name, 'demo_trim', box([side * (x0 + x1) / 2, (y0 + y1) / 2, TAIL_Z - 0.008], [x1 - x0, y1 - y0, 0.016]));
    // Ribbed lens rows: each rib a little ridge standing out.
    const ribs = 11;
    for (let i = 0; i < ribs; i++) {
      const ya = lerp(y0 + 0.006, y1 - 0.006, i / ribs);
      const yb = lerp(y0 + 0.006, y1 - 0.006, (i + 1) / ribs);
      const band = i >= 4 && i <= 6 ? 'demo_indicator' : 'demo_taillight';
      const cells: [number, number, string][] = i < 3 ? [[x0 + 0.006, x0 + 0.16, 'demo_reverse'], [x0 + 0.165, x1 - 0.006, 'demo_taillight']] : [[x0 + 0.006, x1 - 0.006, band]];
      for (const [xa, xb, mat] of cells) {
        const g = sample(linspace(xa, xb, 6), [ya, (ya + yb) / 2, yb], (x, y) => [side * x, y, TAIL_Z - 0.018 - (y === (ya + yb) / 2 ? 0.005 : 0) + 0.004 * (Math.abs(x - (x0 + x1) / 2) / (x1 - x0)) ** 2]);
        b.add(name, mat, shell(side > 0 ? g : g, [0, 0, -1], 0.004));
      }
    }
  }
}

/** Wheels: rounded 175/70 R14 tyres with tread grooves, cross-spoke rims, brake discs and calipers. */
function wheels(b: Builder): void {
  for (const [corner, x, z] of [
    ['FL', TRACK_F, AXLE_F],
    ['FR', -TRACK_F, AXLE_F],
    ['RL', TRACK_R, AXLE_R],
    ['RR', -TRACK_R, AXLE_R],
  ] as const) {
    const out = Math.sign(x);
    const c: V3 = [x, WHEEL_Y, z];
    const tread: [number, number][] = [];
    for (const t of [-0.07, -0.052, -0.048, -0.022, -0.018, 0.018, 0.022, 0.048, 0.052, 0.07]) {
      const groove = [-0.052, -0.048, -0.022, -0.018, 0.018, 0.022, 0.048, 0.052].includes(t);
      tread.push([WHEEL_R - (groove && Math.abs(t) !== 0.052 && Math.abs(t) !== 0.022 && Math.abs(t) !== 0.018 && Math.abs(t) !== 0.048 ? 0 : 0) - (groove ? 0.004 : 0), t]);
    }
    const tyre: [number, number][] = [
      [0.178, 0.076],
      [0.215, 0.083],
      [0.255, 0.087],
      [0.284, 0.082],
      [0.296, 0.074],
      ...tread.slice().reverse(),
      [0.296, -0.074],
      [0.284, -0.082],
      [0.255, -0.087],
      [0.215, -0.083],
      [0.178, -0.076],
    ];
    b.add(`tire_${corner}`, 'demo_tyre', lathe(c, tyre, 48));
    // The rim: barrel, polished lip, then the cross spokes between a hub ring and the outer ring.
    const rim: Face[] = [
      ...lathe(c, ([[0.168, -0.074], [0.178, -0.076], [0.178, 0.064], [0.186, 0.07], [0.184, 0.078], [0.168, 0.072]] as [number, number][]).map(([r, t]): [number, number] => [r, t * out]), 40),
      ...lathe(c, ([[0.15, 0.04], [0.168, 0.04], [0.168, 0.056], [0.15, 0.056]] as [number, number][]).map(([r, t]): [number, number] => [r, t * out]), 40),
      ...lathe(c, ([[0.0, 0.05], [0.058, 0.05], [0.064, 0.066], [0.045, 0.074], [0, 0.074]] as [number, number][]).map(([r, t]): [number, number] => [r, t * out]), 24),
    ];
    const at = (r: number, a: number, t: number): V3 => [x + out * t, WHEEL_Y + Math.sin(a) * r, z + Math.cos(a) * r];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const d = (Math.PI * 2) / 20;
      rim.push(...bar(at(0.058, a, 0.062), at(0.156, a + d, 0.05), 0.009, 0.012, [1, 0, 0]));
      rim.push(...bar(at(0.058, a + d, 0.058), at(0.156, a, 0.054), 0.009, 0.012, [1, 0, 0]));
    }
    b.add(`wheel_${corner}`, 'demo_rim', rim);
    const disc = [...lathe([x - out * 0.045, WHEEL_Y, z], [[0.06, -0.011], [0.128, -0.011], [0.128, 0.011], [0.06, 0.011]], 32), ...box([x - out * 0.045, WHEEL_Y + 0.1, z - 0.06], [0.05, 0.06, 0.09])];
    b.add(`brake_disc_${corner}`, 'demo_brake', disc);
  }
}

/** Floor, wheel wells, bulkhead and parcel shelf. */
function underbody(b: Builder): void {
  const inner = 0.56;
  const sill = W - 0.055;
  const down: V3 = [0, -1, 0];
  const floor = (x0: number, x1: number, z0: number, z1: number) => b.add('body', 'demo_paint', shell(sample(linspace(x0, x1, Math.max(2, Math.round((x1 - x0) / 0.1))), linspace(z0, z1, Math.max(2, Math.round(Math.abs(z1 - z0) / 0.1))), (x, z) => [x, SILL_Y + 0.004, z]), down, 0.004));
  floor(-inner, inner, NOSE_Z - 0.05, TAIL_Z + 0.05);
  for (const s of [1, -1]) {
    const [a, c] = s > 0 ? [inner, sill] : [-sill, -inner];
    floor(a, c, ARCH_F[1] - 0.06, ARCH_B[0] + 0.06);
    floor(a, c, NOSE_Z - 0.06, ARCH_F[0] + 0.06);
    floor(a, c, ARCH_B[1] - 0.06, TAIL_Z + 0.06);
  }
  // Wheel wells: the inside of each arch, and its inner wall.
  for (const axle of [AXLE_F, AXLE_R])
    for (const s of [1, -1]) {
      const r = ARCH_R + 0.012;
      const g = sample(linspace(-0.06, 1.06, 18), [W - 0.01, inner], (f, xx) => {
        const a = Math.PI * f;
        return [s * xx, ARCH_Y + Math.sin(a) * r, axle + Math.cos(a) * r];
      });
      // Faces the wheel: pick the winding by the middle quad.
      const faces = gridFaces(g, [0, -1, 0]);
      b.add('body', 'demo_trim', faces);
      const wall = sample(linspace(-0.06, 1.06, 18), [0, 1], (f, k) => {
        const a = Math.PI * f;
        return [s * inner, ARCH_Y + Math.sin(a) * r * k, axle + Math.cos(a) * r * k];
      });
      b.add('body', 'demo_trim', gridFaces(wall, [s, 0, 0]));
    }
  // Bulkhead between the engine bay and the cabin, and the parcel shelf behind the rear seat.
  b.add('body', 'demo_trim', box([0, 0.6, COWL_Z - 0.04], [2 * W - 0.12, 0.76, 0.02]));
  b.add('body', 'demo_interior', box([0, 1.0, DECK_Z + 0.12], [2 * XR, 0.015, 0.3]));
}

function cabin(b: Builder): void {
  b.add('carpet', 'demo_interior', box([0, SILL_Y + 0.04, -0.6], [2 * W - 0.2, 0.02, 2.0]));
  b.add('dashboard', 'demo_interior', [
    ...roundedBox([0, 0.8, 0.28], [2 * W - 0.14, 0.22, 0.28], 0.05),
    ...rotate(roundedBox([0, 0.9, 0.22], [2 * W - 0.18, 0.05, 0.24], 0.02), [0, 0.9, 0.34], [1, 0, 0], -12),
    // The instrument binnacle ahead of the driver.
    ...roundedBox([0.37, 0.94, 0.18], [0.4, 0.08, 0.14], 0.03),
  ]);
  b.add('center_console', 'demo_interior', [...roundedBox([0, 0.42, -0.12], [0.24, 0.36, 0.62], 0.04), ...cylinder([0, 0.64, -0.16], 0.012, 0.18, 10, 'y'), ...lathe([0, 0.74, -0.16], [[0, -0.02], [0.022, -0.012], [0.022, 0.012], [0, 0.02]], 12, 'y')]);
  const steering: Face[] = [
    ...torus([0, 0, 0], 0.19, 0.016, 36, 8),
    ...roundedBox([0, 0, 0], [0.09, 0.09, 0.05], 0.02),
    ...box([0, -0.09, 0], [0.03, 0.16, 0.02]),
    ...rotate(box([0.09, 0.01, 0], [0.17, 0.03, 0.02]), [0, 0, 0], [0, 0, 1], -8),
    ...rotate(box([-0.09, 0.01, 0], [0.17, 0.03, 0.02]), [0, 0, 0], [0, 0, 1], 8),
    ...cylinder([0, 0, 0.15], 0.022, 0.3, 10, 'z'),
  ];
  // Raked back like a real column, on the driver's side (left-hand drive).
  b.add('steering_wheel', 'demo_trim', moveBy(rotate(steering, [0, 0, 0], [1, 0, 0], -24), [0.37, 0.9, 0.04]));
  const frontSeat = (x: number): Face[] => [
    ...roundedBox([x, 0.42, -0.38], [0.5, 0.13, 0.52], 0.04),
    ...rotate(roundedBox([x, 0.76, -0.62], [0.48, 0.62, 0.12], 0.05), [x, 0.48, -0.62], [1, 0, 0], -14),
    ...rotate(roundedBox([x, 1.14, -0.66], [0.26, 0.16, 0.08], 0.03), [x, 0.48, -0.62], [1, 0, 0], -14),
    ...box([x, 0.3, -0.38], [0.36, 0.12, 0.42]),
  ];
  b.add('seat_FL', 'demo_seat', frontSeat(0.37));
  b.add('seat_FR', 'demo_seat', frontSeat(-0.37));
  b.add('rear_seat', 'demo_seat', [...roundedBox([0, 0.4, -1.2], [2 * W - 0.34, 0.14, 0.5], 0.05), ...rotate(roundedBox([0, 0.74, -1.46], [2 * W - 0.34, 0.58, 0.12], 0.05), [0, 0.47, -1.46], [1, 0, 0], -18)]);
}

function engineBay(b: Builder): void {
  // A slanted four-cylinder (block, head, cam cover, sump, pulleys, intake), the radiator and fan, the battery.
  b.add('engine', 'demo_engine', [
    ...rotate([...box([0, 0.46, 1.28], [0.3, 0.3, 0.58]), ...box([0, 0.66, 1.28], [0.26, 0.12, 0.56]), ...roundedBox([0, 0.75, 1.28], [0.2, 0.07, 0.5], 0.025)], [0, 0.35, 1.28], [0, 0, 1], -30),
    ...box([0, 0.3, 1.28], [0.26, 0.12, 0.48]),
    ...cylinder([0.02, 0.4, 1.6], 0.07, 0.04, 20, 'z'),
    ...cylinder([0.14, 0.52, 1.58], 0.045, 0.06, 16, 'z'),
    ...box([-0.26, 0.64, 1.28], [0.12, 0.08, 0.42]),
    ...cylinder([-0.36, 0.72, 1.43], 0.09, 0.12, 20, 'x'),
  ]);
  b.add('radiator', 'demo_engine', [...box([0, 0.6, 1.93], [0.64, 0.36, 0.05]), ...cylinder([0, 0.6, 1.88], 0.15, 0.03, 20, 'z')]);
  b.add('battery', 'demo_trim', box([-0.56, 0.62, 0.8], [0.18, 0.18, 0.26]));
  // The exhaust: down the underside, a silencer at the back, out under the rear right.
  b.add('exhaust', 'demo_trim', [...cylinder([-0.18, 0.17, -0.2], 0.03, 2.8, 12, 'z'), ...roundedBox([-0.3, 0.18, -1.75], [0.36, 0.12, 0.4], 0.04), ...cylinder([-0.48, 0.18, -2.06], 0.028, 0.22, 12, 'z')]);
}

/** The pieces, named the way modellers usually name them (so auto-classify finds them). */
export function demoCarPieces(): Piece[] {
  const b = new Builder();
  // Order matters only for the file: body first, like most models.
  b.add('body', 'demo_paint', []);
  bodySides(b);
  bonnet(b);
  glasshouse(b);
  boot(b);
  nose(b);
  bumpers(b);
  tailLamps(b);
  wheels(b);
  underbody(b);
  cabin(b);
  engineBay(b);
  return b.done().filter((p) => p.tris.length);
}

/**
 * Smooth normals within a piece, keeping edges sharper than `creaseDeg` as
 * creases: each corner averages the neighbouring faces that turn less than
 * that from its own.
 */
function smoothNormals(faces: readonly Face[], creaseDeg = 40): V3[][] {
  const key = (p: V3) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
  const faceN = faces.map((f) => norm(faceNormal(f)));
  const around = new Map<string, number[]>();
  faces.forEach((f, i) => {
    for (const p of f) {
      const k = key(p);
      const list = around.get(k) ?? [];
      list.push(i);
      around.set(k, list);
    }
  });
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  return faces.map((f, i) =>
    f.map((p) => {
      const sum: V3 = [0, 0, 0];
      for (const j of around.get(key(p)) ?? [i]) {
        if (dot(faceN[i]!, faceN[j]!) < cosCrease) continue;
        sum[0] += faceN[j]![0];
        sum[1] += faceN[j]![1];
        sum[2] += faceN[j]![2];
      }
      return norm(sum);
    }),
  );
}

/** The practice car as OBJ text (with `mtllib demo_car.mtl`) and its MTL; faces are quads where the model has them. */
export function demoCarObj(): { obj: string; mtl: string } {
  const lines = ['# JBeam Forge practice car (tutorial): a BMW E30 318i saloon', 'mtllib demo_car.mtl'];
  let vBase = 1;
  let nBase = 1;
  for (const p of demoCarPieces()) {
    lines.push(`o ${p.name}`);
    // Shared vertices and normals within the piece.
    const vIndex = new Map<string, number>();
    const nIndex = new Map<string, number>();
    const vLines: string[] = [];
    const nLines: string[] = [];
    const fLines: string[] = [];
    const all = p.groups.flatMap((g) => g.faces);
    const normals = smoothNormals(all);
    let i = 0;
    for (const g of p.groups) {
      fLines.push(`usemtl ${g.material}`);
      for (const f of g.faces) {
        const corners = f.map((v, k) => {
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
        fLines.push(`f ${corners.join(' ')}`);
        i++;
      }
    }
    lines.push(...vLines, ...nLines, ...fLines);
    vBase += vIndex.size;
    nBase += nIndex.size;
  }
  const mtl = Object.entries(MATERIALS)
    .map(([name, m]) => [`newmtl ${name}`, `Kd ${m.kd.join(' ')}`, `Ks ${m.ks ?? 0.5} ${m.ks ?? 0.5} ${m.ks ?? 0.5}`, `Ns ${m.ns ?? 50}`, `d ${m.d ?? 1}`].join('\n'))
    .join('\n\n');
  return { obj: `${lines.join('\n')}\n`, mtl: `${mtl}\n` };
}
