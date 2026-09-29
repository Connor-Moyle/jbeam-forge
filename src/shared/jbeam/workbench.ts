import { NODE_ID, type Part, type Project, type RowOptions, type StructNode, type StructTri } from '../project/schema';
import { beamKey, mirrorPartners } from '../structure/edit';

/**
 * The JBeam workspace's operations (fork): exact edits of nodes, beams and
 * triangles, logical node naming, bulk adjustments and structure checks.
 * Pure functions over the document, run inside undoable commands.
 */

type Vec3 = [number, number, number];
type Doc = Pick<Project, 'nodes' | 'beams' | 'tris' | 'proxy'>;

const round = (v: number) => Math.round(v * 1e5) / 1e5;

/** A triangle's identity: its nodes in any order. */
export function triKey(ids: readonly string[]): string {
  return [...ids].sort().join('|');
}

// ---------------------------------------------------------------- renaming

/** Why a batch of renames can't be done, or null. */
export function renameProblem(doc: Pick<Project, 'nodes'>, map: ReadonlyMap<string, string>): string | null {
  const final = new Set(doc.nodes.map((n) => map.get(n.id) ?? n.id));
  if (final.size !== doc.nodes.length) return 'Two nodes would end up with the same name.';
  for (const id of map.values()) if (!NODE_ID.test(id)) return `"${id}" isn't a valid node name (a letter first, then letters, digits and _).`;
  return null;
}

/** Rename many nodes at once (swaps allowed); every beam, triangle and reference node follows. */
export function renameNodes(doc: Doc, map: ReadonlyMap<string, string>): number {
  const problem = renameProblem(doc, map);
  if (problem) throw new Error(problem);
  const to = (id: string) => map.get(id) ?? id;
  let changed = 0;
  for (const n of doc.nodes) {
    const next = to(n.id);
    if (next !== n.id) {
      n.id = next;
      changed++;
    }
  }
  for (const b of doc.beams) {
    b.id1 = to(b.id1);
    b.id2 = to(b.id2);
  }
  for (const t of doc.tris) t.ids = t.ids.map(to) as StructTri['ids'];
  const ref = doc.proxy.refNodes;
  if (ref) for (const k of Object.keys(ref) as (keyof typeof ref)[]) ref[k] = to(ref[k]);
  return changed;
}

export type NamingOrder = 'front-back' | 'bottom-top';

export interface NamingOptions {
  /** Prefix per part id (else one is made from the part's name). */
  prefixes?: Readonly<Record<string, string>>;
  order: NamingOrder;
  /** l/r endings for mirrored pairs (BeamNG's convention). Off numbers every node. */
  sides: boolean;
  /** Start numbering at. */
  start: number;
}

export const DEFAULT_NAMING: NamingOptions = { order: 'front-back', sides: true, start: 1 };

const WORD_PREFIX: Record<string, string> = { body: 'b', hood: 'h', bonnet: 'h', trunk: 't', tailgate: 'tg', door: 'd', fender: 'fe', bumper: 'bu', roof: 'rf', glass: 'gl', windshield: 'ws', window: 'wn', mirror: 'mr', seat: 'st', wheel: 'w', tire: 'ty', engine: 'e', radiator: 'ra', exhaust: 'ex', spoiler: 'sp', wing: 'wg', skirt: 'sk', grille: 'gr', light: 'l', headlight: 'hl', taillight: 'tl', frame: 'f', subframe: 'sf', chassis: 'f', steering: 'sw', dashboard: 'db' };

/** A short prefix for a part's nodes: "hood" → h, "door_FL" → dfl, "rear_bumper" → rbu. */
export function suggestPrefix(part: Pick<Part, 'name' | 'taxonomyId' | 'position'>): string {
  const words = (part.taxonomyId || part.name).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let p = words.map((w, i) => WORD_PREFIX[w] ?? (i === words.length - 1 ? w.slice(0, 2) : w[0])).join('');
  if (part.position) p += part.position.toLowerCase();
  p = p.replace(/[^a-z]/g, '').slice(0, 6);
  return p || 'n';
}

