import { z } from 'zod';

/**
 * Part taxonomy (SPEC §4.3). Layered: shipped taxonomy.json < user-global
 * user-taxonomy.json < project customTaxonomy (later layers add or override
 * entries by id).
 *
 * An entry is a part *kind*; where it sits on the vehicle is its position,
 * chosen from the entry's axis:
 *   none    — one per vehicle (hood, windshield)
 *   fr      — F | R (bumper_F / bumper_R)
 *   lr      — L | R (headlight_L)
 *   corner  — FL | FR | RL | RR (door_FL)
 * The axis also resolves BeamNG's ambiguous "R": rear on fr, right on lr.
 */

export const POSITION_AXES = ['none', 'fr', 'lr', 'corner'] as const;
export type PositionAxis = (typeof POSITION_AXES)[number];

export const POSITIONS_BY_AXIS: Record<PositionAxis, readonly string[]> = {
  none: [],
  fr: ['F', 'R'],
  lr: ['L', 'R'],
  corner: ['FL', 'FR', 'RL', 'RR'],
};

export const BEAM_PRESETS = ['structure_stiff', 'panel_metal', 'panel_plastic', 'trim_light', 'glass_brittle', 'mechanical', 'mechanical_light', 'mechanical_block', 'tyre_rubber'] as const;

const ID = /^[a-z][a-z0-9_]*$/;

export const TaxonomyEntrySchema = z.object({
  id: z.string().regex(ID),
  label: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().min(1),
  positionAxis: z.enum(POSITION_AXES),
  /** Base slotType; position suffixes are added per instance (bumper → bumper_F). */
  slotType: z.string().regex(ID),
  /** Taxonomy id this part attaches to (drives slot nesting). null = root. */
  parent: z.string().regex(ID).nullable(),
  defaultMass: z.number().positive(),
  nodePrefix: z.string().regex(/^[a-z][a-z0-9]{0,5}$/),
  beamPreset: z.enum(BEAM_PRESETS),
  openable: z.boolean(),
  /** Lowercase words/phrases mesh names use for this part (id and label words match automatically). */
  nameHints: z.array(z.string().regex(/^[a-z0-9 ]+$/)),
});

export type TaxonomyEntry = z.infer<typeof TaxonomyEntrySchema>;

export const TaxonomyFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(TaxonomyEntrySchema),
});

export interface TaxonomyProblem {
  id: string;
  problem: string;
}

/** Structural checks a merged taxonomy must pass (also used when users add custom parts). */
export function validateTaxonomy(entries: readonly TaxonomyEntry[]): TaxonomyProblem[] {
  const problems: TaxonomyProblem[] = [];
  const byId = new Map<string, TaxonomyEntry>();
  const prefixes = new Map<string, string>();
  const slotTypes = new Map<string, string>();
  for (const e of entries) {
    if (byId.has(e.id)) problems.push({ id: e.id, problem: 'duplicate id' });
    byId.set(e.id, e);
    const p = prefixes.get(e.nodePrefix);
    if (p) problems.push({ id: e.id, problem: `nodePrefix "${e.nodePrefix}" already used by ${p}` });
    prefixes.set(e.nodePrefix, e.id);
    const s = slotTypes.get(e.slotType);
    if (s) problems.push({ id: e.id, problem: `slotType "${e.slotType}" already used by ${s}` });
    slotTypes.set(e.slotType, e.id);
  }
  const roots = entries.filter((e) => e.parent === null);
  if (roots.length !== 1) problems.push({ id: '*', problem: `expected exactly one root entry, found ${roots.map((r) => r.id).join(', ') || 'none'}` });
  for (const e of entries) {
    if (e.parent !== null && !byId.has(e.parent)) problems.push({ id: e.id, problem: `parent "${e.parent}" does not exist` });
    // Cycle check: walk up; more steps than entries means a loop.
    let cur: TaxonomyEntry | undefined = e;
    for (let steps = 0; cur?.parent; steps++) {
      if (steps > entries.length) {
        problems.push({ id: e.id, problem: 'parent chain loops' });
        break;
      }
      cur = byId.get(cur.parent);
    }
  }
  return problems;
}

/** Merge layers: later layers override earlier ones by id. */
export function mergeTaxonomy(...layers: readonly (readonly TaxonomyEntry[])[]): TaxonomyEntry[] {
  const byId = new Map<string, TaxonomyEntry>();
  for (const layer of layers) for (const e of layer) byId.set(e.id, e);
  return [...byId.values()];
}
