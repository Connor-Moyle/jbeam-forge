import type { StructBeam, StructNode, StructTri } from '../project/schema';
import type { PositionAxis } from '../taxonomy/schema';
import { edges, type ProxyMesh } from './mesh';
import { ATTACHMENT_VALUES, BEAM_PRESET_VALUES, type AttachmentStyle, type BeamPresetId, type BracingDensity } from './presets';

/**
 * Proxy → jbeam structure (SPEC §4.4): vertices → nodes, edges → beams,
 * faces → collision triangles; plus bending braces, node weights from the
 * part's target mass, and attachment beams to the parent part.
 * Conventions follow docs/proxy-generation.md.
 */

/** Positions with |x| below this are centre nodes (no l/r suffix). */
const CENTRE_EPS = 1e-4;
export const LIGHT_NODE_KG = 0.25;

/**
 * Position tag inside node ids: the fore letter for front/rear and corner
 * parts. The side is carried by the l/r suffix, so left/right parts need none.
 */
export function positionTag(axis: PositionAxis, position: string | null): string {
  if (!position || axis === 'none' || axis === 'lr') return '';
  return position[0] === 'F' ? 'f' : 'r';
}

/**
 * Node ids `<prefix><n><l|r>`: numbered front→rear, top→bottom; a vertex and
 * its exact mirror share `n`. Ids already `taken` (other parts) are skipped.
 */
export function nameNodes(positions: ArrayLike<number>, prefix: string, taken: ReadonlySet<string> = new Set()): string[] {
  const n = positions.length / 3;
  const ids = new Array<string>(n);
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const byPos = new Map<string, number>();
  for (let v = 0; v < n; v++) byPos.set(key(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!), v);
  // Slots: centre vertices, left vertices (with their mirror twin if any), unmatched right vertices.
  const slots: { verts: [number | null, number | null, number | null]; y: number; z: number }[] = []; // [centre, left, right]
  const used = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    if (used[v]) continue;
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    used[v] = 1;
    if (Math.abs(x) < CENTRE_EPS) slots.push({ verts: [v, null, null], y, z });
    else {
      const twin = byPos.get(key(-x, y, z));
      const pair = twin !== undefined && !used[twin] ? twin : null;
      if (pair !== null) used[pair] = 1;
      slots.push({ verts: x > 0 ? [null, v, pair] : [null, pair, v], y, z });
    }
  }
  slots.sort((a, b) => a.y - b.y || b.z - a.z);
  let num = 1;
  for (const slot of slots) {
    const [c, l, r] = slot.verts;
    const ok = (k: number) => (c === null || !taken.has(`${prefix}${k}`)) && (l === null || !taken.has(`${prefix}${k}l`)) && (r === null || !taken.has(`${prefix}${k}r`));
    while (!ok(num)) num++;
    if (c !== null) ids[c] = `${prefix}${num}`;
    if (l !== null) ids[l] = `${prefix}${num}l`;
    if (r !== null) ids[r] = `${prefix}${num}r`;
    num++;
  }
  return ids;
}

/**
 * Bending braces: for every edge shared by two triangles, a beam between the
 * two opposite vertices (stops thin shells folding like paper).
 * light = every third edge, standard = all, heavy = all + links to the nearest
 * non-connected nodes within 2.5 × the median edge length (volumetric).
 */
