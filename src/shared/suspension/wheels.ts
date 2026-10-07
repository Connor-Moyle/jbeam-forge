import { isJbeamObject, type JbeamObject } from '../jbeam/parse';
import { readTable } from '../jbeam/tables';
import { coordinate, definedNodes, variableDefaults, type V3 } from './transplant';

/**
 * Where a fitted suspension holds its wheels. The game's hub parts declare
 * each wheel in `pressureWheels` (name "FL", "RR"…, and the two hub nodes
 * its axle runs through); the wheel is built about the middle of that axle.
 * BeamNG space: +X left, −Y front, +Z up.
 */

export type Side = 'L' | 'R';

export interface SetWheel {
  side: Side;
  /** Wheel centre, with the set's placement offset applied. */
  centre: V3;
  /** Unit vector along the axle, outward. */
  axis: V3;
  /** The node groups the game builds for this wheel: the rim's (spins) and the tyre's. */
  hubGroup?: string;
  tireGroup?: string;
  /** The group of the node the wheel's arm is (the knuckle: steers, doesn't spin), if known. */
  armGroup?: string;
  /**
   * False when the hub's two nodes aren't the set's own (most cars: the game's wheel part brings
   * them, placed by the wheel slot's nodeOffset). The centre's height and place along the car are
   * then exact, from that offset; how far out it sits depends on the wheel fitted and is a guess.
   */
  exact: boolean;
}

/** Where a wheel's centre sits outboard of its slot's offset, roughly (the hub nodes of the game's wheel parts span about 0.1 to 0.3 m out). */
const HUB_OUT = 0.15;

/** Wheel slots' nodeOffset by end (F, R): where the game puts the wheel parts' hub nodes. */
function wheelSlotOffsets(parts: Record<string, JbeamObject>): Map<string, V3> {
  const vars = variableDefaults(Object.values(parts));
  const out = new Map<string, V3>();
  for (const p of Object.values(parts))
    for (const key of ['slots', 'slots2'] as const) {
      const t = p[key];
      if (!Array.isArray(t) || !Array.isArray(t[0])) continue;
      const h = t[0].map(String);
      const col = h.includes('name') ? h.indexOf('name') : h.indexOf('type');
      for (const row of t.slice(1)) {
        if (!Array.isArray(row) || typeof row[col] !== 'string') continue;
        const m = /^wheel_([FR])(?:_|$)/i.exec(row[col]);
        const last = row[row.length - 1];
        const o = m && isJbeamObject(last) && isJbeamObject(last.nodeOffset) ? last.nodeOffset : null;
        if (!m || !o) continue;
        const [x, y, z] = [coordinate(o.x ?? 0, vars), coordinate(o.y ?? 0, vars), coordinate(o.z ?? 0, vars)];
        if (!Number.isFinite(y) || !Number.isFinite(z)) continue;
        const end = m[1]!.toUpperCase();
        if (!out.has(end)) out.set(end, [Number.isFinite(x) ? Math.abs(x) : 0.6, y, z]);
      }
    }
  return out;
}

/**
 * For every node, the group of its that a mesh can best be hung on: the one with the most of the
 * set's nodes in it, and at least three of them off one line. A node often lists several groups
 * (the knuckle's nodes are in the hub's, the strut's and the half-shaft's): the first one named was
 * sometimes two nodes, and a brake caliper hung on it stayed behind ("VY node not found").
 */