/**
 * Logical names for a part's nodes, the way BeamNG's own cars are written:
 * a prefix, a number that grows front to back (or bottom to top), and l/r
 * for the two sides of a mirrored pair ("h1l", "h1r", centre nodes "h1").
 * Returns old → new for the nodes whose name changes.
 */
export function logicalNames(doc: Pick<Project, 'nodes' | 'parts'>, partIds: readonly string[], opts: NamingOptions = DEFAULT_NAMING): Map<string, string> {
  const map = new Map<string, string>();
  const renaming = new Set(partIds);
  // Names that stay (nodes of other parts) can't be taken.
  const kept = new Set(doc.nodes.filter((n) => !renaming.has(n.partId)).map((n) => n.id));
  // Parts that share a prefix (a left and a right headlight) are named as one set, so their
  // mirrored nodes pair up: hl1l on the left light, hl1r on the right.
  const groups = new Map<string, StructNode[]>();
  for (const partId of partIds) {
    const part = doc.parts.find((p) => p.id === partId);
    const nodes = doc.nodes.filter((n) => n.partId === partId);
    if (!part || !nodes.length) continue;
    let prefix = (opts.prefixes?.[partId] ?? suggestPrefix(part)).replace(/[^A-Za-z0-9_]/g, '') || 'n';
    if (!/^[A-Za-z]/.test(prefix)) prefix = `n${prefix}`;
    groups.set(prefix, [...(groups.get(prefix) ?? []), ...nodes]);
  }
  const sortKey = (n: StructNode): [number, number, number] => (opts.order === 'front-back' ? [n.pos[1], n.pos[2], -Math.abs(n.pos[0])] : [n.pos[2], n.pos[1], -Math.abs(n.pos[0])]);
  const cmp = (a: StructNode, b: StructNode) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.id.localeCompare(b.id);
  };
  const keptUses = (p: string) => [...kept].some((id) => new RegExp(`^${p}\\d+[lr]?$`).test(id));
  const usedPrefixes = new Set<string>();
  for (const [wanted, nodes] of groups) {
    // A prefix whose names other parts keep gets a letter more (h → ha, hb…).
    let prefix = wanted;
    for (let i = 0; (keptUses(prefix) || usedPrefixes.has(prefix) || (prefix !== wanted && groups.has(prefix))) && i < 26; i++) prefix = `${wanted}${String.fromCharCode(97 + i)}`;
    usedPrefixes.add(prefix);
    let i = opts.start;
    if (opts.sides) {
      const partners = mirrorPartners(nodes);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const done = new Set<string>();
      for (const n of [...nodes].sort(cmp)) {
        if (done.has(n.id)) continue;
        const twin = partners.get(n.id);
        const num = i++;
        if (twin) {
          const left = n.pos[0] >= 0 ? n : byId.get(twin)!;
          const right = left === n ? byId.get(twin)! : n;
          map.set(left.id, `${prefix}${num}l`);
          map.set(right.id, `${prefix}${num}r`);
          done.add(left.id).add(right.id);
        } else {
          // Unpaired: on the centre line it has no ending, otherwise its side's.
          const side = Math.abs(n.pos[0]) < 0.002 ? '' : n.pos[0] > 0 ? 'l' : 'r';
          map.set(n.id, `${prefix}${num}${side}`);
          done.add(n.id);
        }
      }
    } else {
      for (const n of [...nodes].sort(cmp)) map.set(n.id, `${prefix}${i++}`);
    }
  }
  for (const [from, to] of [...map]) if (from === to) map.delete(from);
  return map;
}

/** Find-and-replace in node names ("dr" → "door"); only names that change, and only valid results. */
export function replaceInNames(doc: Pick<Project, 'nodes'>, ids: readonly string[], find: string, replace: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!find) return map;
  const want = new Set(ids);
  for (const n of doc.nodes) {
    if (!want.has(n.id)) continue;
    const next = n.id.split(find).join(replace);
    if (next !== n.id) map.set(n.id, next);
  }
  return map;
}

// ---------------------------------------------------------------- options

export type RowTarget = 'node' | 'beam' | 'tri';

function rowsOf(doc: Doc, target: RowTarget, keys: readonly string[]): { options?: RowOptions }[] {
  const want = new Set(keys);
  if (target === 'node') return doc.nodes.filter((n) => want.has(n.id));
  if (target === 'beam') return doc.beams.filter((b) => want.has(beamKey(b.id1, b.id2)));
  return doc.tris.filter((t) => want.has(triKey(t.ids)));
}

