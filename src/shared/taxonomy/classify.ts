import type { PositionAxis, TaxonomyEntry } from './schema';
import { commonPrefix, tokenize, type Tokenized } from './tokenize';
import { placement, positionCompat } from './positions';

/**
 * Tokenised auto-classification (SPEC §4.3).
 *
 * Every entry contributes phrases (its id words, its label words and each
 * name hint). A phrase matches a mesh name when all its words appear among
 * the name's part words. An entry's score is how much of the name (IDF-
 * weighted) its matched phrases explain; ties go to the entry naming the
 * name's head noun (the last part word: "bumper splitter" is a splitter).
 * Words naming an ancestor kind count as explained context once the entry
 * itself matches ("bumper_custom_splitter" is fully explained by splitter,
 * whose parent is bumper).
 */

export interface Classification {
  taxonomyId: string | null;
  position: string | null;
  /** Variant key ("race", "widebody_drift"…); "" for the base part. */
  variant: string;
  /** 0–1 share of the name the match explains. */
  confidence: number;
  tokens: Tokenized;
}

export const CONFIDENT = 0.75;
export const MINIMUM = 0.5;

/**
 * Words whose meaning depends on where the thing is: a light at the front is a
 * headlight, at the back a taillight; a window at a corner is door glass.
 */
const POSITIONAL: Record<string, { front: string; rear: string; corner?: string }> = {
  light: { front: 'headlight', rear: 'taillight' },
  lights: { front: 'headlight', rear: 'taillight' },
  lamp: { front: 'headlight', rear: 'taillight' },
  window: { front: 'windshield', rear: 'rear_window', corner: 'door_glass' },
  windows: { front: 'windshield', rear: 'rear_window', corner: 'door_glass' },
  glass: { front: 'windshield', rear: 'rear_window', corner: 'door_glass' },
};
/** Grouping words that say where a part lives, not what it is. */
const CONTEXT_WORDS = new Set(['interior', 'exterior', 'body', 'extra']);
const POSITIONAL_CONFIDENCE = 0.8;

interface Phrase {
  words: string[];
  weight: number;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

export class Classifier {
  readonly vocab: Set<string>;
  readonly fuzzyVocab: string[];
  private readonly phrases = new Map<string, Phrase[]>();
  private readonly idf = new Map<string, number>();
  private readonly byId: Map<string, TaxonomyEntry>;

  constructor(readonly entries: readonly TaxonomyEntry[]) {
    this.byId = new Map(entries.map((e) => [e.id, e]));
    const df = new Map<string, number>();
    const raw = new Map<string, string[][]>();
    for (const e of entries) {
      const list = [words(e.id.replace(/_/g, ' ')), words(e.label), ...e.nameHints.map(words)].filter((p) => p.length > 0);
      raw.set(e.id, list);
      for (const w of new Set(list.flat())) df.set(w, (df.get(w) ?? 0) + 1);
    }
    const n = entries.length;
    for (const [w, d] of df) this.idf.set(w, Math.log(1 + n / d));
    for (const [id, list] of raw) this.phrases.set(id, list.map((p) => ({ words: p, weight: p.reduce((s, w) => s + (this.idf.get(w) ?? 1), 0) })));
    this.vocab = new Set(df.keys());
    this.fuzzyVocab = [...this.vocab].filter((w) => w.length >= 5);
  }

  entry(id: string): TaxonomyEntry | undefined {
    return this.byId.get(id);
  }

  private weight(w: string): number {
    return this.idf.get(w) ?? 1;
  }

  classify(name: string, prefix: string | null = null): Classification {
    const tokens = tokenize(name, this.vocab, this.fuzzyVocab, prefix);
    const nameWords = [...new Set(tokens.words)];
    const empty: Classification = { taxonomyId: null, position: null, variant: variantKey(tokens), confidence: 0, tokens };
    if (nameWords.length === 0) return empty;
    const present = new Set(nameWords);
    const total = nameWords.reduce((s, w) => s + this.weight(w), 0) + tokens.unknown.length * 0.5; // unknown words dilute confidence
    const head = nameWords[nameWords.length - 1]!;

    let best: { id: string; score: number; head: boolean; phraseLen: number } | null = null;
    for (const e of this.entries) {
      const covered = new Set<string>();
      let longest = 0;
      for (const p of this.phrases.get(e.id) ?? []) {
        if (p.words.every((w) => present.has(w))) {
          p.words.forEach((w) => covered.add(w));
          longest = Math.max(longest, p.words.length);
        }
      }
      if (covered.size === 0) continue;
      const own = covered.has(head);
      for (let a = e.parent ? this.byId.get(e.parent) : undefined, guard = 0; a && guard < 32; a = a.parent ? this.byId.get(a.parent) : undefined, guard++) {
        for (const p of this.phrases.get(a.id) ?? []) if (p.words.every((w) => present.has(w))) p.words.forEach((w) => covered.add(w));
      }
      // "interior_Dash" is fully explained by the dashboard: its category says it's interior.
      for (const w of words(`${e.category} ${e.subcategory}`)) if (present.has(w)) covered.add(w);
      const score = [...covered].reduce((s, w) => s + this.weight(w), 0) / total;
      const hasHead = own;
      const better =
        !best ||
        score > best.score + 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && ((hasHead && !best.head) || (hasHead === best.head && longest > best.phraseLen)));
      if (better) best = { id: e.id, score, head: hasHead, phraseLen: longest };
    }
    if (!best || best.score < MINIMUM) return this.byPosition(tokens) ?? { ...empty, confidence: best?.score ?? 0 };
    const entry = this.byId.get(best.id)!;
    return { taxonomyId: best.id, position: resolvePosition(entry.positionAxis, tokens), variant: variantKey(tokens), confidence: Math.min(1, best.score), tokens };
  }

