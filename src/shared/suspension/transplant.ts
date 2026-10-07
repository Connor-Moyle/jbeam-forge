import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';
import { readTable } from '../jbeam/tables';
import { STABILITY_DT, STABILITY_OK } from '../proxy/derive';
import { mountsHolding } from '../proxy/hold';
import { firstSlotType, slotTypesOf } from '../jbeam/slots';

/**
 * Bringing a stock suspension's jbeam into another car. The set's parts are
 * renamed so they can't clash (parts and slot types get the mod's prefix,
 * nodes an axle prefix), moved with the meshes, and every beam that reached
 * the original car's body is re-attached to the new car's nearest body node.
 * Flexbodies point at the meshes as exported, and tuning values replace the
 * variables' defaults.
 */

export type V3 = [number, number, number];

/** The defaults of a part's variables table ($caster_F → 0…). */
export function variableDefaults(parts: Iterable<JbeamObject>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of parts) {
    const t = p.variables;
    if (!Array.isArray(t) || !Array.isArray(t[0])) continue;
    const col = t[0].map(String).indexOf('default');
    for (const row of t.slice(1)) if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[col] === 'number') out.set(row[0], row[col]);
  }
  return out;
}

/**
 * A coordinate as a number: plain numbers, a "$variable" or a "$=…" formula of numbers, variables,
 * + - * / and brackets (positions the game lets tuning move: "$=-1.147-$caster_F"). NaN when it
 * can't be worked out.
 */
export function coordinate(v: JbeamValue | undefined, vars: ReadonlyMap<string, number>): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !v.startsWith('$')) return NaN;
  const src = v.startsWith('$=') ? v.slice(2) : v;
  const tokens = src.match(/\$[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+|[-+*/()]/g) ?? [];
  if (tokens.join('') !== src.replace(/\s+/g, '')) return NaN;
  let i = 0;
  const atom = (): number => {
    const t = tokens[i++];
    if (t === '-') return -atom();
    if (t === '+') return atom();
    if (t === '(') {
      const r = sum();
      i++; // ')'
      return r;
    }
    if (t?.startsWith('$')) return vars.get(t) ?? 0;
    return t === undefined ? NaN : Number(t);
  };
  const product = (): number => {
    let r = atom();
    while (tokens[i] === '*' || tokens[i] === '/') r = tokens[i++] === '*' ? r * atom() : r / atom();
    return r;
  };
  const sum = (): number => {
    let r = product();
    while (tokens[i] === '+' || tokens[i] === '-') r = tokens[i++] === '+' ? r + product() : r - product();
    return r;
  };
  const r = sum();
  return i === tokens.length ? r : NaN;
}

/**
 * Node id → position, from a part's nodes table (rows of [id, x, y, z, …]; option objects skipped).
 * Every row counts, formula positions included (worked out with the variables' defaults): a node
 * missed here was taken for one of the original car's and renamed onto the new car's body.
 */
export function definedNodes(part: JbeamObject, vars: ReadonlyMap<string, number> = variableDefaults([part])): Map<string, V3> {
  const out = new Map<string, V3>();
  const table = part.nodes;
  if (!Array.isArray(table)) return out;
  for (const row of table.slice(1)) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || row.length < 4) continue;
    const p = [coordinate(row[1], vars), coordinate(row[2], vars), coordinate(row[3], vars)] as V3;
    out.set(row[0], p.map((c) => (Number.isFinite(c) ? c : 0)) as V3);
  }
  return out;
}

/** Node id → nodeWeight (kg), from a part's nodes table (the game's default, 25, when none is set). */
export function definedWeights(part: JbeamObject, vars: ReadonlyMap<string, number> = variableDefaults([part])): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(part.nodes)) return out;
  try {
    for (const r of readTable(part.nodes).records) {
      if (typeof r.values.id !== 'string') continue;
      const w = coordinate(r.options.nodeWeight ?? 25, vars);
      out.set(r.values.id, Number.isFinite(w) && w > 0 ? w : 25);
    }
  } catch {
    // not a table: no weights
  }
  return out;
}

/** Every string anywhere in a value (for finding node references). */
export function collectStrings(value: JbeamValue | undefined, out: Set<string>): void {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (isJbeamObject(value)) for (const v of Object.values(value)) collectStrings(v, out);
}

/** Nodes the parts use but don't define: the original car's body nodes they attach to. */
export function externalNodeRefs(parts: Record<string, JbeamObject>, vehicleNodes: ReadonlyMap<string, V3>): Record<string, V3> {
  const own = new Set<string>();
  for (const p of Object.values(parts)) for (const id of definedNodes(p).keys()) own.add(id);
  const refs = new Set<string>();
  for (const p of Object.values(parts)) {
    for (const [section, v] of Object.entries(p)) if (!['information', 'slotType', 'slots', 'slots2', 'flexbodies', 'variables', 'nodes'].includes(section)) collectStrings(v, refs);
  }
  const out: Record<string, V3> = {};
  for (const r of refs) {
    const pos = vehicleNodes.get(r);
    if (pos && !own.has(r)) out[r] = pos;
  }
  return out;
}

