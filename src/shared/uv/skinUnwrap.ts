import { z } from 'zod';

/**
 * Skin unwrap (fork): texture coordinates for a whole car laid out the way
 * skin templates are, so a painter can work on it like a colouring sheet.
 *
 * Every body panel is seen from one of the car's sides: the left side, the
 * top, the right side, the front, the rear (and the underside if wanted).
 * All panels share those views, so each lands on the sheet where it sits on
 * the car, at the same scale everywhere: a stripe painted along the side
 * view runs straight across the fender, both doors and the quarter panel.
 *
 * BeamNG space: +X is the car's left, −Y its front, +Z up. On the sheet, u
 * runs right and v runs up (the top of the image is v = 1).
 *
 *   ┌───────────────────────────────┐
 *   │ left side   (front at left)   │
 *   │ top         (front at left)   │
 *   │ right side  (front at right)  │   each view read from outside,
 *   │ front │ rear │ underside      │   so writing reads the right way
 *   └───────────────────────────────┘
 *
 * The underside is drawn small beside the ends (rarely seen), or as a full
 * band of its own with `bottom`.
 *
 * With `bothSides`, the right side is mirrored onto the left side's band:
 * one design for both sides (writing reads backwards on the right).
 */

export const SKIN_VIEWS = ['left', 'right', 'top', 'front', 'rear', 'bottom'] as const;
export type SkinView = (typeof SKIN_VIEWS)[number];

const Rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const V3 = z.tuple([z.number(), z.number(), z.number()]);

export const SkinLayoutSchema = z.object({
  /** The car's box (BeamNG space, metres) the views are laid out from. */
  min: V3,
  max: V3,
  /** Sheet units per metre (the same in every view). */
  scale: z.number().positive(),
  /** Where each view sits on the sheet: [u, v, width, height]. Views left out have none. */
  rects: z.object({ left: Rect, right: Rect, top: Rect, front: Rect, rear: Rect, bottom: Rect.optional() }),
  /** How strongly slanted panels lean to the side views (1 = by their angle alone). */
  sideBias: z.number().min(0.5).max(3),
  /** …and to the top view. */
  topBias: z.number().min(0.5).max(3),
  bothSides: z.boolean(),
  bottom: z.boolean(),
  /** Passes that give a lone triangle its neighbours' view. */
  smoothing: z.number().int().min(0).max(8),
  /** Gap between views (share of the sheet). */
  padding: z.number().min(0).max(0.2).optional(),
  /** The underside's own scale when it has no full band: a small view in the spare space beside the ends. */
  bottomScale: z.number().positive().optional(),
});
export type SkinLayout = z.infer<typeof SkinLayoutSchema>;

export interface SkinOptions {
  sideBias: number;
  topBias: number;
  bothSides: boolean;
  bottom: boolean;
  smoothing: number;
  /** Gap between views, as a share of the sheet. */
  padding: number;
}

export const DEFAULT_SKIN_OPTIONS: SkinOptions = { sideBias: 1.3, topBias: 1.1, bothSides: false, bottom: false, smoothing: 3, padding: 0.02 };

type Vec3 = [number, number, number];

