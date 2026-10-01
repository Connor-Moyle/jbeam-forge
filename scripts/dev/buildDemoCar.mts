/**
 * Builds the tutorial's practice car (assets/demo-car) from the owner's E30
 * reference model: splits it into the parts a modeller would (wings, doors,
 * bonnet, boot, bumpers, side skirts, spoiler, glass, lights, mirrors,
 * wheels, tyres, seats, steering wheel), smooths every part with
 * crease-aware subdivision so it's less blocky, and adds an engine bay and
 * engine of our own.
 *
 *   npx tsx scripts/dev/buildDemoCar.mts <reference.fbx> <its texture folder>
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFbx, type RefTri } from './loadFbx.ts';
import { engineBayPieces } from '../../src/shared/tutorial/demoCar.ts';
import { ASSET_CREDITS, creditLine } from '../../src/shared/credits.ts';

type V3 = [number, number, number];
type V2 = [number, number];
interface Tri {
  p: V3[];
  uv: V2[];
  mat: string;
}

const [fbxPath, texDir] = process.argv.slice(2);
if (!fbxPath || !texDir) throw new Error('usage: buildDemoCar.mts <reference.fbx> <texture folder>');
const OUT = join(import.meta.dirname, '..', '..', 'assets', 'demo-car');

const cen = (t: { p: V3[] }): V3 => [(t.p[0]![0] + t.p[1]![0] + t.p[2]![0]) / 3, (t.p[0]![1] + t.p[1]![1] + t.p[2]![1]) / 3, (t.p[0]![2] + t.p[1]![2] + t.p[2]![2]) / 3];
const uvc = (t: { uv: V2[] }): V2 => [(t.uv[0]![0] + t.uv[1]![0] + t.uv[2]![0]) / 3, (t.uv[0]![1] + t.uv[1]![1] + t.uv[2]![1]) / 3];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const normal = (t: { p: V3[] }) => norm(cross(sub(t.p[1]!, t.p[0]!), sub(t.p[2]!, t.p[0]!)));

// ---------------------------------------------------------------- where each triangle goes

const AXLE_F = 1.426;
const COWL_Z = 0.975; // bonnet's back edge
const DOOR_FRONT = 0.94; // door's front shut line
const DOOR_BACK = -0.37; // door's back shut line (two doors)
const DECK_Z = -1.66; // boot lid's front edge
const LR = (x: number) => (x >= 0 ? 'L' : 'R');

/** In the texture: the headlamps, indicators and tail lamps. */
const inUv = (uv: V2, u0: number, u1: number, v0: number, v1: number) => uv[0] >= u0 && uv[0] <= u1 && uv[1] >= v0 && uv[1] <= v1;
const HEADLAMP_UV = (uv: V2) => inUv(uv, 0.3, 0.52, 0, 0.12);
const INDICATOR_UV = (uv: V2) => inUv(uv, 0.16, 0.29, 0, 0.14);
const TAILLAMP_UV = (uv: V2) => inUv(uv, 0, 0.125, 0.65, 1);

function partOf(t: RefTri): string | null {
  const [x, y, z] = cen(t);
  const n = normal(t);
  const ax = Math.abs(x);
  const side = LR(x);
  const uv = uvc(t);
  switch (t.mesh) {
    case 'driver':
      return null;
    case 'FL':
    case 'FR':
    case 'BL':
    case 'BR': {
      const corner = { FL: 'FL', FR: 'FR', BL: 'RL', BR: 'RR' }[t.mesh];
      return t.mat.includes('tyre') ? `tire_${corner}` : `wheel_${corner}`;
    }
    case 'steering_wheel':
      return 'steering_wheel';
    case 'interior':
      if (z > 0.28) return 'dashboard';
      if (z > -0.62 && z < 0.22 && ax > 0.1 && y > 0.3 && y < 1.2) return `seat_F${side}`;
      if (z <= -0.62 && y > 0.3 && y < 1.15) return 'rear_seat';
      return 'interior';
  }
  if (t.mesh.startsWith('Caliper_')) return `brake_caliper_${t.mesh.slice(8)}`;
  // The body, by material and place.
  if (t.mat === 'glass') {
    if (Math.abs(n[0]) > 0.6) return z > DOOR_BACK ? `door_glass_F${side}` : `quarter_glass_${side}`;
    return z > 0 ? 'windshield' : 'rear_window';
  }
  if (t.mat === 'brakelights' || (z < -1.9 && TAILLAMP_UV(uv))) return `taillight_${side}`;
  if (z > 1.9 && HEADLAMP_UV(uv)) return `headlight_${side}`;
  if (z > 1.85 && INDICATOR_UV(uv)) return `indicator_F${side}`;
  if (ax > 0.76 && y > 0.86 && y < 1.08 && z > 0.38 && z < 0.72) return `mirror_${side}`;
  // Spoiler: the wing standing above the boot lid.
  if (z < -1.78 && y > 0.955) return 'spoiler';
  // Bumpers.
  if (z > 1.96 && y < 0.53) return 'bumper_F';
  if (z < -1.96 && y < 0.56) return 'bumper_R';
  // The black band with the kidneys and lamp surrounds.
  if (z > 1.97 && y >= 0.5 && y < 0.78 && ax < 0.72) return 'grille';
  // Side skirts: below the doors between the arches.
  if (ax > 0.62 && y < 0.3 && z < AXLE_F - 0.36 && z > -1.16 + 0.36) return `skirt_${side}`;
  // Bonnet: the top between the wings, from the scuttle to the nose.
  if (z > COWL_Z && n[1] > 0.55 && ax < 0.7 && y > 0.72) return 'hood';
  // Boot lid: the deck, and the panel between the lamps.
  if (z < DECK_Z && n[1] > 0.55 && ax < 0.71 && y > 0.85 && y < 0.96) return 'trunk';
  if (z < -2.0 && n[2] < -0.6 && ax < 0.38 && y > 0.56 && y < 0.96) return 'trunk';
  // Wings and doors: the outer sides.
  const outer = ax > 0.6 && Math.abs(n[0]) > 0.25;
  if (outer && z > DOOR_FRONT && z < 2.08 && y > 0.29) return `fender_F${side}`;
  if (outer && z <= DOOR_FRONT && z > DOOR_BACK && y > 0.26 && y < 1.33) return `door_F${side}`;
  return 'body';
}

