/**
 * Visual meshes following the physics, the way BeamNG's flexbodies do: each
 * vertex is tied to three nearby nodes as a little frame (origin, one axis
 * towards the second node, the plane of the third) and keeps its position in
 * that frame, so it moves, turns and bends with them.
 */

export interface SkinBinding {
  /** Per vertex: the three node indices (into the sim's node list). */
  nodes: Int32Array;
  /** Per vertex: its position in the nodes' frame. */
  local: Float32Array;
}

type Vec = [number, number, number];

function frame(p: ArrayLike<number>, a: number, b: number, c: number): [Vec, Vec, Vec, Vec] | null {
  const o: Vec = [p[a * 3]!, p[a * 3 + 1]!, p[a * 3 + 2]!];
  const u: Vec = [p[b * 3]! - o[0], p[b * 3 + 1]! - o[1], p[b * 3 + 2]! - o[2]];
  const w: Vec = [p[c * 3]! - o[0], p[c * 3 + 1]! - o[1], p[c * 3 + 2]! - o[2]];
  const lu = Math.hypot(...u);
  if (lu < 1e-9) return null;
  const e1: Vec = [u[0] / lu, u[1] / lu, u[2] / lu];
  const n: Vec = [e1[1] * w[2] - e1[2] * w[1], e1[2] * w[0] - e1[0] * w[2], e1[0] * w[1] - e1[1] * w[0]];
  const ln = Math.hypot(...n);
  if (ln < 1e-9) return null;
  const e3: Vec = [n[0] / ln, n[1] / ln, n[2] / ln];
  const e2: Vec = [e3[1] * e1[2] - e3[2] * e1[1], e3[2] * e1[0] - e3[0] * e1[2], e3[0] * e1[1] - e3[1] * e1[0]];
  return [o, e1, e2, e3];
}

/**
 * Tie every vertex to three of `candidates` (node indices): the nearest, and
 * the two among the next nearest that make the best-shaped frame.
 */
export function bindVertices(vertices: ArrayLike<number>, nodePos: ArrayLike<number>, candidates: readonly number[], near = 8): SkinBinding {
  const count = Math.floor(vertices.length / 3);
  const nodes = new Int32Array(count * 3);
  const local = new Float32Array(count * 3);
  const d = new Float64Array(candidates.length);
  for (let v = 0; v < count; v++) {
    const x = vertices[v * 3]!;
    const y = vertices[v * 3 + 1]!;
    const z = vertices[v * 3 + 2]!;
    for (let i = 0; i < candidates.length; i++) {
      const n = candidates[i]!;
      d[i] = (nodePos[n * 3]! - x) ** 2 + (nodePos[n * 3 + 1]! - y) ** 2 + (nodePos[n * 3 + 2]! - z) ** 2;
    }
    // The few nearest: one pass keeping a short sorted list (a big part has hundreds of nodes).
    const k = Math.min(near, candidates.length);
    const order: number[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const di = d[i]!;
      if (order.length === k && di >= d[order[k - 1]!]!) continue;
      let at = order.length;
      while (at > 0 && d[order[at - 1]!]! > di) at--;
      order.splice(at, 0, i);
      if (order.length > k) order.pop();
    }
    const a = candidates[order[0] ?? 0] ?? 0;
    let pick: [number, number] | null = null;
    let bestArea = 0;
    for (let i = 1; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const b = candidates[order[i]!]!;
        const c = candidates[order[j]!]!;
        const u: Vec = [nodePos[b * 3]! - nodePos[a * 3]!, nodePos[b * 3 + 1]! - nodePos[a * 3 + 1]!, nodePos[b * 3 + 2]! - nodePos[a * 3 + 2]!];
        const w: Vec = [nodePos[c * 3]! - nodePos[a * 3]!, nodePos[c * 3 + 1]! - nodePos[a * 3 + 1]!, nodePos[c * 3 + 2]! - nodePos[a * 3 + 2]!];
        const area = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / (1 + d[order[i]!]! + d[order[j]!]!);
        if (area > bestArea) {
          bestArea = area;
          pick = [b, c];
        }
      }
    }
    const [b, c] = pick ?? [a, a];
    nodes.set([a, b, c], v * 3);
    const f = frame(nodePos, a, b, c);
    if (!f) {
      // Too few nodes for a frame: just follow the nearest one.
      local.set([x - nodePos[a * 3]!, y - nodePos[a * 3 + 1]!, z - nodePos[a * 3 + 2]!], v * 3);
      nodes.set([a, -1, -1], v * 3);
      continue;
    }
    const [o, e1, e2, e3] = f;
    const r: Vec = [x - o[0], y - o[1], z - o[2]];
    local.set([r[0] * e1[0] + r[1] * e1[1] + r[2] * e1[2], r[0] * e2[0] + r[1] * e2[1] + r[2] * e2[2], r[0] * e3[0] + r[1] * e3[1] + r[2] * e3[2]], v * 3);
  }
  return { nodes, local };
}

