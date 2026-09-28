import type { Paint, Project, VehicleConfig } from '../project/schema';

/**
 * Factory paints (v16), the way the game holds them: info.json `paints`
 * (name → paint) with `defaultPaintName1`–`3`, and a `paints` array of three
 * on each .pc. A car has three paint slots; where each shows is up to the
 * paint materials' colour palette mask (red = slot 1, green = 2, blue = 3),
 * so one body can wear three different paints at once.
 */

export interface GamePaint {
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function paintJson(p: Paint): GamePaint {
  return { baseColor: [r3(p.color[0]), r3(p.color[1]), r3(p.color[2]), 1], metallic: r3(p.metallic), roughness: r3(p.roughness), clearcoat: r3(p.clearcoat), clearcoatRoughness: r3(p.clearcoatRoughness) };
}

type PaintDoc = Pick<Project, 'paints'>;

/** A paint in the list by id. */
export const paintById = (doc: PaintDoc, id: string | null | undefined): Paint | undefined => (id ? doc.paints.list.find((p) => p.id === id) : undefined);

/**
 * The paint in each slot for a configuration (null: the default car): its
 * own choice, else the factory default, else slot 1's, else the first paint.
 * Null when the project has no paints (the game then uses its own default).
 */
export function resolvePaints(doc: PaintDoc, config: Pick<VehicleConfig, 'paints'> | null): [Paint, Paint, Paint] | null {
  const first = doc.paints.list[0];
  if (!first) return null;
  const pick = (i: 0 | 1 | 2) => paintById(doc, config?.paints[i]) ?? paintById(doc, doc.paints.defaults[i]);
  const one = pick(0) ?? first;
  return [one, pick(1) ?? one, pick(2) ?? one];
}

/** info.json's paint entries: the list by name, and the default slots. */
export function infoPaints(doc: PaintDoc): Record<string, unknown> {
  if (!doc.paints.list.length) return {};
  const out: Record<string, unknown> = { paints: Object.fromEntries(doc.paints.list.map((p) => [p.name, paintJson(p)])) };
  const slots = resolvePaints(doc, null)!;
  slots.forEach((p, i) => (out[`defaultPaintName${i + 1}`] = p.name));
  return out;
}

/** A .pc's `paints` array, or nothing when the project has no paints. */
export function pcPaints(doc: PaintDoc, config: Pick<VehicleConfig, 'paints'> | null): { paints?: GamePaint[] } {
  const slots = resolvePaints(doc, config);
  return slots ? { paints: slots.map(paintJson) } : {};
}

type PresetPaint = Omit<Paint, 'id'>;
const P = (name: string, color: [number, number, number], metallic: number, roughness: number, clearcoat = 1, clearcoatRoughness = 0.04): PresetPaint => ({ name, color, metallic, roughness, clearcoat, clearcoatRoughness });

/** Starting points: solid, metallic, pearl, matte, candy and the loud stuff. */
export const PAINT_PRESETS: { group: string; paints: PresetPaint[] }[] = [
  { group: 'Solid', paints: [P('Arctic White', [0.93, 0.93, 0.92], 0, 0.45), P('Jet Black', [0.02, 0.02, 0.02], 0, 0.4), P('Signal Red', [0.72, 0.03, 0.02], 0, 0.45), P('Racing Yellow', [0.95, 0.72, 0.02], 0, 0.45), P('Grand Prix Blue', [0.03, 0.18, 0.62], 0, 0.45)] },
  { group: 'Metallic', paints: [P('Silver Metallic', [0.62, 0.63, 0.65], 0.85, 0.35), P('Gunmetal', [0.2, 0.21, 0.23], 0.8, 0.38), P('Deep Blue Metallic', [0.02, 0.06, 0.3], 0.75, 0.35), P('Burgundy Metallic', [0.3, 0.02, 0.05], 0.7, 0.35), P('British Racing Green', [0.02, 0.18, 0.08], 0.6, 0.38)] },
  { group: 'Pearl', paints: [P('Pearl White', [0.9, 0.89, 0.86], 0.45, 0.22), P('Midnight Pearl', [0.04, 0.03, 0.12], 0.55, 0.2), P('Champagne Pearl', [0.75, 0.66, 0.5], 0.6, 0.25)] },
  { group: 'Matte and satin', paints: [P('Matte Black', [0.03, 0.03, 0.03], 0, 0.85, 0, 0.5), P('Satin Grey', [0.28, 0.29, 0.3], 0.2, 0.65, 0.3, 0.4), P('Matte Army Green', [0.2, 0.24, 0.13], 0, 0.9, 0, 0.5), P('Frozen Blue', [0.25, 0.4, 0.6], 0.5, 0.7, 0.2, 0.5)] },
  { group: 'Candy and chrome', paints: [P('Candy Apple Red', [0.55, 0.0, 0.02], 1, 0.12, 1, 0.01), P('Candy Purple', [0.3, 0.02, 0.45], 1, 0.12, 1, 0.01), P('Candy Lime', [0.3, 0.6, 0.02], 1, 0.12, 1, 0.01), P('Chrome', [0.95, 0.95, 0.95], 1, 0.02, 1, 0.01), P('Gold Chrome', [0.9, 0.68, 0.25], 1, 0.04, 1, 0.01)] },
  { group: 'Loud', paints: [P('Neon Green', [0.35, 1, 0.05], 0, 0.35), P('Hot Pink', [1, 0.08, 0.55], 0.2, 0.3), P('Electric Orange', [1, 0.35, 0.0], 0.3, 0.3), P('Toxic Yellow', [0.85, 1, 0.0], 0.1, 0.3), P('Cyber Cyan', [0.0, 0.9, 1], 0.4, 0.25)] },
];

/** Three-paint schemes (slot 1, 2, 3) for multicolour cars in one click. */
export const PAINT_SCHEMES: { name: string; slots: [string, string, string] }[] = [
  { name: 'Gulf', slots: ['Frozen Blue', 'Electric Orange', 'Jet Black'] },
  { name: 'Martini', slots: ['Arctic White', 'Grand Prix Blue', 'Signal Red'] },
  { name: 'Two-tone luxury', slots: ['Midnight Pearl', 'Silver Metallic', 'Chrome'] },
  { name: 'Candy flip', slots: ['Candy Purple', 'Candy Apple Red', 'Gold Chrome'] },
  { name: 'Rave', slots: ['Neon Green', 'Hot Pink', 'Cyber Cyan'] },
  { name: 'Stealth', slots: ['Matte Black', 'Satin Grey', 'Gunmetal'] },
];

export function presetByName(name: string): PresetPaint | undefined {
  for (const g of PAINT_PRESETS) {
    const p = g.paints.find((x) => x.name === name);
    if (p) return p;
  }
  return undefined;
}
