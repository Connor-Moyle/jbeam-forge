import { z } from 'zod';

/**
 * Hinged parts (Phase 9): doors, hood, trunk, tailgate, fuel door. Modelled on
 * how the stock vehicles do it (studied on the Sunburst's front doors):
 *   - two hinge nodes on the axis, each braced rigidly to the body by
 *     breakable beams (one break group per hinge);
 *   - a |BOUNDED limiter beam from the far edge to the body whose long bound
 *     sets how far it opens;
 *   - a latch: an advancedCouplerControl auto-coupling a body node to a
 *     door node, opened by the game's own input action (door_FL, trunk…);
 *   - |SUPPORT seal beams so the closed part rests against the body, and a
 *     slightly precompressed support that pops it open when unlatched;
 *   - handles: triggers2 boxes wired to the same action.
 */

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const HingeSchema = z.object({
  id: z.string().min(1),
  partId: z.string().min(1),
  /** Hinge line, BeamNG space. */
  axis: z.tuple([Vec3, Vec3]),
  /** How far it opens, degrees. */
  openAngle: z.number().min(5).max(180),
  /** Which way it swings: +1 / −1 around the axis (a → b, right-hand rule). */
  direction: z.union([z.literal(1), z.literal(-1)]),
  /** Where the latch is (on the part's closing edge); null = no latch (always free to swing). */
  latch: Vec3.nullable(),
  /** Clickable handles that open it (outside and inside the car). */
  handles: z.array(z.object({ pos: Vec3, inside: z.boolean() })),
  /** The game's input action that opens it (door_FL, trunk, tailgate, hoodRelease…). */
  action: z.string().min(1),
  /** Hinge beams: spring (N/m), damping, and the force that tears the hinge off (N). */
  stiffness: z.number().positive(),
  damping: z.number().nonnegative(),
  strength: z.number().positive(),
  /** Latch holding force (N): a big enough hit pops it. */
  latchStrength: z.number().positive(),
  /** Shutting it latches it again. */
  autoLatch: z.boolean(),
  /** Nudge it open when unlatched. */
  popOpen: z.boolean(),
});

export type Hinge = z.infer<typeof HingeSchema>;
export type Vec3 = [number, number, number];

/** Stock-derived defaults (Sunburst front door). */
export const HINGE_DEFAULTS = { stiffness: 1_201_000, damping: 70, strength: 78_000, latchStrength: 35_000, autoLatch: true, popOpen: true } as const;

/** Game input action + coupler name per hinged part. The action opens the coupler named after it. */
export function hingeAction(taxonomyId: string, position: string | null): { action: string; coupler: string } {
  if (taxonomyId === 'door' || taxonomyId === 'sliding_door') {
    const action = position ? `door_${position}` : 'door_L';
    return { action, coupler: `${action}_coupler` };
  }
  if (taxonomyId === 'hood') return { action: 'hoodRelease', coupler: 'hoodLatchCoupler' };
  if (taxonomyId === 'trunk') return { action: 'trunk', coupler: 'trunkCoupler' };
  if (taxonomyId === 'tailgate') return { action: 'tailgate', coupler: 'tailgateCoupler' };
  return { action: `${taxonomyId}${position ? `_${position}` : ''}`, coupler: `${taxonomyId}${position ? `_${position}` : ''}_coupler` };
}

export function couplerFor(action: string): string {
  if (action === 'hoodRelease') return 'hoodLatchCoupler';
  if (action === 'trunk' || action === 'tailgate') return `${action}Coupler`;
  return `${action}_coupler`;
}

/** Default opening angle per kind (degrees). */
export function defaultOpenAngle(taxonomyId: string): number {
  return { door: 70, sliding_door: 70, hood: 70, trunk: 80, tailgate: 85, fuel_door: 90 }[taxonomyId] ?? 70;
}
