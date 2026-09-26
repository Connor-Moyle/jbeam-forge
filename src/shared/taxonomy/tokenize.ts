/**
 * Mesh-name tokenisation for classification (SPEC §4.3: "tokenised matching —
 * robust against real names like Driveline_Axel_Boot_Inner_Rear and
 * misspellings").
 *
 * Verified on the official Sunburst (418 names): compound words
 * (lowerarm, doorglass, fenderflare, tierod), official misspellings
 * (fenderfalre, raceing, braket), variant words (race, drift, widebody…) and
 * BeamNG position suffixes (_F/_R/_L/_FL…).
 */

/** Position tokens. "r" is ambiguous (rear/right) and resolved by the part's axis. */
export const CORNER_TOKENS: Record<string, string> = { fl: 'FL', fr: 'FR', rl: 'RL', rr: 'RR', lf: 'FL', rf: 'FR', lr: 'RL' };
export const FORE_TOKENS: Record<string, 'F' | 'R'> = { f: 'F', front: 'F', frt: 'F', rear: 'R', back: 'R' };
export const SIDE_TOKENS: Record<string, 'L' | 'R'> = { l: 'L', left: 'L', lh: 'L', lhs: 'L', right: 'R', rh: 'R', rhs: 'R' };
export const AMBIGUOUS_R = 'r';

/** Words that make a *variant* of a part, not a different part. */
export const VARIANT_WORDS = new Set([
  'race', 'racing', 'drift', 'custom', 'widebody', 'wide', 'offroad', 'rally', 'sport', 'sports', 'wagon', 'sedan', 'coupe', 'estate',
  'cut', 'pro', 'plain', 'simple', 'amateur', 'stock', 'old', 'new', 'alt', 'alternate', 'heavy', 'lowered', 'lifted', 'black', 'chrome',
  'carbon', 'welded', 'rev', 'kmh', 'mph', 'cup', 'dmg', 'damaged', 'basic', 'premium', 'luxury', 'taxi', 'tuner', 'aero', 'na', 'at', 'mt', 'awd', 'fwd', 'rwd',
  'blank', 'empty', 'grp', 'rs', 'gt', 'sp', 'track', 'street', 'drag', 'dirt', 'gravel', 'snow', 'short', 'long', 'tall', 'extended',
]);

/** Words naming a piece of the same part (merged, not a separate part or variant). */
export const SUBMESH_WORDS = new Set(['sheet', 'inner', 'outer', 'base', 'cap', 'support', 'bracket', 'int', 'ext', 'top', 'bottom', 'mesh', 'geo', 'pipe', 'pipes', 'lod', 'lod0', 'main', 'stuff', 'part', 'parts', 'body2', 'obj', 'shape']);

/** Known misspellings and spelling variants → canonical text (may be several words). */
export const SYNONYMS: Record<string, string> = {
  fenderfalre: 'fender flare',
  falre: 'flare',
  raceing: 'racing',
  braket: 'bracket',
  axel: 'axle',
  axels: 'axle',
  tyre: 'tire',
  tyres: 'tire',
  grill: 'grille',
  colour: 'color',
  centre: 'center',
  mudflaps: 'mudflap',
  wipers: 'wiper',
  seats: 'seat',
  pedal: 'pedals',
  gauge: 'gauges',
  quarterpanels: 'quarter panel',
  quarterpanel: 'quarter panel',
  sideskirt: 'side skirt',
  lowerarm: 'lower arm',
  upperarm: 'upper arm',
  trailingarm: 'trailing arm',
  tierod: 'tie rod',
  swaybar: 'sway bar',
  doorglass: 'door glass',
  doorpanel: 'door card',
  doorcard: 'door card',
  steeringwheel: 'steering wheel',
  steeringrack: 'steering rack',
  fueltank: 'fuel tank',
};

/**
 * Raw split: separators, camelCase, letter↔digit boundaries; lowercased.
 * Digits glued to a word are piece numbers ("pulley1", "lowerarm_R2" are
 * pieces of one part) and are dropped; free-standing numbers ("lettering_18")
 * survive as variant tokens.
 */
