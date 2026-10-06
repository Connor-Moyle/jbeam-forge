import type { JbeamObject } from '../jbeam/parse';
import { readTable } from '../jbeam/tables';
import { definedNodes, type V3 } from './transplant';

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
}

/** Every node's group (the first, when a node lists several). */
function nodeGroups(parts: Record<string, JbeamObject>): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of Object.values(parts)) {
    if (!Array.isArray(p.nodes)) continue;
    try {
      for (const r of readTable(p.nodes).records) {
        const g = Array.isArray(r.options.group) ? r.options.group[0] : r.options.group;
        if (typeof r.values.id === 'string' && typeof g === 'string' && g && !out.has(r.values.id)) out.set(r.values.id, g);
      }
    } catch {
      // not a table
    }
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
      const a = typeof n1 === 'string' ? nodes.get(n1) : undefined;
      const b = typeof n2 === 'string' ? nodes.get(n2) : undefined;
      if (!a || !b) continue;
      const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const name = typeof r.values.name === 'string' ? r.values.name : '';
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
    if (!found.has(side)) found.set(side, { side, centre: [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]], axis: [side === 'L' ? 1 : -1, 0, 0] });
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
