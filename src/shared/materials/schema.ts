import { z } from 'zod';

/**
 * Vehicle materials (Phase 8), modelled on BeamNG's material format v1.5 as
 * official content uses it (studied over 2,179 materials in 0.39):
 * up to four layers ("Stages"), each with PBR factors and texture maps, plus
 * material-wide flags for transparency, shadows and paint.
 *
 * Paint works the way the stock cars do it: layer 0 carries a colour palette
 * mask (red/green/blue = paint slots 1/2/3) with clear coat; the game fills in
 * the player's paint colours. Anything the editor doesn't expose can still be
 * set through `extra` (raw fields merged into the output as-is).
 */

export const TEXTURE_SLOTS = ['baseColorMap', 'normalMap', 'metallicMap', 'roughnessMap', 'ambientOcclusionMap', 'emissiveMap', 'opacityMap', 'clearCoatMap', 'colorPaletteMap', 'detailNormalMap'] as const;
export type TextureSlot = (typeof TEXTURE_SLOTS)[number];

export const BLEND_OPS = ['None', 'PreMulAlpha', 'LerpAlpha', 'AddAlpha', 'Add', 'Mul', 'Sub'] as const;
export type BlendOp = (typeof BLEND_OPS)[number];

const unit = z.number().min(0).max(1);
const Color3 = z.tuple([unit, unit, unit]);
const Color4 = z.tuple([unit, unit, unit, unit]);
const Raw = z.record(z.string(), z.unknown());

export const MaterialLayerSchema = z.object({
  /** sRGB 0–1, alpha last. */
  baseColor: Color4,
  metallic: unit,
  roughness: unit,
  opacity: unit,
  normalStrength: z.number().min(0).max(10),
  clearCoat: unit,
  clearCoatRoughness: unit,
  emissive: Color3,
  /** Emissive brightness in nits; 0 = not emissive. */
  emissiveIntensity: z.number().min(0).max(100000),
  detailScale: z.tuple([z.number().positive(), z.number().positive()]),
  detailNormalStrength: z.number().min(0).max(10),
  /** Texture file per slot (absolute path on this machine; copied into the mod on export). */
  maps: z.partialRecord(z.enum(TEXTURE_SLOTS), z.string().min(1)),
  /** Slots that read the second UV channel. */
  uv2: z.array(z.enum(TEXTURE_SLOTS)),
  /** Take the colour from the vehicle's paint (older instance-colour style). */
  instanceDiffuse: z.boolean(),
  vertColor: z.boolean(),
  glow: z.boolean(),
  pixelSpecular: z.boolean(),
  useAnisotropic: z.boolean(),
  /** Raw Stage fields merged over the generated ones. */
  extra: Raw,
});

export const MaterialDefSchema = z.object({
  id: z.string().min(1),
  /** Material name before the mod prefix (exported as <slug>_<name>). */
  name: z.string().min(1),
  /** Where it came from when auto-imported: the source and the material's name in it. */
  origin: z.object({ sourceId: z.string(), name: z.string() }).nullable(),
  layers: z.array(MaterialLayerSchema).min(1).max(4),
  /** Body paint through a colour palette mask on layer 0 (paint slots 1–3). */
  paint: z.boolean(),
  translucent: z.boolean(),
  blend: z.enum(BLEND_OPS),
  translucentZWrite: z.boolean(),
  translucentRecvShadows: z.boolean(),
  alphaTest: z.boolean(),
  /** 0–255 cut-off for alpha test. */
  alphaRef: z.number().int().min(0).max(255),
  doubleSided: z.boolean(),
  /**
   * Two-sided with a different inside: the material shown on the back faces
   * (exported as the triangles again, turned round). Optional so older
   * projects and .jbmat files still load.
   */
  backMaterialId: z.string().min(1).nullable().optional(),
  castShadows: z.boolean(),
  dynamicCubemap: z.boolean(),
  /** Use one of BeamNG's own materials by name instead (nothing is exported for this one). */
  gameMaterial: z.string().nullable(),
  /** Raw top-level fields merged over the generated ones. */
  extra: Raw,
});

export type MaterialLayer = z.infer<typeof MaterialLayerSchema>;
export type MaterialDef = z.infer<typeof MaterialDefSchema>;

export function defaultLayer(over: Partial<MaterialLayer> = {}): MaterialLayer {
  return {
    baseColor: [1, 1, 1, 1],
    metallic: 0,
    roughness: 0.5,
    opacity: 1,
    normalStrength: 1,
    clearCoat: 0,
    clearCoatRoughness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    detailScale: [1, 1],
    detailNormalStrength: 1,
    maps: {},
    uv2: [],
    instanceDiffuse: false,
    vertColor: false,
    glow: false,
    pixelSpecular: false,
    useAnisotropic: false,
    extra: {},
    ...over,
  };
}

export function defaultMaterial(id: string, name: string, over: Partial<MaterialDef> = {}): MaterialDef {
  return {
    id,
    name,
    origin: null,
    layers: [defaultLayer()],
    paint: false,
    translucent: false,
    blend: 'None',
    translucentZWrite: false,
    translucentRecvShadows: true,
    alphaTest: false,
    alphaRef: 0,
    doubleSided: false,
    castShadows: true,
    dynamicCubemap: true,
    gameMaterial: null,
    extra: {},
    ...over,
  };
}

/** File-name ending of a livery painted in the app (it goes on a layer of its own, over the paint). */
export const LIVERY_SUFFIX = '_livery.png';

/** The layer carrying the painted livery, if any. */
export function liveryLayerIndex(def: Pick<MaterialDef, 'layers'>): number {
  return def.layers.findIndex((l) => l.maps.baseColorMap?.endsWith(LIVERY_SUFFIX));
}
