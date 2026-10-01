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
//
// The shape follows measurements of a reference E30 (the owner's reference
// model, read like a blueprint): the centre-line profile, the door section,
// the flares over the wheels, the side window outline. Only these curves are
// used; the surfaces, their topology and every part are built here.

/** Straight-line interpolation through (x, y) points sorted by x (either direction). */
function table(pts: readonly (readonly [number, number])[]): (x: number) => number {
  const sorted = [...pts].sort((p, q) => p[0] - q[0]);
  return (x) => {
    if (x <= sorted[0]![0]) return sorted[0]![1];
    for (let i = 1; i < sorted.length; i++) {
      const [x1, y1] = sorted[i]!;
      if (x <= x1) {
        const [x0, y0] = sorted[i - 1]!;
        // Smoothstep between points: the curve is continuous and has no kinks at the points.
        const t = (x - x0) / (x1 - x0);
        return y0 + (y1 - y0) * (0.5 * t + 0.5 * t * t * (3 - 2 * t));
      }
    }
    return sorted[sorted.length - 1]![1];
  };
}

const NOSE_Z = 2.09; // front face of the body (the bumper stands proud of it)
const TAIL_Z = -2.075;
const AXLE_F = 1.42;
const AXLE_R = -1.15; // 2.57 m wheelbase
const TRACK_F = 0.7035;
const TRACK_R = 0.7075;
const WHEEL_R = 0.312;
const WHEEL_Y = 0.312;
const ARCH_R = 0.35;
const ARCH_Y = 0.325;
const SILL_Y = 0.19; // bottom of the sills
const DOOR_BOTTOM = 0.27;
/** Where the lower sides (round the arches) meet the band above them. */
const MID_Y = 0.69;
const COWL_Z = 0.975; // bonnet's back edge, windscreen's foot
const DECK_Z = -1.665; // boot lid's front edge, rear window's foot
const BELT_Y = 0.88; // bottom of the side windows
const RAIL_Y = 1.316; // roof side rails
const GAP = 0.0025; // half a shut line

/** The doors' edges along the car, below the windows (four doors). */
const FRONT_DOOR: [number, number] = [0.925, -0.15];
const REAR_DOOR_FRONT = -0.15;
/** The B-pillar, between the doors' window frames. */
const B_PILLAR = -0.15;
/** Where the arches' surrounds end (the lower sides are built as rings round them). */
const ARCH_F: [number, number] = [AXLE_F + 0.4, AXLE_F - 0.4];
const ARCH_B: [number, number] = [AXLE_R + 0.39, AXLE_R - 0.39];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => t * t * (3 - 2 * t);
const linspace = (a: number, b: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
/** Points from a to b bunched towards b (for rounded ends). */
const easeTo = (a: number, b: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, Math.sin(((i / n) * Math.PI) / 2)));
const joinRuns = (...runs: number[][]): number[] => runs.flatMap((r, i) => (i ? r.slice(1) : r));

/** The door's cross-section, half width by height: the rocker lip and notch, the rubbing-strip line, the flat skin. */
const DOOR_SECTION = table([
  [0.19, 0.721],
  [0.215, 0.755],
  [0.24, 0.746],
  [0.29, 0.73],
  [0.34, 0.738],
  [0.39, 0.754],
  [0.44, 0.761],
  [0.465, 0.764],
  [0.49, 0.752],
  [0.54, 0.755],
  [0.59, 0.76],
  [0.64, 0.762],
  [0.69, 0.764],
  [0.74, 0.762],
]);
/** Above 0.74 m the shoulder rolls in to the window line: half width by the fraction of the way up. */
const SHOULDER = table([
  [0, 0.762],
  [0.185, 0.756],
  [0.37, 0.745],
  [0.56, 0.733],
  [0.74, 0.718],
  [0.93, 0.692],
  [1, 0.683],
]);
const W = 0.764; // the doors' half width
/** How far the wheel-arch flares stand out from the doors, along the car. */
const FLARE = table([
  [2.05, 0],
  [1.9, 0.006],
  [1.8, 0.02],
  [1.7, 0.036],
  [1.3, 0.04],
  [1.2, 0.039],
  [1.1, 0.035],
  [1.0, 0.025],
  [0.9, 0.01],
  [0.8, 0],
  [-0.35, 0],
  [-0.5, 0.01],
  [-0.6, 0.019],
  [-0.7, 0.028],
  [-0.8, 0.036],
  [-0.9, 0.041],
  [-1.0, 0.046],
  [-1.1, 0.051],
  [-1.2, 0.053],
  [-1.5, 0.053],
  [-1.6, 0.047],
  [-1.7, 0.036],
  [-1.8, 0.022],
  [-1.9, 0.006],
  [-2.0, 0],
]);
/** The flares stand out between the sill and a crisp edge just under the shoulder. */
const flareWeight = (y: number) => smooth(clamp01((y - 0.24) / 0.07)) * (1 - smooth(clamp01((y - 0.7) / 0.035)));
/** In plan the corners round off over the last few centimetres. */
function taper(z: number): number {
  if (z > 1.85) return 1 - 0.085 * ((z - 1.85) / (NOSE_Z - 1.85)) ** 2;
  if (z < -1.9) return 1 - 0.05 * ((-1.9 - z) / (-1.9 - TAIL_Z)) ** 2;
  return 1;
}
const halfW = (z: number) => W * taper(z);

