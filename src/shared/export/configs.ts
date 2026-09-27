import type { Part, Project, VehicleConfig } from '../project/schema';
import { partPrice } from '../parts/materials';
import { bodyPart, slotTypeOf, type TaxonomyLookup } from './jbeam';

/**
 * Vehicle configurations (Phase 13): the slots a player can fill, what a
 * configuration puts in each (the default where it doesn't say), and which
 * parts end up on the car. Written out as the game's .pc files.
 */

type Doc = Pick<Project, 'meta' | 'parts' | 'variables'>;

export interface SlotChoice {
  slotType: string;
  /** The slot's name in the menu (its default part's). */
  label: string;
  /** Slot type of the part this slot hangs on; null for top-level slots. */
  parent: string | null;
  depth: number;
  options: { name: string; label: string }[];
  /** The default part's name. */
  defaultPart: string;
  /** The body: can't be left empty. */
  core: boolean;
}

/** Every slot, in menu order (parents before their children). */
export function slotChoices(doc: Pick<Project, 'parts'>, tax: TaxonomyLookup): SlotChoice[] {
  const parts = doc.parts.filter((p) => tax.entry(p.taxonomyId));
  const bases = parts.filter((p) => !p.variantOf);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const body = bodyPart({ parts }, tax);
  const out: SlotChoice[] = [];
  const visit = (base: Part, depth: number, parent: string | null) => {
    const slotType = slotTypeOf(parts, base);
    const variants = parts.filter((p) => p.id === base.id || p.variantOf === base.id);
    out.push({ slotType, label: base.displayName, parent, depth, options: variants.map((v) => ({ name: v.name, label: v.displayName })), defaultPart: base.name, core: base.id === body?.id });
    const kids = bases.filter((c) => c.parentPartId && variants.some((v) => v.id === c.parentPartId));
    for (const k of kids) visit(k, depth + 1, slotType);
  };
  for (const root of bases.filter((p) => !p.parentPartId || !byId.has(p.parentPartId))) visit(root, 0, null);
  return out;
}

export interface PcFile {
  format: 2;
  model: string;
  parts: Record<string, string>;
  vars: Record<string, number>;
}

/** A configuration as a .pc: every slot's part (defaults where the config says nothing), and its values. */
export function resolveConfig(doc: Doc, tax: TaxonomyLookup, config: VehicleConfig | null): PcFile {
  const parts: Record<string, string> = {};
  for (const slot of slotChoices(doc, tax)) parts[slot.slotType] = slot.defaultPart;
  if (config) for (const [slot, name] of Object.entries(config.parts)) if (slot in parts) parts[slot] = name;
  return { format: 2, model: doc.meta.slug, parts, vars: { ...(config?.vars ?? {}) } };
}

/** The parts a configuration puts on the car (a part counts only when every slot above it is filled). */
export function includedParts(doc: Pick<Project, 'parts'>, tax: TaxonomyLookup, pc: PcFile): Set<string> {
  const parts = doc.parts.filter((p) => tax.entry(p.taxonomyId));
  const byId = new Map(parts.map((p) => [p.id, p]));
  const chosen = (p: Part) => pc.parts[slotTypeOf(parts, p)] === p.name;
  const out = new Set<string>();
  for (const p of parts) {
    let ok = chosen(p);
    for (let cur = p.parentPartId ? byId.get(p.parentPartId) : undefined, guard = 0; ok && cur && guard < 64; guard++) {
      // Any variant of the parent slot being fitted is enough.
      const slot = slotTypeOf(parts, cur);
      const fitted = parts.find((x) => slotTypeOf(parts, x) === slot && chosen(x));
      if (!fitted) ok = false;
      cur = fitted?.parentPartId ? byId.get(fitted.parentPartId) : undefined;
    }
    if (ok) out.add(p.id);
  }
  return out;
}

/** File name for a configuration: its name, lower-case, words joined by underscores. */
export function configFileName(config: Pick<VehicleConfig, 'name'> | null): string {
  if (!config) return 'default';
  return config.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'config';
}

export function configInfoJson(doc: Doc, tax: TaxonomyLookup, pc: PcFile, config: VehicleConfig | null): Record<string, string | number> {
  const byName = new Map(doc.parts.map((p) => [p.name, p]));
  const value = Object.values(pc.parts).reduce((sum, name) => {
    const part = byName.get(name);
    return sum + (part ? partPrice(part, tax.entry(part.taxonomyId)) : 0);
  }, 0);
  return {
    Configuration: config?.name ?? 'Default',
    'Config Type': config?.type || 'Factory',
    Description: config?.description || `${config?.name ?? 'Default'} ${doc.meta.name} configuration.`,
    Value: value,
  };
}
