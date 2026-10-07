import { isJbeamObject, type JbeamObject } from '../jbeam/parse';
import { definedNodes, variableDefaults, type V3 } from '../suspension/transplant';

/**
 * Where an engine or gearbox set really is: the box round the nodes of its block. For an engine
 * those are the game's e1r, e1l … e4l (the block every engine is built on); for a gearbox, the
 * nodes its gearbox section names (tra1 and its like). A set's meshes say little about that, and
 * nor do all its nodes: an engine comes with its exhaust, which runs the length of its own car, and
 * placing the set by the middle of either put the block a metre ahead of the bumper.
 */
export interface BlockBounds {
  min: V3;
  max: V3;
}

/** The box round every node the set's parts define (radiator, exhaust and all). */
export function setNodeBounds(parts: Readonly<Record<string, JbeamObject>>): BlockBounds | null {
  const vars = variableDefaults(Object.values(parts));
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const part of Object.values(parts))
    for (const pos of definedNodes(part, vars).values()) {
      count++;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, pos[k]!);
        max[k] = Math.max(max[k]!, pos[k]!);
      }
    }
  return count ? { min, max } : null;
}

/** The engine block's nodes by name (e1r, e1l … e4l), where the set has them. */
export function blockNodes(parts: Readonly<Record<string, JbeamObject>>): Map<string, V3> {
  const vars = variableDefaults(Object.values(parts));
  const out = new Map<string, V3>();
  for (const part of Object.values(parts)) for (const [id, pos] of definedNodes(part, vars)) if (/^e\d+[lr]?$/i.test(id) && !out.has(id)) out.set(id, pos);
  return out;
}

/**
 * How far to move a gearbox set so it bolts to an engine: a gearbox is cut with the points of its
 * own car's engine block it was beamed to (its anchors e1r, e1l…), and those belong on the same
 * points of the engine fitted here. Null when the two share fewer than two of them.
 */
export function gearboxMating(engineBlock: ReadonlyMap<string, V3>, enginePosition: readonly [number, number, number], gearboxAnchors: Readonly<Record<string, readonly [number, number, number]>>): V3 | null {
  const shared = [...engineBlock.keys()].filter((id) => gearboxAnchors[id]);
  if (shared.length < 2) return null;
  const mean = (pick: (id: string) => readonly [number, number, number]): V3 => [0, 1, 2].map((k) => shared.reduce((s, id) => s + pick(id)[k]!, 0) / shared.length) as V3;
  const onEngine = mean((id) => engineBlock.get(id)!);
  const onGearbox = mean((id) => gearboxAnchors[id]!);
  return [onEngine[0] + enginePosition[0] - onGearbox[0], onEngine[1] + enginePosition[1] - onGearbox[1], onEngine[2] + enginePosition[2] - onGearbox[2]];
}

const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function blockBounds(parts: Readonly<Record<string, JbeamObject>>, kind: 'engine' | 'gearbox'): BlockBounds | null {
  const vars = variableDefaults(Object.values(parts));
  const all = new Map<string, V3>();
  for (const part of Object.values(parts)) for (const [id, pos] of definedNodes(part, vars)) if (!all.has(id)) all.set(id, pos);
  let ids: string[];
  if (kind === 'engine') {
    ids = [...all.keys()].filter((id) => /^e\d+[lr]?$/i.test(id));
    // An engine that names its block otherwise: the nodes its torque pushes against.
    if (ids.length < 4) ids = Object.values(parts).flatMap((p) => (isJbeamObject(p.mainEngine) ? strings(p.mainEngine['torqueReactionNodes:']) : []));
  } else {
    ids = Object.values(parts).flatMap((p) => (isJbeamObject(p.gearbox) ? strings(p.gearbox['gearboxNode:']) : []));
    if (!ids.length) ids = [...all.keys()].filter((id) => /^tra\d+[lr]?$/i.test(id));
  }
  const found = ids.map((id) => all.get(id)).filter((p): p is V3 => !!p);
  // An engine's block is a solid; a gearbox is often a single node.
  if (found.length < (kind === 'engine' ? 3 : 1)) return null;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const pos of found)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, pos[k]!);
      max[k] = Math.max(max[k]!, pos[k]!);
    }
  return { min, max };
}
