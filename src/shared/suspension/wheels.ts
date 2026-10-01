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
      found.set(side, { side, centre: [mid[0] + offset[0], mid[1] + offset[1], mid[2] + offset[2]], axis: [(d[0] / len) * s, (d[1] / len) * s, (d[2] / len) * s] });
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
