import type { ProxyMesh } from './mesh';

type V3 = readonly [number, number, number];

/** The room a wheel takes: a cylinder about its axle (the car's X), metres. */
export interface WheelSpace {
  centre: V3;
  radius: number;
  halfWidth: number;
}

/**
 * Clearance kept round a tyre when carving (m): radial, and each side. Room for the wheel to move:
 * with 2 cm the faces left at the arch rubbed the tyre as soon as the suspension worked, and the
 * cars reached half their speed.
 */
const CLEAR_RADIAL = 0.1;
const CLEAR_SIDE = 0.06;

/** The room a wheel takes, from the mesh of the wheel or tyre: null for something too small or flat to be one. */
export function wheelSpaceOf(mesh: ProxyMesh): WheelSpace | null {
  const p = mesh.positions;
  if (p.length < 9) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < p.length; v += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[v + k]!);
      hi[k] = Math.max(hi[k]!, p[v + k]!);
    }
  const radius = Math.max(hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2;
  const halfWidth = (hi[0]! - lo[0]!) / 2;
  if (radius < 0.12 || halfWidth < 0.03 || halfWidth > radius * 1.5) return null;
  return { centre: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2], radius, halfWidth };
}

export function insideWheel(pos: ArrayLike<number>, at: number, w: WheelSpace, radial = CLEAR_RADIAL, side = CLEAR_SIDE): boolean {
  if (Math.abs(pos[at]! - w.centre[0]) > w.halfWidth + side) return false;
  return Math.hypot(pos[at + 1]! - w.centre[1], pos[at + 2]! - w.centre[2]) < w.radius + radial;
}

/**
 * Round the wheel's room, a zone where parts keep their nodes and beams but have no collision
 * faces (m beyond the tyre: radial, and each side). A body on a suspension softer or lower than it
 * was drawn for carries its tyres tucked up into the arches, and clean faces along the arch rubbed
 * them: the cars reached half their speed. The game's wings are open there too.
 */
const NEAR_RADIAL = 0.12;
const NEAR_SIDE = 0.12;

/** Nodes moved out of a wheel's room that land this close to another are made one (m). */
const WELD = 0.04;

/**
 * A proxy with the wheels' room cleared: vertices inside a wheel's space are moved straight out
 * from the axle to the edge of that space, and faces that still pass through it go. A wing or a
 * body wrapped in a hull is closed across its wheel arch, and what bridged the arch became nodes
 * and collision triangles in the middle of the wheel: the tyre pushed every wing out of shape at
 * spawn (5 to 60 mm), and a big one broke it. The game's own wings and bodies are open at the arch.
 *
 * Moved, not removed: a wing has a dozen nodes, and with those in the arch cut away too little was
 * left to hold its mesh.
 *
 * Returns the proxy as it was when nothing of it is in a wheel's room, or when all of it is.
 */