/** Set (or with null, clear) one jbeam property on every picked row. Returns how many changed. */
export function setRowOption(doc: Doc, target: RowTarget, keys: readonly string[], key: string, value: number | string | boolean | null): number {
  let changed = 0;
  for (const row of rowsOf(doc, target, keys)) {
    if (value === null) {
      if (!row.options || !(key in row.options)) continue;
      const { [key]: _gone, ...rest } = row.options;
      row.options = Object.keys(rest).length ? rest : undefined;
      if (!row.options) delete row.options;
    } else {
      if (row.options?.[key] === value) continue;
      row.options = { ...row.options, [key]: value };
    }
    changed++;
  }
  return changed;
}

/** Multiply a numeric property (set on the rows, else `base(row)`) on every picked row. */
export function scaleRowOption(doc: Doc, target: RowTarget, keys: readonly string[], key: string, factor: number, base: (row: unknown) => number | undefined): number {
  let changed = 0;
  for (const row of rowsOf(doc, target, keys)) {
    const cur = typeof row.options?.[key] === 'number' ? (row.options[key]) : base(row);
    if (cur === undefined || !Number.isFinite(cur)) continue;
    row.options = { ...row.options, [key]: Math.round(cur * factor * 1000) / 1000 };
    changed++;
  }
  return changed;
}

/** Remove every hand-set property from the picked rows. */
export function clearRowOptions(doc: Doc, target: RowTarget, keys: readonly string[]): number {
  let changed = 0;
  for (const row of rowsOf(doc, target, keys))
    if (row.options) {
      delete row.options;
      changed++;
    }
  return changed;
}

// ---------------------------------------------------------------- triangles and beams

/** A triangle through three nodes (the first node's part). Null when it exists or the nodes are wrong. */
export function addTriangle(doc: Doc, ids: readonly string[]): string | null {
  if (ids.length !== 3 || new Set(ids).size !== 3) return null;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const nodes = ids.map((id) => byId.get(id));
  if (nodes.some((n) => !n)) return null;
  const key = triKey(ids);
  if (doc.tris.some((t) => triKey(t.ids) === key)) return null;
  doc.tris.push({ ids: [ids[0]!, ids[1]!, ids[2]!], partId: nodes[0]!.partId });
  return key;
}

/** Turn triangles over (their outside becomes the inside). */
export function flipTriangles(doc: Doc, keys: readonly string[]): number {
  const want = new Set(keys);
  let n = 0;
  for (const t of doc.tris)
    if (want.has(triKey(t.ids))) {
      t.ids = [t.ids[0], t.ids[2], t.ids[1]];
      n++;
    }
  return n;
}

export function deleteTriangles(doc: Doc, keys: readonly string[]): number {
  const want = new Set(keys);
  const before = doc.tris.length;
  doc.tris = doc.tris.filter((t) => !want.has(triKey(t.ids)));
  return before - doc.tris.length;
}

/** Triangles every one of whose nodes is picked. */
export function trianglesOf(doc: Pick<Project, 'tris'>, nodeIds: readonly string[]): string[] {
  const want = new Set(nodeIds);
  return doc.tris.filter((t) => t.ids.every((id) => want.has(id))).map((t) => triKey(t.ids));
}

/** Beams both of whose nodes are picked. */
export function beamsOf(doc: Pick<Project, 'beams'>, nodeIds: readonly string[]): string[] {
  const want = new Set(nodeIds);
  return [...new Set(doc.beams.filter((b) => want.has(b.id1) && want.has(b.id2)).map((b) => beamKey(b.id1, b.id2)))];
}

export function setBeamKind(doc: Doc, keys: readonly string[], kind: Project['beams'][number]['kind']): number {
  const want = new Set(keys);
  let n = 0;
  for (const b of doc.beams)
    if (want.has(beamKey(b.id1, b.id2)) && b.kind !== kind) {
      b.kind = kind;
      n++;
    }
  return n;
}