export function rawTokens(name: string): string[] {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, '') // file extensions
    .split(/[\s_\-.:/\\()[\]#,]+/)
    .map((t) => (/^[a-z]+\d+$/i.test(t) ? t.replace(/\d+$/, '') : t))
    .flatMap((t) => t.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/))
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** Damerau–Levenshtein distance capped at 2 (only "≤ 1?" matters here). */
export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

const MIN_SEGMENT = 3;
const FUZZY_MIN = 5;

/**
 * Split a compound token into vocabulary words ("lowerarm" → lower arm),
 * allowing one typo in segments of 5+ letters ("falre" → flare). Returns
 * null when no full segmentation exists. Prefers the fewest segments.
 */
export function segment(token: string, vocab: ReadonlySet<string>, fuzzyVocab: readonly string[]): string[] | null {
  const n = token.length;
  const best: (string[] | null)[] = Array<string[] | null>(n + 1).fill(null);
  best[0] = [];
  for (let end = MIN_SEGMENT; end <= n; end++) {
    for (let start = 0; start <= end - MIN_SEGMENT; start++) {
      const prev = best[start];
      if (!prev) continue;
      const piece = token.slice(start, end);
      let word: string | null = vocab.has(piece) ? piece : null;
      if (!word && piece.length >= FUZZY_MIN) word = fuzzyVocab.find((w) => Math.abs(w.length - piece.length) <= 1 && editDistance(w, piece) <= 1) ?? null;
      if (!word) continue;
      const candidate = [...prev, word];
      const current = best[end];
      if (!current || candidate.length < current.length) best[end] = candidate;
    }
  }
  return best[n] ?? null;
}

export interface Tokenized {
  /** Part words (what the thing is). */
  words: string[];
  /** Position hints found in the name. */
  corner: string | null;
  fore: 'F' | 'R' | null;
  side: 'L' | 'R' | null;
  /** A bare "r" (rear or right, depending on the part). */
  ambiguousR: boolean;
  /** Variant words and bare numbers/letters, in order. */
  variant: string[];
  /** Tokens that were neither vocabulary nor variant/submesh words. */
  unknown: string[];
}

/** Classify every token of a name (after the shared vehicle prefix is removed). */
export function tokenize(name: string, vocab: ReadonlySet<string>, fuzzyVocab: readonly string[], prefix: string | null = null): Tokenized {
  const lead = firstSegment(name);
  const tokens = rawTokens(prefix && lead === prefix ? name.slice(lead.length) : name);
  const out: Tokenized = { words: [], corner: null, fore: null, side: null, ambiguousR: false, variant: [], unknown: [] };

  const segVocab = segmentVocab(vocab);

  const place = (t: string, fromSegment: boolean, expanded = false): void => {
    const syn = expanded ? undefined : SYNONYMS[t];
    if (syn) {
      for (const w of syn.split(' ')) place(w, true, true);
      return;
    }
    if (CORNER_TOKENS[t]) out.corner = CORNER_TOKENS[t];
    else if (t === AMBIGUOUS_R) out.ambiguousR = true;
    else if (FORE_TOKENS[t]) out.fore = FORE_TOKENS[t];
    else if (SIDE_TOKENS[t]) out.side = SIDE_TOKENS[t];
    else if (VARIANT_WORDS.has(t) || /^\d+$/.test(t) || (t.length === 1 && /[a-z]/.test(t))) out.variant.push(t);
    else if (SUBMESH_WORDS.has(t)) return;
    else if (vocab.has(t)) out.words.push(t);
    else {
      // Compounds split only into known words ("mountbraket" → mount bracket), never recursively.
      const parts = !fromSegment && t.length >= MIN_SEGMENT * 2 ? segment(t, segVocab, fuzzyVocab) : null;
      if (parts) {
        for (const p of parts) place(p, true);
        return;
      }
      const fuzzy = t.length >= FUZZY_MIN ? fuzzyVocab.find((w) => editDistance(w, t) <= 1) : undefined;
      if (fuzzy) out.words.push(fuzzy);
      else out.unknown.push(t);
    }
  };
  for (const t of tokens) place(t, false);
  return out;
}

const segVocabCache = new WeakMap<ReadonlySet<string>, Set<string>>();

/** Taxonomy words plus every word the tokenizer already understands (synonym keys, variant and submesh words). */
function segmentVocab(vocab: ReadonlySet<string>): Set<string> {
  let s = segVocabCache.get(vocab);
  if (!s) {
    s = new Set([...vocab, ...Object.keys(SYNONYMS), ...VARIANT_WORDS, ...SUBMESH_WORDS, ...Object.keys(FORE_TOKENS), ...Object.keys(SIDE_TOKENS)]);
    segVocabCache.set(vocab, s);
  }
  return s;
}

/** Leading separator-delimited segment, lowercased ("sunburst2" in sunburst2_door_FL). */
export function firstSegment(name: string): string {
  return (name.split(/[\s_\-.:/\\]/)[0] ?? '').toLowerCase();
}

/**
 * The vehicle prefix shared by most names in one source ("sunburst2" in
 * sunburst2_door_FL), stripped before matching. Needs ≥ 60% agreement.
 */
export function commonPrefix(names: readonly string[]): string | null {
  if (names.length < 3) return null;
  const counts = new Map<string, number>();
  for (const n of names) {
    const first = firstSegment(n);
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const e of counts) if (!best || e[1] > best[1]) best = e;
  return best && best[1] / names.length >= 0.6 ? best[0] : null;
}