/** The bonnet along its centre line, falling to the low nose. */
const HOOD_CL = table([
  [2.1, 0.752],
  [2.0, 0.793],
  [1.9, 0.818],
  [1.8, 0.84],
  [1.7, 0.855],
  [1.6, 0.866],
  [1.5, 0.877],
  [1.4, 0.885],
  [1.3, 0.894],
  [1.2, 0.901],
  [1.1, 0.909],
  [0.97, 0.921],
]);
/** The roof along its centre line, a little higher towards the back. */
const ROOF_CL = table([
  [0.34, 1.35],
  [0.3, 1.355],
  [0.2, 1.369],
  [0.1, 1.377],
  [0, 1.381],
  [-0.1, 1.386],
  [-0.2, 1.388],
  [-0.4, 1.391],
  [-0.6, 1.388],
  [-0.8, 1.381],
  [-0.9, 1.375],
  [-1.0, 1.366],
  [-1.08, 1.346],
]);
const BOOT_Y = 0.94; // the boot lid's middle
const HOOD_FRONT_Y = HOOD_CL(NOSE_Z);

/** Where the lower side ends and the bonnet, windows or boot lid begin (the wing tops fall with the bonnet). */
function topEdgeY(z: number): number {
  if (z >= COWL_Z) return HOOD_CL(z) - lerp(0.046, 0.024, clamp01((z - COWL_Z) / (NOSE_Z - COWL_Z)));
  if (z >= DECK_Z) return BELT_Y;
  return lerp(BELT_Y, BOOT_Y - 0.042, smooth(clamp01((DECK_Z - z) / 0.1)));
}

/** The body side's half width at a height: the door section, the flares over the wheels, the shoulder rolling in. */
function sideX(y: number, z: number): number {
  const k = taper(z);
  const top = topEdgeY(z);
  const from = Math.min(0.74, top - 0.05);
  if (y <= from) return (DOOR_SECTION(y) + FLARE(z) * flareWeight(y)) * k;
  const s = clamp01((y - from) / Math.max(0.01, top - from));
  return (SHOULDER(s) + (DOOR_SECTION(from) - 0.762) * (1 - s)) * k;
}
const SHOULDER_IN = W - 0.683; // the shoulder's top edge sits this far in

/** The glasshouse side: from the window line leaning in (straight) to the roof rail. */
const TUMBLE = 0.156;
const XR = W - SHOULDER_IN - TUMBLE; // roof rail half width
function ghPoint(z: number, t: number): V3 {
  const y = lerp(BELT_Y, RAIL_Y, t);
  const x = (W - SHOULDER_IN) * taper(z) - TUMBLE * t;
  return [x, y, z];
}

/** The windscreen's side edge along the car (its rake), and the A-pillar's rear edge behind it. */
const screenZ = (t: number) => lerp(0.915, 0.3, t);
const aRear = (t: number) => screenZ(t) - 0.065;
/** The front side window's leading edge: upright by the mirror, then up the A-pillar and round into the roof. */
const GLASS_FRONT = table([
  [0.88, 0.556],
  [0.98, 0.548],
  [1.02, 0.54],
  [1.06, 0.523],
  [1.1, 0.477],
  [1.18, 0.385],
  [1.26, 0.293],
  [1.3, 0.2],
  [1.316, 0.12],
]);
const glassFront = (t: number) => Math.min(aRear(t) - 0.02, GLASS_FRONT(lerp(BELT_Y, RAIL_Y, t)));

