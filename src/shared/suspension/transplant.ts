import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';

/**
 * Bringing a stock suspension's jbeam into another car. The set's parts are
 * renamed so they can't clash (parts and slot types get the mod's prefix,
 * nodes an axle prefix), moved with the meshes, and every beam that reached
 * the original car's body is re-attached to the new car's nearest body node.
 * Flexbodies point at the meshes as exported, and tuning values replace the
 * variables' defaults.
 */

export type V3 = [number, number, number];

/** Node id → position, from a part's nodes table (rows of [id, x, y, z, …]; option objects skipped). */
export function definedNodes(part: JbeamObject): Map<string, V3> {
  const out = new Map<string, V3>();
  const table = part.nodes;
  if (!Array.isArray(table)) return out;
  for (const row of table.slice(1)) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
    const [x, y, z] = [row[1], row[2], row[3]];
    if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') out.set(row[0], [x, y, z]);
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
  /** The new car's nodes the suspension can attach to. */
  target: readonly { id: string; pos: V3 }[];
  /** Original mesh name → exported mesh name (meshes not exported are dropped from flexbodies). */
  meshNames: Readonly<Record<string, string>>;
  /** Variable name ($springheight_F…) → value to use as its default. */
  tuning: Readonly<Record<string, number>>;
}

export interface TransplantResult {
  parts: Record<string, JbeamObject>;
  rootPart: string;
  rootSlotType: string;
  /** Original body node → the new car's node it now attaches to. */
  attached: Record<string, string>;
  warnings: string[];
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

export function transplantSuspension(input: TransplantInput): TransplantResult {
  const warnings: string[] = [];
  const partNames = new Map(Object.keys(input.parts).map((n) => [n, `${input.partPrefix}${n}`]));
  const slotTypes = new Map<string, string>();
  for (const body of Object.values(input.parts)) if (typeof body.slotType === 'string') slotTypes.set(body.slotType, `${input.partPrefix}${body.slotType}`);
  // Parts and slot types: one map (slot types often equal part names).
  const names = new Map([...slotTypes, ...partNames]);

  const nodeIds = new Map<string, string>();
  for (const body of Object.values(input.parts)) for (const id of definedNodes(body).keys()) nodeIds.set(id, `${input.nodePrefix}${id}`);

  // The original car's body nodes → the new car's nearest node.
  const attached: Record<string, string> = {};
  const extra: [string, V3][] = [];
  for (const [id, pos] of Object.entries(input.anchors)) {
    const at = add(pos, input.offset);
    let best: { id: string; d: number } | null = null;
    for (const t of input.target) {
      const d = dist2(at, t.pos);
      if (!best || d < best.d) best = { id: t.id, d };
    }
    if (best) {
      attached[id] = best.id;
      nodeIds.set(id, best.id);
      if (best.d > 0.3 ** 2) warnings.push(`${id} attaches to ${best.id}, ${Math.sqrt(best.d).toFixed(2)} m away: check the fit or the body's structure there.`);
    } else {
      // No body structure yet: keep the attachment point as a node of the suspension.
      nodeIds.set(id, `${input.nodePrefix}${id}`);
      extra.push([`${input.nodePrefix}${id}`, at]);
    }
  }
  if (extra.length) warnings.push(`The body has no structure yet, so ${extra.length} attachment points were kept on the suspension. Generate the body, then export again.`);

  const out: Record<string, JbeamObject> = {};
  for (const [name, body] of Object.entries(input.parts)) {
    const part: JbeamObject = {};
    for (const [section, value] of Object.entries(body)) {
      if (section === 'information') part[section] = value;
      else if (section === 'slotType') part[section] = typeof value === 'string' ? (slotTypes.get(value) ?? value) : value;
      else if (section === 'slots' || section === 'slots2') part[section] = shiftSlotOffsets(renameStrings(value, names), input.offset);
      else if (section === 'nodes' && Array.isArray(value)) {
        part[section] = value.map((row, i) => {
          if (i === 0 || !Array.isArray(row) || typeof row[0] !== 'string') return row;
          const [id, x, y, z, ...rest] = row;
          const moved = typeof x === 'number' && typeof y === 'number' && typeof z === 'number' ? add([x, y, z], input.offset) : [x, y, z];
          return [nodeIds.get(id) ?? id, ...moved, ...rest] as JbeamValue[];
        });
      } else if (section === 'flexbodies' && Array.isArray(value)) {
        part[section] = value.filter((row, i) => i === 0 || !Array.isArray(row) || typeof row[0] !== 'string' || input.meshNames[row[0]] !== undefined).map((row, i) => (i > 0 && Array.isArray(row) && typeof row[0] === 'string' ? [input.meshNames[row[0]]!, ...row.slice(1)] : row));
      } else if (section === 'variables' && Array.isArray(value)) {
        const header = Array.isArray(value[0]) ? value[0].map(String) : [];
        const col = header.indexOf('default');
        part[section] = value.map((row, i) => (i > 0 && Array.isArray(row) && typeof row[0] === 'string' && col >= 0 && input.tuning[row[0]] !== undefined ? row.map((c, j) => (j === col ? input.tuning[row[0] as string]! : c)) : row));
      } else part[section] = renameStrings(value, nodeIds);
    }
    out[partNames.get(name)!] = part;
  }
  const rootName = partNames.get(input.root) ?? input.root;
  const root = out[rootName];
  if (root && extra.length) {
    const nodes = Array.isArray(root.nodes) ? root.nodes : [['id', 'posX', 'posY', 'posZ']];
    root.nodes = [...nodes, ...extra.map(([id, p]) => [id, ...p] as JbeamValue[])];
  }
  const rootSlot = typeof input.parts[input.root]?.slotType === 'string' ? (input.parts[input.root]!.slotType as string) : input.root;
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
