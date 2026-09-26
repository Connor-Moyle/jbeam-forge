/**
 * Structure study (Phase 4 ground truth, SPEC §3.1): statistics of an
 * extracted official vehicle's nodes/beams/triangles, so generated proxies
 * use official-scale numbers and conventions. Prints aggregates only;
 * nothing from the game files is copied into the repo.
 *
 *   npm run study-structure -- sunburst2        (after npm run study-vehicle -- sunburst2)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseJbeam, isJbeamObject, type JbeamObject, type JbeamValue } from '../src/shared/jbeam/parse';
import { readTable } from '../src/shared/jbeam/tables';

const id = process.argv[2] ?? 'sunburst2';

/** Scalars as text; tables/objects as JSON (never "[object Object]"). */
function str(v: JbeamValue | undefined): string {
  return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : `${v}`;
}
const dir = resolve(import.meta.dirname, '..', 'scratch', 'vehicle-study', id);

interface PartStats {
  file: string;
  part: string;
  slotType: string;
  nodes: number;
  beams: number;
  tris: number;
  mass: number;
  flexbodies: number;
  groups: Set<string>;
}

const parts: PartStats[] = [];
const numeric = new Map<string, number[]>(); // "<section>.<key>" → values
const strings = new Map<string, Map<string, number>>();
const beamTypes = new Map<string, number>();
const nodeIdShapes = new Map<string, number>();
const breakGroups = { beamsWith: 0, beamsTotal: 0, distinct: new Set<string>() };
const deformGroups = new Set<string>();
const edgeLengths: number[] = [];
let lrPairs = 0;
let lrCandidates = 0;

function push(key: string, v: number) {
  const list = numeric.get(key) ?? [];
  list.push(v);
  numeric.set(key, list);
}
function count(key: string, v: string) {
  const m = strings.get(key) ?? new Map<string, number>();
  m.set(v, (m.get(v) ?? 0) + 1);
  strings.set(key, m);
}

/** Letter-run skeleton of a node id: "b12rr" → "a0a", "fr3l" → "a0a". */
function idShape(nodeId: string): string {
  return nodeId.replace(/[a-z]+/gi, 'a').replace(/[0-9]+/g, '0');
}