export interface TransplantInput {
  parts: Record<string, JbeamObject>;
  /** The root part (the suspension itself). */
  root: string;
  anchors: Record<string, V3>;
  /** Where the set moved to (the same shift as its meshes), BeamNG space. */
  offset: V3;
  /** Prefix for part names and slot types, e.g. "mymod_F_". */
  partPrefix: string;
  /** Prefix for node ids, e.g. "f_". */
  nodePrefix: string;
  /**
   * The new car's nodes the suspension can attach to. With a weight, a node too light for the
   * beams that would land on it is passed over for the next nearest.
   */
  target: readonly { id: string; pos: V3; weight?: number; /** false: another set's node (an engine's), never bolted to. */ structural?: boolean }[];
  /** Original mesh name → exported mesh name (meshes not exported are dropped from flexbodies). */
  meshNames: Readonly<Record<string, string>>;
  /** Variable name ($springheight_F…) → value to use as its default. */
  tuning: Readonly<Record<string, number>>;
  /**
   * Slots the set declares for parts it doesn't bring (an engine's transmission slot) that
   * should take another transplanted set instead: original slot type → its new slot type and part.
   */
  slotRewrites?: Readonly<Record<string, { slotType: string; part: string }>>;
  /**
   * Nodes the set uses that another transplanted set defines (an engine's mounts on the gearbox's
   * nodes): original id → that set's renamed id. Taken before the nearest-body-node attachment.
   */
  linkedNodes?: Readonly<Record<string, string>>;
  /**
   * The new car's node group for meshes that were bound to groups only the original car had (its
   * body, its radiator…). Without one, such groups are left as they were.
   */
  fallbackGroup?: string;
  /** The set's own nodes its car's body also held (the Autobello's fx0): bolted to the new body. */
  held?: readonly string[];
}

/** Node groups a set makes: groups in its nodes tables, and the wheel groups its wheels create at spawn. */
export function setGroups(parts: Record<string, JbeamObject>): Set<string> {
  const out = new Set<string>();
  const add = (g: JbeamValue | undefined) => {
    if (typeof g === 'string' && g) out.add(g);
    else if (Array.isArray(g)) for (const x of g) if (typeof x === 'string' && x) out.add(x);
  };
  for (const p of Object.values(parts)) {
    // Groups come as option rows ({"group": …}) or on a node's own row (["rh1r", x, y, z, {"group": …}]):
    // missing the second re-pinned meshes on those groups to the body, and they stretched.
    if (Array.isArray(p.nodes))
      for (const row of p.nodes) {
        if (isJbeamObject(row)) add(row.group);
        else if (Array.isArray(row)) for (const cell of row) if (isJbeamObject(cell)) add(cell.group);
      }
    for (const section of ['pressureWheels', 'hubWheels', 'wheels']) {
      const table = p[section];
      if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
      const h = table[0].map(String);
      for (const row of table.slice(1)) {
        if (isJbeamObject(row)) {
          add(row.group);
          add(row.hubGroup);
        } else if (Array.isArray(row)) for (const k of ['group', 'hubGroup']) if (h.includes(k)) add(row[h.indexOf(k)]);
      }
    }
  }
  return out;
}

/** Point rewritten slots at their new slot type and default part. */
function rewriteSlots(table: JbeamValue, rewrites: Readonly<Record<string, { slotType: string; part: string }>>): JbeamValue {
  if (!Array.isArray(table) || !Array.isArray(table[0])) return table;
  const h = (table[0]).map(String);
  const typeCol = h.includes('name') ? h.indexOf('name') : h.indexOf('type');
  const defCol = h.indexOf('default');
  const allowCol = h.indexOf('allowTypes');
  return table.map((row, i) => {
    if (i === 0 || !Array.isArray(row) || typeof row[typeCol] !== 'string') return row;
    const r = rewrites[row[typeCol]];
    if (!r) return row;
    return row.map((c, j) => (j === typeCol ? r.slotType : j === defCol ? r.part : j === allowCol && Array.isArray(c) ? [r.slotType] : c));
  });
}

export interface TransplantResult {
  parts: Record<string, JbeamObject>;
  rootPart: string;
  rootSlotType: string;
  /** Original body node → the new car's node it now attaches to. */
  attached: Record<string, string>;
  warnings: string[];
}

/**
 * How far points spread out of their best-fitting plane (m): the root of the covariance's smallest
 * eigenvalue. Meshes on groups under FLAT failed to load in the game ("VY node not found"); the
 * ones that loaded were about 5 cm or more.
 */
