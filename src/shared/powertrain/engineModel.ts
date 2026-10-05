import type { EngineDesign } from './design';

/**
 * The engine designer's own 3D engine, built from the design the way an engine
 * is put together: one cylinder's slice of block, head, cam cover, coil,
 * intake runner and exhaust primary is made once, then copied along the crank
 * for every cylinder and turned for every bank (a V, a flat, a W). Around it
 * go the parts every engine has (crankcase, sump, timing cover, pulleys, belt,
 * alternator, bellhousing) and the ones the design picks (a plenum and
 * throttle body or individual throttles, a carburettor and its air cleaner, a
 * turbo or two with their pipes, a supercharger). Rotaries get a housing per
 * rotor; electric motors a can and an inverter. Nothing comes from the game.
 *
 * Written as an OBJ, in loader space like every model: +Y up, the front of the
 * engine (the timing cover) towards +Z, +X to the left. Metres. The crank runs
 * along Z at the origin, and the rear face of the block is at z = 0.
 */

type V3 = [number, number, number];

interface Face {
  v: V3[];
  n: V3[];
}

/** One of the engine's meshes: its faces, by material. */
export interface EnginePiece {
  name: string;
  /** What it is, for the parts list ("block", "turbo"…). */
  label: string;
  groups: Map<string, Face[]>;
}

export interface EngineModel {
  pieces: EnginePiece[];
  /** Overall size (m) and where the crank sits above the bottom of the sump. */
  size: V3;
  crankHeight: number;
  /** Materials the pieces use: name → base colour (0–1), shine (0–1), metal or not. */
  materials: Record<string, { colour: V3; roughness: number; metallic: number }>;
}

// ---------------------------------------------------------------- vector maths

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Turn about the crank (the Z axis) by `deg`, positive leaning the top to +X. */
const turnZ = (p: V3, deg: number): V3 => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c, p[2]];
};

// ---------------------------------------------------------------- shapes

/** A box, flat-shaded. */
function box(min: V3, max: V3): Face[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const q = (a: V3, b: V3, c: V3, d: V3, n: V3): Face => ({ v: [a, b, c, d], n: [n, n, n, n] });
  return [
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]),
    q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]),
    q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]),
    q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]),
    q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]),
    q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]),
  ];
}

/** Two unit vectors at right angles to `axis` (and to each other). */
function frame(axis: V3): [V3, V3] {
  const a = norm(axis);
  const helper: V3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(a, helper));
  return [u, cross(a, u)];
}

/** A cylinder (or a cone, with two radii) from `start` along `axis` for `length`, smooth sides, flat ends. */
function cylinder(start: V3, axis: V3, length: number, r0: number, r1 = r0, sides = 16, caps = true): Face[] {
  const a = norm(axis);
  const [u, w] = frame(a);
  const end = add(start, mul(a, length));
  const ring = (c: V3, r: number) => Array.from({ length: sides }, (_, i) => {
    const t = (i / sides) * Math.PI * 2;
    const d = add(mul(u, Math.cos(t)), mul(w, Math.sin(t)));
    return { p: add(c, mul(d, r)), n: d };
  });
  const A = ring(start, r0);
  const B = ring(end, r1);
  const slope = (r0 - r1) / length;
  const out: Face[] = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const n = (k: number) => norm(add(A[k]!.n, mul(a, slope)));
    out.push({ v: [A[i]!.p, A[j]!.p, B[j]!.p, B[i]!.p], n: [n(i), n(j), n(j), n(i)] });
  }
  if (caps) {
    const back = mul(a, -1);
    for (let i = 1; i + 1 < sides; i++) {
      out.push({ v: [A[0]!.p, A[i + 1]!.p, A[i]!.p], n: [back, back, back] });
      out.push({ v: [B[0]!.p, B[i]!.p, B[i + 1]!.p], n: [a, a, a] });
    }
  }
  return out;
}