/** Move nodes (and the beams and triangles only they make up) to another part. */
export function moveToPart(doc: Doc, ids: readonly string[], partId: string): number {
  const want = new Set(ids);
  let n = 0;
  for (const node of doc.nodes)
    if (want.has(node.id) && node.partId !== partId) {
      node.partId = partId;
      n++;
    }
  for (const b of doc.beams) if (want.has(b.id1) && want.has(b.id2)) b.partId = partId;
  for (const t of doc.tris) if (t.ids.every((id) => want.has(id))) t.partId = partId;
  return n;
}

// ---------------------------------------------------------------- positions and weights

function picked(doc: Pick<Project, 'nodes'>, ids: readonly string[]): StructNode[] {
  const want = new Set(ids);
  return doc.nodes.filter((n) => want.has(n.id));
}

function centre(nodes: readonly StructNode[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const n of nodes) for (let i = 0; i < 3; i++) c[i]! += n.pos[i]! / nodes.length;
  return c;
}

/** Move by an exact offset (metres). */
export function offsetNodes(doc: Pick<Project, 'nodes'>, ids: readonly string[], d: Vec3): void {
  for (const n of picked(doc, ids)) {
    n.pos = [round(n.pos[0] + d[0]), round(n.pos[1] + d[1]), round(n.pos[2] + d[2])];
    n.manual = true;
  }
}

/** Scale positions about the selection's centre (per axis). */
export function scaleNodes(doc: Pick<Project, 'nodes'>, ids: readonly string[], f: Vec3): void {
  const nodes = picked(doc, ids);
  const c = centre(nodes);
  for (const n of nodes) {
    n.pos = [round(c[0] + (n.pos[0] - c[0]) * f[0]), round(c[1] + (n.pos[1] - c[1]) * f[1]), round(c[2] + (n.pos[2] - c[2]) * f[2])];
    n.manual = true;
  }
}

/** Line nodes up on one axis (all to their average, or to a value). */
export function alignNodes(doc: Pick<Project, 'nodes'>, ids: readonly string[], axis: 0 | 1 | 2, value?: number): void {
  const nodes = picked(doc, ids);
  const v = value ?? centre(nodes)[axis];
  for (const n of nodes) {
    const pos: Vec3 = [...n.pos];
    pos[axis] = round(v);
    n.pos = pos;
    n.manual = true;
  }
}

/** Snap positions to a grid (metres). */
export function snapNodes(doc: Pick<Project, 'nodes'>, ids: readonly string[], grid: number): void {
  if (!(grid > 0)) return;
  for (const n of picked(doc, ids)) {
    n.pos = n.pos.map((v) => round(Math.round(v / grid) * grid)) as Vec3;
    n.manual = true;
  }
}

/** Make the picked nodes exactly symmetric: each pair takes the average of the two sides. */
export function symmetrise(doc: Pick<Project, 'nodes'>, ids: readonly string[], tolerance = 0.02): number {
  const nodes = picked(doc, ids);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  let fixed = 0;
  const done = new Set<string>();
  for (const n of nodes) {
    if (done.has(n.id)) continue;
    if (Math.abs(n.pos[0]) < tolerance / 2) {
      if (n.pos[0] !== 0) {
        n.pos = [0, n.pos[1], n.pos[2]];
        fixed++;
      }
      continue;
    }
    // The nearest node on the other side, within tolerance.
    let best: StructNode | null = null;
    let bestD = tolerance;
    for (const m of doc.nodes) {
      if (m === n || done.has(m.id)) continue;
      const d = Math.hypot(m.pos[0] + n.pos[0], m.pos[1] - n.pos[1], m.pos[2] - n.pos[2]);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best || bestD === 0) continue;
    const x = round((Math.abs(n.pos[0]) + Math.abs(best.pos[0])) / 2);
    const y = round((n.pos[1] + best.pos[1]) / 2);
    const z = round((n.pos[2] + best.pos[2]) / 2);
    n.pos = [Math.sign(n.pos[0]) * x, y, z];
    const b = byId.get(best.id)!;
    b.pos = [Math.sign(b.pos[0]) * x, y, z];
    n.manual = b.manual = true;
    done.add(n.id).add(best.id);
    fixed++;
  }
  return fixed;
}

