/**
 * How each part of a generated project holds up in the app's physics: the car
 * settled on stands for a few seconds, each part's worst sag and drift.
 *
 *   npx tsx scripts/dev/simParts.mts <project doc json> [seconds]
 */
import { readFileSync } from 'node:fs';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { mergeTaxonomy, TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { buildSimModel } from '../../src/shared/sim/model';
import { settle } from '../../src/shared/sim/scenarios';

const doc = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const entries = mergeTaxonomy(TaxonomyFileSchema.parse(shipped).entries, []);
const byId = new Map(entries.map((e) => [e.id, e]));
const tax = { entry: (id: string) => byId.get(id) };
const model = buildSimModel(doc, tax);
const r = settle(model, Number(process.argv[3] ?? 3), 'stands');
const name = new Map<string, string>(doc.parts.map((p: { id: string; displayName: string }) => [p.id, p.displayName]));
// Movement of each node minus the body's average (the car is lifted onto the stands first).
const bodyId = doc.parts.find((p: { taxonomyId: string; variantOf?: string }) => p.taxonomyId === 'body' && !p.variantOf)?.id;
const mean = [0, 0, 0];
let count = 0;
model.nodePart.forEach((pid, i) => {
  if (pid !== bodyId) return;
  for (let k = 0; k < 3; k++) mean[k]! += r.positions[i * 3 + k]! - model.pos[i * 3 + k]!;
  count++;
});
for (let k = 0; k < 3; k++) mean[k]! /= Math.max(1, count);
const rel = (i: number) => Math.hypot(...[0, 1, 2].map((k) => r.positions[i * 3 + k]! - model.pos[i * 3 + k]! - mean[k]!));
const worst = new Map<string, number>();
model.nodePart.forEach((pid, i) => worst.set(pid, Math.max(worst.get(pid) ?? 0, rel(i))));
console.log(r.summary.join('\n'));
for (const [pid, d] of [...worst].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(d * 1000).toFixed(0).padStart(6)} mm  ${name.get(pid) ?? pid}`);

// One part's nodes in detail: SHOW=<display name>.
const show = process.env.SHOW;
if (show) {
  const pid = doc.parts.find((p: { displayName: string }) => p.displayName === show)?.id;
  const attached = new Set<number>();
  for (let b = 0; b < model.beamA.length; b++) if (model.beamPart[b] === pid) for (const i of [model.beamA[b]!, model.beamB[b]!]) if (model.nodePart[i] !== pid) attached.add(model.beamA[b]! === i ? model.beamB[b]! : model.beamA[b]!);
  model.nodePart.forEach((p, i) => {
    if (p !== pid) return;
    const d = [0, 1, 2].map((k) => (r.positions[i * 3 + k]! - model.pos[i * 3 + k]! - mean[k]!) * 1000);
    console.log(`  ${model.nodeIds[i]!.padEnd(8)} ${model.mass[i]!.toFixed(2)} kg  moved ${d.map((v) => v.toFixed(0).padStart(5)).join(' ')} mm ${attached.has(i) ? 'attached' : ''}`);
  });
  let springs = 0;
  let attachSprings = 0;
  for (let b = 0; b < model.beamA.length; b++) if (model.beamPart[b] === pid) (model.nodePart[model.beamA[b]!] === pid && model.nodePart[model.beamB[b]!] === pid ? (springs += model.spring[b]!) : (attachSprings += model.spring[b]!));
  console.log(`  own springs ${springs.toFixed(0)}, attach springs ${attachSprings.toFixed(0)}`);
}