/** The rear side window's back edge (the frame's outside): the Hofmeister kink at the belt, then forward up the C-pillar. */
const GLASS_BACK = table([
  [0.88, -1.236],
  [0.94, -1.235],
  [0.98, -1.224],
  [1.02, -1.19],
  [1.1, -1.123],
  [1.18, -1.055],
  [1.26, -0.985],
  [1.3, -0.87],
  [1.316, -0.82],
]);
const cEdge = (t: number) => GLASS_BACK(lerp(BELT_Y, RAIL_Y, t)) - 0.02;
const REAR_DOOR_BACK = cEdge(0);
/** Roof: the rear window's top corners and centre. */
const ROOF_BACK_SIDE_Z = -0.98;
const ROOF_BACK_Z = -1.08;
/** Roof height across (u = -1…1) at a point along the car: its crown falls to the rails. */
const roofAt = (z: number, u: number) => RAIL_Y + (ROOF_CL(z) - RAIL_Y) * (1 - Math.abs(u) ** 3.5);

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
/** Heights up the band above the arches: close rows at the flares' top edge, then the shoulder rolling in. */
const UPPER_FRACTIONS = [0, 0.08, 0.16, 0.24, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82, 0.91, 1];
const upperRows = (z: number): number[] => UPPER_FRACTIONS.map((f) => lerp(MID_Y, topEdgeY(z), f));

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
      const lip = r === 0 ? -0.014 : r <= 0.02 ? 0.001 : r <= 0.06 ? 0.0015 : 0;
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
  demo_paint: { kd: [0.07, 0.09, 0.42], ns: 250, ks: 0.6 },
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
  fenderFront: joinRuns(linspace(ARCH_F[0], 1.9, 2), easeTo(1.9, NOSE_Z, 6)),
  fenderArchTop: linspace(ARCH_F[0], ARCH_F[1], 16),
  fenderBack: linspace(ARCH_F[1], FRONT_DOOR[0] + GAP, 3),
  doorF: linspace(FRONT_DOOR[0] - GAP, FRONT_DOOR[1] + GAP, 20),
  doorRLower: linspace(REAR_DOOR_FRONT - GAP, ARCH_B[0] + GAP, 8),
  // Over the rear arch: the rear door's upper band ends at the C-pillar's foot.
  rearArchTop: joinRuns(linspace(ARCH_B[0], REAR_DOOR_BACK, 10), linspace(REAR_DOOR_BACK, ARCH_B[1], 6)),
  quarterBack: joinRuns(linspace(ARCH_B[1], -1.9, 7), easeTo(-1.9, TAIL_Z, 6)),
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
    const path: [number, number][] = linspace(z0, z1, Math.max(2, Math.round(Math.abs(z1 - z0) / 0.08))).map((z) => [sideX(0.465, z), z]);
    const prof: [number, number][] = [
      [-0.004, -0.017],
      [0.008, -0.015],
      [0.012, 0],
      [0.008, 0.015],
      [-0.004, 0.017],
    ];
    const m = sweep(path, 0.465, prof, () => 'demo_rubber');
    b.add(name.replace('*', 'L'), 'demo_rubber', m.get('demo_rubber')!);
    b.add(name.includes('*') ? name.replace('*', 'R') : name, 'demo_rubber', m.get('demo_rubber')!.map((f) => flipFace(f.map(mirrorX))));
  };
  const archEdge = Math.sqrt(ARCH_R ** 2 - (0.465 - ARCH_Y) ** 2) + 0.025;
  strip('fender_F*', AXLE_F - archEdge, FRONT_DOOR[0] + 0.006);
  strip('door_F*', FRONT_DOOR[0] - 0.006, FRONT_DOOR[1] + 0.006);
  strip('door_R*', REAR_DOOR_FRONT - 0.006, ARCH_B[0] + 0.006);
  strip('fender_F*', AXLE_F + ARCH_R + 0.03, AXLE_F + archEdge);
  strip('body', ARCH_B[0] - 0.006, AXLE_R + archEdge);

  // Door handles: black pulls on the shoulder near each door's back edge.
  for (const [door, z] of [
    ['door_F', FRONT_DOOR[1] + 0.14],
    ['door_R', ARCH_B[0] - 0.06],
  ] as const) {
    const y = 0.83;
    const x = sideX(y, z) + 0.004;
    const h = rotate(roundedBox([x, y, z], [0.02, 0.028, 0.12], 0.008), [x, y, z], [0, 0, 1], 22);
    b.add(`${door}L`, 'demo_trim', h);
    b.add(`${door}R`, 'demo_trim', h.map((f) => flipFace(f.map(mirrorX))));
  }
  // Side repeaters on the front wings.
  const rep = roundedBox([sideX(0.6, 1.9) + 0.004, 0.6, 1.9], [0.01, 0.026, 0.055], 0.006);
  b.add('indicator_FL', 'demo_indicator', rep);
  b.add('indicator_FR', 'demo_indicator', rep.map((f) => flipFace(f.map(mirrorX))));
}

/**
 * The bonnet between the wing tops: its centre line follows the measured
 * profile down to the low nose, crowned across, its front edge rolled down
 * over the grille band.
 */
function bonnet(b: Builder): void {
  const z0 = COWL_Z + GAP;
  const z1 = NOSE_Z + 0.008;
  const xs = (z: number) => sideX(topEdgeY(z), Math.min(z, NOSE_Z)) - 0.004;
  const us = linspace(-1, 1, 26);
  const vs = joinRuns(linspace(0, 0.85, 20), easeTo(0.85, 1, 4));
  const top = sample(us, vs, (u, v) => {
    const z = lerp(z0, z1, v);
    const zc = Math.min(z, NOSE_Z);
    const edge = topEdgeY(zc);
    const centre = HOOD_CL(z);
    // Nearly flat across the middle, rounding down to the shut lines.
    return [u * xs(zc), edge + (centre - edge) * (1 - Math.abs(u) ** 2.4), z];
  });
  // The front lip: two more rows rolling down to the top of the grille band.
  const front = top[top.length - 1]!;
  top.push(front.map((p) => [p[0] * 0.998, p[1] - 0.008, p[2] + 0.007] as V3));
  top.push(front.map((p) => [p[0] * 0.992, Math.min(p[1] - 0.02, BAND_TOP + 0.004), p[2] + 0.009] as V3));
  b.add('hood', 'demo_paint', shell(top, [0, 1, 0]));
  // The roundel at the front of the bonnet, above the kidneys.
  const badgeC: V3 = [0, HOOD_CL(NOSE_Z - 0.03) + 0.004, NOSE_Z - 0.03];
  const badge = rotate(lathe([0, 0, 0], [[0, -0.004], [0.036, -0.004], [0.036, 0.004], [0.03, 0.006], [0, 0.006]], 24, 'z'), [0, 0, 0], [1, 0, 0], -70);
  b.add('hood', 'demo_badge', moveBy(badge, badgeC));
}

/** Top of the black band under the bonnet's front edge, and its foot on the bumper. */
const BAND_TOP = 0.742;
const BAND_Y = 0.53;

