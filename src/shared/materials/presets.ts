import { defaultLayer, type MaterialDef, type MaterialLayer } from './schema';

/**
 * Built-in material presets: sensible starting points for the surfaces a car
 * is made of, tuned against the values stock BeamNG materials use (e.g. paint
 * = metallic 1 with clear coat 1 / clear coat roughness ≈ 0; glass =
 * translucent PreMulAlpha, no shadows). No textures, so they work on any
 * model; add maps in the editor.
 */

export interface MaterialPreset {
  id: string;
  name: string;
  category: 'Paint' | 'Metal' | 'Plastic & rubber' | 'Glass & lenses' | 'Interior' | 'Lights' | 'Wraps & special';
  /** Everything but id/name/origin. */
  def: Omit<MaterialDef, 'id' | 'name' | 'origin'>;
}

type Base = Omit<MaterialDef, 'id' | 'name' | 'origin'>;

const BASE: Base = {
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
};

const surface = (layer: Partial<MaterialLayer>, over: Partial<Base> = {}): Base => ({ ...BASE, ...over, layers: [defaultLayer(layer)] });
const rgb = (r: number, g: number, b: number, a = 1): [number, number, number, number] => [r / 255, g / 255, b / 255, a];

const paint = (color: [number, number, number, number], metallic: number, roughness: number, clearCoat = 1): Base => ({
  ...BASE,
  paint: true,
  // Paint coat on layer 1 (previews paint slot 1), base underneath on layer 2: the stock layout.
  layers: [defaultLayer({ baseColor: color, metallic, roughness, clearCoat, clearCoatRoughness: 0.03 }), defaultLayer({ baseColor: color, metallic, roughness })],
});

const glass = (color: [number, number, number, number], opacity: number, roughness = 0.05): Base =>
  surface({ baseColor: color, metallic: 1, roughness, opacity, pixelSpecular: true }, { translucent: true, blend: 'PreMulAlpha', castShadows: false, translucentRecvShadows: true });