/** Spread a total mass over the picked nodes (evenly, or keeping their proportions). */
export function distributeWeight(doc: Pick<Project, 'nodes'>, ids: readonly string[], totalKg: number, keepRatio: boolean): void {
  const nodes = picked(doc, ids);
  if (!nodes.length || !(totalKg > 0)) return;
  const sum = nodes.reduce((s, n) => s + n.weight, 0);
  for (const n of nodes) n.weight = Math.max(0.01, Math.round((keepRatio && sum > 0 ? (n.weight / sum) * totalKg : totalKg / nodes.length) * 1000) / 1000);
}

export function scaleWeights(doc: Pick<Project, 'nodes'>, ids: readonly string[], factor: number): void {
  for (const n of picked(doc, ids)) n.weight = Math.max(0.01, Math.round(n.weight * factor * 1000) / 1000);
}

// ---------------------------------------------------------------- checks

export interface CheckThresholds {
  /** Beams shorter than this are suspicious (m). */
  shortBeam: number;
  /** …and longer than this (m). */
  longBeam: number;
  /** A node needs at least this many beams to hold its place. */
  minBeams: number;
  /** Two nodes closer than this are probably one (m). */
  overlap: number;
  /** A node heavier than this many times its part's average. */
  heavyFactor: number;
}

export const DEFAULT_THRESHOLDS: CheckThresholds = { shortBeam: 0.01, longBeam: 2.5, minBeams: 3, overlap: 0.002, heavyFactor: 10 };

export type IssueKind = 'missing-node' | 'loose-node' | 'duplicate-beam' | 'zero-beam' | 'short-beam' | 'long-beam' | 'overlap' | 'bad-triangle' | 'duplicate-triangle' | 'heavy-node' | 'asymmetric';

export interface Issue {
  kind: IssueKind;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodes: string[];
  beams: string[];
  tris: string[];
}

export const ISSUE_TEXT: Record<IssueKind, string> = {
  'missing-node': 'Uses a node that doesn’t exist',
  'loose-node': 'Too few beams to hold its place',
  'duplicate-beam': 'The same beam twice',
  'zero-beam': 'A beam with no length',
  'short-beam': 'A very short beam (can shake)',
  'long-beam': 'A very long beam',
  overlap: 'Nodes on top of each other',
  'bad-triangle': 'A triangle with a repeated or missing node',
  'duplicate-triangle': 'The same triangle twice',
  'heavy-node': 'Much heavier than its neighbours',
  asymmetric: 'No partner on the other side',
};