/** Windscreen, A-pillars, roof, rear window, C-pillars, the doors' window frames and glass. */
function glasshouse(b: Builder): void {
  const us = linspace(0, 1, 24);
  const uu = (u: number) => lerp(-1, 1, u);
  // Windscreen: its centre line runs straight from the scuttle to the roof, the sides a little further back.
  const SCREEN_BASE: V3 = [0, HOOD_CL(COWL_Z) + 0.012, COWL_Z - 0.01];
  const SCREEN_TOP_Z = 0.34;
  const xE = (t: number) => lerp((W - SHOULDER_IN) - 0.01, XR, t);
  const E = (t: number): V3 => [xE(t), lerp(BELT_Y + 0.004, RAIL_Y, t), screenZ(t)];
  const screenBase = (u: number): V3 => [u * xE(0), lerp(E(0)[1], SCREEN_BASE[1], 1 - u * u), lerp(E(0)[2], SCREEN_BASE[2], 1 - u * u)];
  const screenTopZ = (u: number) => lerp(screenZ(1), SCREEN_TOP_Z, 1 - u * u);
  const screenTop = (u: number): V3 => [u * XR, roofAt(screenTopZ(u), u), screenTopZ(u)];
  const ws = coons(
    (u) => screenBase(uu(u)),
    (u) => screenTop(uu(u)),
    (v) => mirrorX(E(v)),
    (v) => E(v),
  );
  const up: V3 = norm([0, 0.83, 0.55]);
  b.add('windshield', 'demo_glass', shell(sample(us, linspace(0, 1, 12), (u, v) => add(ws(u, v), scale(up, 0.01 * Math.sin(Math.PI * v) * (1 - uu(u) ** 2)))), up, 0.005));
  // A-pillars: from the windscreen's edge round to the side glass.
  const Ga = (t: number): V3 => ghPoint(aRear(t), t);
  const ap = coons(
    (s2) => lerp3(E(0), Ga(0), s2),
    (s2) => lerp3(E(1), Ga(1), s2),
    (t) => E(t),
    (t) => Ga(t),
  );
  const apOut: V3 = norm([1, 0.5, 0.5]);
  b.both('body', 'body', 'demo_paint', sample(linspace(0, 1, 4), linspace(0, 1, 12), (s2, t) => add(ap(s2, t), scale(apOut, 0.008 * Math.sin(Math.PI * s2)))), apOut);
  // Roof: the measured centre line, its crown falling to the rails.
  const rearTopZ = (u: number) => lerp(ROOF_BACK_SIDE_Z, ROOF_BACK_Z, 1 - u * u);
  const roof = sample(us, linspace(0, 1, 22), (u, w) => {
    const x = uu(u);
    const z = lerp(screenTopZ(x), rearTopZ(x), w);
    return [x * XR, roofAt(z, x), z];
  });
  b.add('body', 'demo_paint', shell(roof, [0, 1, 0]));
  // Rear window: from the roof down to the boot lid, wrapping a little at the corners.
  const RW_X = 0.672;
  const RW_Y = BOOT_Y + 0.002;
  const RW_CORNER_Z = DECK_Z + 0.06;
  const rwSide = (v: number): V3 => lerp3([RW_X, RW_Y - 0.005, RW_CORNER_Z], [XR, RAIL_Y, ROOF_BACK_SIDE_Z], v);
  const rwBottom = (u: number): V3 => [u * RW_X, RW_Y - 0.005 * u * u, lerp(RW_CORNER_Z, DECK_Z, 1 - u * u)];
  const rearTop = (u: number): V3 => [u * XR, roofAt(rearTopZ(u), u), rearTopZ(u)];
  const rw = coons(
    (u) => rwBottom(uu(u)),
    (u) => rearTop(uu(u)),
    (v) => mirrorX(rwSide(v)),
    (v) => rwSide(v),
  );
  const back: V3 = norm([0, 0.75, -0.66]);
  b.add('rear_window', 'demo_glass', shell(sample(us, linspace(0, 1, 10), (u, v) => add(rw(u, v), scale(back, 0.008 * Math.sin(Math.PI * v) * (1 - uu(u) ** 2)))), back, 0.005));
  // C-pillars: from the side window's kinked edge back round to the rear window, down to the shoulder.
  const Gc = (t: number): V3 => ghPoint(cEdge(t), t);
  const TW = 0.13;
  const pillarFoot: V3 = [(W - SHOULDER_IN) * taper(DECK_Z), BELT_Y, DECK_Z];
  const D = (t: number): V3 => (t <= TW ? lerp3(pillarFoot, [RW_X, RW_Y - 0.005, RW_CORNER_Z], t / TW) : rwSide((t - TW) / (1 - TW)));
  const cp = coons(
    (s2) => {
      const z = lerp(cEdge(0), DECK_Z, s2);
      return [(W - SHOULDER_IN) * taper(z), BELT_Y, z];
    },
    (s2) => lerp3(Gc(1), D(1), s2),
    (t) => Gc(t),
    (t) => D(t),
  );
  const cOut: V3 = norm([1, 0.4, -0.5]);
  b.both('body', 'body', 'demo_paint', sample(linspace(0, 1, 10), linspace(0, 1, 14), (s2, t) => add(cp(s2, t), scale(cOut, 0.01 * Math.sin(Math.PI * s2) * Math.sin(Math.PI * t)))), cOut);
  // The shelf under the rear window's corners, down to the boot lid.
  const shelf = coons(
    (u) => [uu(u) * pillarFoot[0], BELT_Y, DECK_Z],
    (u) => rwBottom(uu(u)),
    (v) => mirrorX(D(v * TW)),
    (v) => D(v * TW),
  );
  b.add('body', 'demo_paint', shell(sample(us, linspace(0, 1, 3), shelf), [0, 1, 0]));

  // Side windows and their frames, per door. Rows run up from the belt (t), columns along the car.
  const L: V3 = [1, 0, 0];
  const strip = (z0: (t: number) => number, z1: (t: number) => number, t0: number, t1: number, nz: number, nt: number, inset = 0): Grid =>
    sample(linspace(0, 1, nz), linspace(t0, t1, nt), (s2, t) => {
      const p = ghPoint(lerp(z0(t), z1(t), s2), t);
      return [p[0] - inset, p[1], p[2]];
    });
  const BOT = 0.03;
  const TOP = 0.93;
  const frame = (name: string, zf: (t: number) => number, zr: (t: number) => number, glass: [(t: number) => number, (t: number) => number][]) => {
    const nameL = `${name}L`;
    const nameR = `${name}R`;
    b.both(nameL, nameR, 'demo_trim', strip(zf, zr, 0, BOT, 16, 1), L, 0.008);
    b.both(nameL, nameR, 'demo_trim', strip(zf, zr, TOP, 1, 16, 2), L, 0.008);
    // Uprights: in front of, between and behind the panes (the front one is the black sail the mirror sits on).
    const edges = [zf, ...glass.flat(), zr];
    for (let k = 0; k < edges.length; k += 2) b.both(nameL, nameR, 'demo_trim', strip(edges[k]!, edges[k + 1]!, BOT, TOP, 3, 12), L, 0.008);
    for (const [g0, g1] of glass) b.both(`${name.replace('door_', 'door_glass_')}L`, `${name.replace('door_', 'door_glass_')}R`, 'demo_glass', strip(g0, g1, BOT, TOP, 12, 12, 0.008), L, 0.005);
  };
  frame('door_F', (t) => aRear(t) - GAP, () => B_PILLAR + 0.002, [[(t) => glassFront(t), () => B_PILLAR + 0.04]]);
  frame('door_R', () => B_PILLAR - 0.002, (t) => cEdge(t) + GAP, [
    [() => B_PILLAR - 0.04, () => -0.93],
    [() => -0.948, (t) => cEdge(t) + 0.02],
  ]);
  // The B-pillar behind the door frames, for when the doors are off.
  b.both('body', 'body', 'demo_trim', sample(linspace(B_PILLAR + 0.015, B_PILLAR - 0.035, 2), linspace(0, 1, 6), (z, t) => {
    const p = ghPoint(z, t);
    return [p[0] - 0.03, p[1], p[2]];
  }), L);
  b.both('body', 'body', 'demo_paint', sample(linspace(B_PILLAR + 0.015, B_PILLAR - 0.035, 2), linspace(SILL_Y, BELT_Y, 6), (z, y) => [sideX(y, z) - 0.03, y, z]), L);

  // Door cards: the trim inside each door.
  for (const [name, z0, z1] of [
    ['door_F', FRONT_DOOR[0] - 0.03, FRONT_DOOR[1] + 0.03],
    ['door_R', REAR_DOOR_FRONT - 0.03, ARCH_B[0] - 0.02],
  ] as const) {
    const card = sample(linspace(z0, z1, 12), linspace(DOOR_BOTTOM + 0.03, BELT_Y - 0.01, 8), (z, y) => [sideX(y, z) - 0.07 - 0.02 * clamp01((y - 0.78) / 0.1), y, z]);
    b.both(`${name}L`, `${name}R`, 'demo_interior', card, [-1, 0, 0], 0.012);
  }
  // Door mirrors on the black sail at the front of the front door windows.
  const mz = 0.7;
  const my = BELT_Y + 0.06;
  const mirror = [
    ...rotate(roundedBox([W + 0.055, my, mz], [0.1, 0.075, 0.075], 0.022), [W + 0.055, my, mz], [0, 1, 0], -8),
    ...roundedBox([W - 0.03, my - 0.02, mz + 0.02], [0.07, 0.04, 0.06], 0.012),
  ];
  b.add('mirror_L', 'demo_trim', mirror);
  b.add('mirror_R', 'demo_trim', mirror.map((f) => flipFace(f.map(mirrorX))));
}