export function thickness(points: readonly V3[]): number {
  if (points.length < 4) return 0;
  const c = [0, 1, 2].map((k) => points.reduce((s, p) => s + p[k]!, 0) / points.length);
  const m = [0, 1, 2].map((a) => [0, 1, 2].map((b) => points.reduce((s, p) => s + (p[a]! - c[a]!) * (p[b]! - c[b]!), 0) / points.length));
  const off = m[0]![1]! ** 2 + m[0]![2]! ** 2 + m[1]![2]! ** 2;
  const q = (m[0]![0]! + m[1]![1]! + m[2]![2]!) / 3;
  const p = Math.sqrt(((m[0]![0]! - q) ** 2 + (m[1]![1]! - q) ** 2 + (m[2]![2]! - q) ** 2 + 2 * off) / 6);
  if (p < 1e-12) return Math.sqrt(Math.max(0, q));
  const b = m.map((row, i) => row.map((v, j) => (v - (i === j ? q : 0)) / p));
  const det = b[0]![0]! * (b[1]![1]! * b[2]![2]! - b[1]![2]! * b[2]![1]!) - b[0]![1]! * (b[1]![0]! * b[2]![2]! - b[1]![2]! * b[2]![0]!) + b[0]![2]! * (b[1]![0]! * b[2]![1]! - b[1]![1]! * b[2]![0]!);
  const phi = Math.acos(Math.max(-1, Math.min(1, det / 2))) / 3;
  return Math.sqrt(Math.max(0, q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3)));
}

const FLAT = 0.025;

/**
 * Do the points lie along one line, near enough? Their widest reach across the line through the
 * two farthest apart, under a fifth of its length. The Lansdale's panhard rod kept three nodes,
 * two of them 16 cm apart at one end of 1.3 m: the game found nothing to turn the mesh about
 * ("VY node not found").
 */
export function slender(points: readonly V3[]): boolean {
  if (points.length < 3) return true;
  let a = points[0]!;
  let b = points[1]!;
  let far = 0;
  for (const p of points)
    for (const q of points) {
      const d = dist2(p, q);
      if (d > far) {
        far = d;
        a = p;
        b = q;
      }
    }
  const length = Math.sqrt(far);
  if (length < 1e-6) return true;
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length];
  let wide = 0;
  for (const p of points) {
    const v = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const along = v[0]! * u[0]! + v[1]! * u[1]! + v[2]! * u[2]!;
    wide = Math.max(wide, Math.sqrt(Math.max(0, v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2 - along ** 2)));
  }
  return wide < Math.max(2 * FLAT, 0.2 * length);
}

/** A set's attachment point this close to a body node takes that node; farther, it's bolted on. */
const MOUNT_SNAP = 0.05;
/** The softest bolt given to a node the old body also held (N/m). */
const HELD_MIN_SPRING = 400_000;
const MOUNT_LINKS = 3;
const MOUNT_MIN_KG = 2;
const MOUNT_RIGID_KG = 5;
/** ω·Δt a bolted-on point is sized for: well inside the limit (the game's cars' median is 1.3). */
const MOUNT_RATIO = 1.5;
const MOUNT = { beamSpring: 6_000_000, beamDamp: 150, beamDeform: 120_000, beamStrength: 400_000 };

/** Distance from p to the plane through a, b and c (∞ when they're in a line). */
export function planeDistance(p: V3, a: V3, b: V3, c: V3): number {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const len = Math.hypot(n[0]!, n[1]!, n[2]!);
  if (len < 1e-9) return Infinity;
  return Math.abs(n[0]! * (p[0] - a[0]) + n[1]! * (p[1] - a[1]) + n[2]! * (p[2] - a[2])) / len;
}

const dist2 = (a: V3, b: V3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** A nodeOffset component moved by `d`: numbers add; variables and expressions get "+ d" in the game's expression form. */
export function shiftOffset(v: JbeamValue, d: number): JbeamValue {
  if (Math.abs(d) < 1e-9) return v;
  if (typeof v === 'number') return Math.round((v + d) * 1e6) / 1e6;
  if (typeof v === 'string' && v.startsWith('$=')) return `$=(${v.slice(2)}) + ${d}`;
  if (typeof v === 'string' && v.startsWith('$')) return `$=${v} + ${d}`;
  return v;
}

/** Slot rows' nodeOffset {x, y, z} (where child parts such as wheels sit) moved with the suspension. */
function shiftSlotOffsets(table: JbeamValue, offset: V3): JbeamValue {
  if (!Array.isArray(table)) return table;
  return table.map((row, i) => {
    if (i === 0 || !Array.isArray(row)) return row;
    return row.map((cell) => {
      if (!isJbeamObject(cell) || !isJbeamObject(cell.nodeOffset)) return cell;
      const o = cell.nodeOffset;
      const moved: JbeamObject = { ...o };
      (['x', 'y', 'z'] as const).forEach((axis, k) => {
        if (o[axis] !== undefined) moved[axis] = shiftOffset(o[axis], offset[k]!);
      });
      return { ...cell, nodeOffset: moved };
    });
  });
}

/** Replace every string equal to a key of `map`, anywhere in the value. */
function renameStrings(value: JbeamValue, map: ReadonlyMap<string, string>): JbeamValue {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => renameStrings(v, map));
  if (isJbeamObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameStrings(v, map)]));
  return value;
}