// ---------------------------------------------------------------- smoothing: Loop subdivision with creases

interface Mesh {
  pos: V3[];
  faces: { v: number[]; uv: V2[]; mat: string }[];
}

function weld(tris: Tri[]): Mesh {
  const ids = new Map<string, number>();
  const pos: V3[] = [];
  const faces: Mesh['faces'] = [];
  for (const t of tris) {
    const v = t.p.map((p) => {
      const k = p.map((c) => Math.round(c * 1e5)).join(',');
      let id = ids.get(k);
      if (id === undefined) {
        id = pos.length;
        ids.set(k, id);
        pos.push([...p]);
      }
      return id;
    });
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    faces.push({ v, uv: t.uv.map((u) => [...u] as V2), mat: t.mat });
  }
  return { pos, faces };
}

/** One step of Loop subdivision; edges sharper than `creaseDeg`, on the border or between materials stay sharp. */
function loop(m: Mesh, creaseDeg: number): Mesh {
  const ek = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edges = new Map<string, { a: number; b: number; faces: number[]; opp: number[] }>();
  m.faces.forEach((f, fi) => {
    for (let k = 0; k < 3; k++) {
      const a = f.v[k]!;
      const b = f.v[(k + 1) % 3]!;
      const key = ek(a, b);
      let e = edges.get(key);
      if (!e) edges.set(key, (e = { a, b, faces: [], opp: [] }));
      e.faces.push(fi);
      e.opp.push(f.v[(k + 2) % 3]!);
    }
  });
  const fn = m.faces.map((f) => norm(cross(sub(m.pos[f.v[1]!]!, m.pos[f.v[0]!]!), sub(m.pos[f.v[2]!]!, m.pos[f.v[0]!]!))));
  const cosC = Math.cos((creaseDeg * Math.PI) / 180);
  const crease = (e: { faces: number[] }) => e.faces.length !== 2 || dot(fn[e.faces[0]!]!, fn[e.faces[1]!]!) < cosC || m.faces[e.faces[0]!]!.mat !== m.faces[e.faces[1]!]!.mat;
  // New points on the edges.
  const edgePoint = new Map<string, number>();
  const pos: V3[] = [];
  // Old points moved.
  const nbr = new Map<number, Set<number>>();
  const creaseNbr = new Map<number, number[]>();
  for (const e of edges.values()) {
    for (const [p, q] of [
      [e.a, e.b],
      [e.b, e.a],
    ] as const) {
      (nbr.get(p) ?? nbr.set(p, new Set()).get(p)!).add(q);
      if (crease(e)) (creaseNbr.get(p) ?? creaseNbr.set(p, []).get(p)!).push(q);
    }
  }
  m.pos.forEach((v, i) => {
    const cn = creaseNbr.get(i) ?? [];
    const ns = [...(nbr.get(i) ?? [])];
    if (cn.length > 2 || ns.length < 3) {
      pos.push([...v]);
      return;
    }
    if (cn.length === 2) {
      const [c1, c2] = [m.pos[cn[0]!]!, m.pos[cn[1]!]!];
      pos.push([0.75 * v[0] + 0.125 * (c1[0] + c2[0]), 0.75 * v[1] + 0.125 * (c1[1] + c2[1]), 0.75 * v[2] + 0.125 * (c1[2] + c2[2])]);
      return;
    }
    const n = ns.length;
    const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
    const s: V3 = [0, 0, 0];
    for (const q of ns) for (let k = 0; k < 3; k++) s[k] += m.pos[q]![k]!;
    pos.push([(1 - n * beta) * v[0] + beta * s[0], (1 - n * beta) * v[1] + beta * s[1], (1 - n * beta) * v[2] + beta * s[2]]);
  });
  for (const [key, e] of edges) {
    const a = m.pos[e.a]!;
    const b = m.pos[e.b]!;
    let p: V3;
    if (crease(e)) p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    else {
      const c = m.pos[e.opp[0]!]!;
      const d = m.pos[e.opp[1]!]!;
      p = [0.375 * (a[0] + b[0]) + 0.125 * (c[0] + d[0]), 0.375 * (a[1] + b[1]) + 0.125 * (c[1] + d[1]), 0.375 * (a[2] + b[2]) + 0.125 * (c[2] + d[2])];
    }
    edgePoint.set(key, pos.length);
    pos.push(p);
  }
  const faces: Mesh['faces'] = [];
  const mid = (p: V2, q: V2): V2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  for (const f of m.faces) {
    const [a, b, c] = f.v as [number, number, number];
    const [ta, tb, tc] = f.uv as [V2, V2, V2];
    const ab = edgePoint.get(ek(a, b))!;
    const bc = edgePoint.get(ek(b, c))!;
    const ca = edgePoint.get(ek(c, a))!;
    const tab = mid(ta, tb);
    const tbc = mid(tb, tc);
    const tca = mid(tc, ta);
    faces.push({ v: [a, ab, ca], uv: [ta, tab, tca], mat: f.mat }, { v: [ab, b, bc], uv: [tab, tb, tbc], mat: f.mat }, { v: [ca, bc, c], uv: [tca, tbc, tc], mat: f.mat }, { v: [ab, bc, ca], uv: [tab, tbc, tca], mat: f.mat });
  }
  return { pos, faces };
}

