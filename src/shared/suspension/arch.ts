import { isJbeamObject, type JbeamObject } from '../jbeam/parse';

type V3 = readonly [number, number, number];

/** The tyre a suspension wears as the game fits it, metres. */
export interface StockTyre {
  radius: number;
  width: number;
}

/**
 * The size of the tyre in a part's wheel table: the game writes it as option rows
 * ({"radius":0.33}, {"tireWidth":0.21}) among the wheel rows.
 */
export function tyreOf(part: JbeamObject): StockTyre | null {
  const table = part.pressureWheels;
  if (!Array.isArray(table)) return null;
  let radius = 0;
  let width = 0;
  for (const row of table) {
    const options = Array.isArray(row) ? row.filter(isJbeamObject) : isJbeamObject(row) ? [row] : [];
    for (const o of options) {
      if (typeof o.radius === 'number') radius = Math.max(radius, o.radius);
      if (typeof o.tireWidth === 'number') width = Math.max(width, o.tireWidth);
    }
  }
  return radius > 0.05 && width > 0.02 ? { radius, width } : null;
}

/** A node counts as inside a tyre when it is at least this deep in it (m): a tyre brushing a wing node moves it a few millimetres and no more. */
export const TYRE_DEPTH = 0.04;

/**
 * The nodes that start well inside a tyre: within its radius of the wheel's axis and between its
 * sidewalls. The game pushes them out the moment the car spawns, and in testing a 20-inch wheel in
 * an arch made for 15 broke both wings and a suspension arm on each side.
 *
 * `wheel.centre` is the middle of the tyre where the set's jbeam says so (`exact`), and otherwise
 * the hub face the wheel bolts to, with the tyre outboard of it: there only nodes outboard of the
 * hub count, out to a tyre's width and a little more.
 */
export function nodesInTyre<T extends { pos: V3 }>(wheel: { centre: V3; axis: V3; exact?: boolean }, tyre: StockTyre, nodes: readonly T[], depth = TYRE_DEPTH): T[] {
  const l = Math.hypot(wheel.axis[0], wheel.axis[1], wheel.axis[2]) || 1;
  const u = [wheel.axis[0] / l, wheel.axis[1] / l, wheel.axis[2] / l];
  return nodes.filter((n) => {
    const v = [n.pos[0] - wheel.centre[0], n.pos[1] - wheel.centre[1], n.pos[2] - wheel.centre[2]];
    const along = v[0]! * u[0]! + v[1]! * u[1]! + v[2]! * u[2]!;
    if (wheel.exact === false ? along < 0.02 || along > tyre.width + 0.05 : Math.abs(along) > tyre.width / 2 - depth) return false;
    const out = Math.sqrt(Math.max(0, v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2 - along ** 2));
    return out <= tyre.radius - depth;
  });
}

/** Deep enough that one node alone is trouble (m). */
export const TYRE_DEEP = 0.09;

/**
 * The nodes worth a warning on one axle's wheels: any that sit deep in a tyre, or the lot when more
 * than one a side is inside. One arch-lip node a side a few centimetres in is what most bodies
 * have, and the game only nudges it.
 */
export function nodesFoulingTyres<T extends { pos: V3 }>(wheels: readonly { centre: V3; axis: V3; exact?: boolean }[], tyre: StockTyre, nodes: readonly T[]): T[] {
  const inside = wheels.map((w) => nodesInTyre(w, tyre, nodes));
  const deep = wheels.some((w) => nodesInTyre(w, tyre, nodes, TYRE_DEEP).length > 0);
  return deep || inside.some((list) => list.length > 1) ? inside.flat() : [];
}

/** What to tell the modder about one axle, or null when nothing of the car is inside its tyres. */
export function archWarning(axle: string, set: { name: string; vehicleName: string }, tyre: StockTyre, inside: readonly { part: string }[]): string | null {
  if (!inside.length) return null;
  const parts = [...new Set(inside.map((n) => n.part))].sort();
  const list = parts.length > 3 ? `${parts.slice(0, 3).join(', ')} and ${parts.length - 3} more` : parts.join(', ');
  return `${set.name} on the ${axle} axle wears the ${set.vehicleName}'s tyres (${Math.round(tyre.radius * 200)} cm across, ${Math.round(tyre.width * 100)} cm wide), and ${inside.length} node${inside.length === 1 ? '' : 's'} of ${list} ${inside.length === 1 ? 'is' : 'are'} inside them. The tyres push those out when the car spawns, which bends the part and can break it and the suspension. Choose smaller wheels in the suspension's options, narrow the track, or move those nodes out of the arch in the JBeam tab.`;
}