/** Everything that looks wrong in the structure, worst first. */
export function checkStructure(doc: Pick<Project, 'nodes' | 'beams' | 'tris'>, t: CheckThresholds = DEFAULT_THRESHOLDS, partIds?: ReadonlySet<string>): Issue[] {
  const out: Issue[] = [];
  const nodes = partIds ? doc.nodes.filter((n) => partIds.has(n.partId)) : doc.nodes;
  const beams = partIds ? doc.beams.filter((b) => partIds.has(b.partId)) : doc.beams;
  const tris = partIds ? doc.tris.filter((x) => partIds.has(x.partId)) : doc.tris;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const add = (kind: IssueKind, severity: Issue['severity'], message: string, sel: Partial<Pick<Issue, 'nodes' | 'beams' | 'tris'>>) => out.push({ kind, severity, message, nodes: sel.nodes ?? [], beams: sel.beams ?? [], tris: sel.tris ?? [] });

  const degree = new Map<string, number>();
  const seenBeams = new Map<string, number>();
  for (const b of doc.beams) {
    degree.set(b.id1, (degree.get(b.id1) ?? 0) + 1);
    degree.set(b.id2, (degree.get(b.id2) ?? 0) + 1);
  }
  for (const b of beams) {
    const key = beamKey(b.id1, b.id2);
    const a = byId.get(b.id1);
    const c = byId.get(b.id2);
    if (!a || !c) {
      add('missing-node', 'error', `${b.id1}–${b.id2}: ${!a ? b.id1 : b.id2} doesn’t exist`, { beams: [key] });
      continue;
    }
    const kindKey = `${key}|${b.kind}`;
    seenBeams.set(kindKey, (seenBeams.get(kindKey) ?? 0) + 1);
    if (seenBeams.get(kindKey) === 2) add('duplicate-beam', 'warning', `${b.id1}–${b.id2} is there twice`, { beams: [key], nodes: [b.id1, b.id2] });
    const len = Math.hypot(a.pos[0] - c.pos[0], a.pos[1] - c.pos[1], a.pos[2] - c.pos[2]);
    if (len < 1e-5) add('zero-beam', 'error', `${b.id1}–${b.id2} has no length`, { beams: [key], nodes: [b.id1, b.id2] });
    else if (len < t.shortBeam) add('short-beam', 'warning', `${b.id1}–${b.id2} is ${(len * 1000).toFixed(1)} mm`, { beams: [key], nodes: [b.id1, b.id2] });
    else if (len > t.longBeam) add('long-beam', 'info', `${b.id1}–${b.id2} is ${len.toFixed(2)} m`, { beams: [key], nodes: [b.id1, b.id2] });
  }
  for (const n of nodes) {
    const d = degree.get(n.id) ?? 0;
    if (d < t.minBeams) add('loose-node', d === 0 ? 'error' : 'warning', `${n.id} has ${d} beam${d === 1 ? '' : 's'}`, { nodes: [n.id] });
  }
  // Overlapping nodes: grid by the overlap distance.
  const cell = (v: number) => Math.floor(v / Math.max(t.overlap, 1e-4));
  const grid = new Map<string, StructNode[]>();
  for (const n of nodes) {
    const k = `${cell(n.pos[0])},${cell(n.pos[1])},${cell(n.pos[2])}`;
    grid.set(k, [...(grid.get(k) ?? []), n]);
  }
  const reported = new Set<string>();
  for (const n of nodes) {
    const [cx, cy, cz] = [cell(n.pos[0]), cell(n.pos[1]), cell(n.pos[2])];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const m of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (m.id <= n.id) continue;
            const key = `${n.id}|${m.id}`;
            if (reported.has(key)) continue;
            if (Math.hypot(n.pos[0] - m.pos[0], n.pos[1] - m.pos[1], n.pos[2] - m.pos[2]) < t.overlap) {
              reported.add(key);
              add('overlap', 'warning', `${n.id} and ${m.id} are in the same place`, { nodes: [n.id, m.id] });
            }
          }
  }
  const seenTris = new Set<string>();
  for (const x of tris) {
    const key = triKey(x.ids);
    if (new Set(x.ids).size < 3 || x.ids.some((id) => !byId.has(id))) {
      add('bad-triangle', 'error', `Triangle ${x.ids.join(', ')}`, { tris: [key] });
      continue;
    }
    if (seenTris.has(key)) add('duplicate-triangle', 'warning', `Triangle ${x.ids.join(', ')} is there twice`, { tris: [key], nodes: [...x.ids] });
    seenTris.add(key);
  }
  // Heavy nodes: against their part's average.
  const perPart = new Map<string, { sum: number; n: number }>();
  for (const n of nodes) {
    const p = perPart.get(n.partId) ?? { sum: 0, n: 0 };
    p.sum += n.weight;
    p.n++;
    perPart.set(n.partId, p);
  }
  for (const n of nodes) {
    const p = perPart.get(n.partId)!;
    const avg = p.sum / p.n;
    if (p.n > 3 && n.weight > avg * t.heavyFactor) add('heavy-node', 'info', `${n.id} weighs ${n.weight.toFixed(2)} kg (part average ${avg.toFixed(2)} kg)`, { nodes: [n.id] });
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Nodes off the centre line with no mirrored partner (only for parts that are symmetric overall). */
export function asymmetricNodes(doc: Pick<Project, 'nodes'>, partIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const partId of partIds) {
    const nodes = doc.nodes.filter((n) => n.partId === partId);
    const left = nodes.filter((n) => n.pos[0] > 0.002).length;
    const right = nodes.filter((n) => n.pos[0] < -0.002).length;
    if (!left || !right) continue; // a one-sided part (a door)
    const pairs = mirrorPartners(nodes);
    for (const n of nodes) if (Math.abs(n.pos[0]) >= 0.002 && !pairs.has(n.id)) out.push(n.id);
  }
  return out;
}