/**
 * The hub nodes the game's wheel parts state: front or rear, side, and the outer one doubled (fw1r,
 * fw1rr, rw1l, rw1ll). Not rw2r, rw3r and the like: those are a suspension's own (the Covet's trailing arms).
 */
const HUB_NODE = /^[fr]w1(?:l{1,2}|r{1,2})$/i;

export function transplantSuspension(input: TransplantInput): TransplantResult {
  const warnings: string[] = [];
  const partNames = new Map(Object.keys(input.parts).map((n) => [n, `${input.partPrefix}${n}`]));
  const slotTypes = new Map<string, string>();
  for (const body of Object.values(input.parts)) for (const st of slotTypesOf(body)) slotTypes.set(st, `${input.partPrefix}${st}`);
  // Parts and slot types: one map (slot types often equal part names).
  const names = new Map([...slotTypes, ...partNames]);

  const nodeIds = new Map<string, string>();
  const own = new Set<string>();
  // The hub nodes a wheel is built on (fw1r, fw1rr, rw1l…) keep their names when the set takes the
  // game's wheel parts: those parts state the same nodes again, by these names, to set the wheel's
  // offset. Renamed, an older car's set (the Covet's, the 200BX's) had two hubs a side, its arms on
  // one and the wheel between the two, and the wheel broke off at spawn.
  const takesWheelParts = Object.values(input.parts).some((p) =>
    (['slots', 'slots2'] as const).some((key) => {
      const t = p[key];
      if (!Array.isArray(t) || !Array.isArray(t[0])) return false;
      const h = t[0].map(String);
      const col = h.includes('name') ? h.indexOf('name') : h.indexOf('type');
      return t.slice(1).some((row) => Array.isArray(row) && typeof row[col] === 'string' && /^wheel_[FR](?:_|$)/i.test(row[col]));
    }),
  );
  for (const body of Object.values(input.parts))
    for (const id of definedNodes(body).keys()) {
      own.add(id);
      if (takesWheelParts && HUB_NODE.test(id)) continue;
      nodeIds.set(id, `${input.nodePrefix}${id}`);
    }
  for (const [id, to] of Object.entries(input.linkedNodes ?? {})) if (!nodeIds.has(id)) nodeIds.set(id, to);
  const groups = setGroups(input.parts);
  // Which of the set's nodes each group holds (option rows and a node's own row both count).
  const groupNodes = new Map<string, Set<string>>();
  for (const body of Object.values(input.parts)) {
    if (!Array.isArray(body.nodes)) continue;
    for (const r of readTable(body.nodes).records) {
      const g = r.options.group;
      const id = typeof r.values.id === 'string' ? r.values.id : '';
      for (const name of (Array.isArray(g) ? g : [g]).filter((x): x is string => typeof x === 'string' && x !== '')) {
        const set = groupNodes.get(name) ?? new Set<string>();
        set.add(id);
        groupNodes.set(name, set);
      }
    }
  }
  const setPositions = new Map<string, V3>();
  for (const body of Object.values(input.parts)) for (const [id, pos] of definedNodes(body)) if (!setPositions.has(id)) setPositions.set(id, pos);
  const keepGroup = (g: JbeamValue): JbeamValue => (typeof g === 'string' && input.fallbackGroup && !groups.has(g) ? input.fallbackGroup : g);

  // How much spring the set's beams put on each node it doesn't define: hydros and torsion bars too
  // (the Burnside's steering hydro pushes on its steering box points, and a light point flew off).
  const vars = variableDefaults(Object.values(input.parts));
  // The springs each of the set's own nodes already carries, from the set's own beams.
  const ownSpring = new Map<string, number>();
  const anchorSpring = new Map<string, number>();
  for (const body of Object.values(input.parts)) for (const section of ['beams', 'hydros', 'torsionbars'] as const) {
    if (!Array.isArray(body[section])) continue;
    try {
      for (const r of readTable(body[section]).records) {
        const k = coordinate(r.options.beamSpring ?? 4_300_000, vars);
        if (!(k > 0)) continue;
        for (const end of [r.values['id1:'], r.values['id2:']]) {
          if (typeof end !== 'string') continue;
          const sums = own.has(end) ? ownSpring : anchorSpring;
          sums.set(end, (sums.get(end) ?? 0) + k);
        }
      }
    } catch {
      // not a table: nothing to count
    }
  }
  // Points something twists or slides on (a torsion-hydro steering box, rails): on their own car
  // they're part of a rigid frame, so here they get a stiffer mount (the Burnside's steering box
  // points spun off three bolts).
  const rigid = new Set<string>();
  for (const body of Object.values(input.parts))
    for (const section of ['torsionHydros', 'torsionbars', 'rails', 'slidenodes'] as const) {
      const refs = new Set<string>();
      collectStrings(body[section], refs);
      for (const r of refs) if (!own.has(r)) rigid.add(r);
    }

  // The original car's body nodes → the new car's nearest node that can take them. When none is
  // close, the point stays where the set needs it, as a node of its own bolted to the nearest body
  // nodes: snapping the Autobello's front crossmember points 20-30 cm onto the two nearest body
  // nodes collapsed the arms' pivots onto each other and the car came apart.
  // A point of the old car's frame: not the set's own, and not another fitted set's.
  const onFrame = (id: JbeamValue | undefined): id is string => typeof id === 'string' && !own.has(id) && !input.linkedNodes?.[id] && input.anchors[id] !== undefined;
  // A prop hung wholly on the old car's frame belongs to that car's cabin, not to the set: a
  // transaxle's clutch pedal sits on three floor nodes by the driver's feet, 1.7 m from the gearbox
  // in a rear-engined car. Brought along, the pedal and its three points stood out in front of the
  // new car's bumper, and the points broke loose at spawn. Such props are left out.
  const propOnFrame = (header: readonly string[], row: readonly JbeamValue[]) => ['idRef:', 'idX:', 'idY:'].every((c) => header.includes(c) && onFrame(row[header.indexOf(c)]));
  // The frame points the set really uses: only those become mounting points.
  const used = new Set<string>();
  for (const body of Object.values(input.parts))
    for (const [section, v] of Object.entries(body)) {
      if (['information', 'slotType', 'slots', 'slots2', 'flexbodies', 'variables', 'nodes'].includes(section)) continue;
      if (section === 'props' && Array.isArray(v) && Array.isArray(v[0])) {
        const header = v[0].map(String);
        for (const row of v.slice(1)) if (!Array.isArray(row) || !propOnFrame(header, row)) collectStrings(row, used);
      } else collectStrings(v, used);
    }

  const attached: Record<string, string> = {};
  const extra: [string, V3, number?][] = [];
  const mounts: [string, string][] = [];
  for (const [id, pos] of Object.entries(input.anchors)) {
    if (!used.has(id)) continue;
    // A node these parts define is theirs, not the original car's: an anchor list made from other
    // parts of the set (its options) names the engine block's own nodes, and attaching those gave
    // them the names of body nodes.
    if (input.linkedNodes?.[id] || own.has(id)) continue;
    // A hub node the wheel part will bring is no part of the old body: made into a mounting point, it
    // sat at the wheel part's own coordinates (by the car's middle) with the arms beamed to it.
    if (takesWheelParts && HUB_NODE.test(id)) continue;
    const at = add(pos, input.offset);
    // A light node under stiff beams shakes the car apart: the Barstow gearbox's 20 MN/m beam to its
    // own exhaust landed on the Autobello's 0.4 kg exhaust node. Such nodes are passed over.
    const k = anchorSpring.get(id) ?? 0;
    const carries = (t: { weight?: number }) => t.weight === undefined || Math.sqrt(k / t.weight) * STABILITY_DT <= STABILITY_OK;
    let best: { id: string; d: number } | null = null;
    for (const t of input.target) {
      if (!carries(t)) continue;
      const d = dist2(at, t.pos);
      if (!best || d < best.d) best = { id: t.id, d };
    }
    if (!best)
      for (const t of input.target) {
        const d = dist2(at, t.pos);
        if (!best || d < best.d) best = { id: t.id, d };
      }
    if (best && best.d <= MOUNT_SNAP ** 2) {
      attached[id] = best.id;
      nodeIds.set(id, best.id);
    } else if (best) {
      const kept = `${input.nodePrefix}${id}`;
      nodeIds.set(id, kept);
      // Bolted to the body's structure only (a gearbox's points went onto the engine's 1 kg exhaust
      // nodes, and the exhaust fell off), and to nodes heavy enough for the bolt.
      const holds = (t: { weight?: number; structural?: boolean }) => t.structural !== false && (t.weight === undefined || Math.sqrt(MOUNT.beamSpring / t.weight) * STABILITY_DT <= MOUNT_RATIO);
      const ranked = input.target
        .filter(holds)
        .map((t) => ({ id: t.id, pos: t.pos, d: dist2(at, t.pos) }))
        .sort((a, b) => a.d - b.d);
      // Three bolts in one plane with the point don't hold it across that plane: more are added
      // until it is held every way (the Vivace's strut-tower points, bolted to three body nodes
      // nearly in line, sat 30-46 mm out at rest). A point something twists always gets a fourth.
      const near = mountsHolding(at, ranked, MOUNT_LINKS, rigid.has(id) ? MOUNT_LINKS + 1 : 0);
      const links = near.length ? near : [best];
      for (const t of links) mounts.push([kept, t.id]);
      // Heavy enough for the set's own beams on it and the mount, inside the stability limit.
      const load = k + links.length * MOUNT.beamSpring;
      extra.push([kept, at, Math.max(rigid.has(id) ? MOUNT_RIGID_KG : MOUNT_MIN_KG, Math.ceil(load * (STABILITY_DT / MOUNT_RATIO) ** 2 * 10) / 10)]);
      attached[id] = links[0]!.id;
      if (best.d > 0.3 ** 2) warnings.push(`${id} is ${Math.sqrt(best.d).toFixed(2)} m from the body's nearest node (${best.id}): check the fit or the body's structure there.`);
    } else {
      // No body structure yet: keep the attachment point as a node of the suspension.
      nodeIds.set(id, `${input.nodePrefix}${id}`);
      extra.push([`${input.nodePrefix}${id}`, at]);
    }
  }
  // The nodes that carry a wheel: every one of the set's with a beam straight to a hub node.
  const hubCarriers = new Set<string>();
  for (const body of Object.values(input.parts)) {
    if (!Array.isArray(body.beams)) continue;
    for (const row of body.beams) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') continue;
      if (HUB_NODE.test(row[0])) hubCarriers.add(row[1]);
      if (HUB_NODE.test(row[1])) hubCarriers.add(row[0]);
    }
  }
  // The set's nodes beamed to another fitted set's (a gearbox's mount node to the engine block):
  // how many such beams each has.
  const loose = new Set(input.target.filter((t) => t.structural === false).map((t) => t.id));
  const ofOtherSet = (id: string) => !own.has(id) && (!!input.linkedNodes?.[id] || (attached[id] !== undefined && loose.has(attached[id])));
  const onOtherSet = new Map<string, number>();
  for (const body of Object.values(input.parts)) {
    if (!Array.isArray(body.beams)) continue;
    for (const row of body.beams) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') continue;
      for (const [x, y] of [[row[0], row[1]], [row[1], row[0]]] as const) if (own.has(x) && ofOtherSet(y)) onOtherSet.set(x, (onOtherSet.get(x) ?? 0) + 1);
    }
  }
  // Nodes the old body also held: bolted to the new one, with springs their weight can carry.
  const heldMounts: { node: string; to: string[]; spring: number }[] = [];
  const weights = new Map<string, number>();
  for (const body of Object.values(input.parts)) for (const [id, w] of definedWeights(body, vars)) if (!weights.has(id)) weights.set(id, w);
  for (const id of input.held ?? []) {
    const at = setPositions.get(id);
    if (!at || !own.has(id)) continue;
    // Never a hub, nor the carrier it turns in (any node beamed straight to a hub node): what the old
    // car had on those was a bump stop, a sway bar or a half-shaft, and a bolt to the body locks the
    // wheel's travel until something breaks (the Covet's rear hubs were bolted solid).
    if (HUB_NODE.test(id) || hubCarriers.has(id)) continue;
    // Nor a node that is part of the engine and gearbox block (a gearbox's mount node, beamed to
    // every corner of the engine): what held it on its own car was the engine, and the engine is
    // here. Bolted to the body as well, the whole drive line hung from that one bolt on top of its
    // rubber mounts, and the bolt broke at spawn.
    if ((onOtherSet.get(id) ?? 0) >= 3) continue;
    const p = add(at, input.offset);
    const ranked = input.target
      .filter((t) => t.structural !== false)
      .map((t) => ({ id: t.id, pos: t.pos, d: dist2(p, t.pos) }))
      .sort((a, b) => a.d - b.d);
    const near = mountsHolding(p, ranked, MOUNT_LINKS);
    const to = near.map((t) => t.id);
    if (!to.length) continue;
    const w = weights.get(id) ?? 25;
    // What its weight can carry less what the set's own beams already put on it: a subframe node
    // on a 26 MN/m lower arm, given four full bolts as well, shook until the arm broke at spawn
    // (the Bastion's, the ETK I's, the Vivace's). Never less than a bolt that still holds it.
    const room = w * (MOUNT_RATIO / STABILITY_DT) ** 2 - (ownSpring.get(id) ?? 0);
    const spring = Math.round(Math.min(MOUNT.beamSpring, Math.max(HELD_MIN_SPRING, room / to.length)));
    heldMounts.push({ node: `${input.nodePrefix}${id}`, to, spring });
  }
  if (extra.length && !mounts.length) warnings.push(`The body has no structure yet, so ${extra.length} attachment points were kept on the suspension. Generate the body, then export again.`);

  // The rails the set brings. A node that slid on a rail of the old car's (the Covet's middle
  // engine mount rides a rail across its front subframe) has none to slide on here: the game
  // wrenched it away at spawn and the mount and its bolts broke. It stays a plain mounted node.
  const rails = new Set<string>();
  for (const body of Object.values(input.parts)) if (isJbeamObject(body.rails)) for (const rail of Object.keys(body.rails)) rails.add(rail);

  const out: Record<string, JbeamObject> = {};
  for (const [name, body] of Object.entries(input.parts)) {
    const part: JbeamObject = {};
    for (const [section, value] of Object.entries(body)) {
      if (section === 'information') part[section] = value;
      // A part that fits several slots (one intake for three engines) keeps fitting each of them.
      else if (section === 'slotType') part[section] = typeof value === 'string' ? (slotTypes.get(value) ?? value) : Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? (slotTypes.get(v) ?? v) : v)) : value;
      else if (section === 'slots' || section === 'slots2') part[section] = shiftSlotOffsets(renameStrings(rewriteSlots(value, input.slotRewrites ?? {}), names), input.offset);
      else if (section === 'nodes' && Array.isArray(value)) {
        part[section] = value.map((row, i) => {
          if (i === 0 || !Array.isArray(row) || typeof row[0] !== 'string') return row;
          const [id, x, y, z, ...rest] = row;
          // Formula positions move too ("$=… + d"), or those nodes stayed where the original car had them.
          const moved = typeof x === 'number' && typeof y === 'number' && typeof z === 'number' ? add([x, y, z], input.offset) : [shiftOffset(x!, input.offset[0]), shiftOffset(y!, input.offset[1]), shiftOffset(z!, input.offset[2])];
          return [nodeIds.get(id) ?? id, ...moved, ...rest] as JbeamValue[];
        });
      } else if (section === 'flexbodies' && Array.isArray(value)) {
        part[section] = value
          .filter((row, i) => i === 0 || !Array.isArray(row) || typeof row[0] !== 'string' || input.meshNames[row[0]] !== undefined)
          .map((row, i) => {
            if (i === 0 || !Array.isArray(row) || typeof row[0] !== 'string') return row;
            const [, bound, ...rest] = row;
            let regrouped = Array.isArray(bound) ? [...new Set(bound.map(keepGroup))] : bound;
            // A mesh needs nodes around it in three dimensions to sit right. On its own car an arm's
            // group also took the frame's mount nodes (the Autobello's tie rods take body node b2),
            // which stay behind: when the set's own nodes are fewer than three or lie flat, the mesh
            // also binds to the new car's body (where those mounts now are), or the game can't
            // place it and it stretches ("VY node not found").
            if (Array.isArray(regrouped) && input.fallbackGroup && !regrouped.includes(input.fallbackGroup)) {
              const held = new Set(regrouped.flatMap((g) => (typeof g === 'string' ? [...(groupNodes.get(g) ?? [])] : [])));
              const pts = [...held].flatMap((id) => (setPositions.has(id) ? [setPositions.get(id)!] : []));
              if (held.size < 3 || (pts.length >= 3 && slender(pts)) || (pts.length >= 4 && thickness(pts) < FLAT)) regrouped = [...regrouped, input.fallbackGroup];
            }
            return [input.meshNames[row[0]]!, regrouped as JbeamValue, ...rest];
          });
      } else if (section === 'props' && Array.isArray(value) && Array.isArray(value[0])) {
        // Props move a mesh by name: renamed to the mesh as exported, or left out when it wasn't
        // ("Mesh 'bx_driveshaft' not found"). Lights (SPOTLIGHT, POINTLIGHT) have no mesh.
        const header = value[0].map(String);
        const meshCol = header.indexOf('mesh');
        const kept = value.filter((row, i) => i === 0 || !Array.isArray(row) || !propOnFrame(header, row));
        part[section] = (renameStrings(kept, nodeIds) as JbeamValue[])
          .filter((row, i) => i === 0 || meshCol < 0 || !Array.isArray(row) || typeof row[meshCol] !== 'string' || /^(SPOTLIGHT|POINTLIGHT)$/.test(row[meshCol]) || input.meshNames[row[meshCol]] !== undefined)
          .map((row, i) => (i === 0 || meshCol < 0 || !Array.isArray(row) || typeof row[meshCol] !== 'string' || !input.meshNames[row[meshCol]] ? row : row.map((c, j) => (j === meshCol ? input.meshNames[row[meshCol] as string]! : c))));
      } else if (section === 'slidenodes' && Array.isArray(value)) {
        const kept = (renameStrings(value, nodeIds) as JbeamValue[]).filter((row, i) => i === 0 || !Array.isArray(row) || typeof row[1] !== 'string' || rails.has(row[1]));
        if (kept.some((row, i) => i > 0 && Array.isArray(row))) part[section] = kept;
      } else if (section === 'variables' && Array.isArray(value)) {
        const header = Array.isArray(value[0]) ? value[0].map(String) : [];
        const col = header.indexOf('default');
        part[section] = value.map((row, i) => (i > 0 && Array.isArray(row) && typeof row[0] === 'string' && col >= 0 && input.tuning[row[0]] !== undefined ? row.map((c, j) => (j === col ? input.tuning[row[0] as string]! : c)) : row));
      } else if ((section === 'beams' || section === 'triangles') && Array.isArray(value)) {
        // Two of the original car's nodes can land on one node of the new car: a beam between them
        // is then zero length, and two beams the same ("zero size beam", "duplicated beam").
        const seen = new Set<string>();
        const n = section === 'beams' ? 2 : 3;
        // A point of the old car's frame: not the set's own, and not the gearbox's.
        const ofFrame = (id: JbeamValue | undefined) => typeof id === 'string' && !own.has(id) && !input.linkedNodes?.[id] && input.anchors[id] !== undefined;
        part[section] = (renameStrings(value, nodeIds) as JbeamValue[]).filter((row, i) => {
          if (i === 0 || !Array.isArray(row) || row.slice(0, n).some((c) => typeof c !== 'string')) return true;
          // A beam from one point of the old car's frame to another (an engine's mount brackets, a
          // subframe's braces) was part of that frame. Here both its ends are bolted to the new body
          // on their own, and it can only fight the body: the Bolide's engine brackets broke at
          // spawn and took the engine with them.
          const from = value[i];
          if (section === 'beams' && Array.isArray(from) && ofFrame(from[0]) && ofFrame(from[1])) return false;
          const ids = row.slice(0, n) as string[];
          if (new Set(ids).size < n) return false;
          const key = [...ids].sort().join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else part[section] = renameStrings(value, nodeIds);
    }
    out[partNames.get(name)!] = part;
  }
  const rootName = partNames.get(input.root) ?? input.root;
  const root = out[rootName];
  if (root && extra.length) {
    const nodes = Array.isArray(root.nodes) ? root.nodes : [['id', 'posX', 'posY', 'posZ']];
    root.nodes = [...nodes, ...extra.map(([id, p, w]) => [id, ...p, ...(w ? [{ nodeWeight: w, collision: false, selfCollision: false, group: '' }] : [])] as JbeamValue[])];
  }
  if (root && (mounts.length || heldMounts.length)) {
    const beams = Array.isArray(root.beams) ? root.beams : [['id1:', 'id2:']];
    root.beams = [
      ...beams,
      { ...MOUNT, beamType: '|NORMAL', breakGroup: '', deformGroup: '' },
      ...mounts.map(([a, b]) => [a, b] as JbeamValue[]),
      ...heldMounts.flatMap((h): JbeamValue[] => [{ beamSpring: h.spring }, ...h.to.map((b) => [h.node, b])]),
      { beamSpring: MOUNT.beamSpring },
    ];
  }
  const rootSlot = firstSlotType(input.parts[input.root]) || input.root;
  return { parts: out, rootPart: rootName, rootSlotType: slotTypes.get(rootSlot) ?? rootSlot, attached, warnings };
}

