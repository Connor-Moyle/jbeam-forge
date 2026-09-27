import type { JbeamValue } from '../jbeam/parse';

/**
 * Lights (Phase 12): which of the game's electrics make a light part glow,
 * for the main part's glowMap. The meshes' material gets an "on" twin that
 * glows; the game swaps to it while the signal is on. Signal names are the
 * game's own (lua/vehicle/electrics.lua).
 */

/** The electrics that light a part, by kind and side; null = not a light. */
export function lightFunction(taxonomyId: string, position: string | null): JbeamValue | null {
  const side = position?.includes('L') ? 'L' : position?.includes('R') ? 'R' : null;
  switch (taxonomyId) {
    case 'headlight':
      return 'lowhighbeam';
    case 'taillight':
      // Dim with the lights on, bright when braking.
      return { lowhighbeam: 0.4, brakelights: 1 };
    case 'brake_light':
      return 'brakelights';
    case 'reverse_light':
      return 'reverse';
    case 'foglight':
      return 'fog';
    case 'plate_light':
      return 'lowhighbeam';
    case 'indicator':
      return side ? `signal_${side}` : 'hazard';
    case 'light_bar':
    case 'police_lights':
      return 'lightbar';
    default:
      return null;
  }
}

export const onMaterialName = (name: string) => `${name}_on`;

export interface GlowEntry {
  simpleFunction: JbeamValue;
  off: string;
  on: string;
}

/**
 * The glowMap for the mod: every material used only by light meshes, with
 * its signal. A material also on non-light meshes (the body's paint, say) is
 * left out and reported, or the whole body would light up.
 */
export function buildGlowMap(uses: readonly { material: string; light: JbeamValue | null }[]): { glowMap: Record<string, GlowEntry>; shared: string[] } {
  const byMaterial = new Map<string, JbeamValue[]>();
  const nonLight = new Set<string>();
  for (const u of uses) {
    if (u.light === null) nonLight.add(u.material);
    else byMaterial.set(u.material, [...(byMaterial.get(u.material) ?? []), u.light]);
  }
  const glowMap: Record<string, GlowEntry> = {};
  const shared: string[] = [];
  for (const [material, fns] of byMaterial) {
    if (nonLight.has(material)) {
      shared.push(material);
      continue;
    }
    // One signal per material: the first light's (a taillight and a brake light sharing one material share its signal).
    glowMap[material] = { simpleFunction: fns[0]!, off: material, on: onMaterialName(material) };
  }
  return { glowMap, shared };
}
