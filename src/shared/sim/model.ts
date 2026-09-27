import type { Part, Project } from '../project/schema';
import type { TaxonomyEntry } from '../taxonomy/schema';
import { materialDefaults } from '../parts/materials';
import { partSettings } from '../proxy/generate';
import { beamPhysics } from '../proxy/beamValues';
import { STABILITY_DT, STABILITY_OK, STABILITY_UNSTABLE } from '../proxy/derive';
import type { SimModel } from './solver';

/**
 * Project → sandbox model (SPEC §4.6). Simulates the *default configuration*
 * (base parts, no variants — they overlap in space), with the same beam values
 * the exporter writes (see proxy/beamValues.ts).
 */

type Doc = Pick<Project, 'parts' | 'nodes' | 'beams' | 'proxy'>;

export interface TaxonomyLookup {
  entry(id: string): TaxonomyEntry | undefined;
}

/** Parts in the simulated configuration: every base part (variants excluded). */
export function simParts(doc: Pick<Doc, 'parts'>): Part[] {
  return doc.parts.filter((p) => !p.variantOf);
}

export function buildSimModel(doc: Doc, tax: TaxonomyLookup, parts: readonly Part[] = simParts(doc)): SimModel {
  const include = new Set(parts.map((p) => p.id));
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const nodes = doc.nodes.filter((n) => include.has(n.partId));
  const index = new Map<string, number>();
  nodes.forEach((n, i) => index.set(n.id, i));
  const n = nodes.length;
  const pos = new Float64Array(n * 3);
  const mass = new Float64Array(n);
  const friction = new Float64Array(n).fill(0.5); // official median frictionCoef
  const collide = new Uint8Array(n).fill(1);
  nodes.forEach((node, i) => {
    pos.set(node.pos, i * 3);
    mass[i] = node.weight;
  });

  const beams = doc.beams.filter((b) => include.has(b.partId) && index.has(b.id1) && index.has(b.id2));
  const m = beams.length;
  const model: SimModel = {
    nodeIds: nodes.map((x) => x.id),
    pos,
    mass,
    friction,
    collide,
    beamA: new Uint32Array(m),
    beamB: new Uint32Array(m),
    spring: new Float64Array(m),
    damp: new Float64Array(m),
    deform: new Float64Array(m),
    strength: new Float64Array(m),
    expansionLimit: new Float64Array(m),
    compressionLimit: new Float64Array(m),
    beamType: new Uint8Array(m),
    breakGroup: new Int32Array(m).fill(-1),
    breakGroups: [],
    beamPart: [],
  };
  const groupIndex = new Map<string, number>();
  beams.forEach((b, k) => {
    const part = byId.get(b.partId)!;
    const entry = tax.entry(part.taxonomyId);
    const preset = entry ? materialDefaults(entry, part.constructionMaterial).beamPreset : 'panel_metal';
    const attachment = entry ? partSettings(doc, part, entry).attachment : 'bolted';
    const v = beamPhysics(b.kind, preset, attachment, part.name);
    model.beamA[k] = index.get(b.id1)!;
    model.beamB[k] = index.get(b.id2)!;
    model.spring[k] = v.beamSpring;
    model.damp[k] = v.beamDamp;
    model.deform[k] = v.beamDeform;
    model.strength[k] = v.beamStrength ?? Infinity;
    model.expansionLimit[k] = v.deformLimitExpansion;
    model.compressionLimit[k] = 0.5; // a beam may crush to half its length
    model.beamPart.push(b.partId);
    if (v.breakGroup) {
      let g = groupIndex.get(v.breakGroup);
      if (g === undefined) {
        g = model.breakGroups.length;
        model.breakGroups.push(v.breakGroup);
        groupIndex.set(v.breakGroup, g);
      }
      model.breakGroup[k] = g;
    }
  });
  return model;
}

export interface PrecheckIssue {
  severity: 'error' | 'warning';
  code: 'orphan' | 'near-orphan' | 'islands' | 'zero-beam' | 'duplicate-beam' | 'unstable' | 'marginal';
  message: string;
  nodeIds?: string[];
}

