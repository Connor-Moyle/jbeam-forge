import type { ConstructionMaterial } from '../project/schema';
import type { BEAM_PRESETS, TaxonomyEntry } from '../taxonomy/schema';

type BeamPreset = (typeof BEAM_PRESETS)[number];

/**
 * Construction material → mass multiplier and beam-preset default (SPEC §4.3).
 * Relative to steel. Phase 4 uses these when generating a part's structure;
 * the user can override per part there.
 */
export const CONSTRUCTION: Record<ConstructionMaterial, { label: string; massMultiplier: number; panelPreset: BeamPreset | null }> = {
  steel: { label: 'Steel', massMultiplier: 1, panelPreset: null },
  aluminium: { label: 'Aluminium', massMultiplier: 0.45, panelPreset: 'panel_metal' },
  carbon: { label: 'Carbon fibre', massMultiplier: 0.3, panelPreset: 'panel_plastic' },
  fibreglass: { label: 'Fibreglass', massMultiplier: 0.55, panelPreset: 'panel_plastic' },
  plastic: { label: 'Plastic', massMultiplier: 0.4, panelPreset: 'panel_plastic' },
};

/** Material-adjusted defaults for a part of this kind. Glass, tyres and mechanicals keep their own preset. */
export function materialDefaults(entry: TaxonomyEntry, material: ConstructionMaterial): { mass: number; beamPreset: BeamPreset } {
  const m = CONSTRUCTION[material];
  const panel = entry.beamPreset === 'panel_metal' || entry.beamPreset === 'panel_plastic';
  return {
    mass: Math.round(entry.defaultMass * m.massMultiplier * 100) / 100,
    beamPreset: panel && m.panelPreset ? m.panelPreset : entry.beamPreset,
  };
}