// ---------------------------------------------------------------- build

const ref = await loadFbx(fbxPath);
const parts = new Map<string, Tri[]>();
for (const t of ref) {
  const part = partOf(t);
  if (!part) continue;
  (parts.get(part) ?? parts.set(part, []).get(part)!).push({ p: t.p, uv: t.uv, mat: t.mat });
}

const MATERIALS: Record<string, string> = {
  bodycolor: 'demo_paint',
  diffuse: 'demo_details',
  reflective: 'demo_lights',
  trims: 'demo_trim',
  glass: 'demo_glass',
  brakelights: 'demo_taillight',
  interior: 'demo_interior',
  HD_wheeltyre: 'demo_tyre',
  HD_wheelrim: 'demo_rim',
};

/** Painted panels get two steps of smoothing; small and textured parts one. */
const steps = (name: string) => (/^(body|hood|trunk|fender|door_F|bumper|skirt|spoiler)/.test(name) ? 2 : 1);

const out: { name: string; mesh: Mesh }[] = [];
for (const [name, tris] of parts) {
  let mesh = weld(tris);
  for (let i = 0; i < steps(name); i++) mesh = loop(mesh, 38);
  out.push({ name, mesh });
}

// The engine bay and engine (ours): pieces as triangles with planar texture coordinates.
for (const piece of engineBayPieces()) {
  const tris: Tri[] = [];
  for (const g of piece.groups)
    for (const f of g.faces)
      for (let i = 1; i + 1 < f.length; i++) tris.push({ p: [f[0]!, f[i]!, f[i + 1]!], uv: [[0, 0], [0, 0], [0, 0]], mat: g.material });
  out.push({ name: piece.name, mesh: weld(tris) });
}

// ---------------------------------------------------------------- OBJ

function smoothNormals(m: Mesh, creaseDeg = 40): V3[][] {
  const fnrm = m.faces.map((f) => norm(cross(sub(m.pos[f.v[1]!]!, m.pos[f.v[0]!]!), sub(m.pos[f.v[2]!]!, m.pos[f.v[0]!]!))));
  const around = new Map<number, number[]>();
  m.faces.forEach((f, i) => f.v.forEach((v) => (around.get(v) ?? around.set(v, []).get(v)!).push(i)));
  const cosC = Math.cos((creaseDeg * Math.PI) / 180);
  return m.faces.map((f, i) =>
    f.v.map((v) => {
      const s: V3 = [0, 0, 0];
      for (const j of around.get(v) ?? [i]) {
        if (dot(fnrm[i]!, fnrm[j]!) < cosC || m.faces[j]!.mat !== f.mat) continue;
        for (let k = 0; k < 3; k++) s[k] += fnrm[j]![k]!;
      }
      return norm(s);
    }),
  );
}