for (const file of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
  let doc: JbeamObject;
  try {
    const parsed = parseJbeam(readFileSync(join(dir, file), 'utf8')).value;
    if (!isJbeamObject(parsed)) continue;
    doc = parsed;
  } catch {
    continue;
  }
  for (const [partName, raw] of Object.entries(doc)) {
    if (!isJbeamObject(raw)) continue;
    const stats: PartStats = { file, part: partName, slotType: str(raw.slotType ?? ''), nodes: 0, beams: 0, tris: 0, mass: 0, flexbodies: 0, groups: new Set() };
    const pos = new Map<string, [number, number, number]>();
    if (raw.nodes) {
      try {
        for (const r of readTable(raw.nodes).records) {
          const nid = str(r.values.id ?? '');
          const p: [number, number, number] = [Number(r.values.posX), Number(r.values.posY), Number(r.values.posZ)];
          pos.set(nid, p);
          stats.nodes++;
          nodeIdShapes.set(idShape(nid), (nodeIdShapes.get(idShape(nid)) ?? 0) + 1);
          const w = r.options.nodeWeight;
          if (typeof w === 'number') {
            push('nodes.nodeWeight', w);
            stats.mass += w;
          }
          for (const k of ['frictionCoef', 'collision', 'selfCollision', 'nodeMaterial', 'fixed'] as const) {
            const v = r.options[k];
            if (typeof v === 'number') push(`nodes.${k}`, v);
            else if (v !== undefined) count(`nodes.${k}`, str(v));
          }
          const g = r.options.group;
          if (typeof g === 'string' && g) stats.groups.add(g);
          else if (Array.isArray(g)) g.forEach((x) => stats.groups.add(str(x)));
        }
      } catch {
        /* tolerate odd tables */
      }
      // l/r pairing: ids ending in l with a matching r at mirrored X.
      for (const [nid, p] of pos) {
        if (!/l$/.test(nid)) continue;
        lrCandidates++;
        const twin = pos.get(nid.replace(/l$/, 'r'));
        if (twin && Math.abs(twin[0] + p[0]) < 0.01 && Math.abs(twin[1] - p[1]) < 0.01) lrPairs++;
      }
    }
    if (raw.beams) {
      try {
        for (const r of readTable(raw.beams).records) {
          stats.beams++;
          breakGroups.beamsTotal++;
          for (const k of ['beamSpring', 'beamDamp', 'beamDeform', 'beamStrength', 'deformLimitExpansion', 'beamPrecompression', 'beamLongBound', 'beamShortBound', 'dampCutoffHz']) {
            const v = r.options[k];
            if (typeof v === 'number') push(`beams.${k}`, v);
            else if (typeof v === 'string') count(`beams.${k}`, v);
          }
          const t = r.options.beamType;
          beamTypes.set(str(t ?? '(normal)'), (beamTypes.get(str(t ?? '(normal)')) ?? 0) + 1);
          const bg = r.options.breakGroup;
          if (bg !== undefined && bg !== '') {
            breakGroups.beamsWith++;
            (Array.isArray(bg) ? bg : [bg]).forEach((x: JbeamValue) => breakGroups.distinct.add(str(x)));
          }
          const dg = r.options.deformGroup;
          if (typeof dg === 'string' && dg) deformGroups.add(dg);
          const a = pos.get(str(r.values['id1:']));
          const b = pos.get(str(r.values['id2:']));
          if (a && b) edgeLengths.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
        }
      } catch {
        /* tolerate */
      }
    }
    if (raw.triangles) {
      try {
        stats.tris = readTable(raw.triangles).records.length;
      } catch {
        /* tolerate */
      }
    }
    if (raw.flexbodies) {
      try {
        stats.flexbodies = readTable(raw.flexbodies).records.length;
      } catch {
        /* tolerate */
      }
    }
    if (stats.nodes || stats.beams || stats.flexbodies) parts.push(stats);
  }
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] ?? NaN;
};
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toExponential(2) : n.toFixed(3).replace(/\.?0+$/, ''));
const summary = (xs: number[]) => `n=${xs.length} min=${fmt(q(xs, 0))} p10=${fmt(q(xs, 0.1))} median=${fmt(q(xs, 0.5))} p90=${fmt(q(xs, 0.9))} max=${fmt(q(xs, 1))}`;

