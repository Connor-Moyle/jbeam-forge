/**
 * Nodes that start out touching another part's collision surface. With self-collision on, the game
 * pushes such a node off that surface the moment the car spawns: a grille tucked against the bumper
 * broke its own mounts (23 beams on the demo car; 4 with these nodes left out of self-collision).
 * Everything else keeps self-collision, so parts still hit each other in a crash.
 */

type V3 = readonly [number, number, number];

const sub = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Distance from p to triangle abc (closest point on the triangle, Ericson's method). */
export function pointTriangleDistance(p: V3, a: V3, b: V3, c: V3): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  const at = (q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const lerp = (u: V3, v: V3, t: number): V3 => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t, u[2] + (v[2] - u[2]) * t];
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(lerp(a, b, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(lerp(a, c, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return at(lerp(b, c, (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

export const CONTACT_GAP = 0.025;

/** Ids of nodes within `gap` of a collision triangle that belongs to a different part. */
export function nodesTouchingOtherParts(
  nodes: readonly { id: string; partId: string; pos: V3 }[],
  tris: readonly { ids: readonly [string, string, string]; partId: string }[],
  gap = CONTACT_GAP,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Triangles in a coarse grid, so each node only looks at the ones nearby.
  const cell = Math.max(0.25, gap * 4);
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, { a: V3; b: V3; c: V3; partId: string }[]>();
  for (const t of tris) {
    const [a, b, c] = t.ids.map((id) => byId.get(id)?.pos);
    if (!a || !b || !c) continue;
    const lo = [0, 1, 2].map((k) => Math.floor((Math.min(a[k]!, b[k]!, c[k]!) - gap) / cell));
    const hi = [0, 1, 2].map((k) => Math.floor((Math.max(a[k]!, b[k]!, c[k]!) + gap) / cell));
    const entry = { a, b, c, partId: t.partId };
    for (let x = lo[0]!; x <= hi[0]!; x++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let z = lo[2]!; z <= hi[2]!; z++) {
          const k = `${x},${y},${z}`;
          const list = grid.get(k) ?? [];
          list.push(entry);
          grid.set(k, list);
        }
  }
  const out = new Set<string>();
  for (const n of nodes) {
    const near = grid.get(key(n.pos[0], n.pos[1], n.pos[2]));
    if (near?.some((t) => t.partId !== n.partId && pointTriangleDistance(n.pos, t.a, t.b, t.c) < gap)) out.add(n.id);
  }
  return out;
}
