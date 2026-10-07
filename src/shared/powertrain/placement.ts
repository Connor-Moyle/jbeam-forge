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
