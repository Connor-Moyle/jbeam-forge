import type { Project, StructBeam, StructNode } from '../project/schema';
import { mountsHolding } from '../proxy/hold';
import { dist, distToLine, rotateAbout } from './geometry';
import type { Hinge, Vec3 } from './schema';

/**
 * Turn a hinge into structure on its part: replaces the part's attachment
 * beams (the temporary bolts) with what the stock vehicles use. All of it
 * belongs to the hinged part, so swapping a door variant takes its hinge along.
 */

type Doc = Pick<Project, 'nodes' | 'beams'>;

const HINGE_LINKS = 4; // body nodes each hinge node is braced to
const MOUNT_LINKS = 4; // part nodes each hinge/latch node is tied into
const SEAL_REACH = 0.12; // m: part and body nodes this close get a seal support
const MAX_SEALS = 10;

function nearest(nodes: readonly StructNode[], to: readonly number[], n: number, exclude?: ReadonlySet<string>): StructNode[] {
  return nodes
    .filter((x) => !exclude?.has(x.id))
    .map((x) => ({ x, d: dist(x.pos, to as Vec3) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((r) => r.x);
}

function freeId(taken: Set<string>, base: string): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
  taken.add(id);
  return id;
}

/** A hinge or latch node closer than this to one of the part's own would hang on a beam of no length: it is moved clear. */
const CLEAR = 0.012;
const CLEAR_BY = 0.03;

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** `pos`, moved a little along `along` when it sits on top of one of the part's nodes. */
function clearOf(partNodes: readonly StructNode[], pos: Vec3, along: Vec3): Vec3 {
  if (!partNodes.some((n) => dist(n.pos, pos) < CLEAR)) return pos;
  const u = unit(along);
  return [pos[0] + u[0] * CLEAR_BY, pos[1] + u[1] * CLEAR_BY, pos[2] + u[2] * CLEAR_BY];
}

/**
 * The part's nodes a hinge or latch node is tied into: the nearest few, and more until it is held
 * every way. A panel's nearest nodes are all on its skin, and a latch held by those alone gives
 * way across the skin: the pop-open spring pushed a door 15 mm out round its own latch (measured in
 * the game). The game ties a door's latch node to nearly every node of the door.
 *
 * Held is judged by angle, not distance: a bonnet catch's nearest body nodes were half a metre off
 * and all in one upright plane with it, so one of them 40 mm out of that plane held nothing. The
 * catch's body half sat 48 mm from where it belonged and the latch never closed.
 */
function mountsFor(partNodes: readonly StructNode[], pos: Vec3, links = MOUNT_LINKS): StructNode[] {
  const ranked = partNodes
    .map((x) => ({ x, d: dist(x.pos, pos) }))
    .filter((r) => r.d >= CLEAR)
    .sort((a, b) => a.d - b.d);
  return mountsHolding(
    pos,
    ranked.map((r) => r.x),
    links,
  );
}

const LIMITER_REACH = 0.8; // m from the hinge's middle a limiter's body end may be

/**
 * The body node for the opening limiter: one the far edge moves steadily away
 * from all the way to the opening angle (so the bounded beam goes taut there
 * and nowhere before), picking the one whose length changes most. A node on
 * or near the hinge line is useless: the far edge stays the same distance
 * from it however far it swings.
 */
function limiterAnchor(farPos: Vec3, bodyNodes: readonly StructNode[], hinge: Hinge, axisMid: Vec3): StructNode | null {
  const angle = hinge.openAngle * hinge.direction;
  const steps = 8;
  let best: StructNode | null = null;
  let bestGain = 0.05; // at least 5 % longer when fully open
  for (const b of bodyNodes) {
    if (dist(b.pos, axisMid) > LIMITER_REACH) continue;
    const lengths = Array.from({ length: steps + 1 }, (_, i) => dist(rotateAbout(farPos, hinge.axis[0], hinge.axis[1], (angle * i) / steps), b.pos));
    if (lengths.some((l, i) => i > 0 && l <= lengths[i - 1]!)) continue;
    const gain = lengths[steps]! / lengths[0]! - 1;
    if (gain > bestGain) {
      bestGain = gain;
      best = b;
    }
  }
  return best;
}

export interface HingeStructure {
  nodes: StructNode[];
  beams: StructBeam[];
  /** The hinge's special node ids, for export (coupler, triggers, limiter). */
  ids: { hinge: [string, string]; latchPart: string | null; latchBody: string | null; limiter: [string, string] | null };
}

/**
 * Build the hinge structure. `partNodes` are the hinged part's generated
 * nodes, `bodyNodes` those of the part it hangs on. `prefix` names the new
 * nodes (the part's node prefix).
 */
export function buildHinge(doc: Doc, hinge: Hinge, partNodes: readonly StructNode[], bodyNodes: readonly StructNode[], prefix: string): HingeStructure {
  const taken = new Set(doc.nodes.map((n) => n.id));
  const partId = hinge.partId;
  const weight = partNodes.length ? partNodes.reduce((m, n) => m + n.weight, 0) / partNodes.length : 1;
  const node = (base: string, pos: Vec3): StructNode => ({ id: freeId(taken, `${prefix}${base}`), partId, pos: pos.map((v) => Math.round(v * 1e4) / 1e4) as Vec3, weight: Math.round(weight * 1000) / 1000 || 0.5 });
  const beam = (a: string, b: string, kind: StructBeam['kind']): StructBeam => ({ id1: a, id2: b, partId, kind });
  const nodes: StructNode[] = [];
  const beams: StructBeam[] = [];

  // Hinge nodes sit exactly on the axis (moved along it when one of the part's nodes is already
  // there): braced into the part and, rigidly, to the body.
  const hingeNodes = hinge.axis.map((p, i) => node(`h${i + 1}`, clearOf(partNodes, [...p], sub(hinge.axis[1 - i]!, p))));
  nodes.push(...hingeNodes);
  for (const h of hingeNodes) {
    for (const p of mountsFor(partNodes, h.pos)) beams.push(beam(h.id, p.id, 'mount'));
    for (const b of mountsFor(bodyNodes, h.pos, HINGE_LINKS)) beams.push(beam(h.id, b.id, 'hinge'));
  }
  beams.push(beam(hingeNodes[0]!.id, hingeNodes[1]!.id, 'mount'));

  // Limiter: from the part node farthest from the axis to a body node it pulls away from as it opens.
  let limiter: [string, string] | null = null;
  const far = [...partNodes].sort((a, b) => distToLine(b.pos, hinge.axis[0], hinge.axis[1]) - distToLine(a.pos, hinge.axis[0], hinge.axis[1]))[0];
  const axisMid: Vec3 = [(hinge.axis[0][0] + hinge.axis[1][0]) / 2, (hinge.axis[0][1] + hinge.axis[1][1]) / 2, (hinge.axis[0][2] + hinge.axis[1][2]) / 2];
  const anchor = (far && limiterAnchor(far.pos, bodyNodes, hinge, axisMid)) ?? nearest(bodyNodes, axisMid, 1)[0];
  if (far && anchor) {
    beams.push(beam(far.id, anchor.id, 'limit'));
    limiter = [far.id, anchor.id];
  }

  // Latch: a node on the part and its twin on the body, joined in game by the coupler.
  let latchPart: string | null = null;
  let latchBody: string | null = null;
  if (hinge.latch) {
    // The pair sits just inside the part's edge, clear of the node the latch was placed on.
    const middle: Vec3 = partNodes.length ? [0, 1, 2].map((k) => partNodes.reduce((s, n) => s + n.pos[k]!, 0) / partNodes.length) as Vec3 : [...hinge.latch];
    const at = clearOf(partNodes, [...hinge.latch], sub(middle, hinge.latch));
    const lp = node('lt', at);
    const lb = node('lb', at);
    nodes.push(lp, lb);
    latchPart = lp.id;
    latchBody = lb.id;
    for (const p of mountsFor(partNodes, lp.pos)) beams.push(beam(lp.id, p.id, 'mount'));
    // The body's half is held the same way: on the nearest body nodes alone (all on one panel) it
    // gave towards the part, and a bonnet's catch stood 10 mm off.
    for (const b of mountsFor(bodyNodes, lb.pos)) beams.push(beam(lb.id, b.id, 'mount'));
    if (hinge.popOpen) {
      const push = nearest(partNodes, lp.pos, 2).at(-1);
      if (push) beams.push(beam(lb.id, push.id, 'popopen'));
    }
  }

  // Seals: the closed part rests on the body (compression only), away from the hinge line.
  const seals = partNodes
    .map((p) => ({ p, b: nearest(bodyNodes, p.pos, 1)[0], axisD: distToLine(p.pos, hinge.axis[0], hinge.axis[1]) }))
    .filter((r) => r.b && dist(r.p.pos, r.b.pos) <= SEAL_REACH && r.axisD > 0.1)
    .sort((a, b) => b.axisD - a.axisD)
    .slice(0, MAX_SEALS);
  for (const s of seals) beams.push(beam(s.p.id, s.b!.id, 'support'));

  return { nodes, beams, ids: { hinge: [hingeNodes[0]!.id, hingeNodes[1]!.id], latchPart, latchBody, limiter } };
}

/** Which node ids of a hinged part are its hinge/latch/limiter (from the beams stored in the document). */
export function hingeIds(doc: Pick<Project, 'beams' | 'nodes'>, partId: string): HingeStructure['ids'] {
  const own = doc.beams.filter((b) => b.partId === partId);
  const hingeNodes = [...new Set(own.filter((b) => b.kind === 'hinge').map((b) => b.id1))];
  const limit = own.find((b) => b.kind === 'limit');
  const pop = own.find((b) => b.kind === 'popopen');
  // The latch nodes are <prefix>lt and <prefix>lb, with a number when the name was taken: two front
  // doors share the prefix, so the right door's are dflt2 and dflb2 (and it lost its latch).
  const latchPart = doc.nodes.find((n) => n.partId === partId && /lt\d*$/.test(n.id))?.id ?? null;
  return { hinge: [hingeNodes[0] ?? '', hingeNodes[1] ?? ''], latchPart, latchBody: pop?.id1 ?? doc.nodes.find((n) => n.partId === partId && /lb\d*$/.test(n.id))?.id ?? null, limiter: limit ? [limit.id1, limit.id2] : null };
}