/** The boot lid (with the panel between the tail lamps) and the tail panel. */
function boot(b: Builder): void {
  const z0 = DECK_Z - 0.008;
  const z1 = TAIL_Z + 0.03;
  const xs = (z: number) => sideX(topEdgeY(z), z) - 0.004;
  const top = sample(linspace(-1, 1, 26), linspace(0, 1, 10), (u, v) => {
    const z = lerp(z0, z1, v);
    const edge = topEdgeY(z) + 0.002;
    const centre = lerp(BOOT_Y, BOOT_Y - 0.005, v);
    return [u * xs(z), edge + (centre - edge) * (1 - Math.abs(u) ** 2.4), z];
  });
  const last = top[top.length - 1]!;
  // The rear edge rolls down onto the tail.
  top.push(last.map((p) => [p[0] * 0.997, p[1] - 0.01, TAIL_Z + 0.012] as V3));
  top.push(last.map((p) => [p[0] * 0.99, p[1] - 0.03, TAIL_Z - 0.002] as V3));
  b.add('trunk', 'demo_paint', shell(top, [0, 1, 0]));
  // The panel between the lamps, down to the bumper (the plate goes here).
  const PL = 0.36;
  b.add('trunk', 'demo_paint', shell(sample(linspace(-PL, PL, 12), linspace(BOOT_Y - 0.035, 0.56, 8), (x, y) => [x, y, TAIL_Z - 0.004 + 0.012 * ((y - 0.56) / (BOOT_Y - 0.595)) ** 2]), [0, 0, -1]));
  // The tail panel behind it all (lamps and boot lid off: still a car).
  const hw = halfW(TAIL_Z);
  b.add('body', 'demo_paint', shell(sample(linspace(-hw, hw, 24), linspace(0.26, BOOT_Y - 0.01, 10), (x, y) => [x, y, TAIL_Z + 0.006]), [0, 0, -1]));
}

