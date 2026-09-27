/**
 * Score auto-classification against a project someone assigned by hand.
 *
 *   npm run project-bench -- "Template Car/hirochi_sunburst_6.jbforge"
 *
 * Every mesh the user assigned (split pieces excluded: the classifier never
 * sees those names) is classified from its name alone and compared with the
 * user's part kind and position. Local projects only; nothing is committed.
 */
import { readFileSync } from 'node:fs';
import shipped from '../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../src/shared/taxonomy/schema';
import { Classifier } from '../src/shared/taxonomy/classify';
import { commonPrefix } from '../src/shared/taxonomy/tokenize';
import { parseProject } from '../src/shared/project/io';

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run project-bench -- <project.jbforge>');
const { project } = parseProject(readFileSync(file, 'utf8'));
const classifier = new Classifier(TaxonomyFileSchema.parse(shipped).entries);
const nameOf = (key: string) => key.slice(key.indexOf(':') + 1);
const byId = new Map(project.parts.map((p) => [p.id, p]));
const rows = Object.entries(project.assignments)
  .filter(([key]) => !key.startsWith('split:') && !nameOf(key).includes('/'))
  .map(([key, partId]) => ({ name: nameOf(key), part: byId.get(partId)! }));
const prefix = commonPrefix(rows.map((r) => r.name), classifier.vocab);

let kind = 0;
let both = 0;
let none = 0;
const wrong: string[] = [];
for (const { name, part } of rows) {
  const c = classifier.classify(name, prefix);
  if (!c.taxonomyId) {
    none++;
    continue;
  }
  if (c.taxonomyId === part.taxonomyId) kind++;
  if (c.taxonomyId === part.taxonomyId && (c.position ?? null) === (part.position ?? null)) both++;
  else wrong.push(`  ${name.padEnd(42)} you: ${part.taxonomyId} ${part.position ?? ''}   classifier: ${c.taxonomyId} ${c.position ?? ''} (${c.confidence.toFixed(2)})`);
}
const n = rows.length;
console.log(`${file}: ${n} hand-assigned meshes (prefix "${prefix ?? '—'}")`);
console.log(`  same kind            ${kind}/${n} (${((100 * kind) / n).toFixed(0)}%)`);
console.log(`  same kind + position ${both}/${n} (${((100 * both) / n).toFixed(0)}%)`);
console.log(`  left unassigned      ${none}/${n} (no usable name)`);
if (wrong.length) console.log(`\nDisagreements:\n${wrong.join('\n')}`);