export function braces(mesh: ProxyMesh, density: BracingDensity): [number, number][] {
  if (density === 'none') return [];
  const opposite = new Map<string, number[]>();
  const k = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < mesh.index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.index[t + e]!;
      const b = mesh.index[t + ((e + 1) % 3)]!;
      const c = mesh.index[t + ((e + 2) % 3)]!;
      const list = opposite.get(k(a, b));
      if (list) list.push(c);
      else opposite.set(k(a, b), [c]);
    }
  }
  const connected = new Set(edges(mesh).map(([a, b]) => k(a, b)));
  const out = new Map<string, [number, number]>();
  let i = 0;
  for (const list of opposite.values()) {
    if (list.length !== 2) continue;
    i++;
    if (density === 'light' && i % 3 !== 0) continue;
    const [c, d] = list as [number, number];
    if (c === d || connected.has(k(c, d))) continue;
    out.set(k(c, d), [Math.min(c, d), Math.max(c, d)]);
  }
  if (density === 'heavy') {
    const p = mesh.positions;
    const n = p.length / 3;
    const dist = (a: number, b: number) => Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);
    const lengths = edges(mesh)
      .map(([a, b]) => dist(a, b))
      .sort((x, y) => x - y);
    const reach = 2.5 * (lengths[Math.floor(lengths.length / 2)] ?? 0.3);
    for (let a = 0; a < n; a++) {
      const near: [number, number][] = [];
      for (let b = 0; b < n; b++) {
        if (a === b || connected.has(k(a, b)) || out.has(k(a, b))) continue;
        const d = dist(a, b);
        if (d <= reach) near.push([b, d]);
      }
      near.sort((x, y) => x[1] - y[1]);
      for (const [b] of near.slice(0, 2)) out.set(k(a, b), [Math.min(a, b), Math.max(a, b)]);
    }
    // Cage bracing across a symmetric body, like official bodies: every off-centre node ties to its
    // exact mirror twin (a width beam) and crosses to its neighbours' twins (X-diagonals).
    const key3 = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    const at = new Map<string, number>();
    for (let v = 0; v < n; v++) at.set(key3(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!), v);
    const twin = (v: number) => (Math.abs(p[v * 3]!) < 1e-3 ? undefined : at.get(key3(-p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!)));
    const neighbours = new Map<number, number[]>();
    for (const [a, b] of edges(mesh)) {
      neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
      neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
    }
    const add = (a: number, b: number | undefined) => {
      if (b === undefined || a === b || connected.has(k(a, b))) return;
      out.set(k(a, b), [Math.min(a, b), Math.max(a, b)]);
    };
    // Only where a real body has cross members: the floor, the roof and the two ends (bulkhead,
    // rear panel). Tying every side node across would fill the cabin and engine bay with beams.
    let zLo = Infinity;
    let zHi = -Infinity;
    let yLo = Infinity;
    let yHi = -Infinity;
    for (let v = 0; v < n; v++) {
      zLo = Math.min(zLo, p[v * 3 + 2]!);
      zHi = Math.max(zHi, p[v * 3 + 2]!);
      yLo = Math.min(yLo, p[v * 3 + 1]!);
      yHi = Math.max(yHi, p[v * 3 + 1]!);
    }
    const crossMember = (v: number) => {
      const z = p[v * 3 + 2]!;
      const y = p[v * 3 + 1]!;
      return z < zLo + 0.22 * (zHi - zLo) || z > zHi - 0.12 * (zHi - zLo) || y < yLo + 0.08 * (yHi - yLo) || y > yHi - 0.08 * (yHi - yLo);
    };
    for (let a = 0; a < n; a++) {
      if (p[a * 3]! <= 0) continue; // left side drives it; the right side is its mirror
      if (!crossMember(a)) continue;
      const t = twin(a);
      if (t === undefined) continue;
      add(a, t);
      for (const nb of neighbours.get(a) ?? []) if (p[nb * 3]! > 0 && crossMember(nb)) add(a, twin(nb));
    }
  }
  return [...out.values()];
}

export interface DeriveInput {
  partId: string;
  mesh: ProxyMesh;
  prefix: string;
  massKg: number;
  bracing: BracingDensity;
  /** Node ids used by other parts (vehicle-wide uniqueness). */
  taken?: ReadonlySet<string>;
}

export interface DerivedStructure {
  nodes: StructNode[];
  beams: StructBeam[];
  tris: StructTri[];
  warnings: string[];
}