export function carveWheels(mesh: ProxyMesh, wheels: readonly WheelSpace[]): ProxyMesh {
  if (!wheels.length) return mesh;
  const count = mesh.positions.length / 3;
  const p = Float32Array.from(mesh.positions);
  const moved = new Uint8Array(count);
  let any = false;
  for (let v = 0; v < count; v++)
    for (const w of wheels) {
      if (!insideWheel(p, v * 3, w)) continue;
      const dy = p[v * 3 + 1]! - w.centre[1];
      const dz = p[v * 3 + 2]! - w.centre[2];
      const d = Math.hypot(dy, dz);
      const out = w.radius + CLEAR_RADIAL + 0.005;
      // One on the axle itself goes up, into the top of the arch.
      p[v * 3 + 1] = w.centre[1] + (d > 1e-6 ? (dy / d) * out : 0);
      p[v * 3 + 2] = w.centre[2] + (d > 1e-6 ? (dz / d) * out : out);
      moved[v] = 1;
      any = true;
    }
  // A face with all its corners outside can still cross the wheel: its middle and the middles of its edges say so.
  const crosses = (a: number, b: number, c: number) => {
    const at = (i: number, j: number, k: number, wi: number, wj: number, wk: number) => [0, 1, 2].map((d) => p[i * 3 + d]! * wi + p[j * 3 + d]! * wj + p[k * 3 + d]! * wk);
    const samples = [at(a, b, c, 1 / 3, 1 / 3, 1 / 3), at(a, b, c, 0.5, 0.5, 0), at(a, b, c, 0, 0.5, 0.5), at(a, b, c, 0.5, 0, 0.5)];
    return samples.some((s) => wheels.some((w) => insideWheel(s, 0, w)));
  };
  // Moved vertices that land on another become that one.
  const same = Int32Array.from({ length: count }, (_, i) => i);
  for (let v = 0; v < count; v++) {
    if (!moved[v]) continue;
    for (let u = 0; u < count; u++) {
      if (u === v || same[u] !== u || (moved[u] && u > v)) continue;
      if (Math.hypot(p[u * 3]! - p[v * 3]!, p[u * 3 + 1]! - p[v * 3 + 1]!, p[u * 3 + 2]! - p[v * 3 + 2]!) < WELD) {
        same[v] = u;
        break;
      }
    }
  }
  const near = (v: number) => wheels.some((w) => insideWheel(p, v * 3, w, NEAR_RADIAL, NEAR_SIDE));
  const clear: number[] = [];
  const faces: number[] = [];
  // Faces beside the wheel stay as beams only.
  const beams: [number, number][] = [];
  let changed = any;
  for (let t = 0; t < mesh.index.length; t += 3) {
    const a = same[mesh.index[t]!]!;
    const b = same[mesh.index[t + 1]!]!;
    const c = same[mesh.index[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    if (crosses(a, b, c)) {
      changed = true;
      continue;
    }
    clear.push(a, b, c);
    if (near(a) || near(b) || near(c)) {
      beams.push([a, b], [b, c], [c, a]);
      changed = true;
    } else faces.push(a, b, c);
  }
  if (!changed) return mesh;
  const build = (tris: readonly number[], edges: readonly [number, number][]): ProxyMesh => {
    const remap = new Int32Array(count).fill(-1);
    const positions: number[] = [];
    const slot = (v: number) => {
      if (remap[v]! < 0) {
        remap[v] = positions.length / 3;
        positions.push(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
      }
      return remap[v]!;
    };
    const index = tris.map(slot);
    const seen = new Set<string>();
    const extraEdges: [number, number][] = [];
    for (const [a, b] of [...edges, ...(mesh.extraEdges ?? []).map(([x, y]): [number, number] => [same[x]!, same[y]!])]) {
      if (a === b) continue;
      const x = slot(a);
      const y = slot(b);
      const key = x < y ? `${x}|${y}` : `${y}|${x}`;
      if (seen.has(key)) continue;
      seen.add(key);
      extraEdges.push([x, y]);
    }
    return { positions: Float32Array.from(positions), index: Uint32Array.from(index), ...(extraEdges.length ? { extraEdges } : {}) };
  };
  const carved = build(faces, beams);
  if (carved.index.length / 3 >= 2) return carved;
  // Too little left with faces: it keeps those that don't cross the wheel. A part that is all arch
  // (a liner, a mud flap) lives in the wheel's room and is left as it was drawn.
  return clear.length / 3 >= 2 ? build(clear, []) : mesh;
}

/** Is this part itself in a wheel's room (the wheel, its tyre, its brake)? Those are not carved. */
export function inWheelSpace(mesh: ProxyMesh, wheels: readonly WheelSpace[]): boolean {
  const p = mesh.positions;
  const count = p.length / 3;
  if (!count) return false;
  // Nearly all of it, not its middle: a wing's middle is in the arch, and that had wings passed over.
  return wheels.some((w) => {
    let inside = 0;
    for (let v = 0; v < count; v++) if (insideWheel(p, v * 3, w)) inside++;
    return inside >= count * 0.8;
  });
}