function nodeGroups(parts: Record<string, JbeamObject>): Map<string, string> {
  const of = new Map<string, string[]>();
  const members = new Map<string, V3[]>();
  const positions = setNodes(parts);
  for (const p of Object.values(parts)) {
    if (!Array.isArray(p.nodes)) continue;
    try {
      for (const r of readTable(p.nodes).records) {
        const id = r.values.id;
        if (typeof id !== 'string' || of.has(id)) continue;
        const list = (Array.isArray(r.options.group) ? r.options.group : [r.options.group]).filter((g): g is string => typeof g === 'string' && g !== '');
        of.set(id, list);
        const at = positions.get(id);
        if (at) for (const g of list) members.set(g, [...(members.get(g) ?? []), at]);
      }
    } catch {
      // not a table
    }
  }
  const holds = (g: string) => {
    const pts = members.get(g) ?? [];
    if (pts.length < 3) return false;
    const [a, b] = pts as [V3, V3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ul = Math.hypot(u[0]!, u[1]!, u[2]!) || 1;
    return pts.slice(2).some((c) => {
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const vl = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
      return Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / (ul * vl) > 0.5;
    });
  };
  const out = new Map<string, string>();
  for (const [id, list] of of) {
    const best = list.filter(holds).sort((x, y) => (members.get(y)?.length ?? 0) - (members.get(x)?.length ?? 0))[0];
    if (best) out.set(id, best);
  }
  return out;
}

/** Every node the set's parts define. */
function setNodes(parts: Record<string, JbeamObject>): Map<string, V3> {
  const out = new Map<string, V3>();
  for (const p of Object.values(parts)) for (const [id, pos] of definedNodes(p)) if (!out.has(id)) out.set(id, pos);
  return out;
}

/** The set's wheels, one per side (the first declared for each). */
export function setWheels(parts: Record<string, JbeamObject>, offset: V3 = [0, 0, 0]): SetWheel[] {
  const nodes = setNodes(parts);
  const groups = nodeGroups(parts);
  const slotOffsets = wheelSlotOffsets(parts);
  const found = new Map<Side, SetWheel>();
  for (const part of Object.values(parts)) {
    if (!Array.isArray(part.pressureWheels)) continue;
    let records;
    try {
      records = readTable(part.pressureWheels).records;
    } catch {
      continue;
    }
    for (const r of records) {
      const n1 = r.values['node1:'];
      const n2 = r.values['node2:'];
      const own1 = typeof n1 === 'string' ? nodes.get(n1) : undefined;
      const own2 = typeof n2 === 'string' ? nodes.get(n2) : undefined;
      const name = typeof r.values.name === 'string' ? r.values.name : '';
      // The hub nodes come with the game's wheel part: the wheel slot's offset is where they go.
      const slot = !own1 || !own2 ? (slotOffsets.get(name.charAt(0).toUpperCase()) ?? (slotOffsets.size === 1 ? [...slotOffsets.values()][0] : undefined)) : undefined;
      const out = /L\d*$/i.test(name) ? 1 : -1;
      const a: V3 | undefined = own1 && own2 ? own1 : slot ? [out * (slot[0] + HUB_OUT - 0.05), slot[1], slot[2]] : undefined;
      const b: V3 | undefined = own1 && own2 ? own2 : slot ? [out * (slot[0] + HUB_OUT + 0.05), slot[1], slot[2]] : undefined;
      if (!a || !b) continue;
      const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const side: Side = /L\d*$/i.test(name) ? 'L' : /R\d*$/i.test(name) ? 'R' : mid[0] >= 0 ? 'L' : 'R';
      if (found.has(side)) continue;
      const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(...d) || 1;
      // Outward: toward this side (+X on the left).
      const s = (side === 'L' ? 1 : -1) * Math.sign(d[0] || 1);
      const text = (k: string) => (typeof r.values[k] === 'string' ? (r.values[k]) : undefined);
      const arm = text('nodeArm:');
      const armGroup = arm ? groups.get(arm) : undefined;
      found.set(side, {
        side,
        centre: [mid[0] + offset[0], mid[1] + offset[1], mid[2] + offset[2]],
        axis: [(d[0] / len) * s, (d[1] / len) * s, (d[2] / len) * s],
        exact: !slot,
        ...(text('hubGroup') ? { hubGroup: text('hubGroup') } : {}),
        ...(text('group') ? { tireGroup: text('group') } : {}),
        ...(armGroup ? { armGroup } : {}),
      });
    }
  }
  if (found.size) return [...found.values()];
  // No wheel rows (an older cut): the hub nodes by the game's naming (fw1l, rw1r…).
  for (const [id, pos] of nodes) {
    const m = /^[a-z]{0,3}w1(l|r)$/i.exec(id);
    if (!m) continue;
    const side: Side = m[1]!.toLowerCase() === 'l' ? 'L' : 'R';
    if (!found.has(side)) found.set(side, { side, centre: [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]], axis: [side === 'L' ? 1 : -1, 0, 0], exact: true });
  }
  return [...found.values()];
}

/**
 * The wheels a set brings, by name (FL, FR, RL…): more than two and the set is the whole running
 * gear (a box trailer's or a utility frame's), covering both axles.
 */
/**
 * Which end's wheel parts a set takes (its wheel_F_… / wheel_R_… slots). Wheel parts make the axle's
 * wheel nodes (fw1r… or rw1r…), so two sets taking the same end's wheels clash even when their own
 * wheel names differ (a pickup's front axle and a caravan's, which takes front wheels).
 */
export function wheelSlotEnds(parts: Readonly<Record<string, JbeamObject>>): ('F' | 'R')[] {
  const ends = new Set<'F' | 'R'>();
  for (const p of Object.values(parts))
    for (const key of ['slots', 'slots2'] as const) {
      const t = p[key];
      if (!Array.isArray(t) || !Array.isArray(t[0])) continue;
      const h = t[0].map(String);
      const col = h.includes('name') ? h.indexOf('name') : h.indexOf('type');
      for (const row of t.slice(1)) {
        const m = Array.isArray(row) && typeof row[col] === 'string' ? /^wheel_([FR])(?:_|$)/i.exec(row[col]) : null;
        if (m) ends.add(m[1]!.toUpperCase() as 'F' | 'R');
      }
    }
  return [...ends];
}

export function wheelNames(parts: Readonly<Record<string, JbeamObject>>): string[] {
  const names = new Set<string>();
  for (const p of Object.values(parts))
    for (const section of ['pressureWheels', 'hubWheels', 'wheels'] as const) {
      const t = p[section];
      if (!Array.isArray(t)) continue;
      for (const r of readTable(t).records) if (typeof r.values.name === 'string') names.add(r.values.name);
    }
  return [...names];
}
