/**
 * Classifier benchmark (Phase 3c).
 *
 *   npm run classify:bench -- sunburst2
 *
 * 1. Agreement with the hand-labelled fixture (tests/fixtures/classify/<id>-expected.json).
 * 2. Coverage over every mesh name of the vehicle's DAE, when a local study
 *    exists (scratch/vehicle-study/<id>/dae-nodes.json from `npm run study-vehicle`).
 * 3. The proposed part tree, to eyeball parent resolution.
 *
 * Game data never leaves scratch/; only names are read.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import shipped from '../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../src/shared/taxonomy/schema';
import { CONFIDENT, Classifier, proposeParts } from '../src/shared/taxonomy/classify';
import { commonPrefix } from '../src/shared/taxonomy/tokenize';

interface Fixture {
  prefix: string;
  expected: [string, string, string | null][];
}

const id = process.argv[2] ?? 'sunburst2';
const verbose = process.argv.includes('--verbose');
const root = resolve(import.meta.dirname, '..');
const classifier = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

const fixturePath = join(root, 'tests/fixtures/classify', `${id}-expected.json`);
if (existsSync(fixturePath)) {
  const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
  let kind = 0;
  let both = 0;
  const misses: string[] = [];
  for (const [name, taxonomyId, position] of fx.expected) {
    const c = classifier.classify(name, fx.prefix);
    const k = c.taxonomyId === taxonomyId;
    const p = k && c.position === position;
    if (k) kind++;
    if (p) both++;
    if (!p) misses.push(`  ${name.padEnd(46)} expected ${taxonomyId}${position ? ` ${position}` : ''}, got ${c.taxonomyId ?? '—'}${c.position ? ` ${c.position}` : ''} (${c.confidence.toFixed(2)})`);
  }
  const n = fx.expected.length;
  console.log(`Fixture ${id}: ${n} hand-labelled names`);
  console.log(`  kind agreement            ${kind}/${n} (${((100 * kind) / n).toFixed(1)}%)`);
  console.log(`  kind + position agreement ${both}/${n} (${((100 * both) / n).toFixed(1)}%)`);
  if (misses.length) console.log(misses.join('\n'));
} else {
  console.log(`No fixture at ${fixturePath}`);
}

const studyPath = join(root, 'scratch/vehicle-study', id, 'dae-nodes.json');
if (existsSync(studyPath)) {
  const names = Object.values(JSON.parse(readFileSync(studyPath, 'utf8')) as Record<string, string[]>).flat();
  const prefix = commonPrefix(names);
  let classified = 0;
  let confident = 0;
  const unassigned: string[] = [];
  for (const name of names) {
    const c = classifier.classify(name, prefix);
    if (c.taxonomyId) classified++;
    else unassigned.push(name);
    if (c.taxonomyId && c.confidence >= CONFIDENT) confident++;
  }
  console.log(`\nCoverage over ${names.length} mesh names (prefix "${prefix ?? '—'}"):`);
  console.log(`  classified ${classified} (${((100 * classified) / names.length).toFixed(1)}%), confident ${confident}, unassigned ${unassigned.length}`);
  if (unassigned.length) console.log(unassigned.map((u) => `    ${u}`).join('\n'));

  const proposal = proposeParts(
    names.map((n) => ({ key: n, name: n })),
    classifier,
  );
  const bases = proposal.parts.filter((p) => !p.variantOf);
  console.log(`\nProposed ${proposal.parts.length} parts (${bases.length} base, ${proposal.parts.length - bases.length} variants)`);
  if (verbose) {
    const byParent = new Map<string | null, typeof proposal.parts>();
    for (const p of proposal.parts) byParent.set(p.parentPartId, [...(byParent.get(p.parentPartId) ?? []), p]);
    const label = (p: (typeof proposal.parts)[number]) => `${p.taxonomyId}${p.position ? `_${p.position}` : ''}${p.variant ? ` [${p.variant}]` : ''}${p.variantOf ? ' (variant)' : ''} ×${p.meshKeys.length}`;
    const walk = (parent: string | null, depth: number) => {
      for (const p of byParent.get(parent) ?? []) {
        console.log(`${'  '.repeat(depth + 1)}${label(p)}`);
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
  }
} else {
  console.log(`\n(No local study at ${studyPath}; run npm run study-vehicle -- ${id} for full coverage numbers.)`);
}