/** A tube along a path (runners, primaries, pipes), smooth, capped. */
function tube(path: readonly V3[], radius: number, sides = 10): Face[] {
  const out: Face[] = [];
  const n = path.length;
  const tangent = (i: number) => norm(sub(path[Math.min(n - 1, i + 1)]!, path[Math.max(0, i - 1)]!));
  let [u, w] = frame(tangent(0));
  const rings: { p: V3; n: V3 }[][] = [];
  for (let i = 0; i < n; i++) {
    const t = tangent(i);
    // Carry the frame along without twisting.
    u = norm(sub(u, mul(t, u[0] * t[0] + u[1] * t[1] + u[2] * t[2])));
    w = cross(t, u);
    rings.push(Array.from({ length: sides }, (_, k) => {
      const a = (k / sides) * Math.PI * 2;
      const d = add(mul(u, Math.cos(a)), mul(w, Math.sin(a)));
      return { p: add(path[i]!, mul(d, radius)), n: d };
    }));
  }
  for (let i = 0; i + 1 < n; i++)
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      const a = rings[i]!;
      const b = rings[i + 1]!;
      out.push({ v: [a[k]!.p, a[j]!.p, b[j]!.p, b[k]!.p], n: [a[k]!.n, a[j]!.n, b[j]!.n, b[k]!.n] });
    }
  // End caps, each wound to face out of its end.
  const start = rings[0]!;
  const finish = rings[n - 1]!;
  const back = mul(tangent(0), -1);
  const ahead = tangent(n - 1);
  for (let k = 1; k + 1 < sides; k++) {
    out.push({ v: [start[0]!.p, start[k + 1]!.p, start[k]!.p], n: [back, back, back] });
    out.push({ v: [finish[0]!.p, finish[k]!.p, finish[k + 1]!.p], n: [ahead, ahead, ahead] });
  }
  return out;
}

/** A smooth curve through points (Catmull-Rom), for pipes. */
function curve(points: readonly V3[], steps = 6): V3[] {
  const out: V3[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k]! + (-p0[k]! + p2[k]!) * t + (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * t2 + (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * t3)) as V3);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Faces mirrored across X (wound the other way, so they still face out), or as they are. */
function mirrorX(faces: readonly Face[], flip: boolean): Face[] {
  if (!flip) return [...faces];
  return faces.map((f) => ({ v: [...f.v].reverse().map((p) => [-p[0], p[1], p[2]] as V3), n: [...f.n].reverse().map((n) => [-n[0], n[1], n[2]] as V3) }));
}

/** Faces moved: turned about the crank, then shifted. */
function place(faces: readonly Face[], turnDeg: number, shift: V3): Face[] {
  return faces.map((f) => ({ v: f.v.map((p) => add(turnZ(p, turnDeg), shift)), n: f.n.map((n) => turnZ(n, turnDeg)) }));
}

// ---------------------------------------------------------------- the engine

const METALS: Record<EngineDesign['block'], V3> = { iron: [0.27, 0.27, 0.28], aluminium: [0.6, 0.61, 0.62], magnesium: [0.52, 0.5, 0.46] };

/** Banks: how many, how far each leans from upright, and their stagger along the crank. */
function banksOf(design: EngineDesign): { lean: number; stagger: number }[] {
  const n = design.cylinders;
  switch (design.layout) {
    case 'v': {
      const angle = n === 6 || n === 12 ? 60 : n === 10 ? 72 : 90;
      return [{ lean: -angle / 2, stagger: 0 }, { lean: angle / 2, stagger: 0.32 }];
    }
    case 'flat':
      return [{ lean: -90, stagger: 0 }, { lean: 90, stagger: 0.5 }];
    case 'w':
      return [{ lean: -36, stagger: 0 }, { lean: -21, stagger: 0.25 }, { lean: 21, stagger: 0.5 }, { lean: 36, stagger: 0.75 }];
    default:
      return [{ lean: 0, stagger: 0 }];
  }
}

type Put = (name: string, label: string, material: string, faces: Face[]) => void;

/** Collects faces into named pieces, and measures the result. */
function builder(prefix: string): { put: Put; model: (materials: EngineModel['materials']) => EngineModel } {
  const pieces = new Map<string, EnginePiece>();
  const put: Put = (name, label, material, faces) => {
    const key = `${prefix}_${name}`;
    const piece = pieces.get(key) ?? { name: key, label, groups: new Map<string, Face[]>() };
    const list = piece.groups.get(material) ?? [];
    for (const face of faces) list.push(face);
    piece.groups.set(material, list);
    pieces.set(key, piece);
  };
  const model = (materials: EngineModel['materials']): EngineModel => {
    const list = [...pieces.values()];
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of list)
      for (const faces of p.groups.values())
        for (const face of faces)
          for (const v of face.v)
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k]!, v[k]!);
              hi[k] = Math.max(hi[k]!, v[k]!);
            }
    return { pieces: list, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], crankHeight: -lo[1], materials };
  };
  return { put, model };
}

