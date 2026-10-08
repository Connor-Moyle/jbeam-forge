type V3 = readonly [number, number, number];
/** A box in the car's space (BeamNG axes). */
export interface Box {
  min: readonly number[];
  max: readonly number[];
}

/** How far a fitted engine's block may stand out of the car's own engine before it is worth a word (m). */
export const FIT_SLACK = 0.06;

export interface EngineFit {
  /** How far the block stands out of the car's own engine, metres: 0 where it fits. */
  ahead: number;
  behind: number;
  above: number;
  below: number;
  wide: number;
}

/**
 * A fitted engine's block against the room the car's own engine model takes. The car's own engine
 * is the measure of its bay: a block that stands out of it is in the bulkhead, the bonnet or the
 * radiator, and the game shoves it back at spawn (a pickup's straight-six in a small saloon broke
 * its own mounts and the exhaust manifold).
 */
export function engineFit(block: Box, placedAt: V3, own: Box): EngineFit {
  const lo = block.min.map((v, k) => v + placedAt[k]!);
  const hi = block.max.map((v, k) => v + placedAt[k]!);
  const over = (d: number) => (d > FIT_SLACK ? Math.round(d * 100) / 100 : 0);
  return {
    // BeamNG: −Y is the front of the car.
    ahead: over(own.min[1]! - lo[1]!),
    behind: over(hi[1]! - own.max[1]!),
    above: over(hi[2]! - own.max[2]!),
    below: over(own.min[2]! - lo[2]!),
    wide: over(Math.max(own.min[0]! - lo[0]!, hi[0]! - own.max[0]!)),
  };
}

/** What to tell the modder, or null when the engine fits. */
export function engineFitWarning(name: string, fit: EngineFit): string | null {
  const cm = (m: number) => `${Math.round(m * 100)} cm`;
  const out: string[] = [];
  if (fit.behind) out.push(`${cm(fit.behind)} further back`);
  if (fit.ahead) out.push(`${cm(fit.ahead)} further forward`);
  if (fit.above) out.push(`${cm(fit.above)} higher`);
  if (fit.below) out.push(`${cm(fit.below)} lower`);
  if (fit.wide) out.push(`${cm(fit.wide)} wider on one side`);
  if (!out.length) return null;
  return `${name} is bigger than your car's own engine: its block reaches ${out.join(', ')}. Where it meets the body the game pushes it back when the car spawns, which can break its mounts and what is bolted to it. Move or scale your engine model to the size of the bay, move the fitted engine in the Engine tab, or choose a smaller engine.`;
}