/** The tunable variables of a set (from every part's variables table). */
export interface TuningVariable {
  name: string;
  unit: string;
  category: string;
  title: string;
  description: string;
  default: number;
  min: number;
  max: number;
  step: number | null;
}

export function tuningVariables(parts: Record<string, JbeamObject>): TuningVariable[] {
  const out = new Map<string, TuningVariable>();
  for (const body of Object.values(parts)) {
    const table = body.variables;
    if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
    const h = (table[0]).map(String);
    const at = (row: JbeamValue[], k: string) => row[h.indexOf(k)];
    for (const row of table.slice(1)) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || at(row, 'type') !== 'range') continue;
      const [def, a, b] = [at(row, 'default'), at(row, 'min'), at(row, 'max')];
      if (typeof def !== 'number' || typeof a !== 'number' || typeof b !== 'number') continue;
      const opts = row.find((c) => isJbeamObject(c));
      const step = typeof opts?.stepDis === 'number' ? opts.stepDis : null;
      const text = (k: string, fallback = '') => {
        const v = at(row, k);
        return typeof v === 'string' ? v : fallback;
      };
      out.set(row[0], { name: row[0], unit: text('unit'), category: text('category'), title: text('title', row[0]), description: text('description'), default: def, min: Math.min(a, b), max: Math.max(a, b), step });
    }
  }
  return [...out.values()];
}