export function engineModel(design: EngineDesign, prefix = 'forge_engine'): EngineModel {
  const { put, model } = builder(prefix);
  const materials: EngineModel['materials'] = {
    [`${prefix}_block`]: { colour: METALS[design.block], roughness: 0.55, metallic: 1 },
    [`${prefix}_head`]: { colour: METALS[design.head], roughness: 0.45, metallic: 1 },
    [`${prefix}_cover`]: { colour: design.valvetrain === 'ohv' ? [0.55, 0.05, 0.05] : [0.08, 0.08, 0.09], roughness: 0.35, metallic: 0.2 },
    [`${prefix}_alloy`]: { colour: [0.56, 0.57, 0.59], roughness: 0.32, metallic: 1 },
    [`${prefix}_steel`]: { colour: [0.42, 0.38, 0.36], roughness: 0.5, metallic: 1 },
    [`${prefix}_rubber`]: { colour: [0.04, 0.04, 0.04], roughness: 0.85, metallic: 0 },
    [`${prefix}_paint`]: { colour: [0.1, 0.1, 0.11], roughness: 0.5, metallic: 0 },
  };
  const M = (m: string) => `${prefix}_${m}`;

  if (design.layout === 'electric') {
    electric(design, put, M);
    return model(materials);
  }
  if (design.layout === 'rotary') {
    rotary(design, put, M);
    return model(materials);
  }

  const bore = design.bore / 1000;
  const stroke = design.stroke / 1000;
  const banks = banksOf(design);
  const perBank = Math.ceil(design.cylinders / banks.length);
  // Real engines: bore spacing a little more than the bore, deck height from the stroke and rod.
  const pitch = bore * 1.16 + 0.012;
  const deck = stroke * 0.5 + stroke * 1.65 + bore * 0.32;
  const wall = 0.012;
  const blockW = bore + wall * 4;
  const headH = design.valvetrain === 'dohc' ? 0.11 : design.valvetrain === 'sohc' ? 0.09 : 0.065;
  const headW = blockW + (design.valvetrain === 'dohc' ? 0.04 : 0.02);
  const length = perBank * pitch + pitch * 0.35 + (banks.length > 1 ? pitch * Math.max(...banks.map((b) => b.stagger)) : 0);
  const carb = design.fuelSystem === 'carburettor';
  const itb = design.intake === 'itb' && !carb;
  const diesel = design.fuel === 'diesel';
  // The intake side of a bank: outward for an inline engine (+X), into the valley for a V.
  const intakeOut = banks.length === 1;

  // ---- one cylinder's slice, made once (bank upright, crank at the origin, the slice from z = 0 to z = pitch)
  const slice = {
    block: [...box([-blockW / 2, stroke * 0.35, 0], [blockW / 2, deck, pitch]), ...cylinder([0, deck * 0.45, pitch / 2], [0, 1, 0], deck * 0.5, bore / 2 + wall * 1.5, bore / 2 + wall * 1.5, 18, false)],
    head: box([-headW / 2, deck, 0.004], [headW / 2, deck + headH, pitch - 0.004]),
    cover:
      design.valvetrain === 'dohc'
        ? [-1, 1].flatMap((s) => cylinder([(s * headW) / 4, deck + headH, 0.002], [0, 0, 1], pitch - 0.004, headW / 4.4, headW / 4.4, 12))
        : box([-headW / 2 + 0.008, deck + headH, 0.006], [headW / 2 - 0.008, deck + headH + 0.04, pitch - 0.006]),
    // A coil pack (petrol) or an injector (diesel) on top of every cylinder.
    coil: cylinder([0, deck + headH + (design.valvetrain === 'dohc' ? headW / 4.4 : 0.04), pitch / 2], [0, 1, 0], diesel ? 0.05 : 0.035, diesel ? 0.012 : 0.02),
    // The intake runner leaves the head's intake side and rises to the plenum; the primary leaves the other side and drops.
    runner: tube(curve([[headW / 2, deck + headH * 0.5, pitch / 2], [headW / 2 + 0.06, deck + headH * 0.7, pitch / 2], [headW / 2 + 0.1, deck + headH + 0.05, pitch / 2]]), bore * 0.19),
    trumpet: cylinder([headW / 2 + 0.1, deck + headH + 0.05, pitch / 2], [0.3, 1, 0], 0.07, bore * 0.19, bore * 0.32, 14, false),
    primary: tube(curve([[-headW / 2, deck + headH * 0.4, pitch / 2], [-headW / 2 - 0.07, deck + headH * 0.2, pitch / 2], [-headW / 2 - 0.1, deck * 0.55, pitch * 0.25]]), bore * 0.17),
  };

  // ---- copies of the slice: the same mesh, moved along the crank and turned for its bank
  const collectors: { bank: number; at: V3; lean: number }[] = [];
  /** Where each bank's runners end (the plenum or throttles go there) and where its fuel rail runs. */
  const ends: V3[][] = banks.map(() => []);
  const rails: V3[][] = banks.map(() => []);
  let made = 0;
  banks.forEach((bank, b) => {
    // On a V or a flat the intake faces the valley and the exhaust the outside: the bank leaning to +X
    // takes the slice mirrored (intake on its -X side, exhaust on its +X side).
    const flip = !intakeOut && bank.lean > 0;
    const side = flip ? -1 : 1;
    for (let i = 0; i < perBank && made < design.cylinders; i++, made++) {
      const shift: V3 = [0, 0, (i + bank.stagger) * pitch + pitch * 0.18];
      put('block', 'Block', M('block'), place(slice.block, bank.lean, shift));
      put('heads', 'Cylinder heads', M('head'), place(slice.head, bank.lean, shift));
      put('covers', 'Cam covers', M('cover'), place(slice.cover, bank.lean, shift));
      put('coils', diesel ? 'Injectors' : 'Coil packs', M('rubber'), place(slice.coil, bank.lean, shift));
      const intake = mirrorX(itb ? [...slice.runner, ...slice.trumpet] : slice.runner, flip);
      if (!carb || intakeOut) put('intake', itb ? 'Individual throttles' : 'Intake manifold', M('alloy'), place(intake, bank.lean, shift));
      put('exhaust', 'Exhaust manifold', M('steel'), place(mirrorX(slice.primary, flip), bank.lean, shift));
      ends[b]!.push(add(turnZ([side * (headW / 2 + 0.1), deck + headH + 0.05, pitch / 2], bank.lean), shift));
      rails[b]!.push(add(turnZ([side * (headW / 2 + 0.035), deck + headH * 0.95, pitch / 2], bank.lean), shift));
      if (i === 0) collectors.push({ bank: b, at: turnZ([-side * (headW / 2 + 0.1), deck * 0.55, 0], bank.lean), lean: bank.lean });
    }
  });

  // ---- the whole engine's parts
  const crankcaseW = banks.length === 1 ? blockW + 0.03 : Math.max(blockW, Math.abs(turnZ([blockW / 2, deck * 0.6, 0], banks[0]!.lean)[0]) * 2);
  const bottom = -stroke * 0.95;
  put('block', 'Block', M('block'), box([-crankcaseW / 2, bottom, 0], [crankcaseW / 2, stroke * 0.45, length]));
  // Ribs down the block's sides, one between every pair of cylinders (cast in, so they're the block's).
  for (let i = 1; i < perBank; i++) for (const s of [-1, 1]) put('block', 'Block', M('block'), box([s > 0 ? crankcaseW / 2 : -crankcaseW / 2 - 0.008, bottom + 0.01, i * pitch + pitch * 0.18 - 0.006], [s > 0 ? crankcaseW / 2 + 0.008 : -crankcaseW / 2, stroke * 0.4, i * pitch + pitch * 0.18 + 0.006]));
  // Sump: deeper at the front, like most.
  put('sump', 'Oil sump', M('paint'), [...box([-crankcaseW / 2 + 0.02, bottom - 0.1, length * 0.3], [crankcaseW / 2 - 0.02, bottom, length - 0.02]), ...box([-crankcaseW / 2 + 0.02, bottom - 0.05, 0.02], [crankcaseW / 2 - 0.02, bottom, length * 0.3])]);
  const top = Math.max(...banks.map((b) => turnZ([0, deck + headH, 0], b.lean)[1]));
  const halfW = Math.max(crankcaseW / 2, ...banks.map((b) => Math.abs(turnZ([(headW / 2) * Math.sign(b.lean || 1), deck + headH, 0], b.lean)[0]) + 0.02));
  // Timing cover over the front, pulleys and a belt, the alternator up on the intake side.
  put('front', 'Timing cover and pulleys', M('paint'), box([-Math.min(halfW * 0.8, 0.3), bottom + 0.03, length], [Math.min(halfW * 0.8, 0.3), Math.max(top * 0.92, stroke), length + 0.03]));
  put('front', 'Timing cover and pulleys', M('rubber'), cylinder([0, 0, length + 0.03], [0, 0, 1], 0.03, 0.085, 0.085, 24));
  const alt: V3 = [Math.min(halfW * 0.75, 0.24), Math.max(top * 0.45, stroke * 0.8), length - 0.06];
  const pump: V3 = [0, Math.max(top * 0.62, stroke * 1.1), length + 0.03];
  put('front', 'Timing cover and pulleys', M('alloy'), [...cylinder(alt, [0, 0, 1], 0.12, 0.06), ...cylinder(pump, [0, 0, 1], 0.025, 0.05, 0.05, 20)]);
  put('front', 'Timing cover and pulleys', M('rubber'), tube(curve([[0, -0.085, length + 0.045], [0.09, 0, length + 0.045], [alt[0], alt[1], length + 0.045], [0.04, pump[1] + 0.05, length + 0.045], [-0.09, 0.02, length + 0.045], [0, -0.085, length + 0.045]], 4), 0.006, 6));
  // Bellhousing flange at the back, sized for the clutch the engine needs (not the engine's width).
  const bell = Math.min(0.26, Math.max(0.17, stroke * 1.8 + 0.06));
  put('bellhousing', 'Bellhousing flange', M('block'), cylinder([0, 0, 0], [0, 0, -1], 0.03, bell, bell, 28));

  // ---- the bits every engine has: oil filter, starter, thermostat housing, dipstick, mounts
  const exhaustSide = intakeOut ? -1 : 1;
  put('ancillaries', 'Oil filter, starter and the rest', M('paint'), cylinder([exhaustSide * (crankcaseW / 2), stroke * 0.05, length * 0.72], [exhaustSide, -0.3, 0], 0.11, 0.04, 0.04, 18));
  put('ancillaries', 'Oil filter, starter and the rest', M('steel'), cylinder([-exhaustSide * (crankcaseW / 2 + 0.05), -stroke * 0.35, 0.03], [0, 0, 1], 0.2, 0.045, 0.045, 18));
  put('ancillaries', 'Oil filter, starter and the rest', M('alloy'), cylinder([0, Math.max(top * 0.85, stroke * 1.3), length - 0.02], [0, 0.4, 1], 0.07, 0.025, 0.02, 14));
  put('ancillaries', 'Oil filter, starter and the rest', M('paint'), tube([[exhaustSide * (crankcaseW / 2 - 0.03), bottom, length * 0.55], [exhaustSide * (crankcaseW / 2 + 0.01), stroke * 0.5, length * 0.55], [exhaustSide * (crankcaseW / 2 + 0.01), Math.max(top * 0.7, stroke * 1.2), length * 0.55]], 0.005, 6));
  for (const s of [-1, 1]) put('mounts', 'Engine mounts', M('rubber'), [...box([s * (crankcaseW / 2), -0.03, length * 0.45], [s * (crankcaseW / 2 + 0.07), 0.04, length * 0.62]), ...cylinder([s * (crankcaseW / 2 + 0.07), 0.005, length * 0.535], [s, 0, 0], 0.04, 0.035, 0.035, 14)]);

  // ---- induction: one plenum where the runners meet, or one per bank when the banks' runners end far apart (a flat)
  const centre = (pts: readonly V3[]): V3 => mul(pts.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / Math.max(1, pts.length));
  const bankEnds = ends.filter((e) => e.length).map((e) => ({ at: centre(e), z0: Math.min(...e.map((p) => p[2])), z1: Math.max(...e.map((p) => p[2])) }));
  const apart = bankEnds.length > 1 && Math.abs(bankEnds[0]!.at[0] - bankEnds[1]!.at[0]) > 0.25;
  const plenums = apart ? bankEnds : [{ at: centre(ends.flat()), z0: Math.min(...ends.flat().map((p) => p[2])), z1: Math.max(...ends.flat().map((p) => p[2])) }];
  const spread = apart ? 0 : Math.max(...ends.flat().map((p) => Math.abs(p[0] - plenums[0]!.at[0])));
  const front = (p: (typeof plenums)[number]): V3 => [p.at[0], p.at[1] + 0.02, p.z1 + pitch * 0.45];
  if (carb) {
    // A carburettor on each plenum, a round air cleaner on top.
    for (const p of plenums) {
      put('intake', 'Intake manifold', M('alloy'), box([p.at[0] - 0.05 - spread, p.at[1] - 0.03, p.z0 - pitch * 0.3], [p.at[0] + 0.05 + spread, p.at[1] + 0.03, p.z1 + pitch * 0.3]));
      const mid: V3 = [p.at[0], p.at[1] + 0.03, (p.z0 + p.z1) / 2];
      put('carb', 'Carburettor', M('alloy'), box([mid[0] - 0.05, mid[1], mid[2] - 0.05], [mid[0] + 0.05, mid[1] + 0.08, mid[2] + 0.05]));
      put('aircleaner', 'Air cleaner', M('paint'), cylinder([mid[0], mid[1] + 0.08, mid[2]], [0, 1, 0], 0.06, 0.17, 0.17, 28));
    }
  } else if (!itb) {
    // A plenum along the runners' ends, the throttle body on its front.
    for (const p of plenums) {
      put('intake', 'Intake manifold', M('alloy'), box([p.at[0] - 0.045 - spread, p.at[1] - 0.035, p.z0 - pitch * 0.35], [p.at[0] + 0.045 + spread, p.at[1] + 0.06, p.z1 + pitch * 0.35]));
      put('throttle', 'Throttle body', M('alloy'), cylinder([p.at[0], p.at[1] + 0.02, p.z1 + pitch * 0.35], [0, 0, 1], 0.06, 0.038, 0.038, 18));
    }
    // Two plenums share one throttle through a crossover.
    if (apart) put('intake', 'Intake manifold', M('alloy'), tube(curve([front(plenums[0]!), [0, Math.max(...plenums.map((p) => p.at[1])) + 0.1, front(plenums[0]!)[2] + 0.05], front(plenums[1]!)]), 0.035, 12));
  }
  // Fuel rails along the injectors (port and direct injection; a diesel's are on top).
  if (!carb && design.fuelSystem !== 'single-point' && !diesel) for (const r of rails.filter((x) => x.length > 1)) put('fuelrail', 'Fuel rails', M('alloy'), tube([add(r[0]!, [0, 0, -pitch * 0.4]), ...r, add(r[r.length - 1]!, [0, 0, pitch * 0.4])], 0.009, 8));
  const forced = design.aspiration !== 'na' && design.boost > 0;
  const intakeFront: V3 = plenums.length ? (apart ? [0, Math.max(...plenums.map((p) => p.at[1])) + 0.1, front(plenums[0]!)[2] + 0.06] : front(plenums[0]!)) : [0, top, length];
  if (!forced && !carb && !itb) put('aircleaner', 'Air filter', M('rubber'), cylinder(add(intakeFront, [0, 0, 0.04]), [0, 0, 1], 0.14, 0.06, 0.075, 18));
  if (itb) for (const p of plenums.length ? plenums : []) put('aircleaner', 'Air box', M('paint'), box([p.at[0] - 0.08 - spread, p.at[1] + 0.06, p.z0 - pitch * 0.3], [p.at[0] + 0.08 + spread, p.at[1] + 0.12, p.z1 + pitch * 0.3]));

  // ---- exhaust collectors, turbos, the supercharger
  const turbos = design.aspiration === 'twin-turbo' && forced ? collectors : design.aspiration === 'turbo' && forced ? collectors.slice(0, 1) : [];
  for (const c of collectors) {
    const out: V3 = [c.at[0] * 1.05, bottom - 0.05, 0.02];
    put('exhaust', 'Exhaust manifold', M('steel'), tube(curve([[c.at[0], c.at[1], length * 0.5], [c.at[0] * 1.02, c.at[1] * 0.4, length * 0.3], out]), bore * 0.22));
  }
  const size = 0.065 + design.turboSize * 0.045;
  turbos.forEach((t) => {
    const at: V3 = [t.at[0] + Math.sign(t.at[0] || -1) * 0.07, Math.max(t.at[1] * 0.6, 0), length * 0.4];
    // Turbine on the exhaust (cast iron), compressor in front of it (alloy), a snail scroll round each.
    put('turbo', turbos.length > 1 ? 'Turbochargers' : 'Turbocharger', M('steel'), [...cylinder(at, [0, 0, 1], size * 0.75, size, size, 20), ...tube(curve([add(at, [size, 0, size * 0.35]), add(at, [0, size * 1.15, size * 0.35]), add(at, [-size * 1.1, 0, size * 0.35])]), size * 0.28, 10)]);
    const comp = add(at, [0, 0, size * 0.85]);
    put('turbo', turbos.length > 1 ? 'Turbochargers' : 'Turbocharger', M('alloy'), [...cylinder(comp, [0, 0, 1], size * 0.6, size * 0.95, size * 0.8, 20), ...cylinder(add(comp, [0, 0, size * 0.6]), [0, 0, 1], size * 0.3, size * 0.5, size * 0.5, 16)]);
    // Charge pipe from the compressor, up and round the front of the engine, into the throttle.
    put('chargepipes', 'Charge pipes', M('alloy'), tube(curve([add(comp, [0, size * 0.9, size * 0.3]), [at[0], Math.max(at[1], intakeFront[1] - 0.05), length + 0.1], [intakeFront[0], intakeFront[1], intakeFront[2] + 0.12], add(intakeFront, [0, 0, 0.02])], 6), 0.03, 12));
  });
  if (design.aspiration === 'supercharger' && forced) {
    // Roots-type on the plenum (in the valley of a V), driven from the crank by its own pulley.
    const p = plenums[0];
    const sc: V3 = p ? [p.at[0], p.at[1] + 0.12, 0] : [0, top + 0.1, 0];
    put('supercharger', 'Supercharger', M('alloy'), box([sc[0] - 0.08, sc[1] - 0.06, length * 0.2], [sc[0] + 0.08, sc[1] + 0.06, length * 0.92]));
    put('supercharger', 'Supercharger', M('rubber'), cylinder([sc[0], sc[1], length * 0.92], [0, 0, 1], 0.04, 0.05, 0.05, 20));
  }

  return model(materials);
}

