/**
 * Price and mass study: what official parts of each kind cost in game and
 * weigh (sum of their node weights), across every extracted car and truck.
 * Feeds the automatic price/mass defaults in taxonomy.json. Prints aggregates
 * only; nothing from the game files is copied into the repo.
 *
 *   npm run study-prices                 table of medians per part kind
 *   npm run study-prices -- --json out   also write { id: { price, mass, n } }
 *   npm run study-prices -- --kind hood  list the parts behind one kind
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import shipped from '../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../src/shared/taxonomy/schema';
import { CONFIDENT, Classifier } from '../src/shared/taxonomy/classify';
import { commonPrefix } from '../src/shared/taxonomy/tokenize';
import { parseJbeam, isJbeamObject, type JbeamObject } from '../src/shared/jbeam/parse';
import { readTable } from '../src/shared/jbeam/tables';

const root = resolve(import.meta.dirname, '..', 'scratch', 'vehicle-study');
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyKind = flag('--kind');
const jsonOut = flag('--json');

const TYPES = new Set(['car', 'truck']);
const classifier = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

interface Sample {
  vehicle: string;
  part: string;
  price: number | null;
  mass: number;
}
const byKind = new Map<string, Sample[]>();

function vehicleType(dir: string): string {
  const p = join(dir, 'info.json');
  if (!existsSync(p)) return '';
  const m = readFileSync(p, 'utf8').match(/"Type"\s*:\s*"([^"]+)"/);
  return (m?.[1] ?? '').toLowerCase();
}

for (const vehicle of readdirSync(root)) {
  const dir = join(root, vehicle);
  if (!existsSync(join(dir, 'info.json')) || !TYPES.has(vehicleType(dir))) continue;
  const parts: [string, JbeamObject][] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
    try {
      const doc = parseJbeam(readFileSync(join(dir, file), 'utf8')).value;
      if (!isJbeamObject(doc)) continue;
      for (const [name, raw] of Object.entries(doc)) if (isJbeamObject(raw)) parts.push([name, raw]);
    } catch {
      /* skip files the parser can't take */
    }
  }
  const prefix = commonPrefix(parts.map(([n]) => n));
  for (const [name, raw] of parts) {
    const c = classifier.classify(name, prefix);
    if (!c.taxonomyId || c.confidence < CONFIDENT) continue;
    const info = isJbeamObject(raw.information) ? raw.information : null;
    const price = typeof info?.value === 'number' ? info.value : null;
    let mass = 0;
    if (raw.nodes) {
      try {
        for (const r of readTable(raw.nodes).records) if (typeof r.options.nodeWeight === 'number') mass += r.options.nodeWeight;
      } catch {
        /* odd table */
      }
    }
    if (price === null && mass === 0) continue;
    const list = byKind.get(c.taxonomyId) ?? [];
    list.push({ vehicle, part: name, price, mass });
    byKind.set(c.taxonomyId, list);
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const quart = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))] ?? NaN;

if (onlyKind) {
  for (const s of (byKind.get(onlyKind) ?? []).sort((a, b) => (a.price ?? 0) - (b.price ?? 0)))
    console.log(`${s.vehicle.padEnd(12)} ${s.part.padEnd(48)} $${String(s.price ?? '—').padStart(6)}  ${s.mass.toFixed(1).padStart(7)} kg`);
  process.exit(0);
}

const out: Record<string, { price: number | null; mass: number | null; nPrice: number; nMass: number }> = {};
console.log(`kind                        n$   median $   (p25–p75)        nKg  median kg  (p25–p75)`);
for (const [kind, samples] of [...byKind].sort((a, b) => a[0].localeCompare(b[0]))) {
  // Free/zero-priced parts are placeholders ("empty" slots), not prices.
  const prices = samples.map((s) => s.price).filter((p): p is number => p !== null && p > 0);
  const masses = samples.map((s) => s.mass).filter((m) => m > 0);
  out[kind] = { price: prices.length ? median(prices) : null, mass: masses.length ? median(masses) : null, nPrice: prices.length, nMass: masses.length };
  const pr = prices.length ? `${median(prices).toFixed(0).padStart(8)}   (${quart(prices, 0.25).toFixed(0)}–${quart(prices, 0.75).toFixed(0)})` : '       —';
  const ms = masses.length ? `${median(masses).toFixed(1).padStart(9)}  (${quart(masses, 0.25).toFixed(1)}–${quart(masses, 0.75).toFixed(1)})` : '        —';
  console.log(`${kind.padEnd(26)} ${String(prices.length).padStart(4)} ${pr.padEnd(28)} ${String(masses.length).padStart(4)} ${ms}`);
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}