console.log(`# Structure study: ${id} (${parts.length} parts with structure or flexbodies)\n`);
const structural = parts.filter((p) => p.nodes > 0);
console.log(`Totals: ${structural.reduce((n, p) => n + p.nodes, 0)} nodes, ${structural.reduce((n, p) => n + p.beams, 0)} beams, ${structural.reduce((n, p) => n + p.tris, 0)} triangles in ${structural.length} parts`);
console.log(`Nodes per part: ${summary(structural.map((p) => p.nodes))}`);
console.log(`Beams per node: ${summary(structural.filter((p) => p.nodes > 3).map((p) => p.beams / p.nodes))}`);
console.log(`Part mass (kg, sum of nodeWeight): ${summary(structural.map((p) => p.mass).filter((m) => m > 0))}`);
console.log(`Beam length (m): ${summary(edgeLengths)}`);
console.log(`\nLargest parts by nodes:`);
for (const p of [...structural].sort((a, b) => b.nodes - a.nodes).slice(0, 15)) console.log(`  ${p.part.padEnd(40)} nodes ${str(p.nodes).padStart(4)}  beams ${str(p.beams).padStart(5)}  tris ${str(p.tris).padStart(4)}  mass ${fmt(p.mass).padStart(7)} kg  flexbodies ${p.flexbodies}`);
console.log(`\nNumeric options:`);
for (const [k, xs] of [...numeric].sort()) console.log(`  ${k.padEnd(28)} ${summary(xs)}`);
console.log(`\nString options:`);
for (const [k, m] of [...strings].sort()) console.log(`  ${k.padEnd(28)} ${[...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, n]) => `${v}×${n}`).join(', ')}`);
console.log(`\nBeam types: ${[...beamTypes].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(', ')}`);
console.log(`breakGroup: ${breakGroups.beamsWith}/${breakGroups.beamsTotal} beams, ${breakGroups.distinct.size} distinct; deformGroups: ${deformGroups.size}`);
console.log(`Node id shapes: ${[...nodeIdShapes].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s}×${n}`).join(', ')}`);
console.log(`l/r mirrored pairs: ${lrPairs}/${lrCandidates} ids ending in "l" have an "r" twin at mirrored X`);

// Per part-kind beam/node medians (for beam presets by part type).
const KINDS: [string, RegExp][] = [
  ['body', /_body_(sedan|wagon)$/],
  ['hood', /_hood$/],
  ['door', /_door_[FR][LR]$/],
  ['fender', /_fender_[LR]$/],
  ['bumper', /_bumper_[FR]$/],
  ['glass', /_(windshield|rearglass|sideglass|doorglass)/],
  ['trunk/tailgate', /_(trunk|tailgate)/],
  ['spoiler/wing', /_(spoiler|bigwing|wing)/],
  ['sideskirt', /_sideskirt/],
  ['radiator', /_radiator$/],
  ['engine', /_engine_\d_\d$|_engine$/],
  ['transaxle', /_transaxle/],
  ['suspension', /_suspension_[FR]$/],
  ['exhaust', /_exhaust/],
  ['fueltank', /_fueltank$/],
];
console.log(`\nPer part-kind medians (spring / damp / deform / strength / nodeWeight, beams-per-node, tris-per-node):`);
for (const [label, re] of KINDS) {
  const hits: { spring: number[]; damp: number[]; deform: number[]; strength: number[]; weight: number[]; bpn: number[]; tpn: number[]; names: string[] } = { spring: [], damp: [], deform: [], strength: [], weight: [], bpn: [], tpn: [], names: [] };
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
    let doc: JbeamValue;
    try {
      doc = parseJbeam(readFileSync(join(dir, file), 'utf8')).value;
    } catch {
      continue;
    }
    if (!isJbeamObject(doc)) continue;
    for (const [partName, raw] of Object.entries(doc)) {
      if (!re.test(partName) || !isJbeamObject(raw) || !raw.nodes || !raw.beams) continue;
      try {
        const nodes = readTable(raw.nodes).records;
        const beams = readTable(raw.beams).records;
        hits.names.push(partName);
        for (const r of nodes) if (typeof r.options.nodeWeight === 'number') hits.weight.push(r.options.nodeWeight);
        for (const r of beams) {
          if (r.options.beamType !== '|NORMAL' && r.options.beamType !== undefined) continue;
          for (const [k, arr] of [['beamSpring', hits.spring], ['beamDamp', hits.damp], ['beamDeform', hits.deform], ['beamStrength', hits.strength]] as const) {
            const v = r.options[k];
            if (typeof v === 'number') arr.push(v);
          }
        }
        if (nodes.length) hits.bpn.push(beams.length / nodes.length);
        if (nodes.length && raw.triangles) hits.tpn.push(readTable(raw.triangles).records.length / nodes.length);
      } catch {
        /* tolerate */
      }
    }
  }
  if (!hits.names.length) continue;
  const m = (xs: number[]) => (xs.length ? fmt(q(xs, 0.5)) : '—');
  console.log(`  ${label.padEnd(15)} parts ${str(hits.names.length).padStart(2)}  spring ${m(hits.spring)}  damp ${m(hits.damp)}  deform ${m(hits.deform)}  strength ${m(hits.strength)}  nodeWeight ${m(hits.weight)}  b/n ${m(hits.bpn)}  t/n ${m(hits.tpn)}`);
}

// Attachment beams: beams with an endpoint that the part doesn't define (it belongs to the parent part).
{
  const perPart: number[] = [];
  const withBreak: number[] = [];
  const spring: number[] = [];
  const strength: number[] = [];
  const deform: number[] = [];
  let total = 0;
  let broken = 0;
  const examples: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
    let doc: JbeamValue;
    try {
      doc = parseJbeam(readFileSync(join(dir, file), 'utf8')).value;
    } catch {
      continue;
    }
    if (!isJbeamObject(doc)) continue;
    for (const [partName, raw] of Object.entries(doc)) {
      if (!isJbeamObject(raw) || !raw.nodes || !raw.beams) continue;
      try {
        const own = new Set(readTable(raw.nodes).records.map((r) => str(r.values.id)));
        if (own.size < 4) continue;
        let n = 0;
        let b = 0;
        for (const r of readTable(raw.beams).records) {
          const a = str(r.values['id1:']);
          const c = str(r.values['id2:']);
          if (own.has(a) && own.has(c)) continue;
          n++;
          if (r.options.breakGroup) b++;
          if (typeof r.options.beamSpring === 'number') spring.push(r.options.beamSpring);
          if (typeof r.options.beamStrength === 'number') strength.push(r.options.beamStrength);
          if (typeof r.options.beamDeform === 'number') deform.push(r.options.beamDeform);
        }
        if (n) {
          perPart.push(n);
          withBreak.push(b / n);
          total += n;
          broken += b;
          if (examples.length < 6 && /hood|door_F|fender_L|bumper_F$/.test(partName)) examples.push(`${partName}: ${n} attach beams, ${b} with breakGroup`);
        }
      } catch {
        /* tolerate */
      }
    }
  }
  console.log(`\nAttachment beams (to parent nodes): ${total} in ${perPart.length} parts; per part ${summary(perPart)}; ${broken} (${Math.round((100 * broken) / Math.max(1, total))}%) carry a breakGroup`);
  console.log(`  spring ${summary(spring)}`);
  console.log(`  strength ${summary(strength)}`);
  console.log(`  deform ${summary(deform)}`);
  for (const e of examples) console.log(`  e.g. ${e}`);
}

// Stability calibration: per node ω·Δt with ω = √(Σ incident spring / nodeWeight), Δt = 1/2000 s.
{
  const dt = 1 / 2000;
  const nodeW = new Map<string, number>();
  const nodeK = new Map<string, number>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
    let doc: JbeamValue;
    try {
      doc = parseJbeam(readFileSync(join(dir, file), 'utf8')).value;
    } catch {
      continue;
    }
    if (!isJbeamObject(doc)) continue;
    // Only the default sedan configuration's body family, to avoid mixing variants that share node ids.
    for (const [partName, raw] of Object.entries(doc)) {
      if (!isJbeamObject(raw)) continue;
      if (/_wagon|_race|_rally|_drift|_custom|_wide|_offroad|_proD|_cut|_alt|_lightweight|_cf/.test(partName)) continue;
      try {
        if (raw.nodes) for (const r of readTable(raw.nodes).records) if (typeof r.options.nodeWeight === 'number') nodeW.set(str(r.values.id), r.options.nodeWeight);
        if (raw.beams)
          for (const r of readTable(raw.beams).records) {
            const k = r.options.beamSpring;
            if (typeof k !== 'number') continue;
            for (const id of [str(r.values['id1:']), str(r.values['id2:'])]) nodeK.set(id, (nodeK.get(id) ?? 0) + k);
          }
      } catch {
        /* tolerate */
      }
    }
  }
  const ratios: number[] = [];
  let worst = { id: '', r: 0, w: 0, k: 0 };
  for (const [id, k] of nodeK) {
    const w = nodeW.get(id);
    if (!w) continue;
    const r = Math.sqrt(k / w) * dt;
    ratios.push(r);
    if (r > worst.r) worst = { id, r, w, k };
  }
  console.log(`\nStability calibration ω·Δt (ω = √(Σk/m), Δt = 1/2000): ${summary(ratios)}; p99 ${fmt(q(ratios, 0.99))}`);
  console.log(`  stiffest node: ${worst.id} ${fmt(worst.w)} kg, Σk ${fmt(worst.k)} → ${fmt(worst.r)}`);
}

// Parts that show a mesh (flexbodies) without nodes of their own: they ride on another part's node group.
{
  const riders = parts.filter((p) => p.flexbodies > 0 && p.nodes === 0);
  const own = parts.filter((p) => p.flexbodies > 0 && p.nodes > 0);
  const kind = (name: string) => name.replace(/^sunburst2_/, '').replace(/_(F|R|FL|FR|RL|RR|L)$/i, '').split('_')[0]!;
  const tally = (list: PartStats[]) => {
    const m = new Map<string, number>();
    for (const p of list) m.set(kind(p.part), (m.get(kind(p.part)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(', ');
  };
  console.log(`\nMeshed parts WITHOUT own nodes (ride on another part's nodes): ${riders.length} — ${tally(riders)}`);
  console.log(`Meshed parts WITH own nodes: ${own.length} — ${tally(own)}`);
  const small = own.filter((p) => p.nodes <= 4);
  console.log(`Meshed parts with ≤ 4 own nodes: ${small.length} — ${tally(small)}`);
}
