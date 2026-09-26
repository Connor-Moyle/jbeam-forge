import { axesValid, loaderToBeamngMatrix, transformBox, type Box3Like } from '@shared/coords';
import type { Axis } from '@shared/project/schema';

/** Vehicle-size sanity checks for the import dialog (pure, unit-tested). */

export interface Dimensions {
  /** BeamNG Y extent (front ↔ back), metres. */
  length: number;
  /** BeamNG X extent, metres. */
  width: number;
  /** BeamNG Z extent, metres. */
  height: number;
}

export function dimensionsFor(box: Box3Like | null, up: Axis, forward: Axis, scale: number): Dimensions | null {
  if (!box || !axesValid(up, forward)) return null;
  const b = transformBox(loaderToBeamngMatrix(up, forward, scale), box);
  return { length: b.max[1] - b.min[1], width: b.max[0] - b.min[0], height: b.max[2] - b.min[2] };
}

export const SCALE_PRESETS = [
  { value: 1, label: 'Metres' },
  { value: 0.01, label: 'Centimetres' },
  { value: 0.001, label: 'Millimetres' },
  { value: 0.0254, label: 'Inches' },
  { value: 0.3048, label: 'Feet' },
] as const;

/** Vehicles in BeamNG range from carts (~1 m) to trucks and trailers (~20 m). */
const MIN_PLAUSIBLE_M = 0.8;
const MAX_PLAUSIBLE_M = 25;

export interface SizeAdvice {
  level: 'ok' | 'warning';
  message: string;
  /** A preset that would make the size plausible, when one exists. */
  suggestScale: number | null;
}

export function sizeAdvice(d: Dimensions | null, scale: number): SizeAdvice {
  if (!d) return { level: 'warning', message: 'Up and forward must be different axes.', suggestScale: null };
  const longest = Math.max(d.length, d.width, d.height);
  if (longest < MIN_PLAUSIBLE_M || longest > MAX_PLAUSIBLE_M) {
    const suggest = SCALE_PRESETS.find((p) => {
      const l = (longest / scale) * p.value;
      return p.value !== scale && l >= MIN_PLAUSIBLE_M * 1.5 && l <= MAX_PLAUSIBLE_M / 2;
    });
    const unit = suggest ? SCALE_PRESETS.find((p) => p.value === suggest.value)!.label.toLowerCase() : null;
    return {
      level: 'warning',
      message: `${longest.toFixed(2)} m is ${longest < MIN_PLAUSIBLE_M ? 'very small' : 'very large'} for a vehicle.${unit ? ` The file looks like it's in ${unit}.` : ''}`,
      suggestScale: suggest?.value ?? null,
    };
  }
  if (d.width > d.length * 1.05) return { level: 'warning', message: 'The vehicle is wider than it is long — check the forward axis.', suggestScale: null };
  if (d.height > d.length) return { level: 'warning', message: 'The vehicle is taller than it is long — check the up axis.', suggestScale: null };
  return { level: 'ok', message: 'Size looks plausible for a vehicle.', suggestScale: null };
}