/** A rotary: one housing per rotor, the same mesh moved along the shaft, end plates and the ports. */
function rotary(design: EngineDesign, put: Put, M: (m: string) => string): void {
  const rotors = Math.max(1, Math.min(4, design.cylinders));
  const thick = 0.085;
  const ring = Array.from({ length: 24 }, (_, i) => {
    const t = (i / 24) * Math.PI * 2;
    return [Math.cos(t) * 0.14, Math.sin(t) * 0.115] as const;
  });
  // The housing outline (an oval, like the epitrochoid), extruded once.
  const housing: Face[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    const n0 = norm([x0 / 0.14, y0 / 0.115, 0]);
    const n1 = norm([x1 / 0.14, y1 / 0.115, 0]);
    housing.push({ v: [[x0, y0, 0], [x1, y1, 0], [x1, y1, thick], [x0, y0, thick]], n: [n0, n1, n1, n0] });
  }
  for (let r = 0; r < rotors; r++) {
    const shift: V3 = [0, 0, 0.03 + r * (thick + 0.02)];
    put('block', 'Rotor housings', M('block'), place(housing, 0, shift));
    put('heads', 'Side plates', M('head'), place(cylinder([0, 0, 0], [0, 0, 1], 0.02, 0.15, 0.15, 24), 0, add(shift, [0, 0, thick])));
    put('intake', 'Intake manifold', M('alloy'), tube(curve([[0.13, 0.03, shift[2] + thick / 2], [0.2, 0.12, shift[2] + thick / 2], [0.16, 0.24, shift[2] + thick / 2]]), 0.028));
    put('exhaust', 'Exhaust manifold', M('steel'), tube(curve([[-0.13, -0.02, shift[2] + thick / 2], [-0.22, -0.06, shift[2] + thick / 2], [-0.24, -0.14, 0.02]]), 0.03));
  }
  const length = 0.03 + rotors * (thick + 0.02) + 0.02;
  put('heads', 'Side plates', M('head'), cylinder([0, 0, 0], [0, 0, 1], 0.03, 0.155, 0.155, 24));
  put('front', 'Timing cover and pulleys', M('rubber'), cylinder([0, 0, length], [0, 0, 1], 0.03, 0.08, 0.08, 24));
  put('sump', 'Oil sump', M('paint'), box([-0.11, -0.2, 0.02], [0.11, -0.115, length - 0.01]));
  put('intake', 'Intake manifold', M('alloy'), box([0.1, 0.2, 0.02], [0.22, 0.28, length]));
}

