import type { Project } from '../project/schema';
import { buildHinge } from './build';
import type { Hinge } from './schema';

type Doc = Pick<Project, 'nodes' | 'beams' | 'hinges'>;

export const HINGE_BEAM_KINDS = new Set(['hinge', 'mount', 'limit', 'support', 'popopen']);

/** Hinge-built node ids look like <prefix>h1, <prefix>h2, <prefix>lt, <prefix>lb (numbered on a clash). */
function isHingeNode(id: string, prefix: string): boolean {
  return id.startsWith(prefix) && /^(h1|h2|lt|lb)\d*$/.test(id.slice(prefix.length));
}

/** Take a part's hinge structure out again (before rebuilding it, or when the hinge is removed). */
export function clearHinge(doc: Pick<Project, 'nodes' | 'beams'>, partId: string, prefix: string): void {
  const gone = new Set(doc.nodes.filter((n) => n.partId === partId && isHingeNode(n.id, prefix)).map((n) => n.id));
  doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
  doc.beams = doc.beams.filter((b) => !(b.partId === partId && (HINGE_BEAM_KINDS.has(b.kind) || gone.has(b.id1) || gone.has(b.id2))));
}

/**
 * (Re)build a hinged part's hinge: its attachment beams (the temporary bolts)
 * go, the hinge structure comes in. Needs the part's own nodes and its
 * parent's; returns false when either is missing (nothing is changed then).
 */
export function applyHinge(doc: Doc, hinge: Hinge, parentNodeIds: ReadonlySet<string>, prefix: string): boolean {
  clearHinge(doc, hinge.partId, prefix);
  const partNodes = doc.nodes.filter((n) => n.partId === hinge.partId);
  const bodyNodes = doc.nodes.filter((n) => parentNodeIds.has(n.id));
  if (partNodes.length < 3 || bodyNodes.length < 3) return false;
  doc.beams = doc.beams.filter((b) => !(b.partId === hinge.partId && b.kind === 'attach'));
  const built = buildHinge(doc, hinge, partNodes, bodyNodes, prefix);
  doc.nodes.push(...built.nodes);
  doc.beams.push(...built.beams);
  return true;
}
