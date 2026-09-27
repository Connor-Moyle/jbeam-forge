import type { MaterialDef, MaterialLayer, TextureSlot } from './schema';

/**
 * MaterialDef → an entry of main.materials.json, in the v1.5 form official
 * vehicles use. Only fields that differ from BeamNG's defaults are written,
 * the way the stock files look, so the output stays readable.
 */

/** The game's own paint mask: everything paint slot 1. Referenced, never copied. */
export const DEFAULT_PALETTE_MASK = '/vehicles/common/nullcolormaskR.color.png';

const round = (v: number) => Math.round(v * 1000) / 1000;
const USE_UV_KEY: Record<TextureSlot, string> = {
  baseColorMap: 'diffuseMapUseUV',
  normalMap: 'normalMapUseUV',
  metallicMap: 'metallicMapUseUV',
  roughnessMap: 'roughnessMapUseUV',
  ambientOcclusionMap: 'ambientOcclusionMapUseUV',
  emissiveMap: 'emissiveMapUseUV',
  opacityMap: 'opacityMapUseUV',
  clearCoatMap: 'clearCoatMapUseUV',
  colorPaletteMap: 'colorPaletteMapUseUV',
  detailNormalMap: 'normalDetailMapUseUV',
};

/** `fileFor` maps a texture path on disk to its path inside the mod ("/vehicles/<slug>/<file>"). */
export function stageJson(layer: MaterialLayer, fileFor: (path: string) => string): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const [r, g, b, a] = layer.baseColor;
  if (r !== 1 || g !== 1 || b !== 1 || a !== 1 || !layer.maps.baseColorMap) s.baseColorFactor = layer.baseColor.map(round);
  s.metallicFactor = round(layer.metallic);
  if (layer.roughness !== 0.5 || !layer.maps.roughnessMap) s.roughnessFactor = round(layer.roughness);
  if (layer.opacity < 1) s.opacityFactor = round(layer.opacity);
  if (layer.normalStrength !== 1 && layer.maps.normalMap) s.normalMapStrength = round(layer.normalStrength);
  if (layer.clearCoat > 0) {
    s.clearCoatFactor = round(layer.clearCoat);
    s.clearCoatRoughnessFactor = round(layer.clearCoatRoughness);
  }
  if (layer.emissiveIntensity > 0) {
    s.emissiveFactor = layer.emissive.map(round);
    s.emissiveIntensityNits = round(layer.emissiveIntensity);
  }
  if (layer.maps.detailNormalMap) {
    s.detailScale = layer.detailScale.map(round);
    s.detailNormalMapStrength = round(layer.detailNormalStrength);
  }
  for (const [slot, path] of Object.entries(layer.maps) as [TextureSlot, string][]) s[slot] = path.startsWith('/vehicles/') ? path : fileFor(path);
  for (const slot of layer.uv2) if (layer.maps[slot]) s[USE_UV_KEY[slot]] = 1;
  if (layer.instanceDiffuse) s.instanceDiffuse = true;
  if (layer.vertColor) s.vertColor = true;
  if (layer.glow) s.glow = true;
  if (layer.pixelSpecular) s.pixelSpecular = true;
  if (layer.useAnisotropic) s.useAnisotropic = true;
  return { ...s, ...layer.extra };
}

export function materialJson(def: MaterialDef, exportName: string, fileFor: (path: string) => string): Record<string, unknown> {
  const layers = def.layers.map((l, i) => {
    // Painted: layer 0 needs a palette mask; without one the whole thing is paint slot 1.
    if (i === 0 && def.paint && !l.maps.colorPaletteMap) return { ...l, maps: { ...l.maps, colorPaletteMap: DEFAULT_PALETTE_MASK } };
    return l;
  });
  const stages = layers.map((l) => stageJson(l, fileFor));
  while (stages.length < 4) stages.push({});
  const out: Record<string, unknown> = { name: exportName, mapTo: exportName, class: 'Material', Stages: stages };
  if (def.layers.length > 1) out.activeLayers = def.layers.length;
  if (def.translucent) {
    out.translucent = true;
    out.translucentBlendOp = def.blend;
    if (def.translucentZWrite) out.translucentZWrite = true;
    if (def.translucentRecvShadows) out.translucentRecvShadows = true;
  }
  if (def.alphaTest) out.alphaTest = true;
  if (def.alphaTest || def.translucent) out.alphaRef = def.alphaRef;
  if (def.doubleSided) out.doubleSided = true;
  if (!def.castShadows) out.castShadows = false;
  if (def.dynamicCubemap) out.dynamicCubemap = true;
  out.materialTag0 = 'beamng';
  out.materialTag1 = 'vehicle';
  out.version = 1.5;
  return { ...out, ...def.extra };
}

/** Every texture file a material needs copied into the mod. */
export function texturePaths(def: MaterialDef): string[] {
  if (def.gameMaterial) return [];
  return [...new Set(def.layers.flatMap((l) => Object.values(l.maps).filter((p) => !p.startsWith('/vehicles/'))))];
}
