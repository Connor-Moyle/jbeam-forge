import type { Part, Project, VehicleConfig } from '../project/schema';
import { partPrice } from '../parts/materials';
import { pcPaints, type GamePaint } from '../paints/paints';
import { axleTag, bodyPart, SET_KINDS, slotTypeOf, type SuspensionSetData, type TaxonomyLookup } from './jbeam';

/**
 * Vehicle configurations (Phase 13): the slots a player can fill, what a
 * configuration puts in each (the default where it doesn't say), and which
 * parts end up on the car. Written out as the game's .pc files.
 */

type Doc = Pick<Project, 'meta' | 'parts' | 'variables'> & Partial<Pick<Project, 'axles' | 'assignments' | 'paints'>>;
/** Fitted suspensions' jbeam by set id: each fitted axle becomes a slot a configuration can leave empty. */
type Sets = Readonly<Record<string, Pick<SuspensionSetData, 'parts' | 'root'>>>;

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
  /** A fitted axle's slot: the project parts standing in for its suspension. */
  setPartIds?: string[];
}

/** Every slot, in menu order (parents before their children). */
export function slotChoices(doc: Pick<Project, 'parts'> & Partial<Pick<Project, 'meta' | 'axles' | 'assignments'>>, tax: TaxonomyLookup, sets?: Sets): SlotChoice[] {
  const parts = doc.parts.filter((p) => tax.entry(p.taxonomyId) && !SET_KINDS.has(p.taxonomyId));
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
  // Fitted axles hang on the body: a configuration can leave one off (a 4-wheel version of a 6-wheeler).
  const axles: SlotChoice[] = [];
  (doc.axles ?? []).forEach((axle, i) => {
    const data = axle.fitted && sets?.[axle.fitted.setId];
    if (!axle.fitted || !data || !doc.meta) return;
    const rootSlot = typeof data.parts[data.root]?.slotType === 'string' ? (data.parts[data.root]!.slotType as string) : data.root;
    const prefix = `${doc.meta.slug}_${axleTag(i)}_`;
    const source = `${axle.fitted.sourceId}:`;
    const setPartIds = [...new Set(Object.entries(doc.assignments ?? {}).flatMap(([k, id]) => (k.startsWith(source) ? [id] : [])))];
    axles.push({ slotType: `${prefix}${rootSlot}`, label: `${axle.name} suspension`, parent: body ? slotTypeOf(parts, body) : null, depth: 1, options: [{ name: `${prefix}${data.root}`, label: `${axle.fitted.vehicle} ${axle.fitted.name}` }], defaultPart: `${prefix}${data.root}`, core: false, setPartIds });
  });
  const at = body ? out.findIndex((s) => s.core) + 1 : out.length;
  out.splice(at, 0, ...axles);
  return out;
}

export interface PcFile {
  format: 2;
  model: string;
  parts: Record<string, string>;
  vars: Record<string, number>;
  /** The three paint slots (only when the project has paints). */
  paints?: GamePaint[];
}

/** A configuration as a .pc: every slot's part (defaults where the config says nothing), and its values. */
export function resolveConfig(doc: Doc, tax: TaxonomyLookup, config: VehicleConfig | null, sets?: Sets): PcFile {
  const parts: Record<string, string> = {};
  for (const slot of slotChoices(doc, tax, sets)) parts[slot.slotType] = slot.defaultPart;
  if (config) for (const [slot, name] of Object.entries(config.parts)) if (slot in parts) parts[slot] = name;
  return { format: 2, model: doc.meta.slug, parts, vars: { ...(config?.vars ?? {}) }, ...(doc.paints ? pcPaints({ paints: doc.paints }, config) : {}) };
}

/** The parts a configuration puts on the car (a part counts only when every slot above it is filled). */
export function includedParts(doc: Pick<Project, 'parts'> & Partial<Pick<Project, 'meta' | 'axles' | 'assignments'>>, tax: TaxonomyLookup, pc: PcFile, sets?: Sets): Set<string> {
  const parts = doc.parts.filter((p) => tax.entry(p.taxonomyId) && !SET_KINDS.has(p.taxonomyId));
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
  // Fitted sets are on the car unless the configuration leaves their axle empty.
  const offAxles = new Set(slotChoices(doc, tax, sets).flatMap((s) => (s.setPartIds && !pc.parts[s.slotType] ? s.setPartIds : [])));
  for (const p of doc.parts) if (SET_KINDS.has(p.taxonomyId) && !offAxles.has(p.id)) out.add(p.id);
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
