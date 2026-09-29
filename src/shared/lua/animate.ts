import type { Prop } from '../props/props';
import { outputName, type ParamDef, type ScriptTemplate } from './templates';
import type { VehicleScript } from './types';

/**
 * A template's mesh settings as animated parts (fork): each picked mesh
 * becomes a prop driven by the script's output, with a first-guess pivot
 * from its bounds. Props already made keep the pivot and axis the user
 * fine-tuned; only their range follows the settings. Meshes taken out of a
 * list lose their prop.
 */

type V3 = [number, number, number];
export interface MeshBounds {
  min: V3;
  max: V3;
}

export function pivotOf(b: MeshBounds, mode: NonNullable<ParamDef['animate']>['pivot']): V3 {
  const c: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  switch (mode) {
    case 'top':
      return [c[0], c[1], b.max[2]];
    case 'bottom':
      return [c[0], c[1], b.min[2]];
    case 'front':
      return [c[0], b.min[1], c[2]];
    case 'rear':
      return [c[0], b.max[1], c[2]];
    case 'left':
      return [b.max[0], c[1], c[2]];
    case 'right':
      return [b.min[0], c[1], c[2]];
    case 'inner':
      // The edge toward the car's centre line (BeamNG +X is the left side).
      return [c[0] >= 0 ? b.min[0] : b.max[0], c[1], c[2]];
    default:
      return c;
  }
}

const unit = (v: readonly number[]): V3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

/** The prop range for output 0–1: degrees (or metres) from `from` to `to`, mirrored for the right side. */
function range(from: number, to: number, mirrored: boolean): Pick<Prop, 'min' | 'max' | 'offset' | 'multiplier'> {
  const k = mirrored ? -1 : 1;
  const a = from * k;
  const b = to * k;
  return { offset: a, multiplier: b - a, min: Math.min(a, b), max: Math.max(a, b) };
}

/** The props of a script (by output name), after syncing to its mesh settings. */
export function syncScriptProps(t: ScriptTemplate, script: Pick<VehicleScript, 'name' | 'params'>, props: readonly Prop[], bounds: (meshKey: string) => MeshBounds | null, newId: () => string): Prop[] {
  const outputs = new Set(t.outputs.map((o) => outputName(script.name, o.suffix)));
  const wanted = new Map<string, Prop>();
  for (const p of t.params) {
    const a = p.animate;
    if (p.kind !== 'meshes' || !a) continue;
    const keys = script.params[p.id];
    if (!Array.isArray(keys)) continue;
    const func = outputName(script.name, a.output);
    const toParam = a.toParam ? script.params[a.toParam] : undefined;
    const to = typeof toParam === 'number' ? toParam : a.to;
    for (const key of keys) {
      const b = bounds(key);
      const centreX = b ? (b.min[0] + b.max[0]) / 2 : 0;
      const r = range(a.from, to, !!a.mirror && centreX < 0);
      const have = props.find((x) => x.meshKey === key && x.func === func);
      if (have) {
        wanted.set(key, { ...have, ...r });
        continue;
      }
      const pivot = b ? pivotOf(b, a.pivot) : ([0, 0, 0] as V3);
      wanted.set(key, a.motion === 'rotate' ? { id: newId(), meshKey: key, func, pivot, axis: unit(a.axis), slide: [0, 0, 0], ...r } : { id: newId(), meshKey: key, func, pivot, axis: [0, 0, 0], slide: unit(a.axis), ...r });
    }
  }
  // Other props stay; this script's props on meshes no longer listed go; a picked mesh's other prop is replaced.
  const kept = props.filter((x) => !wanted.has(x.meshKey) && !outputs.has(x.func));
  return [...kept, ...wanted.values()];
}
