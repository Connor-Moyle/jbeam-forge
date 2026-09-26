import { useMemo } from 'react';
import { create } from 'zustand';
import shipped from '@shared/taxonomy/taxonomy.json';
import { mergeTaxonomy, TaxonomyEntrySchema, TaxonomyFileSchema, validateTaxonomy, type TaxonomyEntry } from '@shared/taxonomy/schema';
import { Classifier } from '@shared/taxonomy/classify';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { EMPTY_ARR } from '@shared/empty';

const logger = rlog('taxonomy');

/**
 * Layered taxonomy (SPEC §4.3): shipped < user (userData/user-taxonomy.json)
 * < project (doc.customTaxonomy). The merged result drives classification,
 * the assignment menus and slot nesting.
 */

const SHIPPED: readonly TaxonomyEntry[] = TaxonomyFileSchema.parse(shipped).entries;

interface UserTaxonomyState {
  entries: readonly TaxonomyEntry[];
  setEntries: (entries: readonly TaxonomyEntry[]) => void;
}

export const useUserTaxonomy = create<UserTaxonomyState>()((set) => ({
  entries: EMPTY_ARR,
  setEntries: (entries) => set({ entries }),
}));

export async function loadUserTaxonomy(): Promise<void> {
  try {
    useUserTaxonomy.getState().setEntries(await call('taxonomy:getUser'));
  } catch (err) {
    logger.warn('could not load user taxonomy:', err instanceof Error ? err.message : String(err));
  }
}

/** Add or replace one user-level entry (persisted by main after validation). */
export async function saveUserEntry(entry: TaxonomyEntry): Promise<void> {
  const current = useUserTaxonomy.getState().entries.filter((e) => e.id !== entry.id);
  useUserTaxonomy.getState().setEntries(await call('taxonomy:saveUser', { entries: [...current, entry] }));
}

/** Project entries are stored loosely in the document; invalid ones are skipped (and logged once). */
const warned = new Set<string>();
function projectEntries(raw: readonly unknown[]): TaxonomyEntry[] {
  const out: TaxonomyEntry[] = [];
  for (const r of raw) {
    const parsed = TaxonomyEntrySchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
    else {
      const key = JSON.stringify(r);
      if (!warned.has(key)) logger.warn('skipping invalid project taxonomy entry:', key.slice(0, 200));
      warned.add(key);
    }
  }
  return out;
}

export interface Taxonomy {
  entries: readonly TaxonomyEntry[];
  classifier: Classifier;
  entry(id: string): TaxonomyEntry | undefined;
}

let cache: { user: readonly TaxonomyEntry[]; project: readonly unknown[]; value: Taxonomy } | null = null;

/** Merged taxonomy for the given layers (memoised on layer identity; the Classifier is costly). */
export function buildTaxonomy(user: readonly TaxonomyEntry[], project: readonly unknown[]): Taxonomy {
  if (cache && cache.user === user && cache.project === project) return cache.value;
  let entries = mergeTaxonomy(SHIPPED, user, projectEntries(project));
  const problems = validateTaxonomy(entries);
  if (problems.length) {
    logger.warn('custom taxonomy has problems; ignoring project layer:', problems.map((p) => `${p.id}: ${p.problem}`).join('; '));
    entries = mergeTaxonomy(SHIPPED, user);
  }
  const classifier = new Classifier(entries);
  const value: Taxonomy = { entries, classifier, entry: (id) => classifier.entry(id) };
  cache = { user, project, value };
  return value;
}

export function currentTaxonomy(): Taxonomy {
  return buildTaxonomy(useUserTaxonomy.getState().entries, projectStore.getState().doc?.customTaxonomy ?? EMPTY_ARR);
}

export function useTaxonomy(): Taxonomy {
  const user = useUserTaxonomy((s) => s.entries);
  const project = useProjectStore((s) => s.doc?.customTaxonomy ?? EMPTY_ARR);
  return useMemo(() => buildTaxonomy(user, project), [user, project]);
}

/** Validate a would-be custom entry against the current merged taxonomy. */
export function checkCustomEntry(entry: TaxonomyEntry): string[] {
  const t = currentTaxonomy();
  return validateTaxonomy(mergeTaxonomy(t.entries, [entry])).map((p) => `${p.id}: ${p.problem}`);
}

const CATEGORY_TOKENS: Record<string, string> = {
  'Body & Structure': '--cat-body',
  Panels: '--cat-panel',
  'Bumpers & Aero': '--cat-panel',
  'Exterior Trim': '--cat-panel',
  Lights: '--cat-light',
  Glass: '--cat-glass',
  Interior: '--cat-interior',
  Mechanical: '--cat-mechanical',
};

/** Category colour (a design token) for tree dots and badges; custom categories fall back to misc. */
export function categoryColor(category: string | undefined): string {
  return `var(${(category && CATEGORY_TOKENS[category]) ?? '--cat-misc'})`;
}
