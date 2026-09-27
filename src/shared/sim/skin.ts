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
    // The few nearest (partial selection is plenty for small candidate lists).
    const order: number[] = [];
    for (let k = 0; k < Math.min(near, candidates.length); k++) {
      let best = -1;
      for (let i = 0; i < candidates.length; i++) if (!order.includes(i) && (best < 0 || d[i]! < d[best]!)) best = i;
      order.push(best);
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

/** Vertex positions for the nodes' current positions. */
export function deformVertices(b: SkinBinding, nodePos: ArrayLike<number>, out: Float32Array): void {
  const count = b.local.length / 3;
  for (let v = 0; v < count; v++) {
    const a = b.nodes[v * 3]!;
    const bb = b.nodes[v * 3 + 1]!;
    const lx = b.local[v * 3]!;
    const ly = b.local[v * 3 + 1]!;
    const lz = b.local[v * 3 + 2]!;
    const f = bb < 0 ? null : frame(nodePos, a, bb, b.nodes[v * 3 + 2]!);
    if (!f) {
      out[v * 3] = nodePos[a * 3]! + lx;
      out[v * 3 + 1] = nodePos[a * 3 + 1]! + ly;
      out[v * 3 + 2] = nodePos[a * 3 + 2]! + lz;
      continue;
    }
    const [o, e1, e2, e3] = f;
    out[v * 3] = o[0] + e1[0] * lx + e2[0] * ly + e3[0] * lz;
    out[v * 3 + 1] = o[1] + e1[1] * lx + e2[1] * ly + e3[1] * lz;
    out[v * 3 + 2] = o[2] + e1[2] * lx + e2[2] * ly + e3[2] * lz;
  }
}
