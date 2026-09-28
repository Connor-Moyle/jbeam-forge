import type { MeshEdit } from '../project/schema';

/**
 * Per-mesh edits (move/turn/resize about the mesh's centre, texture mapping)
 * as plain maths, shared by the renderer (which bakes them into geometry)
 * and tests.
 */

export type V3 = [number, number, number];

export const IDENTITY_EDIT: MeshEdit = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], uv: { scale: [1, 1], offset: [0, 0], rotation: 0 } };

const same = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);

export function isIdentityTransform(e: MeshEdit): boolean {
  return same(e.position, [0, 0, 0]) && same(e.rotation, [0, 0, 0]) && same(e.scale, [1, 1, 1]);
}

export function isIdentityUv(e: MeshEdit): boolean {
  return same(e.uv.scale, [1, 1]) && same(e.uv.offset, [0, 0]) && Math.abs(e.uv.rotation) < 1e-9 && !e.uv.project;
}

export type UvProjection = NonNullable<MeshEdit['uv']['project']>;

const AXIS = { x: 0, y: 1, z: 2 } as const;

/**
 * Texture coordinates projected from triangle positions (three floats per
 * vertex, three vertices per triangle, unindexed). Each triangle is laid flat
 * along its axis (for 'box', the one its normal points along most), scaled
 * so one texture repeat covers `size` metres, and flipped on the far side so
 * text and weaves never read backwards.
 */
export function projectUvs(pos: ArrayLike<number>, p: UvProjection): Float32Array {
  const verts = Math.floor(pos.length / 3);
  const out = new Float32Array(verts * 2);
  const k = 1 / p.size;
  for (let t = 0; t + 2 < verts; t += 3) {
    const a = t * 3;
    const e1 = [pos[a + 3]! - pos[a]!, pos[a + 4]! - pos[a + 1]!, pos[a + 5]! - pos[a + 2]!];
    const e2 = [pos[a + 6]! - pos[a]!, pos[a + 7]! - pos[a + 1]!, pos[a + 8]! - pos[a + 2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    let axis: 0 | 1 | 2;
    if (p.kind === 'box') {
      const ax = Math.abs(n[0]!), ay = Math.abs(n[1]!), az = Math.abs(n[2]!);
      axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    } else axis = AXIS[p.kind];
    // The other two axes, in an order that reads the right way round from the positive side.
    const [ua, va] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    const flip = (axis === 1 ? -1 : 1) * (n[axis]! < 0 ? -1 : 1);
    for (let v = 0; v < 3; v++) {
      const i = (t + v) * 3;
      out[(t + v) * 2] = pos[i + ua]! * k * flip;
      out[(t + v) * 2 + 1] = pos[i + va]! * k;
    }
  }
  return out;
}

type M = number[]; // 4×4 column-major

const mul = (a: M, b: M): M => {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
};
const translate = ([x, y, z]: readonly number[]): M => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x!, y!, z!, 1];
const scaleM = ([x, y, z]: readonly number[]): M => [x!, 0, 0, 0, 0, y!, 0, 0, 0, 0, z!, 0, 0, 0, 0, 1];
function rotation([rx, ry, rz]: readonly number[]): M {
  const [a, b, c] = [rx!, ry!, rz!].map((d) => (d * Math.PI) / 180) as [number, number, number];
  const X: M = [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
  const Y: M = [Math.cos(b), 0, -Math.sin(b), 0, 0, 1, 0, 0, Math.sin(b), 0, Math.cos(b), 0, 0, 0, 0, 1];
  const Z: M = [Math.cos(c), Math.sin(c), 0, 0, -Math.sin(c), Math.cos(c), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return mul(Z, mul(Y, X));
}

/** The edit as a matrix: resize, turn (about `pivot`, the mesh's centre), then move. */
export function editMatrix(e: MeshEdit, pivot: readonly number[]): M {
  return mul(translate([pivot[0]! + e.position[0], pivot[1]! + e.position[1], pivot[2]! + e.position[2]]), mul(rotation(e.rotation), mul(scaleM(e.scale), translate([-pivot[0]!, -pivot[1]!, -pivot[2]!]))));
}

/** Mirror across the car's centre line (BeamNG X = 0; +X is left). */
export const MIRROR_X: M = scaleM([-1, 1, 1]);

export function multiply(a: M, b: M): M {
  return mul(a, b);
}

/** Whether a matrix turns the mesh inside out (negative determinant): triangle winding must flip. */
export function flipsWinding(m: M): boolean {
  const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
  return det < 0;
}

/** Texture coordinates after the mesh's mapping edit: scaled (tiling), turned (degrees), then offset. */
export function mapUv(u: number, v: number, uv: MeshEdit['uv']): [number, number] {
  const su = u * uv.scale[0];
  const sv = v * uv.scale[1];
  const t = (uv.rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [su * c - sv * s + uv.offset[0], su * s + sv * c + uv.offset[1]];
}

/** The mesh on the other side of the car: "…_FL" ↔ "…_FR", "left" ↔ "right"; else " (mirror)". */
export function mirroredName(name: string): string {
  const swaps: [RegExp, string][] = [
    [/(^|[_\s-])(F|R)L($|[_\s-])/, '$1$2R$3'],
    [/(^|[_\s-])(F|R)R($|[_\s-])/, '$1$2L$3'],
    [/(^|[_\s-])L($|[_\s-])/, '$1R$2'],
    [/(^|[_\s-])R($|[_\s-])/, '$1L$2'],
  ];
  for (const [re, to] of swaps) if (re.test(name)) return name.replace(re, to);
  const word = (from: string, to: string) => (m: string) => (m === from.toUpperCase() ? to.toUpperCase() : m[0] === from[0]!.toUpperCase() ? to[0]!.toUpperCase() + to.slice(1) : to);
  if (/left/i.test(name)) return name.replace(/left/i, word('left', 'right'));
  if (/right/i.test(name)) return name.replace(/right/i, word('right', 'left'));
  return `${name} (mirror)`;
}
