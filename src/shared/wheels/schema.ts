import { z } from 'zod';

/**
 * Tyre and wheel (rim) mods (fork). Universal parts, written under
 * vehicles/common/ so every car whose wheels take them can fit them:
 *
 *   a tyre fills a rim's tyre slot, `tire_F_<rim>x<width>` (front) and
 *   `tire_R_…` (rear), and sets the pressure wheel's tyre values;
 *   a rim fills a hub's wheel slot, `wheel_F_<lugs>` / `wheel_R_<lugs>`,
 *   sets the hub values and offers the tyre slot for its size.
 *
 * Values follow the layout of the game's common wheels; check a new tyre
 * in the game before publishing it.
 */

export const TREADS = ['road', 'sport', 'semislick', 'slick', 'allterrain', 'mud', 'winter', 'drag'] as const;
export type Tread = (typeof TREADS)[number];

export const TyreSizeSchema = z.object({
  /** Section width (mm), e.g. 225. */
  width: z.number().int().min(100).max(500),
  /** Sidewall height as a share of the width (%), e.g. 45. */
  aspect: z.number().int().min(15).max(100),
  /** Rim diameter (inches), e.g. 17. */
  rim: z.number().int().min(10).max(26),
  /** Rim width it fits (inches), e.g. 8. */
  rimWidth: z.number().min(3).max(15),
});
export type TyreSize = z.infer<typeof TyreSizeSchema>;

export const TyreSpecSchema = z.object({
  name: z.string().min(1).max(80),
  sizes: z.array(TyreSizeSchema).min(1).max(40),
  /** Which axles' slots it fills. */
  axles: z.enum(['both', 'F', 'R']),
  tread: z.enum(TREADS),
  pressureFront: z.number().min(5).max(120),
  pressureRear: z.number().min(5).max(120),
  frictionCoef: z.number().min(0.1).max(3),
  slidingFrictionCoef: z.number().min(0.1).max(3),
  noLoadCoef: z.number().min(0.1).max(4),
  fullLoadCoef: z.number().min(0.05).max(3),
  loadSensitivitySlope: z.number().min(0).max(0.01),
  treadCoef: z.number().min(0).max(3),
  softnessCoef: z.number().min(0).max(2),
  numRays: z.number().int().min(8).max(40),
  /** Weight of each tread node (kg). */
  nodeWeight: z.number().min(0.05).max(5),
  sideSpring: z.number().min(0),
  sideDamp: z.number().min(0),
  treadSpring: z.number().min(0),
  treadDamp: z.number().min(0),
  peripherySpring: z.number().min(0),
  peripheryDamp: z.number().min(0),
  /** Price in the parts menu. */
  value: z.number().min(0).max(1_000_000),
});
export type TyreSpec = z.infer<typeof TyreSpecSchema>;

export const RimSpecSchema = z.object({
  name: z.string().min(1).max(80),
  /** Diameter and width (inches). */
  diameter: z.number().int().min(10).max(26),
  width: z.number().min(3).max(15),
  lugs: z.number().int().min(3).max(10),
  axles: z.enum(['both', 'F', 'R']),
  /** Offset of the mounting face from the rim's centre (mm; positive pushes the wheel in). */
  offsetMm: z.number().min(-100).max(100),
  hubNodeWeight: z.number().min(0.05).max(10),
  hubBeamSpring: z.number().min(0),
  hubBeamDamp: z.number().min(0),
  value: z.number().min(0).max(1_000_000),
});
export type RimSpec = z.infer<typeof RimSpecSchema>;

