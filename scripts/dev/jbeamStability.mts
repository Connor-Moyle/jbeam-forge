/**
 * Stability check for an exported vehicle folder, the way BeamNG integrates it:
 * explicit steps at 2000 Hz, so a beam whose spring (or damping) is too much
 * for the weight on its ends blows up on the first frame ("Instability detected").
 *
 *   npx tsx scripts/dev/jbeamStability.mts <vehicle folder>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';

const dir = process.argv[2]!;
const DT = 1 / 2000;
type Node = { id: string; pos: [number, number, number]; weight: number; part: string };
type Beam = { a: string; b: string; spring: number; damp: number; part: string; type: string };
const nodes = new Map<string, Node>();
const beams: Beam[] = [];
const parts: Record<string, JbeamObject> = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.jbeam'))) {
  const v = parseJbeam(readFileSync(join(dir, f), 'utf8')).value;
  if (isJbeamObject(v)) for (const [k, p] of Object.entries(v)) if (isJbeamObject(p)) parts[k] = p;
}
const pc = JSON.parse(readFileSync(join(dir, process.argv[3] ?? 'default.pc'), 'utf8'));
const chosen = new Set<string>(Object.values(pc.parts as Record<string, string>).filter(Boolean));
for (const k of Object.keys(parts)) if (parts[k]!.slotType === 'main') chosen.add(k);
for (const name of chosen) {
  const p = parts[name];
  if (!p) continue;
  if (p.nodes) for (const r of readTable(p.nodes).records) {
    const id = String(r.values.id);
    nodes.set(id, { id, pos: [Number(r.values.posX), Number(r.values.posY), Number(r.values.posZ)], weight: Number(r.options.nodeWeight ?? 25), part: name });
  }
  if (p.beams) for (const r of readTable(p.beams).records) {
    beams.push({ a: String(r.values['id1:']), b: String(r.values['id2:']), spring: Number(r.options.beamSpring ?? 4_300_000), damp: Number(r.options.beamDamp ?? 580), part: name, type: String(r.options.beamType ?? '|NORMAL') });
  }
}
const problems: string[] = [];
let worst = 0;
const byPart = new Map<string, number>();
for (const b of beams) {
  const A = nodes.get(b.a);
  const B = nodes.get(b.b);
  if (!A || !B) {
    problems.push(`${b.part}: beam ${b.a}-${b.b} names a missing node`);
    continue;
  }
  const len = Math.hypot(A.pos[0] - B.pos[0], A.pos[1] - B.pos[1], A.pos[2] - B.pos[2]);
  if (len < 0.005) problems.push(`${b.part}: beam ${b.a}-${b.b} is ${(len * 1000).toFixed(1)} mm long`);
  if (b.type.includes('BOUNDED') || b.type.includes('SUPPORT')) continue;
  const inv = 1 / A.weight + 1 / B.weight;
  const w = Math.sqrt(b.spring * inv) * DT; // must stay well under 2
  const c = b.damp * inv * DT; // must stay under 2
  const score = Math.max(w / 2, c / 2);
  worst = Math.max(worst, score);
  byPart.set(b.part, Math.max(byPart.get(b.part) ?? 0, score));
  if (score > 0.5) problems.push(`${b.part}: ${b.a}(${A.weight}kg)-${b.b}(${B.weight}kg) spring ${b.spring} damp ${b.damp} → ${score.toFixed(2)} of the limit`);
}
// Node sum per node: many beams on a light node add up.
const sumK = new Map<string, number>();
const sumC = new Map<string, number>();
for (const b of beams) for (const id of [b.a, b.b]) {
  sumK.set(id, (sumK.get(id) ?? 0) + b.spring);
  sumC.set(id, (sumC.get(id) ?? 0) + b.damp);
}
let worstNode = '';
let worstNodeScore = 0;
for (const [id, n] of nodes) {
  const s = Math.max(Math.sqrt((sumK.get(id) ?? 0) / n.weight) * DT / 2, ((sumC.get(id) ?? 0) / n.weight) * DT / 2);
  if (s > worstNodeScore) [worstNodeScore, worstNode] = [s, `${id} (${n.part}, ${n.weight} kg, Σk ${sumK.get(id)}, Σc ${sumC.get(id)})`];
  if (!(n.weight > 0)) problems.push(`${n.part}: node ${id} weighs ${n.weight}`);
}
const posKey = new Map<string, string>();
for (const [id, n] of nodes) {
  const k = n.pos.map((x) => x.toFixed(3)).join(',');
  const other = posKey.get(k);
  if (other) problems.push(`nodes ${other} and ${id} are in the same place`);
  posKey.set(k, id);
}
const total = [...nodes.values()].reduce((s, n) => s + n.weight, 0);
console.log(`${nodes.size} nodes, ${beams.length} beams, ${total.toFixed(0)} kg`);
console.log(`worst beam ${worst.toFixed(2)} of the limit; worst node ${worstNodeScore.toFixed(2)}: ${worstNode}`);
console.log([...byPart].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, s]) => `  ${p} ${s.toFixed(2)}`).join('\n'));
console.log(problems.length ? `${problems.length} problems:\n  ` + problems.slice(0, 60).join('\n  ') : 'no problems');

// Plain run at 2000 Hz, no sub-steps (as the game): gravity, a ground under the lowest node.
{
  const ids = [...nodes.keys()];
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const x = new Float64Array(n * 3);
  const v = new Float64Array(n * 3);
  const m = new Float64Array(n);
  ids.forEach((id, i) => {
    const nd = nodes.get(id)!;
    x.set(nd.pos, i * 3);
    m[i] = nd.weight;
  });
  let ground = Infinity;
  for (let i = 0; i < n; i++) ground = Math.min(ground, x[i * 3 + 2]!);
  ground -= 0.02;
  const bs = beams.filter((b) => index.has(b.a) && index.has(b.b) && !b.type.includes('SUPPORT'));
  const A = Int32Array.from(bs.map((b) => index.get(b.a)!));
  const B = Int32Array.from(bs.map((b) => index.get(b.b)!));
  const K = Float64Array.from(bs.map((b) => b.spring));
  const C = Float64Array.from(bs.map((b) => b.damp));
  const L = Float64Array.from(bs.map((_, k) => Math.hypot(x[A[k]! * 3]! - x[B[k]! * 3]!, x[A[k]! * 3 + 1]! - x[B[k]! * 3 + 1]!, x[A[k]! * 3 + 2]! - x[B[k]! * 3 + 2]!)));
  const f = new Float64Array(n * 3);
  const steps = Number(process.env.STEPS ?? 4000);
  let blew = '';
  for (let s = 0; s < steps && !blew; s++) {
    f.fill(0);
    for (let k = 0; k < A.length; k++) {
      const i = A[k]! * 3;
      const j = B[k]! * 3;
      const dx = x[j]! - x[i]!, dy = x[j + 1]! - x[i + 1]!, dz = x[j + 2]! - x[i + 2]!;
      const len = Math.hypot(dx, dy, dz) || 1e-9;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      const rv = (v[j]! - v[i]!) * ux + (v[j + 1]! - v[i + 1]!) * uy + (v[j + 2]! - v[i + 2]!) * uz;
      const t = K[k]! * (len - L[k]!) + C[k]! * rv;
      f[i]! += t * ux; f[i + 1]! += t * uy; f[i + 2]! += t * uz;
      f[j]! -= t * ux; f[j + 1]! -= t * uy; f[j + 2]! -= t * uz;
    }
    for (let i = 0; i < n; i++) {
      const w = 1 / m[i]!;
      v[i * 3]! += f[i * 3]! * w * DT;
      v[i * 3 + 1]! += f[i * 3 + 1]! * w * DT;
      v[i * 3 + 2]! += (f[i * 3 + 2]! * w - 9.81) * DT;
      for (let a = 0; a < 3; a++) x[i * 3 + a]! += v[i * 3 + a]! * DT;
      if (x[i * 3 + 2]! < ground) {
        x[i * 3 + 2] = ground;
        if (v[i * 3 + 2]! < 0) v[i * 3 + 2] = 0;
        v[i * 3]! *= 0.9;
        v[i * 3 + 1]! *= 0.9;
      }
      const sp = Math.hypot(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
      if (!(sp < 200)) blew = `${ids[i]} (${nodes.get(ids[i]!)!.part}) at ${(s * DT).toFixed(4)} s, ${sp.toFixed(0)} m/s`;
    }
  }
  console.log(blew ? `RUN: blew up — ${blew}` : `RUN: ${steps} steps (${(steps * DT).toFixed(1)} s) stable`);
}