export function deriveStructure(input: DeriveInput): DerivedStructure {
  const { mesh, partId } = input;
  const ids = nameNodes(mesh.positions, input.prefix, input.taken);
  const n = ids.length;
  const weight = n ? input.massKg / n : 0;
  const warnings: string[] = [];
  if (n && weight < LIGHT_NODE_KG) warnings.push(`Nodes weigh ${weight.toFixed(2)} kg each (below ${LIGHT_NODE_KG} kg): raise the part's mass or lower its detail.`);
  const round = (v: number) => Math.round(v * 1e4) / 1e4 || 0; // no -0
  const nodes: StructNode[] = ids.map((id, v) => ({ id, partId, pos: [round(mesh.positions[v * 3]!), round(mesh.positions[v * 3 + 1]!), round(mesh.positions[v * 3 + 2]!)], weight: Math.round(weight * 1000) / 1000 || 0.001 }));
  const beams: StructBeam[] = [...edges(mesh).map(([a, b]) => ({ id1: ids[a]!, id2: ids[b]!, partId, kind: 'edge' as const })), ...braces(mesh, input.bracing).map(([a, b]) => ({ id1: ids[a]!, id2: ids[b]!, partId, kind: 'brace' as const }))];
  const tris: StructTri[] = [];
  for (let t = 0; t < mesh.index.length; t += 3) tris.push({ ids: [ids[mesh.index[t]!]!, ids[mesh.index[t + 1]!]!, ids[mesh.index[t + 2]!]!], partId });
  return { nodes, beams, tris, warnings };
}

/** Beyond this gap (m) a part is "far from its parent": attachment is minimal and a warning is raised. */
export const FAR_FROM_PARENT = 0.3;

/** Smallest distance between any child node and any parent node. */
export function parentGap(child: readonly StructNode[], parent: readonly StructNode[]): number {
  let best = Infinity;
  for (const c of child) for (const p of parent) best = Math.min(best, Math.hypot(c.pos[0] - p.pos[0], c.pos[1] - p.pos[1], c.pos[2] - p.pos[2]));
  return best;
}

/** Shortest attachment beam (m). */
export const MIN_ATTACH_LENGTH = 0.02;

/**
 * Attachment beams from a child part to its parent's nodes (SPEC §4.4):
 * child nodes near the parent get `links` beams each to their nearest parent
 * nodes. Openable parts get none (their hinges attach them, Phase 9).
 */
