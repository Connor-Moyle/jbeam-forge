import type { Project, StructBeam, StructNode } from '../project/schema';
import { dist, distToLine } from './geometry';
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

  // Hinge nodes sit exactly on the axis: braced into the part and, rigidly, to the body.
  const hingeNodes = hinge.axis.map((p, i) => node(`h${i + 1}`, [...p]));
  nodes.push(...hingeNodes);
  for (const h of hingeNodes) {
    for (const p of nearest(partNodes, h.pos, MOUNT_LINKS)) beams.push(beam(h.id, p.id, 'mount'));
    for (const b of nearest(bodyNodes, h.pos, HINGE_LINKS)) beams.push(beam(h.id, b.id, 'hinge'));
  }
  beams.push(beam(hingeNodes[0]!.id, hingeNodes[1]!.id, 'mount'));

  // Limiter: from the part node farthest from the axis to the body node nearest the axis' middle.
  let limiter: [string, string] | null = null;
  const far = [...partNodes].sort((a, b) => distToLine(b.pos, hinge.axis[0], hinge.axis[1]) - distToLine(a.pos, hinge.axis[0], hinge.axis[1]))[0];
  const axisMid: Vec3 = [(hinge.axis[0][0] + hinge.axis[1][0]) / 2, (hinge.axis[0][1] + hinge.axis[1][1]) / 2, (hinge.axis[0][2] + hinge.axis[1][2]) / 2];
  const anchor = nearest(bodyNodes, axisMid, 1)[0];
  if (far && anchor) {
    beams.push(beam(far.id, anchor.id, 'limit'));
    limiter = [far.id, anchor.id];
  }

  // Latch: a node on the part and its twin on the body, joined in game by the coupler.
  let latchPart: string | null = null;
  let latchBody: string | null = null;
  if (hinge.latch) {
    const lp = node('lt', [...hinge.latch]);
    const lb = node('lb', [...hinge.latch]);
    nodes.push(lp, lb);
    latchPart = lp.id;
    latchBody = lb.id;
    for (const p of nearest(partNodes, lp.pos, MOUNT_LINKS)) beams.push(beam(lp.id, p.id, 'mount'));
    for (const b of nearest(bodyNodes, lb.pos, MOUNT_LINKS)) beams.push(beam(lb.id, b.id, 'mount'));
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
  const latchPart = doc.nodes.find((n) => n.partId === partId && n.id.endsWith('lt'))?.id ?? null;
  return { hinge: [hingeNodes[0] ?? '', hingeNodes[1] ?? ''], latchPart, latchBody: pop?.id1 ?? doc.nodes.find((n) => n.partId === partId && n.id.endsWith('lb'))?.id ?? null, limiter: limit ? [limit.id1, limit.id2] : null };
}