/** Grip and feel per kind of tread, modelled on the game's tyre families. */
export const TREAD_PRESETS: Record<Tread, { label: string; hint: string } & Pick<TyreSpec, 'frictionCoef' | 'slidingFrictionCoef' | 'noLoadCoef' | 'fullLoadCoef' | 'loadSensitivitySlope' | 'treadCoef' | 'softnessCoef'>> = {
  road: { label: 'Road', hint: 'Everyday tyres: quiet, forgiving', frictionCoef: 1.0, slidingFrictionCoef: 0.7, noLoadCoef: 1.5, fullLoadCoef: 0.4, loadSensitivitySlope: 0.00021, treadCoef: 1.0, softnessCoef: 0.6 },
  sport: { label: 'Sport', hint: 'Performance road tyres', frictionCoef: 1.08, slidingFrictionCoef: 0.72, noLoadCoef: 1.58, fullLoadCoef: 0.44, loadSensitivitySlope: 0.0002, treadCoef: 0.8, softnessCoef: 0.5 },
  semislick: { label: 'Semi-slick', hint: 'Track days: road legal, little tread', frictionCoef: 1.15, slidingFrictionCoef: 0.74, noLoadCoef: 1.64, fullLoadCoef: 0.47, loadSensitivitySlope: 0.00019, treadCoef: 0.45, softnessCoef: 0.45 },
  slick: { label: 'Slick', hint: 'Racing, dry tarmac only', frictionCoef: 1.24, slidingFrictionCoef: 0.76, noLoadCoef: 1.7, fullLoadCoef: 0.5, loadSensitivitySlope: 0.00018, treadCoef: 0, softnessCoef: 0.4 },
  allterrain: { label: 'All-terrain', hint: 'Road and gravel', frictionCoef: 0.96, slidingFrictionCoef: 0.7, noLoadCoef: 1.45, fullLoadCoef: 0.4, loadSensitivitySlope: 0.00022, treadCoef: 1.3, softnessCoef: 0.7 },
  mud: { label: 'Mud', hint: 'Deep tread for mud and sand', frictionCoef: 0.9, slidingFrictionCoef: 0.68, noLoadCoef: 1.4, fullLoadCoef: 0.38, loadSensitivitySlope: 0.00023, treadCoef: 1.7, softnessCoef: 0.8 },
  winter: { label: 'Winter', hint: 'Soft compound, sipes for snow', frictionCoef: 0.94, slidingFrictionCoef: 0.7, noLoadCoef: 1.48, fullLoadCoef: 0.4, loadSensitivitySlope: 0.00022, treadCoef: 1.2, softnessCoef: 0.75 },
  drag: { label: 'Drag radial', hint: 'Soft sidewalls, huge grip in a straight line', frictionCoef: 1.3, slidingFrictionCoef: 0.78, noLoadCoef: 1.75, fullLoadCoef: 0.5, loadSensitivitySlope: 0.00017, treadCoef: 0.2, softnessCoef: 1.0 },
};

export function defaultTyre(name: string): TyreSpec {
  return {
    name,
    sizes: [{ width: 225, aspect: 45, rim: 17, rimWidth: 8 }],
    axles: 'both',
    pressureFront: 32,
    pressureRear: 32,
    ...pickTread('sport'),
    numRays: 24,
    nodeWeight: 0.24,
    sideSpring: 40_000,
    sideDamp: 25,
    treadSpring: 180_000,
    treadDamp: 30,
    peripherySpring: 150_000,
    peripheryDamp: 30,
    value: 450,
  };
}

export function pickTread(t: Tread): Pick<TyreSpec, 'tread' | 'frictionCoef' | 'slidingFrictionCoef' | 'noLoadCoef' | 'fullLoadCoef' | 'loadSensitivitySlope' | 'treadCoef' | 'softnessCoef'> {
  const { label: _l, hint: _h, ...values } = TREAD_PRESETS[t];
  return { tread: t, ...values };
}

export function defaultRim(name: string): RimSpec {
  return { name, diameter: 17, width: 8, lugs: 5, axles: 'both', offsetMm: 35, hubNodeWeight: 1.3, hubBeamSpring: 800_000, hubBeamDamp: 40, value: 900 };
}

/** Outer radius of a tyre (m): half the rim plus the sidewall. */
export function tyreRadius(s: TyreSize): number {
  return (s.rim * 25.4) / 2000 + (s.width * s.aspect) / 100 / 1000;
}

/** "225/45R17" */
export function sizeLabel(s: TyreSize): string {
  return `${s.width}/${s.aspect}R${s.rim}`;
}

/** The game's slot a tyre of this size fills on an axle ("tire_F_17x8"). */
export function tyreSlot(axle: 'F' | 'R', rim: number, rimWidth: number): string {
  return `tire_${axle}_${rim}x${Number.isInteger(rimWidth) ? rimWidth : rimWidth.toFixed(1)}`;
}

/** The slot a rim fills ("wheel_F_5"). */
export function rimSlot(axle: 'F' | 'R', lugs: number): string {
  return `wheel_${axle}_${lugs}`;
}