/** Static checks that need no simulation (SPEC §4.6): run instantly on every structure change. */
export function precheck(model: SimModel): PrecheckIssue[] {
  const issues: PrecheckIssue[] = [];
  const n = model.mass.length;
  const m = model.beamA.length;
  const degree = new Uint32Array(n);
  const springSum = new Float64Array(n);
  const seen = new Set<string>();
  const dupes: string[] = [];
  const zero: string[] = [];
  for (let b = 0; b < m; b++) {
    const a = model.beamA[b]!;
    const c = model.beamB[b]!;
    degree[a]!++;
    degree[c]!++;
    springSum[a]! += model.spring[b]!;
    springSum[c]! += model.spring[b]!;
    const key = a < c ? `${a}_${c}` : `${c}_${a}`;
    if (seen.has(key)) dupes.push(`${model.nodeIds[a]}–${model.nodeIds[c]}`);
    seen.add(key);
    const L = Math.hypot(model.pos[c * 3]! - model.pos[a * 3]!, model.pos[c * 3 + 1]! - model.pos[a * 3 + 1]!, model.pos[c * 3 + 2]! - model.pos[a * 3 + 2]!);
    if (L < 0.002) zero.push(`${model.nodeIds[a]}–${model.nodeIds[c]}`);
  }
  const orphans: string[] = [];
  const near: string[] = [];
  for (let i = 0; i < n; i++) {
    if (degree[i] === 0) orphans.push(model.nodeIds[i]!);
    else if (degree[i]! <= 2) near.push(model.nodeIds[i]!);
  }
  if (orphans.length) issues.push({ severity: 'error', code: 'orphan', message: `${orphans.length} node(s) have no beams and will fall away: ${orphans.slice(0, 8).join(', ')}`, nodeIds: orphans });
  if (near.length) issues.push({ severity: 'warning', code: 'near-orphan', message: `${near.length} node(s) hang on only 1–2 beams (they flop): ${near.slice(0, 8).join(', ')}`, nodeIds: near });
  if (zero.length) issues.push({ severity: 'error', code: 'zero-beam', message: `${zero.length} beam(s) shorter than 2 mm (unstable): ${zero.slice(0, 6).join(', ')}` });
  if (dupes.length) issues.push({ severity: 'warning', code: 'duplicate-beam', message: `${dupes.length} duplicate beam(s): ${dupes.slice(0, 6).join(', ')}` });

  // Islands: parts not connected to the rest fall off.
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (let b = 0; b < m; b++) parent[find(model.beamA[b]!)] = find(model.beamB[b]!);
  const sizes = new Map<number, number>();
  for (let i = 0; i < n; i++) if (degree[i]) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
  if (sizes.size > 1) {
    const list = [...sizes.values()].sort((a, b) => b - a);
    issues.push({ severity: 'error', code: 'islands', message: `${sizes.size} disconnected structures (largest ${list[0]} nodes, then ${list.slice(1, 6).join(', ')}): the smaller ones are not attached to the car.` });
  }

  // Stability predictor (same calibration as generation).
  const unstable: string[] = [];
  const marginal: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(springSum[i]! / Math.max(1e-9, model.mass[i]!)) * STABILITY_DT;
    if (r > STABILITY_UNSTABLE) unstable.push(`${model.nodeIds[i]} (${model.mass[i]!.toFixed(2)} kg, ω·Δt ${r.toFixed(1)})`);
    else if (r > STABILITY_OK) marginal.push(model.nodeIds[i]!);
  }
  if (unstable.length) issues.push({ severity: 'error', code: 'unstable', message: `${unstable.length} node(s) will likely explode: ${unstable.slice(0, 4).join('; ')} — add mass or soften their beams`, nodeIds: unstable });
  if (marginal.length) issues.push({ severity: 'warning', code: 'marginal', message: `${marginal.length} node(s) are near the stability limit (within official content's range)`, nodeIds: marginal });
  return issues;
}
