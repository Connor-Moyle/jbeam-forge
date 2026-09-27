import type { ConstructionMaterial, Part } from '../project/schema';
import type { BEAM_PRESETS, TaxonomyEntry } from '../taxonomy/schema';

type BeamPreset = (typeof BEAM_PRESETS)[number];

/**
 * Construction material → mass and price multipliers and beam-preset default
 * (SPEC §4.3). Relative to steel. Phase 4 uses these when generating a part's structure;
 * the user can override per part there.
 */
export const CONSTRUCTION: Record<ConstructionMaterial, { label: string; massMultiplier: number; priceMultiplier: number; panelPreset: BeamPreset | null }> = {
  steel: { label: 'Steel', massMultiplier: 1, priceMultiplier: 1, panelPreset: null },
  aluminium: { label: 'Aluminium', massMultiplier: 0.45, priceMultiplier: 1.6, panelPreset: 'panel_metal' },
  carbon: { label: 'Carbon fibre', massMultiplier: 0.3, priceMultiplier: 3, panelPreset: 'panel_plastic' },
  fibreglass: { label: 'Fibreglass', massMultiplier: 0.55, priceMultiplier: 1.3, panelPreset: 'panel_plastic' },
  plastic: { label: 'Plastic', massMultiplier: 0.4, priceMultiplier: 0.8, panelPreset: 'panel_plastic' },
};

/** Round a price the way shop prices look: $5 steps under $100, $10 under $1,000, $50 above. */
export function nicePrice(p: number): number {
  const step = p < 100 ? 5 : p < 1000 ? 10 : 50;
  return Math.round(p / step) * step;
}

/** Material-adjusted defaults for a part of this kind. Glass, tyres and mechanicals keep their own preset. */
export function materialDefaults(entry: TaxonomyEntry, material: ConstructionMaterial): { mass: number; price: number; beamPreset: BeamPreset } {
  const m = CONSTRUCTION[material];
  const panel = entry.beamPreset === 'panel_metal' || entry.beamPreset === 'panel_plastic';
  return {
    mass: Math.round(entry.defaultMass * m.massMultiplier * 100) / 100,
    price: nicePrice(entry.defaultPrice * m.priceMultiplier),
    beamPreset: panel && m.panelPreset ? m.panelPreset : entry.beamPreset,
  };
}

/** The part's in-game price: what the user typed, or the automatic one for its kind and material. */
export function partPrice(part: Pick<Part, 'price' | 'constructionMaterial'>, entry: TaxonomyEntry | undefined): number {
  if (part.price !== null) return part.price;
  return entry ? materialDefaults(entry, part.constructionMaterial).price : 0;
}
