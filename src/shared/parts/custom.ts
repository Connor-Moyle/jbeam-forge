import { slugify } from '../text';
import type { BEAM_PRESETS, PositionAxis, TaxonomyEntry } from '../taxonomy/schema';

export interface CustomKindInput {
  label: string;
  category: string;
  subcategory?: string;
  parent: string;
  positionAxis: PositionAxis;
  openable: boolean;
  defaultMass: number;
  defaultPrice?: number;
  beamPreset: (typeof BEAM_PRESETS)[number];
}

/** Unique lowercase node prefix (3–6 chars) derived from the id: consonant skeleton, then the plain letters, then numbered. */
export function uniqueNodePrefix(id: string, taken: ReadonlySet<string>): string {
  const letters = id.replace(/[^a-z]/g, '');
  const skeleton = (letters[0] ?? 'c') + letters.slice(1).replace(/[aeiou]/g, '');
  for (const source of [skeleton, letters]) {
    for (const len of [3, 4, 5, 6]) {
      const p = source.slice(0, len);
      if (p.length === len && !taken.has(p)) return p;
    }
  }
  const stem = skeleton.slice(0, 4) || 'c';
  for (let i = 1; ; i++) if (!taken.has(`${stem}${i}`)) return `${stem}${i}`;
}

/** Build a taxonomy entry for "Add Custom Part"; id/slotType come from the label and are made unique. */
export function buildCustomEntry(input: CustomKindInput, existing: readonly TaxonomyEntry[]): TaxonomyEntry {
  let base = slugify(input.label);
  if (!/^[a-z]/.test(base)) base = `custom_${base || 'part'}`;
  const ids = new Set(existing.flatMap((e) => [e.id, e.slotType]));
  let id = base;
  for (let i = 2; ids.has(id); i++) id = `${base}_${i}`;
  return {
    id,
    label: input.label.trim(),
    category: input.category,
    subcategory: input.subcategory?.trim() || 'Custom',
    positionAxis: input.positionAxis,
    slotType: id,
    parent: input.parent,
    defaultMass: input.defaultMass,
    defaultPrice: input.defaultPrice ?? 100,
    nodePrefix: uniqueNodePrefix(id, new Set(existing.map((e) => e.nodePrefix))),
    beamPreset: input.beamPreset,
    openable: input.openable,
    nameHints: [],
  };
}
