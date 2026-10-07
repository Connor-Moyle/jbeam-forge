import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';

/**
 * Materials a part's jbeam names that no mesh carries: what a glow map switches between (the
 * Pessima's gear indicator shows pessima_gauges, or pessima_gauges_on when lit) and what a mesh's
 * material is swapped for (the Scintilla's four brake discs each get their own, to glow on their
 * own). A borrowed part needs them defined in the mod like any material on its meshes, or the game
 * draws the part in its orange "no material".
 */
export function jbeamMaterialRefs(parts: Iterable<JbeamObject>): string[] {
  const out = new Set<string>();
  const overrides = (v: JbeamValue | undefined) => {
    if (Array.isArray(v)) for (const x of v) overrides(x);
    else if (isJbeamObject(v)) {
      const swap = v.materialOverride;
      if (isJbeamObject(swap)) for (const to of Object.values(swap)) if (typeof to === 'string' && to) out.add(to);
    }
  };
  for (const p of parts) {
    if (isJbeamObject(p.glowMap))
      for (const entry of Object.values(p.glowMap)) {
        if (!isJbeamObject(entry)) continue;
        for (const key of ['off', 'on', 'on_intense']) {
          const name = entry[key];
          if (typeof name === 'string' && name) out.add(name);
        }
      }
    overrides(p.flexbodies);
    overrides(p.props);
  }
  return [...out].sort();
}
