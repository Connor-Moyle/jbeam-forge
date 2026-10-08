import type { Project } from '../project/schema';
import { partMass, partRole, partSettings, type TaxonomyLookup } from './generate';

/**
 * Starting points for a car's structure: what kind of vehicle it is sets how much its parts weigh
 * together and how finely they are built, so the generator doesn't start every car as the same
 * middling saloon. Weights are the game's own cars of each kind (their selector figures); a car's
 * own structure is taken as a little over half of that, the rest being the suspension, engine,
 * gearbox and wheels fitted to it.
 */
export interface Archetype {
  id: string;
  label: string;
  description: string;
  /** What a car of this kind weighs ready to drive, kg. */
  kerbKg: number;
  /** Structure detail, 0..1 within each part's budget. */
  detail: number;
}

export const ARCHETYPES: readonly Archetype[] = [
  { id: 'hatch', label: 'Hatchback', description: 'A small light car (the Covet, about 1,000 kg)', kerbKg: 1000, detail: 0.4 },
  { id: 'coupe', label: 'Coupé or sports car', description: 'Low and stiff (the 200BX, about 1,250 kg)', kerbKg: 1250, detail: 0.5 },
  { id: 'saloon', label: 'Saloon', description: 'A family four-door (the Pessima, about 1,400 kg)', kerbKg: 1400, detail: 0.5 },
  { id: 'ute', label: 'Pickup or SUV', description: 'A tall body on a frame (the D-Series, about 2,000 kg)', kerbKg: 2000, detail: 0.55 },
  { id: 'truck', label: 'Truck', description: 'A cab on a heavy frame (the T-Series, about 7,500 kg)', kerbKg: 7500, detail: 0.65 },
  { id: 'trailer', label: 'Trailer', description: 'A box on an axle, no engine (about 900 kg)', kerbKg: 900, detail: 0.35 },
];

/** The share of a car's weight that is its own structure (body, panels, glass, trim): the rest is fitted from the game. */
export const STRUCTURE_SHARE = 0.55;

type Doc = Pick<Project, 'parts' | 'proxy'>;

/**
 * Set every part with structure of its own to an archetype: its detail, and its weight scaled so the
 * car's own structure comes to the archetype's share of its kerb weight. Returns the scale used, or
 * null when the car has no such parts yet.
 */
export function applyArchetype(doc: Doc, tax: TaxonomyLookup, id: string): number | null {
  const archetype = ARCHETYPES.find((a) => a.id === id);
  if (!archetype) return null;
  const own = doc.parts.flatMap((part) => {
    const entry = tax.entry(part.taxonomyId);
    if (!entry || part.variantOf) return [];
    const settings = partSettings(doc, part, entry);
    return partRole(entry, settings) === 'own' ? [{ part, entry, settings }] : [];
  });
  // Weighed as the parts' kinds and materials say, whatever was set before.
  const plain = own.reduce((sum, o) => sum + partMass(o.part, o.entry, { ...o.settings, massKg: null }), 0);
  if (!own.length || plain <= 0) return null;
  // A trailer has nothing fitted that weighs much: nearly all of it is its own structure.
  const share = id === 'trailer' ? 0.85 : STRUCTURE_SHARE;
  const scale = Math.min(6, Math.max(0.4, (archetype.kerbKg * share) / plain));
  for (const o of own) {
    const kg = partMass(o.part, o.entry, { ...o.settings, massKg: null }) * scale;
    doc.proxy.parts[o.part.id] = { ...o.settings, detail: archetype.detail, massKg: Math.round(kg * 10) / 10 };
  }
  return Math.round(scale * 100) / 100;
}