const lamp = (color: [number, number, number, number], nits: number): Base => surface({ baseColor: color, roughness: 0.3, emissive: [color[0], color[1], color[2]], emissiveIntensity: nits, glow: true });

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  { id: 'paint_gloss', name: 'Gloss paint', category: 'Paint', def: paint(rgb(200, 30, 30), 0.1, 0.35) },
  { id: 'paint_metallic', name: 'Metallic paint', category: 'Paint', def: paint(rgb(40, 70, 140), 1, 0.35) },
  { id: 'paint_pearl', name: 'Pearl paint', category: 'Paint', def: paint(rgb(235, 235, 240), 0.6, 0.25) },
  { id: 'paint_matte', name: 'Matte paint', category: 'Paint', def: paint(rgb(60, 60, 62), 0.2, 0.75, 0) },
  { id: 'paint_satin', name: 'Satin paint', category: 'Paint', def: paint(rgb(30, 30, 32), 0.4, 0.5, 0.4) },
  { id: 'chrome', name: 'Chrome', category: 'Metal', def: surface({ baseColor: rgb(250, 250, 250), metallic: 1, roughness: 0.03 }) },
  { id: 'aluminium_brushed', name: 'Brushed aluminium', category: 'Metal', def: surface({ baseColor: rgb(200, 202, 206), metallic: 1, roughness: 0.35, useAnisotropic: true }) },
  { id: 'aluminium_polished', name: 'Polished aluminium', category: 'Metal', def: surface({ baseColor: rgb(225, 226, 230), metallic: 1, roughness: 0.12 }) },
  { id: 'steel_bare', name: 'Bare steel', category: 'Metal', def: surface({ baseColor: rgb(150, 152, 155), metallic: 1, roughness: 0.45 }) },
  { id: 'steel_dark', name: 'Dark steel (suspension, frame)', category: 'Metal', def: surface({ baseColor: rgb(55, 57, 60), metallic: 0.9, roughness: 0.55 }) },
  { id: 'cast_iron', name: 'Cast iron (brakes, block)', category: 'Metal', def: surface({ baseColor: rgb(85, 82, 80), metallic: 0.9, roughness: 0.7 }) },
  { id: 'anodised_gold', name: 'Gold anodised', category: 'Metal', def: surface({ baseColor: rgb(212, 170, 80), metallic: 1, roughness: 0.3 }) },
  { id: 'titanium_burnt', name: 'Burnt titanium (exhaust tips)', category: 'Metal', def: surface({ baseColor: rgb(110, 90, 140), metallic: 1, roughness: 0.3 }) },
  { id: 'plastic_black_textured', name: 'Black textured plastic', category: 'Plastic & rubber', def: surface({ baseColor: rgb(22, 22, 23), roughness: 0.8 }) },
  { id: 'plastic_black_gloss', name: 'Gloss black plastic', category: 'Plastic & rubber', def: surface({ baseColor: rgb(10, 10, 11), roughness: 0.15, clearCoat: 0.5 }) },
  { id: 'plastic_grey', name: 'Grey plastic', category: 'Plastic & rubber', def: surface({ baseColor: rgb(90, 92, 95), roughness: 0.6 }) },
  { id: 'rubber', name: 'Rubber (tyres, seals)', category: 'Plastic & rubber', def: surface({ baseColor: rgb(18, 18, 18), roughness: 0.9 }) },
  { id: 'carbon', name: 'Carbon fibre (add a weave texture)', category: 'Plastic & rubber', def: surface({ baseColor: rgb(25, 26, 28), metallic: 0.3, roughness: 0.25, clearCoat: 1, clearCoatRoughness: 0.02, useAnisotropic: true }) },
  { id: 'glass_clear', name: 'Clear glass', category: 'Glass & lenses', def: glass(rgb(200, 210, 215, 1), 0.2) },
  { id: 'glass_tinted', name: 'Tinted glass', category: 'Glass & lenses', def: glass(rgb(30, 35, 40, 1), 0.55) },
  { id: 'lens_clear', name: 'Headlight lens', category: 'Glass & lenses', def: glass(rgb(235, 240, 245, 1), 0.12, 0.02) },
  { id: 'lens_red', name: 'Taillight lens (red)', category: 'Glass & lenses', def: glass(rgb(180, 10, 10, 1), 0.6) },
  { id: 'lens_amber', name: 'Indicator lens (amber)', category: 'Glass & lenses', def: glass(rgb(230, 130, 10, 1), 0.55) },
  { id: 'mirror', name: 'Mirror glass', category: 'Glass & lenses', def: surface({ baseColor: rgb(240, 240, 240), metallic: 1, roughness: 0.01 }) },
  { id: 'leather_black', name: 'Black leather', category: 'Interior', def: surface({ baseColor: rgb(25, 24, 23), roughness: 0.55 }) },
  { id: 'leather_tan', name: 'Tan leather', category: 'Interior', def: surface({ baseColor: rgb(150, 100, 60), roughness: 0.55 }) },
  { id: 'fabric_seat', name: 'Seat fabric', category: 'Interior', def: surface({ baseColor: rgb(45, 45, 48), roughness: 0.95 }) },
  { id: 'alcantara', name: 'Alcantara / suede', category: 'Interior', def: surface({ baseColor: rgb(35, 35, 37), roughness: 1 }) },
  { id: 'carpet', name: 'Carpet', category: 'Interior', def: surface({ baseColor: rgb(30, 30, 30), roughness: 1 }) },
  { id: 'dash_soft', name: 'Soft-touch dashboard', category: 'Interior', def: surface({ baseColor: rgb(38, 38, 40), roughness: 0.7 }) },
  { id: 'glow_white', name: 'Headlight glow', category: 'Lights', def: lamp(rgb(255, 250, 235), 40) },
  { id: 'glow_red', name: 'Brake light glow', category: 'Lights', def: lamp(rgb(255, 20, 10), 25) },
  { id: 'glow_amber', name: 'Indicator glow', category: 'Lights', def: lamp(rgb(255, 140, 10), 25) },
  { id: 'glow_gauge', name: 'Gauge backlight', category: 'Lights', def: lamp(rgb(255, 255, 255), 5) },
  // Paint
  { id: 'paint_candy_red', name: 'Candy red', category: 'Paint', def: paint(rgb(150, 8, 12), 0.8, 0.2) },
  { id: 'paint_candy_blue', name: 'Candy blue', category: 'Paint', def: paint(rgb(12, 30, 140), 0.8, 0.2) },
  { id: 'paint_flake_silver', name: 'Silver metal flake', category: 'Paint', def: paint(rgb(190, 192, 196), 1, 0.3) },
  { id: 'paint_gunmetal', name: 'Gunmetal grey', category: 'Paint', def: paint(rgb(70, 74, 80), 1, 0.35) },
  { id: 'paint_racing_green', name: 'Racing green', category: 'Paint', def: paint(rgb(14, 60, 32), 0.3, 0.3) },
  { id: 'paint_safety_yellow', name: 'Safety yellow', category: 'Paint', def: paint(rgb(250, 200, 10), 0.05, 0.35) },
  { id: 'paint_signal_orange', name: 'Signal orange', category: 'Paint', def: paint(rgb(240, 90, 10), 0.1, 0.35) },
  { id: 'paint_pure_white', name: 'Pure white (solid)', category: 'Paint', def: paint(rgb(240, 240, 238), 0, 0.3) },
  { id: 'paint_jet_black', name: 'Jet black (solid)', category: 'Paint', def: paint(rgb(8, 8, 9), 0, 0.25) },
  { id: 'paint_frozen_grey', name: 'Frozen grey (matte metallic)', category: 'Paint', def: paint(rgb(120, 124, 128), 0.8, 0.6, 0) },
  // Metal
  { id: 'copper', name: 'Copper', category: 'Metal', def: surface({ baseColor: rgb(184, 115, 70), metallic: 1, roughness: 0.25 }) },
  { id: 'brass', name: 'Brass', category: 'Metal', def: surface({ baseColor: rgb(200, 165, 90), metallic: 1, roughness: 0.25 }) },
  { id: 'black_chrome', name: 'Black chrome', category: 'Metal', def: surface({ baseColor: rgb(40, 42, 45), metallic: 1, roughness: 0.05 }) },
  { id: 'stainless_polished', name: 'Polished stainless (exhausts)', category: 'Metal', def: surface({ baseColor: rgb(210, 212, 215), metallic: 1, roughness: 0.08 }) },
  { id: 'galvanised', name: 'Galvanised steel', category: 'Metal', def: surface({ baseColor: rgb(165, 170, 172), metallic: 1, roughness: 0.55 }) },
  { id: 'magnesium_raw', name: 'Raw magnesium (wheels, cases)', category: 'Metal', def: surface({ baseColor: rgb(175, 175, 170), metallic: 1, roughness: 0.5 }) },
  { id: 'rusty_steel', name: 'Rusty steel (add a rust texture)', category: 'Metal', def: surface({ baseColor: rgb(110, 60, 35), metallic: 0.4, roughness: 0.9 }) },
  { id: 'gold_plated', name: 'Gold plated', category: 'Metal', def: surface({ baseColor: rgb(230, 185, 80), metallic: 1, roughness: 0.08 }) },
  // Plastic & rubber
  { id: 'plastic_white', name: 'White plastic', category: 'Plastic & rubber', def: surface({ baseColor: rgb(225, 225, 222), roughness: 0.55 }) },
  { id: 'plastic_red', name: 'Red plastic (towing eyes, clips)', category: 'Plastic & rubber', def: surface({ baseColor: rgb(180, 20, 20), roughness: 0.5 }) },
  { id: 'tyre_sidewall', name: 'Tyre sidewall (worn rubber)', category: 'Plastic & rubber', def: surface({ baseColor: rgb(28, 28, 28), roughness: 0.85 }) },
  { id: 'forged_carbon', name: 'Forged carbon (add a forged texture)', category: 'Plastic & rubber', def: surface({ baseColor: rgb(32, 33, 35), metallic: 0.4, roughness: 0.3, clearCoat: 1, clearCoatRoughness: 0.02 }) },
  // Glass & lenses
  { id: 'glass_privacy', name: 'Privacy glass (rear windows)', category: 'Glass & lenses', def: glass(rgb(15, 17, 20, 1), 0.8) },
  { id: 'lens_smoked', name: 'Smoked lens', category: 'Glass & lenses', def: glass(rgb(40, 40, 42, 1), 0.7, 0.03) },
  { id: 'lens_clear_red', name: 'Clear-red taillight lens', category: 'Glass & lenses', def: glass(rgb(220, 60, 60, 1), 0.35) },
  { id: 'lens_yellow', name: 'Yellow fog-light lens', category: 'Glass & lenses', def: glass(rgb(240, 200, 40, 1), 0.4) },
  // Interior
  { id: 'leather_red', name: 'Red leather', category: 'Interior', def: surface({ baseColor: rgb(120, 20, 22), roughness: 0.55 }) },
  { id: 'leather_cream', name: 'Cream leather', category: 'Interior', def: surface({ baseColor: rgb(215, 200, 170), roughness: 0.55 }) },
  { id: 'wood_trim', name: 'Wood trim (add a grain texture)', category: 'Interior', def: surface({ baseColor: rgb(110, 60, 30), roughness: 0.2, clearCoat: 1, clearCoatRoughness: 0.03 }) },
  { id: 'piano_black', name: 'Piano black trim', category: 'Interior', def: surface({ baseColor: rgb(6, 6, 7), roughness: 0.05, clearCoat: 1, clearCoatRoughness: 0.01 }) },
  { id: 'headliner', name: 'Headliner fabric', category: 'Interior', def: surface({ baseColor: rgb(170, 168, 162), roughness: 1 }) },
  { id: 'rubber_mat', name: 'Rubber floor mat', category: 'Interior', def: surface({ baseColor: rgb(20, 20, 20), roughness: 0.95 }) },
  // Lights
  { id: 'glow_led_white', name: 'LED daytime light (cool white)', category: 'Lights', def: lamp(rgb(225, 235, 255), 60) },
  { id: 'glow_fog_yellow', name: 'Fog light glow (yellow)', category: 'Lights', def: lamp(rgb(255, 210, 60), 30) },
  { id: 'glow_reverse', name: 'Reverse light glow', category: 'Lights', def: lamp(rgb(250, 250, 255), 30) },
  { id: 'glow_gauge_red', name: 'Gauge backlight (red)', category: 'Lights', def: lamp(rgb(255, 30, 20), 5) },
  { id: 'glow_underglow', name: 'Underglow (neon blue)', category: 'Lights', def: lamp(rgb(40, 120, 255), 80) },
  // Wraps & special
  { id: 'wrap_matte_black', name: 'Matte black wrap', category: 'Wraps & special', def: surface({ baseColor: rgb(18, 18, 19), roughness: 0.8 }, { paint: true }) },
  { id: 'wrap_satin_white', name: 'Satin white wrap', category: 'Wraps & special', def: surface({ baseColor: rgb(230, 230, 228), roughness: 0.5 }, { paint: true }) },
  { id: 'primer_grey', name: 'Grey primer', category: 'Wraps & special', def: surface({ baseColor: rgb(130, 132, 134), roughness: 0.9 }) },
  { id: 'primer_red', name: 'Red oxide primer', category: 'Wraps & special', def: surface({ baseColor: rgb(130, 50, 35), roughness: 0.9 }) },
  { id: 'shadow_black', name: 'Shadow black (hidden areas, under panels)', category: 'Wraps & special', def: surface({ baseColor: rgb(4, 4, 4), roughness: 1 }, { castShadows: false }) },
];