/** An electric motor: a can along the shaft, end bells, an inverter on top, the cables. */
function electric(design: EngineDesign, put: Put, M: (m: string) => string): void {
  const r = 0.09 + Math.min(0.08, design.motorKw / 4000);
  const length = 0.22 + Math.min(0.25, design.motorKw / 2500);
  put('block', 'Motor', M('block'), cylinder([0, 0, 0.02], [0, 0, 1], length, r, r, 32));
  put('heads', 'End bells', M('head'), [...cylinder([0, 0, 0], [0, 0, 1], 0.03, r * 0.92, r * 0.92, 32), ...cylinder([0, 0, length + 0.02], [0, 0, 1], 0.03, r * 0.92, r * 0.92, 32)]);
  put('front', 'Inverter', M('paint'), box([-r * 0.8, r, 0.05], [r * 0.8, r + 0.09, length - 0.02]));
  put('front', 'Inverter', M('rubber'), [-1, 0, 1].flatMap((k) => tube(curve([[k * 0.04, r + 0.05, length - 0.02], [k * 0.04, r + 0.06, length + 0.08], [k * 0.04 + 0.1, r * 0.4, length + 0.1]]), 0.012, 8)));
}

/** The model as OBJ and MTL text (the MTL named `${mtlName}`). */
export function engineModelObj(model: EngineModel, mtlName: string): { obj: string; mtl: string } {
  const lines = ['# JBeam Forge: an engine from the engine designer', `mtllib ${mtlName}`];
  let vBase = 1;
  let nBase = 1;
  for (const p of model.pieces) {
    lines.push(`o ${p.name}`);
    const vIndex = new Map<string, number>();
    const nIndex = new Map<string, number>();
    const vLines: string[] = [];
    const nLines: string[] = [];
    const fLines: string[] = [];
    for (const [material, faces] of p.groups) {
      fLines.push(`usemtl ${material}`);
      for (const f of faces) {
        const corners = f.v.map((v, k) => {
          const vk = `${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`;
          let vi = vIndex.get(vk);
          if (vi === undefined) {
            vi = vBase + vIndex.size;
            vIndex.set(vk, vi);
            vLines.push(`v ${vk}`);
          }
          const n = f.n[k]!;
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
      }
    }
    lines.push(...vLines, ...nLines, ...fLines);
    vBase += vIndex.size;
    nBase += nIndex.size;
  }
  const mtl = Object.entries(model.materials)
    .map(([name, m]) => [`newmtl ${name}`, `Kd ${m.colour.map((c) => c.toFixed(3)).join(' ')}`, `Ks ${(1 - m.roughness).toFixed(2)} ${(1 - m.roughness).toFixed(2)} ${(1 - m.roughness).toFixed(2)}`, `Ns ${Math.round((1 - m.roughness) * 200)}`, `Pr ${m.roughness}`, `Pm ${m.metallic}`, 'd 1'].join('\n'))
    .join('\n\n');
  return { obj: `${lines.join('\n')}\n`, mtl: `${mtl}\n` };
}