/** The car's box from the meshes' triangle positions (three floats per vertex). */
export function carBox(meshes: readonly ArrayLike<number>[]): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const pos of meshes)
    for (let i = 0; i + 2 < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = pos[i + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/**
 * Lay the views out on the sheet for a car of this box: one scale for all,
 * as large as fits with `padding` between views and round the edge.
 */
export function planSkinLayout(box: { min: Vec3; max: Vec3 }, opts: SkinOptions = DEFAULT_SKIN_OPTIONS): SkinLayout {
  const W = Math.max(box.max[0] - box.min[0], 1e-3);
  const L = Math.max(box.max[1] - box.min[1], 1e-3);
  const H = Math.max(box.max[2] - box.min[2], 1e-3);
  const p = opts.padding;
  // Rows, top to bottom, as [height in metres]; widths in metres.
  const rows: { views: SkinView[]; h: number; w: number }[] = [
    { views: ['left'], h: H, w: L },
    { views: ['top'], h: W, w: L },
    ...(opts.bothSides ? [] : [{ views: ['right'] as SkinView[], h: H, w: L }]),
    { views: ['front', 'rear'], h: H, w: 2 * W },
    ...(opts.bottom ? [{ views: ['bottom'] as SkinView[], h: W, w: L }] : []),
  ];
  const gapsV = p * (rows.length + 1);
  const scaleV = (1 - gapsV) / rows.reduce((s, r) => s + r.h, 0);
  const scaleU = Math.min(...rows.map((r) => (1 - p * (r.views.length + 1)) / r.w));
  const s = Math.min(scaleU, scaleV);
  const rects: Partial<Record<SkinView, [number, number, number, number]>> = {};
  let top = 1 - p;
  for (const r of rows) {
    const h = r.h * s;
    const v = top - h;
    if (r.views.length === 1) rects[r.views[0]!] = [p, v, L * s, h];
    else {
      rects.front = [p, v, W * s, h];
      rects.rear = [p * 2 + W * s, v, W * s, h];
    }
    top = v - p;
  }
  if (opts.bothSides) rects.right = rects.left;
  // No underside band: the undersides (the floor, under the hood) go small into the space beside
  // the front and rear views, out of the way of the views that are painted but still there.
  let bottomScale: number | undefined;
  if (!opts.bottom && rects.rear) {
    const u0 = rects.rear[0] + rects.rear[2] + p;
    const free = [1 - p - u0, rects.rear[3]];
    const k = Math.min(free[0]! / L, free[1]! / W);
    if (k * L >= 0.05) {
      bottomScale = k;
      rects.bottom = [u0, rects.rear[1] + rects.rear[3] - W * k, L * k, W * k];
    }
  }
  return {
    min: [...box.min],
    max: [...box.max],
    scale: s,
    rects: { left: rects.left!, right: rects.right!, top: rects.top!, front: rects.front!, rear: rects.rear!, ...(rects.bottom ? { bottom: rects.bottom } : {}) },
    sideBias: opts.sideBias,
    topBias: opts.topBias,
    bothSides: opts.bothSides,
    bottom: opts.bottom,
    smoothing: opts.smoothing,
    padding: opts.padding,
    ...(bottomScale ? { bottomScale } : {}),
  };
}

/** The options a layout was made with. */
export function layoutOptions(L: SkinLayout): SkinOptions {
  return { sideBias: L.sideBias, topBias: L.topBias, bothSides: L.bothSides, bottom: L.bottom, smoothing: L.smoothing, padding: L.padding ?? DEFAULT_SKIN_OPTIONS.padding };
}

/** A triangle's unit normal (zero for a degenerate one). */
function normalOf(pos: ArrayLike<number>, a: number): Vec3 {
  const e1 = [pos[a + 3]! - pos[a]!, pos[a + 4]! - pos[a + 1]!, pos[a + 5]! - pos[a + 2]!];
  const e2 = [pos[a + 6]! - pos[a]!, pos[a + 7]! - pos[a + 1]!, pos[a + 8]! - pos[a + 2]!];
  const n: Vec3 = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const l = Math.hypot(n[0], n[1], n[2]);
  return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
}

/** How well each view sees a triangle with this normal at this place (higher is better). */
function viewScores(n: Vec3, c: Vec3, L: SkinLayout): Record<SkinView, number> {
  const mid = [(L.min[0] + L.max[0]) / 2, (L.min[1] + L.max[1]) / 2];
  const halfW = (L.max[0] - L.min[0]) / 2 || 1;
  const halfL = (L.max[1] - L.min[1]) / 2 || 1;
  // Which side and end: by place when clearly off the centre line, else by facing.
  // (The inside of a door is on the door's side, whichever way it faces.)
  const dx = (c[0] - mid[0]!) / halfW;
  const leftSide = Math.abs(dx) > 0.15 ? dx > 0 : n[0] >= 0;
  const dy = (c[1] - mid[1]!) / halfL;
  const frontEnd = Math.abs(dy) > 0.15 ? dy < 0 : n[1] <= 0;
  // Top or underside the same way: by height when clearly above or below the middle (a flipped
  // roof stays a roof; the inside of the hood sits under its outside), else by facing.
  const midZ = (L.min[2] + L.max[2]) / 2;
  const halfH = (L.max[2] - L.min[2]) / 2 || 1;
  const dz = (c[2] - midZ) / halfH;
  const upper = Math.abs(dz) > 0.15 ? dz > 0 : n[2] >= 0;
  const side = Math.abs(n[0]) * L.sideBias;
  const end = Math.abs(n[1]);
  const flat = Math.abs(n[2]);
  return {
    left: leftSide ? side : 0,
    right: leftSide ? 0 : side,
    top: upper ? flat * L.topBias : L.rects.bottom ? 0 : flat * 0.01,
    front: frontEnd ? end : 0,
    rear: frontEnd ? 0 : end,
    bottom: !upper && L.rects.bottom ? flat : 0,
  };
}

function best(s: Record<SkinView, number>): SkinView {
  let v: SkinView = 'left';
  let top = -1;
  for (const k of SKIN_VIEWS)
    if (s[k] > top) {
      top = s[k];
      v = k;
    }
  // A panel facing straight down with no underside view: seen from the side it's on, else it
  // shares the top view (undersides are rarely seen).
  return top <= 0.02 && !s.bottom ? (s.left > 0 || s.right > 0 ? (s.left >= s.right ? 'left' : 'right') : 'top') : v;
}

/**
 * Each triangle's view, smoothed: a triangle whose neighbours (sharing an
 * edge) mostly use another view that still sees it reasonably takes theirs,
 * so gently curved panels stay in one piece instead of breaking into specks.
 */
export function skinViews(pos: ArrayLike<number>, L: SkinLayout): SkinView[] {
  const tris = Math.floor(pos.length / 9);
  const views: SkinView[] = new Array<SkinView>(tris);
  const scores = new Array<Record<SkinView, number>>(tris);
  for (let t = 0; t < tris; t++) {
    const a = t * 9;
    const n = normalOf(pos, a);
    const c: Vec3 = [(pos[a]! + pos[a + 3]! + pos[a + 6]!) / 3, (pos[a + 1]! + pos[a + 4]! + pos[a + 7]!) / 3, (pos[a + 2]! + pos[a + 5]! + pos[a + 8]!) / 3];
    scores[t] = viewScores(n, c, L);
    views[t] = best(scores[t]!);
  }
  if (L.smoothing <= 0 || tris < 2) return views;
  const neighbours = triangleNeighbours(pos);
  for (let pass = 0; pass < L.smoothing; pass++) {
    let changed = 0;
    for (let t = 0; t < tris; t++) {
      const around = neighbours[t]!;
      if (around.length < 2) continue;
      const count = new Map<SkinView, number>();
      for (const o of around) count.set(views[o]!, (count.get(views[o]!) ?? 0) + 1);
      let major: SkinView = views[t]!;
      let most = 0;
      for (const [v, k] of count)
        if (k > most) {
          most = k;
          major = v;
        }
      const own = count.get(views[t]!) ?? 0;
      // Only a lone triangle moves, and only to a view that sees it at a fair angle.
      if (major !== views[t] && most >= 2 && own === 0 && scores[t]![major] >= 0.3) {
        views[t] = major;
        changed++;
      }
    }
    if (!changed) break;
  }
  return views;
}

/** For each triangle, the triangles sharing an edge with it (corners welded within 0.1 mm). */
export function triangleNeighbours(pos: ArrayLike<number>): number[][] {
  const tris = Math.floor(pos.length / 9);
  const ids = new Map<string, number>();
  const vid = (i: number) => {
    const key = `${Math.round(pos[i]! * 1e4)},${Math.round(pos[i + 1]! * 1e4)},${Math.round(pos[i + 2]! * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  const edges = new Map<string, number[]>();
  for (let t = 0; t < tris; t++) {
    const v = [vid(t * 9), vid(t * 9 + 3), vid(t * 9 + 6)];
    for (let k = 0; k < 3; k++) {
      const a = v[k]!;
      const b = v[(k + 1) % 3]!;
      if (a === b) continue;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const list = edges.get(key);
      if (list) list.push(t);
      else edges.set(key, [t]);
    }
  }
  const out: number[][] = Array.from({ length: tris }, () => []);
  for (const list of edges.values()) {
    if (list.length < 2 || list.length > 4) continue; // open edges and messy non-manifold fans
    for (const a of list) for (const b of list) if (a !== b && !out[a]!.includes(b)) out[a]!.push(b);
  }
  return out;
}

/** Where a point lands in a view: [u, v] on the sheet. */
export function projectPoint(p: readonly number[], view: SkinView, L: SkinLayout): [number, number] {
  const r = L.rects[view] ?? L.rects.top;
  const s = view === 'bottom' ? (L.bottomScale ?? L.scale) : L.scale;
  const [x, y, z] = [p[0]!, p[1]!, p[2]!];
  const [minX, minY, minZ] = L.min;
  const [maxX, maxY] = L.max;
  switch (view) {
    case 'left': // from the left: the front at the left
      return [r[0] + (y - minY) * s, r[1] + (z - minZ) * s];
    case 'right': // from the right: the front at the right (mirrored onto the left's band with bothSides)
      return L.bothSides ? [r[0] + (y - minY) * s, r[1] + (z - minZ) * s] : [r[0] + (maxY - y) * s, r[1] + (z - minZ) * s];
    case 'top': // from above: the front at the left, the car's right side at the top
      return [r[0] + (y - minY) * s, r[1] + (maxX - x) * s];
    case 'front': // from ahead: the car's left at the right
      return [r[0] + (x - minX) * s, r[1] + (z - minZ) * s];
    case 'rear': // from behind: the car's left at the left
      return [r[0] + (maxX - x) * s, r[1] + (z - minZ) * s];
    case 'bottom': // from below: the front at the left, the car's left side at the top
      return [r[0] + (y - minY) * s, r[1] + (x - minX) * s];
  }
}

/** Texture coordinates for a mesh's triangles (three floats per vertex, unindexed), and each triangle's view. */
export function skinUvs(pos: ArrayLike<number>, L: SkinLayout): { uv: Float32Array; views: SkinView[] } {
  const views = skinViews(pos, L);
  const uv = new Float32Array(Math.floor(pos.length / 3) * 2);
  for (let t = 0; t < views.length; t++)
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      const [u, v] = projectPoint([pos[i]!, pos[i + 1]!, pos[i + 2]!], views[t]!, L);
      uv[(t * 3 + k) * 2] = u;
      uv[(t * 3 + k) * 2 + 1] = v;
    }
  return { uv, views };
}

const VIEW_AXIS: Record<SkinView, 0 | 1 | 2> = { left: 0, right: 0, front: 1, rear: 1, top: 2, bottom: 2 };

/**
 * How squarely each triangle faces its view: 1 = flat to it (no stretch),
 * 0.5 = stretched twice along the slope, near 0 = edge-on.
 */
export function triangleFacing(pos: ArrayLike<number>, views: readonly SkinView[]): Float32Array {
  const out = new Float32Array(views.length);
  for (let t = 0; t < views.length; t++) out[t] = Math.abs(normalOf(pos, t * 9)[VIEW_AXIS[views[t]!]]);
  return out;
}

export interface SkinStats {
  triangles: number;
  perView: Record<SkinView, number>;
  /** Share of the painted area stretched more than twice (a surface at a steep angle to its view). */
  stretched: number;
}

/** How the triangles spread over the views, and how much of the surface is stretched. */
export function skinStats(pos: ArrayLike<number>, views: readonly SkinView[]): SkinStats {
  const perView = Object.fromEntries(SKIN_VIEWS.map((v) => [v, 0])) as Record<SkinView, number>;
  const facing = triangleFacing(pos, views);
  let area = 0;
  let bad = 0;
  for (let t = 0; t < views.length; t++) {
    perView[views[t]!]++;
    const a = t * 9;
    const e1 = [pos[a + 3]! - pos[a]!, pos[a + 4]! - pos[a + 1]!, pos[a + 5]! - pos[a + 2]!];
    const e2 = [pos[a + 6]! - pos[a]!, pos[a + 7]! - pos[a + 1]!, pos[a + 8]! - pos[a + 2]!];
    const len = Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
    area += len;
    if (facing[t]! < 0.5) bad += len;
  }
  return { triangles: views.length, perView, stretched: area ? bad / area : 0 };
}