/** The nose: the black band with the kidneys, the four lamps, the apron and the chin spoiler. */
function nose(b: Builder): void {
  const hw = halfW(NOSE_Z);
  const bandZ = (y: number) => NOSE_Z + 0.004 + 0.014 * clamp01((y - BAND_Y) / (BAND_TOP - BAND_Y));
  // The band's top follows the bonnet's front edge, which falls towards the corners.
  const edgeAt = (x: number) => {
    const e = topEdgeY(NOSE_Z);
    return Math.min(BAND_TOP, e + (HOOD_FRONT_Y - e) * (1 - Math.abs(x / hw) ** 2.4) - 0.02);
  };
  b.add('grille', 'demo_trim', shell(sample(linspace(-hw, hw, 28), linspace(0, 1, 6), (x, f) => {
    const y = lerp(BAND_Y, edgeAt(x), f);
    return [x, y, bandZ(y) - 0.01 * (x / hw) ** 6];
  }), [0, 0, 1], 0.01));
  // The kidneys: chrome surrounds with black slats, a touch narrower at the foot.
  for (const side of [1, -1]) {
    const cx = side * 0.064;
    const cy = 0.64;
    const kidney = (s: number): [number, number] => {
      // A superellipse (rounded rectangle), 0.106 wide and 0.2 high.
      const a = s * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const e = 0.35;
      const x = Math.sign(c) * Math.abs(c) ** e * 0.053 * (sn < 0 ? 1 - 0.12 * -sn : 1);
      const y = Math.sign(sn) * Math.abs(sn) ** e * 0.094;
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
    for (let k = -3; k <= 3; k++) b.add('grille', 'demo_rubber', box([cx + k * 0.012, cy - 0.004, bandZ(cy) + 0.012], [0.004, 0.16, 0.012]));
  }
  // Four round lamps: chrome bezel, reflector, domed lens.
  for (const [side, tag] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    for (const [x, r] of [
      [0.255, 0.079],
      [0.47, 0.088],
    ] as const) {
      const c: V3 = [side * x, 0.638, bandZ(0.638) + 0.002];
      b.add(`headlight_${tag}`, 'demo_chrome', lathe(c, [[r - 0.004, 0], [r + 0.012, 0], [r + 0.012, 0.016], [r + 0.004, 0.022], [r - 0.004, 0.018]], 32, 'z'));
      b.add(`headlight_${tag}`, 'demo_headlight', lathe(c, [[0, 0.002], [r, 0.002], [r, 0.014], [r * 0.7, 0.024], [0, 0.028]], 32, 'z'));
    }
  }
  // The apron under the band, behind the bumper, with the black chin spoiler below.
  b.add('body', 'demo_paint', shell(sample(linspace(-hw + 0.01, hw - 0.01, 24), linspace(0.24, BAND_Y, 6), (x, y) => [x, y, NOSE_Z - 0.004 - 0.02 * ((BAND_Y - y) / (BAND_Y - 0.24)) ** 2]), [0, 0, 1]));
  const spoilerPath: [number, number][] = linspace(-1, 1, 20).map((t) => [t * (hw - 0.05), NOSE_Z + 0.03 - 0.04 * t ** 4]);
  const spoiler = sweep(spoilerPath, 0.3, [[-0.03, -0.018], [0.03, -0.012], [0.035, 0.008], [-0.03, 0.02]], () => 'demo_trim');
  b.addMap('body', spoiler, 'demo_paint');
}

/**
 * The facelift's plastic bumpers: deep and square, wrapping round the corners
 * to the wheel arches, a rubbing strip along the middle, the front
 * indicators set into them.
 */
function bumpers(b: Builder): void {
  // (outward, up) from the bumper's middle: a flat face rounding over at top and bottom, the strip standing proud.
  const prof: [number, number][] = [
    [-0.06, -0.125],
    [0, -0.128],
    [0.028, -0.118],
    [0.042, -0.095],
    [0.046, -0.03],
    [0.05, -0.026],
    [0.056, -0.02],
    [0.056, 0.012],
    [0.05, 0.018],
    [0.046, 0.022],
    [0.044, 0.1],
    [0.032, 0.122],
    [0, 0.13],
    [-0.06, 0.13],
  ];
  const strip = new Set([4, 5, 6, 7, 8]);
  const build = (name: string, face: number, sideEnd: number, y: number) => {
    const dir = Math.sign(face);
    const R = 0.09;
    const xw = W + 0.012;
    const endL: [number, number][] = [];
    const sideSteps = 5;
    const arcSteps = 8;
    const halfFront = 10;
    for (let i = 0; i <= sideSteps; i++) endL.push([xw, lerp(sideEnd, face - dir * R, i / sideSteps)]);
    for (let i = 1; i <= arcSteps; i++) {
      const a = ((i / arcSteps) * Math.PI) / 2;
      endL.push([xw - R + R * Math.cos(a), face - dir * R + dir * R * Math.sin(a)]);
    }
    for (let i = 1; i <= halfFront; i++) endL.push([lerp(xw - R, 0, i / halfFront), face]);
    const path = [...endL];
    for (let i = endL.length - 2; i >= 0; i--) path.push([-endL[i]![0], endL[i]![1]]);
    const m = sweep(path, y, prof.map(([o, u]): [number, number] => [o, u * 0.82]), (_seg, p) => (strip.has(p) ? 'demo_rubber' : 'demo_trim'));
    b.addMap(name, m, 'demo_trim');
  };
  build('bumper_F', NOSE_Z + 0.05, AXLE_F + ARCH_R + 0.02, 0.43);
  build('bumper_R', TAIL_Z - 0.05, AXLE_R - ARCH_R - 0.02, 0.43);
  // Front indicators in the bumper, under the outer lamps, and the air slot between them.
  for (const [side, tag] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) b.add(`indicator_F${tag}`, 'demo_indicator', roundedBox([side * 0.5, 0.49, NOSE_Z + 0.098], [0.2, 0.04, 0.012], 0.006));
  b.add('bumper_F', 'demo_rubber', roundedBox([0, 0.37, NOSE_Z + 0.09], [0.62, 0.045, 0.02], 0.01));
}

/** Wide tail lamps with ribbed lenses: red, an amber band, white reversing lamps by the plate. */
function tailLamps(b: Builder): void {
  for (const [side, tag] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const x0 = 0.37;
    const x1 = halfW(TAIL_Z) - 0.012;
    const y0 = 0.6;
    const y1 = BOOT_Y - 0.075;
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
      tread.push([WHEEL_R - (groove ? 0.004 : 0), t]);
    }
    const tyre: [number, number][] = [
      [0.178, 0.076],
      [0.215, 0.083],
      [WHEEL_R - 0.052, 0.087],
      [WHEEL_R - 0.024, 0.082],
      [WHEEL_R - 0.009, 0.074],
      ...tread.slice().reverse(),
      [WHEEL_R - 0.009, -0.074],
      [WHEEL_R - 0.024, -0.082],
      [WHEEL_R - 0.052, -0.087],
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
  b.add('body', 'demo_trim', box([0, 0.55, COWL_Z - 0.05], [2 * W - 0.12, 0.64, 0.02]));
  b.add('body', 'demo_interior', box([0, BELT_Y + 0.03, DECK_Z + 0.16], [2 * XR, 0.015, 0.3]));
}

function cabin(b: Builder): void {
  b.add('carpet', 'demo_interior', box([0, SILL_Y + 0.04, -0.3], [2 * W - 0.18, 0.02, 2.4]));
  b.add('dashboard', 'demo_interior', [
    ...roundedBox([0, 0.78, COWL_Z - 0.18], [2 * W - 0.14, 0.22, 0.28], 0.05),
    ...rotate(roundedBox([0, 0.88, COWL_Z - 0.24], [2 * W - 0.18, 0.05, 0.24], 0.02), [0, 0.88, COWL_Z - 0.12], [1, 0, 0], -12),
    // The instrument binnacle ahead of the driver.
    ...roundedBox([0.37, 0.92, COWL_Z - 0.28], [0.4, 0.08, 0.14], 0.03),
  ]);
  b.add('center_console', 'demo_interior', [...roundedBox([0, 0.42, 0.3], [0.24, 0.36, 0.62], 0.04), ...cylinder([0, 0.64, 0.2], 0.012, 0.18, 10, 'y'), ...lathe([0, 0.74, 0.2], [[0, -0.02], [0.022, -0.012], [0.022, 0.012], [0, 0.02]], 12, 'y')]);
  const steering: Face[] = [
    ...torus([0, 0, 0], 0.19, 0.016, 36, 8),
    ...roundedBox([0, 0, 0], [0.09, 0.09, 0.05], 0.02),
    ...box([0, -0.09, 0], [0.03, 0.16, 0.02]),
    ...rotate(box([0.09, 0.01, 0], [0.17, 0.03, 0.02]), [0, 0, 0], [0, 0, 1], -8),
    ...rotate(box([-0.09, 0.01, 0], [0.17, 0.03, 0.02]), [0, 0, 0], [0, 0, 1], 8),
    ...cylinder([0, 0, 0.15], 0.022, 0.3, 10, 'z'),
  ];
  // Raked back like a real column, on the driver's side (left-hand drive).
  b.add('steering_wheel', 'demo_trim', moveBy(rotate(steering, [0, 0, 0], [1, 0, 0], -24), [0.37, 0.88, COWL_Z - 0.44]));
  const frontSeat = (x: number): Face[] => [
    ...roundedBox([x, 0.42, 0.05], [0.5, 0.13, 0.52], 0.04),
    ...rotate(roundedBox([x, 0.76, -0.19], [0.48, 0.62, 0.12], 0.05), [x, 0.48, -0.19], [1, 0, 0], -14),
    ...rotate(roundedBox([x, 1.12, -0.23], [0.26, 0.16, 0.08], 0.03), [x, 0.48, -0.19], [1, 0, 0], -14),
    ...box([x, 0.3, 0.05], [0.36, 0.12, 0.42]),
  ];
  b.add('seat_FL', 'demo_seat', frontSeat(0.37));
  b.add('seat_FR', 'demo_seat', frontSeat(-0.37));
  b.add('rear_seat', 'demo_seat', [...roundedBox([0, 0.4, -0.88], [2 * W - 0.3, 0.14, 0.5], 0.05), ...rotate(roundedBox([0, 0.72, -1.2], [2 * W - 0.3, 0.56, 0.12], 0.05), [0, 0.47, -1.2], [1, 0, 0], -18)]);
}

function engineBay(b: Builder): void {
  // A slanted four-cylinder (block, head, cam cover, sump, pulleys, intake), the radiator and fan, the battery.
  b.add('engine', 'demo_engine', [
    ...rotate([...box([0, 0.46, 1.5], [0.3, 0.3, 0.58]), ...box([0, 0.66, 1.5], [0.26, 0.12, 0.56]), ...roundedBox([0, 0.75, 1.5], [0.2, 0.07, 0.5], 0.025)], [0, 0.35, 1.5], [0, 0, 1], -30),
    ...box([0, 0.3, 1.5], [0.26, 0.12, 0.48]),
    ...cylinder([0.02, 0.4, 1.82], 0.07, 0.04, 20, 'z'),
    ...cylinder([0.14, 0.52, 1.8], 0.045, 0.06, 16, 'z'),
    ...box([-0.26, 0.62, 1.5], [0.12, 0.08, 0.42]),
    ...cylinder([-0.36, 0.7, 1.62], 0.09, 0.12, 20, 'x'),
  ]);
  b.add('radiator', 'demo_engine', [...box([0, 0.58, 1.98], [0.64, 0.32, 0.05]), ...cylinder([0, 0.58, 1.93], 0.14, 0.03, 20, 'z')]);
  b.add('battery', 'demo_trim', box([-0.54, 0.62, 1.15], [0.18, 0.18, 0.26]));
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

/**
 * The engine bay and engine for the practice car built from the owner's
 * reference model (scripts/dev/buildDemoCar.mts): body-coloured inner wings
 * with strut towers, the firewall, an undertray and the radiator support,
 * and the engine (block, head, cam cover, sump, pulleys, intake, exhaust
 * manifold), radiator with its fan, and battery. Front axle at z = 1.426,
 * the bonnet's back edge at z = 0.975.
 */
export function engineBayPieces(): Piece[] {
  const b = new Builder();
  const AF = 1.426;
  const inner = 0.545;
  // Inner wings: walls beside the engine with a strut tower over each wheel.
  for (const s of [1, -1]) {
    b.add('engine_bay', 'demo_paint', box([s * inner, 0.56, 1.5], [0.012, 0.44, 1.02]));
    b.add('engine_bay', 'demo_paint', cylinder([s * (inner - 0.07), 0.7, AF], 0.085, 0.18, 20, 'y'));
    b.add('engine_bay', 'demo_paint', box([s * (inner - 0.035), 0.785, AF], [0.07, 0.012, 0.2]));
  }
  // Firewall, undertray, radiator support.
  b.add('engine_bay', 'demo_paint', box([0, 0.6, 0.99], [2 * inner, 0.56, 0.012]));
  b.add('engine_bay', 'demo_trim', box([0, 0.2, 1.52], [2 * inner, 0.01, 1.05]));
  b.add('engine_bay', 'demo_paint', box([0, 0.72, 2.02], [2 * inner - 0.1, 0.05, 0.05]));
  b.add('engine_bay', 'demo_paint', box([0, 0.42, 2.02], [2 * inner - 0.1, 0.05, 0.05]));
  // The engine: a four-cylinder leaning over, with its pulleys, intake and exhaust manifold.
  const ez = 1.45;
  b.add('engine', 'demo_engine', [
    ...rotate([...box([0, 0.47, ez], [0.3, 0.3, 0.58]), ...box([0, 0.67, ez], [0.26, 0.12, 0.56]), ...roundedBox([0, 0.76, ez], [0.2, 0.07, 0.5], 0.025)], [0, 0.36, ez], [0, 0, 1], -30),
    ...box([0, 0.3, ez], [0.26, 0.12, 0.48]),
    ...cylinder([0.02, 0.41, ez + 0.32], 0.07, 0.04, 20, 'z'),
    ...cylinder([0.14, 0.53, ez + 0.3], 0.045, 0.06, 16, 'z'),
    ...box([-0.26, 0.63, ez], [0.12, 0.08, 0.42]),
    ...cylinder([-0.36, 0.71, ez + 0.12], 0.09, 0.12, 20, 'x'),
  ]);
  for (let k = 0; k < 4; k++) b.add('engine', 'demo_chrome', bar([0.16, 0.52, ez - 0.2 + k * 0.13], [0.24, 0.36, ez - 0.2 + k * 0.13], 0.035, 0.035, [0, 0, 1]));
  b.add('radiator', 'demo_engine', [...box([0, 0.57, 1.97], [0.62, 0.3, 0.05]), ...cylinder([0, 0.57, 1.92], 0.13, 0.03, 20, 'z')]);
  b.add('battery', 'demo_trim', box([-0.42, 0.6, 1.12], [0.18, 0.18, 0.26]));
  return b.done();
}