export function attachToParent(child: readonly StructNode[], parent: readonly StructNode[], style: AttachmentStyle, partId: string, maxBeams = 150): StructBeam[] {
  if (!child.length || !parent.length) return [];
  const { links } = ATTACHMENT_VALUES[style];
  const d = (a: StructNode, b: StructNode) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
  const nearestDist = child.map((c) => Math.min(...parent.map((p) => d(c, p))));
  const sorted = [...nearestDist].sort((x, y) => x - y);
  // Nodes within reach of the parent (≤ 0.15 m, or 1.5× the closest gap when the part sits slightly off),
  // at least 3. A part far from its parent (> FAR_FROM_PARENT) only hangs on its 3 nearest nodes.
  const gap = sorted[0] ?? 0;
  const reach = gap > FAR_FROM_PARENT ? -1 : Math.max(0.15, gap * 1.5);
  let chosen = child.map((c, i) => ({ c, dist: nearestDist[i]! })).filter((x) => x.dist <= reach);
  if (chosen.length < 3) chosen = child.map((c, i) => ({ c, dist: nearestDist[i]! })).sort((x, y) => x.dist - y.dist).slice(0, 3);
  const out: StructBeam[] = [];
  const seen = new Set<string>();
  for (const { c } of chosen) {
    // A beam of a few millimetres has no clear direction and shakes in the game: nodes that close are skipped.
    const nearest = [...parent].filter((x) => d(c, x) >= MIN_ATTACH_LENGTH).sort((x, y) => d(c, x) - d(c, y)).slice(0, links);
    for (const p of nearest) {
      const key = `${c.id}|${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id1: c.id, id2: p.id, partId, kind: 'attach' });
      if (out.length >= maxBeams) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------- stability predictor

export const STABILITY_DT = 1 / 2000;
/** ω·Δt limits calibrated on official content (docs/proxy-generation.md). */
export const STABILITY_OK = 2.5;
export const STABILITY_UNSTABLE = 4;

export type StabilityVerdict = 'ok' | 'marginal' | 'unstable';

export interface StabilityOffender {
  nodeId: string;
  ratio: number;
  weight: number;
  springSum: number;
  message: string;
}

export interface StabilityReport {
  verdict: StabilityVerdict;
  worst: number;
  offenders: StabilityOffender[];
}

export interface SpringLookup {
  /** Spring (N/m) of a beam, from its part's preset / attachment style. */
  spring(beam: StructBeam): number;
}

const si = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

/** Per node ω·Δt with ω = √(Σ incident spring / weight). Worst first. */
export function predictStability(nodes: readonly StructNode[], beams: readonly StructBeam[], springs: SpringLookup): StabilityReport {
  const sum = new Map<string, number>();
  for (const b of beams) {
    const k = springs.spring(b);
    sum.set(b.id1, (sum.get(b.id1) ?? 0) + k);
    sum.set(b.id2, (sum.get(b.id2) ?? 0) + k);
  }
  const offenders: StabilityOffender[] = [];
  let worst = 0;
  for (const node of nodes) {
    const k = sum.get(node.id) ?? 0;
    const ratio = Math.sqrt(k / node.weight) * STABILITY_DT;
    worst = Math.max(worst, ratio);
    if (ratio > STABILITY_OK) {
      const safeMass = k * (STABILITY_DT / STABILITY_OK) ** 2;
      offenders.push({ nodeId: node.id, ratio, weight: node.weight, springSum: k, message: `node ${node.id} ${node.weight.toFixed(2)} kg with ~${si(k)} of beams: add mass (≥ ${safeMass.toFixed(2)} kg) or soften its beams` });
    }
  }
  offenders.sort((a, b) => b.ratio - a.ratio);
  return { verdict: worst > STABILITY_UNSTABLE ? 'unstable' : worst > STABILITY_OK ? 'marginal' : 'ok', worst, offenders };
}

/** Spring lookup from part presets and attachment styles. */
export function presetSprings(partPreset: (partId: string) => BeamPresetId | undefined, partAttachment: (partId: string) => AttachmentStyle | undefined): SpringLookup {
  return {
    spring: (b) => {
      if (b.kind === 'attach') return ATTACHMENT_VALUES[partAttachment(b.partId) ?? 'bolted'].beamSpring;
      const preset = BEAM_PRESET_VALUES[partPreset(b.partId) ?? 'panel_metal'];
      return b.kind === 'brace' ? preset.beamSpring * preset.braceSpringFactor : preset.beamSpring;
    },
  };
}

// ---------------------------------------------------------------- refNodes

/**
 * refNodes from the body's nodes (BeamNG space: +X left, +Y rear, +Z up):
 * ref near the floor centre, back behind it, left to its left, up above it,
 * leftCorner/rightCorner at the front-lower corners.
 */
export function placeRefNodes(body: readonly StructNode[]): { ref: string; back: string; left: string; up: string; leftCorner: string; rightCorner: string } | null {
  if (body.length < 6) return null;
  const xs = body.map((n) => n.pos[0]);
  const ys = body.map((n) => n.pos[1]);
  const zs = body.map((n) => n.pos[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const zLow = Math.min(...zs);
  const zHigh = Math.max(...zs);
  const nearest = (target: [number, number, number], exclude: Set<string>) => {
    let best: StructNode | null = null;
    let bd = Infinity;
    for (const n of body) {
      if (exclude.has(n.id)) continue;
      const d = Math.hypot(n.pos[0] - target[0], n.pos[1] - target[1], n.pos[2] - target[2]);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best!;
  };
  const used = new Set<string>();
  const pick = (t: [number, number, number]) => {
    const n = nearest(t, used);
    used.add(n.id);
    return n;
  };
  const span = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const ref = pick([cx, cy, zLow]);
  const back = pick([ref.pos[0], ref.pos[1] + span * 0.25, ref.pos[2]]);
  const left = pick([ref.pos[0] + span * 0.2, ref.pos[1], ref.pos[2]]);
  const up = pick([ref.pos[0], ref.pos[1], ref.pos[2] + (zHigh - zLow) * 0.5]);
  const yFront = Math.min(...ys);
  const leftCorner = pick([Math.max(...xs), yFront, zLow]);
  const rightCorner = pick([Math.min(...xs), yFront, zLow]);
  return { ref: ref.id, back: back.id, left: left.id, up: up.id, leftCorner: leftCorner.id, rightCorner: rightCorner.id };
}