  /** Names like light_FL or window_R: the one part word only makes sense with its position. */
  private byPosition(tokens: Tokenized): Classification | null {
    const meaningful = [...tokens.words, ...tokens.unknown].filter((w) => !CONTEXT_WORDS.has(w));
    if (meaningful.length !== 1) return null;
    const rule = POSITIONAL[meaningful[0]!];
    if (!rule) return null;
    const fore = tokens.corner ? tokens.corner[0] : (tokens.fore ?? (tokens.ambiguousR ? 'R' : null));
    const id = tokens.corner && rule.corner ? rule.corner : fore === 'F' ? rule.front : fore === 'R' ? rule.rear : null;
    const entry = id ? this.byId.get(id) : undefined;
    if (!entry) return null;
    return { taxonomyId: entry.id, position: resolvePosition(entry.positionAxis, tokens), variant: variantKey(tokens), confidence: POSITIONAL_CONFIDENCE, tokens };
  }
}

/** Only explicit variant words (race, widebody, a/b, numbers) make a variant; unknown words are usually sub-pieces (stalk, strap) and stay in the part. */
export function variantKey(t: Tokenized): string {
  return t.variant.join('_');
}

export function resolvePosition(axis: PositionAxis, t: Tokenized): string | null {
  switch (axis) {
    case 'none':
      return null;
    case 'corner': {
      if (t.corner) return t.corner;
      // A bare "r" fills whichever half is missing (bumper_R_flare_L → RL, door_F_R → FR).
      const fore = t.fore ?? (t.ambiguousR && t.side ? 'R' : null);
      const side = t.side ?? (t.ambiguousR && t.fore ? 'R' : null);
      return fore && side ? `${fore === 'F' ? 'F' : 'R'}${side}` : null;
    }
    case 'fr':
      if (t.fore) return t.fore;
      if (t.corner) return t.corner[0]!;
      return t.ambiguousR ? 'R' : null;
    case 'lr':
      if (t.side) return t.side;
      if (t.corner) return t.corner[1]!;
      return t.ambiguousR ? 'R' : null;
  }
}

// ---------------------------------------------------------------- part proposals

export interface MeshRef {
  key: string;
  name: string;
}

export interface ProposedPart {
  /** Temporary id, stable within one proposal. */
  id: string;
  taxonomyId: string;
  position: string | null;
  variant: string;
  /** Id of the base part this is a variant of, or null. */
  variantOf: string | null;
  parentPartId: string | null;
  meshKeys: string[];
  confidence: number;
}

export interface Proposal {
  parts: ProposedPart[];
  /** Mesh key → proposed part id. */
  assignments: Record<string, string>;
  unassigned: string[];
  /** Assigned, but below CONFIDENT: worth a human look. */
  lowConfidence: string[];
}

/** Group classified meshes into parts, link variants, and resolve parents by taxonomy + position. */
export function proposeParts(meshes: readonly MeshRef[], classifier: Classifier): Proposal {
  const prefix = commonPrefix(meshes.map((m) => m.name), classifier.vocab);
  const groups = new Map<string, ProposedPart>();
  const assignments: Record<string, string> = {};
  const unassigned: string[] = [];
  const lowConfidence: string[] = [];

  for (const m of meshes) {
    const c = classifier.classify(m.name, prefix);
    if (!c.taxonomyId) {
      unassigned.push(m.key);
      continue;
    }
    const gk = `${c.taxonomyId}|${c.position ?? ''}|${c.variant}`;
    let part = groups.get(gk);
    if (!part) {
      part = { id: `p${groups.size + 1}`, taxonomyId: c.taxonomyId, position: c.position, variant: c.variant, variantOf: null, parentPartId: null, meshKeys: [], confidence: c.confidence };
      groups.set(gk, part);
    }
    part.meshKeys.push(m.key);
    part.confidence = Math.min(part.confidence, c.confidence);
    assignments[m.key] = part.id;
    if (c.confidence < CONFIDENT) lowConfidence.push(m.key);
  }

  const parts = [...groups.values()];
  // Variants: parts of the same kind + position; the unsuffixed (or largest) one is the base.
  const byKindPos = new Map<string, ProposedPart[]>();
  for (const p of parts) {
    const k = `${p.taxonomyId}|${p.position ?? ''}`;
    byKindPos.set(k, [...(byKindPos.get(k) ?? []), p]);
  }
  for (const list of byKindPos.values()) {
    if (list.length < 2) continue;
    const base = list.find((p) => p.variant === '') ?? [...list].sort((a, b) => b.meshKeys.length - a.meshKeys.length)[0]!;
    for (const p of list) if (p !== base) p.variantOf = base.id;
  }

  // Parents: nearest ancestor kind that exists, preferring a compatible position.
  const bases = parts.filter((p) => p.variantOf === null);
  const place = (p: ProposedPart) => placement(classifier.entry(p.taxonomyId)?.positionAxis, p.position);
  for (const p of parts) {
    const at = place(p);
    let kind = classifier.entry(p.taxonomyId)?.parent ?? null;
    while (kind) {
      const candidates = bases.filter((b) => b.taxonomyId === kind && b !== p);
      if (candidates.length) {
        const scored = candidates.map((b) => ({ b, s: positionCompat(at, place(b)) })).sort((x, y) => y.s - x.s);
        if (scored[0]!.s > 0) {
          p.parentPartId = scored[0]!.b.id;
          break;
        }
      }
      kind = classifier.entry(kind)?.parent ?? null;
    }
  }
  return { parts, assignments, unassigned, lowConfidence };
}