/**
 * Each binding's distinct node frames: most vertices share their three nodes
 * with their neighbours, so a frame is worked out once per update, not once
 * per vertex (a car has a few thousand frames and a few hundred thousand vertices).
 */
interface FramePlan {
  /** Distinct (a, b, c) node triples. */
  triples: Int32Array;
  /** Per vertex: its triple, or -1 to follow node `nodes[v*3]` alone. */
  which: Int32Array;
  /** Per triple: origin and three axes (12 numbers), refilled each update. */
  frames: Float64Array;
  /** Per triple: 1 when its frame was usable this update. */
  ok: Uint8Array;
}

const plans = new WeakMap<SkinBinding, FramePlan>();

function planOf(b: SkinBinding): FramePlan {
  let plan = plans.get(b);
  if (plan) return plan;
  const count = b.local.length / 3;
  const ids = new Map<string, number>();
  const triples: number[] = [];
  const which = new Int32Array(count);
  for (let v = 0; v < count; v++) {
    const a = b.nodes[v * 3]!;
    const bb = b.nodes[v * 3 + 1]!;
    const c = b.nodes[v * 3 + 2]!;
    if (bb < 0) {
      which[v] = -1;
      continue;
    }
    const key = `${a},${bb},${c}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = triples.length / 3;
      ids.set(key, id);
      triples.push(a, bb, c);
    }
    which[v] = id;
  }
  const n = triples.length / 3;
  plan = { triples: Int32Array.from(triples), which, frames: new Float64Array(n * 12), ok: new Uint8Array(n) };
  plans.set(b, plan);
  return plan;
}

/** Vertex positions for the nodes' current positions. */
export function deformVertices(b: SkinBinding, nodePos: ArrayLike<number>, out: Float32Array): void {
  const plan = planOf(b);
  const { triples, frames, ok, which } = plan;
  for (let t = 0; t < ok.length; t++) {
    const f = frame(nodePos, triples[t * 3]!, triples[t * 3 + 1]!, triples[t * 3 + 2]!);
    if (!f) {
      ok[t] = 0;
      continue;
    }
    ok[t] = 1;
    const [o, e1, e2, e3] = f;
    frames.set(o, t * 12);
    frames.set(e1, t * 12 + 3);
    frames.set(e2, t * 12 + 6);
    frames.set(e3, t * 12 + 9);
  }
  const count = b.local.length / 3;
  for (let v = 0; v < count; v++) {
    const lx = b.local[v * 3]!;
    const ly = b.local[v * 3 + 1]!;
    const lz = b.local[v * 3 + 2]!;
    const t = which[v]!;
    if (t < 0 || !ok[t]) {
      const a = b.nodes[v * 3]!;
      out[v * 3] = nodePos[a * 3]! + lx;
      out[v * 3 + 1] = nodePos[a * 3 + 1]! + ly;
      out[v * 3 + 2] = nodePos[a * 3 + 2]! + lz;
      continue;
    }
    const i = t * 12;
    out[v * 3] = frames[i]! + frames[i + 3]! * lx + frames[i + 6]! * ly + frames[i + 9]! * lz;
    out[v * 3 + 1] = frames[i + 1]! + frames[i + 4]! * lx + frames[i + 7]! * ly + frames[i + 10]! * lz;
    out[v * 3 + 2] = frames[i + 2]! + frames[i + 5]! * lx + frames[i + 8]! * ly + frames[i + 11]! * lz;
  }
}
