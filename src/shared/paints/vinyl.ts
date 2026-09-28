import type { VinylLayer } from '../project/schema';
import type { Bounds, Vec3 } from './patterns';

/**
 * Vinyls: layers of shapes, text and images placed on the car the way a
 * livery editor does it. Each layer is projected onto the car from one side
 * (left, right, top, front, back), sits at (x, y) in that side's view in
 * metres, and has a size, turn, slant and flips. They're composited, bottom
 * layer first, into the texels of a material (each texel knowing the point
 * of the car it shows and which way it faces), fading out where the surface
 * turns away from the side it's projected from.
 */

export type Side = VinylLayer['side'];
export const SIDES: readonly Side[] = ['left', 'right', 'top', 'front', 'back'];

/** Each side as seen from outside: the viewer's right (H), up (V), and the way the surface faces (N). BeamNG: +X left, −Y front, +Z up. */
export const SIDE_FRAMES: Record<Side, { h: Vec3; v: Vec3; n: Vec3 }> = {
  left: { h: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
  right: { h: [0, -1, 0], v: [0, 0, 1], n: [-1, 0, 0] },
  top: { h: [-1, 0, 0], v: [0, -1, 0], n: [0, 0, 1] },
  front: { h: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
  back: { h: [-1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
};

/** Where side views are measured from: the car's centre line across, its middle along and up. */
export function viewCentre(b: Bounds): Vec3 {
  return [0, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A point of the car in a side's view (metres). */
export function planeCoords(side: Side, p: Vec3, centre: Vec3): [number, number] {
  const f = SIDE_FRAMES[side];
  const d: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
  return [dot(d, f.h), dot(d, f.v)];
}

/** The side a surface faces most (for placing a layer where the car was clicked). */
export function sideFacing(n: Vec3): Side {
  let best: Side = 'left';
  let score = -Infinity;
  for (const s of SIDES) {
    const d = dot(n, SIDE_FRAMES[s].n);
    if (d > score) {
      score = d;
      best = s;
    }
  }
  return best;
}

/** The opposite side across the centre line (left ↔ right; top, front and back mirror onto themselves). */
export const mirrorSide = (s: Side): Side => (s === 'left' ? 'right' : s === 'right' ? 'left' : s);

/** The mirrored copy of a layer, across the car's centre line. */
export function mirrored(l: VinylLayer): VinylLayer {
  const keep = l.readable && (l.kind === 'text' || l.kind === 'image');
  return { ...l, side: mirrorSide(l.side), x: -l.x, rotation: -l.rotation, skew: -l.skew, flipX: keep ? l.flipX : !l.flipX, gradientAngle: 180 - l.gradientAngle };
}

/** A layer's placement: plane (h, v) → shape (s, t), both −½…½ over the layer; and back. */
export interface Placement {
  /** Inverse matrix (plane offset → shape) and the layer's centre. */
  inv: [number, number, number, number];
  x: number;
  y: number;
  /** The layer's extent in the plane. */
  box: { minH: number; maxH: number; minV: number; maxV: number };
}

export function placement(l: Pick<VinylLayer, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'skew' | 'flipX' | 'flipY'>): Placement {
  const r = (l.rotation * Math.PI) / 180;
  const k = Math.tan((Math.max(-80, Math.min(80, l.skew)) * Math.PI) / 180);
  const sx = l.w * (l.flipX ? -1 : 1);
  const sy = l.h * (l.flipY ? -1 : 1);
  const [c, s] = [Math.cos(r), Math.sin(r)];
  // forward: R · K · S, with K = [[1, k], [0, 1]]
  const a = c * sx;
  const b = (c * k - s) * sy;
  const cc = s * sx;
  const d = (s * k + c) * sy;
  const det = a * d - b * cc;
  const inv: [number, number, number, number] = [d / det, -b / det, -cc / det, a / det];
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([u, t]) => [l.x + a * u! + b * t!, l.y + cc * u! + d * t!]);
  const hs = corners.map((q) => q[0]!);
  const vs = corners.map((q) => q[1]!);
  return { inv, x: l.x, y: l.y, box: { minH: Math.min(...hs), maxH: Math.max(...hs), minV: Math.min(...vs), maxV: Math.max(...vs) } };
}

/** Plane point → shape coordinates. */
export function toShape(p: Placement, h: number, v: number): [number, number] {
  const dh = h - p.x;
  const dv = v - p.y;
  return [p.inv[0] * dh + p.inv[1] * dv, p.inv[2] * dh + p.inv[3] * dv];
}

/** What a layer looks like at a point of its shape: coverage 0–1, and (for images) the image's own colour. */
export interface LayerLook {
  alpha(s: number, t: number): number;
  rgba?(s: number, t: number): [number, number, number, number];
}

export interface Texels {
  count: number;
  /** BeamNG-space point and surface normal of each texel, xyz after xyz. */
  pos: Float32Array;
  nrm: Float32Array;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much a surface facing `n` takes a projection from a side facing `dir`. */
export const facing = (n: Vec3, dir: Vec3) => smoothstep(0.12, 0.4, dot(n, dir));

export interface ComposeOptions {
  bounds: Bounds;
  /** The look of each layer by id (built from its shape, text or image). */
  looks: ReadonlyMap<string, LayerLook>;
  /** The colours to paint with: real colours on a livery, the slot colours on a mask. */
  colorOf(l: VinylLayer, which: 1 | 2): [number, number, number];
  /** Outline these layers (and their mirrors). */
  selected?: ReadonlySet<string> | null;
}

export interface Composite {
  /** RGBA per texel, 0–255, not premultiplied. */
  rgba: Uint8ClampedArray;
  /** 1 where the selected layer's outline runs. */
  outline: Uint8Array;
}

/** Composite visible layers (bottom first) into the texels. */
export function composeVinyls(texels: Texels, layers: readonly VinylLayer[], o: ComposeOptions): Composite {
  const n = texels.count;
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const A = new Float32Array(n);
  const outline = new Uint8Array(n);
  // Clip layers show only where the nearest ordinary layer below them is: its coverage, per copy (0 original, 1 mirror).
  const baseCov = [new Float32Array(n), new Float32Array(n)];
  const baseStamp = [new Int32Array(n).fill(-1), new Int32Array(n).fill(-1)];
  const baseLayer = [-1, -1];
  const centre = viewCentre(o.bounds);
  const P = texels.pos;
  const N = texels.nrm;
  layers.forEach((layer, li) => {
    if (!layer.visible) return;
    const look = o.looks.get(layer.id);
    if (!look) return;
    const copies: [VinylLayer, 0 | 1][] = [[layer, 0], ...(layer.mirror ? [[mirrored(layer), 1] as [VinylLayer, 1]] : [])];
    for (const [l, copy] of copies) {
      const f = SIDE_FRAMES[l.side];
      const pl = placement(l);
      const c1 = o.colorOf(l, 1);
      const c2 = o.colorOf(l, 2);
      const g = (l.gradientAngle * Math.PI) / 180;
      const [gc, gs] = [Math.cos(g), Math.sin(g)];
      const gspan = Math.abs(gc) + Math.abs(gs) || 1;
      const isSelected = !!o.selected?.has(layer.id);
      const edge = 0.012;
      // Which base the clip reads, and which bases this layer becomes (a layer without a mirror is the base for both copies).
      const reads = copy;
      const writes: (0 | 1)[] = layer.mirror ? [copy] : [0, 1];
      if (l.mode === 'normal') for (const w of writes) baseLayer[w] = li;
      for (let i = 0; i < n; i++) {
        const px = P[i * 3]! - centre[0];
        const py = P[i * 3 + 1]! - centre[1];
        const pz = P[i * 3 + 2]! - centre[2];
        const h = px * f.h[0] + py * f.h[1] + pz * f.h[2];
        if (h < pl.box.minH || h > pl.box.maxH) continue;
        const v = px * f.v[0] + py * f.v[1] + pz * f.v[2];
        if (v < pl.box.minV || v > pl.box.maxV) continue;
        const fade = facing([N[i * 3]!, N[i * 3 + 1]!, N[i * 3 + 2]!], f.n);
        if (fade <= 0) continue;
        const [s, t] = toShape(pl, h, v);
        if (s < -0.5 || s > 0.5 || t < -0.5 || t > 0.5) continue;
        if (isSelected && Math.max(Math.abs(s), Math.abs(t)) > 0.5 - edge) outline[i] = 1;
        let cov = look.alpha(s, t);
        if (cov <= 0) continue;
        let r: number;
        let gg: number;
        let bb: number;
        const own = look.rgba?.(s, t);
        if (own) {
          [r, gg, bb] = own;
          cov *= own[3];
        } else {
          let k = 0;
          if (l.fill === 'linear') k = Math.min(1, Math.max(0, (s * gc + t * gs) / gspan + 0.5));
          else if (l.fill === 'radial') k = Math.min(1, 2 * Math.hypot(s, t));
          r = c1[0] + (c2[0] - c1[0]) * k;
          gg = c1[1] + (c2[1] - c1[1]) * k;
          bb = c1[2] + (c2[2] - c1[2]) * k;
        }
        let a = cov * l.opacity * fade;
        if (l.mode === 'clip') a *= baseStamp[reads]![i] === baseLayer[reads] ? baseCov[reads]![i]! : 0;
        if (a <= 0) continue;
        if (l.mode === 'erase') {
          R[i] = R[i]! * (1 - a);
          G[i] = G[i]! * (1 - a);
          B[i] = B[i]! * (1 - a);
          A[i] = A[i]! * (1 - a);
          continue;
        }
        R[i] = r * a + R[i]! * (1 - a);
        G[i] = gg * a + G[i]! * (1 - a);
        B[i] = bb * a + B[i]! * (1 - a);
        A[i] = a + A[i]! * (1 - a);
        if (l.mode === 'normal') {
          for (const w of writes) {
            baseCov[w]![i] = cov * fade;
            baseStamp[w]![i] = li;
          }
        }
      }
    }
  });
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const a = A[i]!;
    if (a <= 0) continue;
    rgba[i * 4] = (R[i]! / a) * 255;
    rgba[i * 4 + 1] = (G[i]! / a) * 255;
    rgba[i * 4 + 2] = (B[i]! / a) * 255;
    rgba[i * 4 + 3] = a * 255;
  }
  return { rgba, outline };
}

/** The topmost visible layer at a point of the car (for clicking a layer to select it). */
export function layerAt(layers: readonly VinylLayer[], looks: ReadonlyMap<string, LayerLook>, p: Vec3, nrm: Vec3, bounds: Bounds): string | null {
  const centre = viewCentre(bounds);
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li]!;
    const look = looks.get(layer.id);
    if (!layer.visible || !look || layer.mode === 'erase') continue;
    for (const l of [layer, ...(layer.mirror ? [mirrored(layer)] : [])]) {
      if (facing(nrm, SIDE_FRAMES[l.side].n) <= 0) continue;
      const [h, v] = planeCoords(l.side, p, centre);
      const [s, t] = toShape(placement(l), h, v);
      if (Math.abs(s) <= 0.5 && Math.abs(t) <= 0.5 && look.alpha(s, t) > 0.3) return layer.id;
    }
  }
  return null;
}

/** A new layer with everything at its plain default. */
export function newLayer(id: string, over: Partial<VinylLayer> = {}): VinylLayer {
  return {
    id,
    name: 'Layer',
    kind: 'shape',
    shape: 'square',
    text: 'TEXT',
    font: 'Impact',
    bold: false,
    italic: false,
    image: null,
    side: 'left',
    x: 0,
    y: 0,
    w: 0.5,
    h: 0.5,
    rotation: 0,
    skew: 0,
    flipX: false,
    flipY: false,
    fill: 'solid',
    color: [0.9, 0.1, 0.1],
    color2: [1, 1, 1],
    slot: 1,
    slot2: 2,
    gradientAngle: 0,
    opacity: 1,
    mode: 'normal',
    mirror: false,
    readable: true,
    visible: true,
    locked: false,
    groupId: null,
    ...over,
  };
}
