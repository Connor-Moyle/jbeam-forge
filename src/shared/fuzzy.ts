/**
 * Small fuzzy matcher for search-first pickers. Scores word-prefix hits
 * highest, then substrings, then in-order subsequences; 0 = no match.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  const terms = q.split(/\s+/);
  let total = 0;
  for (const term of terms) {
    const s = termScore(term, t);
    if (s === 0) return 0;
    total += s;
  }
  return total / terms.length;
}

function termScore(term: string, t: string): number {
  if (t === term) return 100;
  if (t.startsWith(term)) return 90;
  const words = t.split(/[^a-z0-9]+/);
  if (words.some((w) => w.startsWith(term))) return 80;
  const at = t.indexOf(term);
  if (at !== -1) return 60 - Math.min(at, 20);
  // Subsequence ("dgl" → door glass), penalised by gaps.
  let ti = 0;
  let gaps = 0;
  for (const ch of term) {
    const next = t.indexOf(ch, ti);
    if (next === -1) return 0;
    gaps += next - ti;
    ti = next + 1;
  }
  return Math.max(1, 40 - gaps);
}

/** Items sorted by best score over their search texts (non-matches dropped; stable for ties). */
export function fuzzyFilter<T>(items: readonly T[], query: string, texts: (item: T) => readonly string[]): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, i) => ({ item, i, s: Math.max(0, ...texts(item).map((x) => fuzzyScore(query, x))) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.item);
}
