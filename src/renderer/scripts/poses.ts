import { Matrix4, Vector3 } from 'three';
import { propAmount, type Prop } from '@shared/props/props';

/**
 * A script test playing on the car: each animated part driven by a value
 * the test recorded, moved to where the game would put it (turned about its
 * pivot, or slid), in BeamNG space.
 */
export function propPose(prop: Prop, value: number): Matrix4 {
  const amount = propAmount(prop, value);
  const axis = new Vector3(...prop.axis);
  if (axis.lengthSq() > 1e-12) {
    const p = new Vector3(...prop.pivot);
    return new Matrix4()
      .makeTranslation(p.x, p.y, p.z)
      .multiply(new Matrix4().makeRotationAxis(axis.normalize(), (amount * Math.PI) / 180))
      .multiply(new Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  }
  const s = new Vector3(...prop.slide).multiplyScalar(amount);
  return new Matrix4().makeTranslation(s.x, s.y, s.z);
}

export function posesAt(props: readonly Prop[], value: (func: string) => number | undefined): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  for (const p of props) {
    const v = value(p.func);
    if (v !== undefined) out.set(p.meshKey, propPose(p, v));
  }
  return out;
}