const ORDER = ['body', 'hood', 'trunk', 'spoiler', 'fender_FL', 'fender_FR', 'door_FL', 'door_FR', 'skirt_L', 'skirt_R', 'bumper_F', 'bumper_R', 'grille', 'windshield', 'rear_window', 'door_glass_FL', 'door_glass_FR', 'quarter_glass_L', 'quarter_glass_R'];
out.sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99) || a.name.localeCompare(b.name));

const credit = ASSET_CREDITS.find((c) => c.files?.includes('tutorial/demo_car.obj'))!;
const lines = ['# JBeam Forge practice car (tutorial): a BMW E30, in parts', `# ${creditLine(credit)}`, 'mtllib demo_car.mtl'];
let vb = 1;
let tb = 1;
let nb = 1;
let triangles = 0;
for (const { name, mesh } of out) {
  lines.push(`o ${name}`);
  const nrm = smoothNormals(mesh);
  for (const p of mesh.pos) lines.push(`v ${p.map((c) => c.toFixed(4)).join(' ')}`);
  const uvIndex = new Map<string, number>();
  const nIndex = new Map<string, number>();
  const vt: string[] = [];
  const vn: string[] = [];
  const fl: string[] = [];
  let mat = '';
  mesh.faces.forEach((f, i) => {
    const m = MATERIALS[f.mat] ?? f.mat;
    if (m !== mat) fl.push(`usemtl ${(mat = m)}`);
    const c = f.v.map((v, k) => {
      const uk = `${f.uv[k]![0].toFixed(4)} ${f.uv[k]![1].toFixed(4)}`;
      let ui = uvIndex.get(uk);
      if (ui === undefined) {
        ui = tb + uvIndex.size;
        uvIndex.set(uk, ui);
        vt.push(`vt ${uk}`);
      }
      const n = nrm[i]![k]!;
      const nk = n.map((x) => x.toFixed(3)).join(' ');
      let ni = nIndex.get(nk);
      if (ni === undefined) {
        ni = nb + nIndex.size;
        nIndex.set(nk, ni);
        vn.push(`vn ${nk}`);
      }
      return `${vb + v}/${ui}/${ni}`;
    });
    fl.push(`f ${c.join(' ')}`);
  });
  triangles += mesh.faces.length;
  lines.push(...vt, ...vn, ...fl);
  vb += mesh.pos.length;
  tb += uvIndex.size;
  nb += nIndex.size;
}

const MTL = `newmtl demo_paint
Kd 0.07 0.09 0.42
Ks 0.6 0.6 0.6
Ns 250

newmtl demo_details
Kd 1 1 1
Ks 0.2 0.2 0.2
Ns 40
map_Kd demo_car_atlas.png

newmtl demo_lights
Kd 1 1 1
Ks 0.8 0.8 0.8
Ns 400
map_Kd demo_car_atlas.png

newmtl demo_taillight
Kd 1 1 1
Ks 0.6 0.6 0.6
Ns 300
map_Kd demo_car_atlas.png

newmtl demo_trim
Kd 0.05 0.05 0.05
Ks 0.2 0.2 0.2
Ns 40

newmtl demo_glass
Kd 0.06 0.08 0.09
Ks 0.8 0.8 0.8
Ns 400
d 0.4

newmtl demo_interior
Kd 1 1 1
Ks 0.05 0.05 0.05
Ns 10
map_Kd demo_car_interior.png

newmtl demo_tyre
Kd 1 1 1
Ks 0.05 0.05 0.05
Ns 8
map_Kd demo_car_wheels.png

newmtl demo_rim
Kd 1 1 1
Ks 0.7 0.7 0.7
Ns 300
map_Kd demo_car_wheels.png

newmtl demo_engine
Kd 0.32 0.32 0.34
Ks 0.3 0.3 0.3
Ns 80

newmtl demo_rubber
Kd 0.025 0.025 0.025
Ks 0.05 0.05 0.05
Ns 10

newmtl demo_chrome
Kd 0.5 0.51 0.53
Ks 0.95 0.95 0.95
Ns 600
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'demo_car.obj'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'demo_car.mtl'), MTL);
writeFileSync(join(OUT, 'CREDITS.txt'), `JBeam Forge practice car\n\n${creditLine(credit)}\n`);
copyFileSync(join(texDir, '013014SSCR.png'), join(OUT, 'demo_car_atlas.png'));
copyFileSync(join(texDir, '013014SSCR_interior.png'), join(OUT, 'demo_car_interior.png'));
copyFileSync(join(texDir, 'wheelstyle_color1B.png'), join(OUT, 'demo_car_wheels.png'));
console.log(`${out.length} parts, ${triangles.toLocaleString()} triangles → ${OUT}`);
for (const { name, mesh } of out) console.log(`  ${name.padEnd(18)} ${mesh.faces.length}`);
