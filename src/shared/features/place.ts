import type { Project } from '../project/schema';

/**
 * Where the extras go by default: plates on the middle of the bumpers' faces,
 * the hitch low behind the rear bumper, the nitrous bottle in the boot.
 * Worked out from the generated structure (BeamNG space: −Y forward, +Z up).
 */

type Vec3 = [number, number, number];
export type FeatureKind = 'plateFront' | 'plateRear' | 'hitch' | 'nitrous';

export function nodeBounds(doc: Pick<Project, 'nodes'>, partId: string | null): { min: Vec3; max: Vec3 } | null {
  const nodes = partId ? doc.nodes.filter((n) => n.partId === partId) : doc.nodes;
  if (!nodes.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const n of nodes)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, n.pos[i]!);
      max[i] = Math.max(max[i]!, n.pos[i]!);
    }
  return { min, max };
}

const r3 = (v: Vec3): Vec3 => v.map((x) => Math.round(x * 1000) / 1000) as Vec3;

/** The part a feature mounts to and where, or null when there's no structure to put it on. */
export function suggestFeature(doc: Pick<Project, 'nodes' | 'parts'>, bodyId: string | null, kind: FeatureKind): { partId: string; pos: Vec3 } | null {
  const bumper = (pos: 'F' | 'R') => doc.parts.find((p) => p.taxonomyId === 'bumper' && p.position === pos && !p.variantOf && doc.nodes.some((n) => n.partId === p.id));
  const mount = kind === 'plateFront' ? bumper('F') : kind === 'nitrous' ? undefined : bumper('R');
  const partId = mount?.id ?? bodyId;
  if (!partId) return null;
  const b = nodeBounds(doc, partId) ?? nodeBounds(doc, null);
  if (!b) return null;
  const cx = (b.min[0] + b.max[0]) / 2;
  const h = b.max[2] - b.min[2];
  const len = b.max[1] - b.min[1];
  switch (kind) {
    case 'plateFront':
      return { partId, pos: r3([cx, b.min[1] - 0.005, b.min[2] + h * 0.45]) };
    case 'plateRear':
      return { partId, pos: r3([cx, b.max[1] + 0.005, b.min[2] + h * 0.55]) };
    case 'hitch':
      return { partId, pos: r3([cx, b.max[1] + 0.08, b.min[2] + h * 0.1]) };
    case 'nitrous':
      return { partId, pos: r3([cx, b.max[1] - len * 0.15, b.min[2] + h * 0.3]) };
  }
}
