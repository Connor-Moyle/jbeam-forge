import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/shared/project/schema';
import { adoptManualNodes, applyMove, beamKey, centroid, connectNodes, deleteBeams, deleteNodes, mergeNodes, mirrorPartners, planMove, renameNode, setNodeAxis, softWeight, splitBeams } from '../../src/shared/structure/edit';

type Doc = Pick<Project, 'nodes' | 'beams' | 'tris' | 'proxy'>;

function makeDoc(): Doc {
  return {
    nodes: [
      { id: 'n1l', partId: 'p1', pos: [0.5, 1, 0.3], weight: 1 },
      { id: 'n1r', partId: 'p1', pos: [-0.5, 1, 0.3], weight: 1 },
      { id: 'n2l', partId: 'p2', pos: [1.5, 2, 0.6], weight: 1 },
      { id: 'n2r', partId: 'p2', pos: [-1.5, 2, 0.6], weight: 1 },
      { id: 'n3', partId: 'p1', pos: [0, 1, 0.3], weight: 1 },
      { id: 'lone', partId: 'p2', pos: [0.8, 3, 0.1], weight: 1 },
    ],
    beams: [
      { id1: 'n1l', id2: 'n1r', partId: 'p1', kind: 'edge' },
      { id1: 'n2l', id2: 'n2r', partId: 'p2', kind: 'edge' },
      { id1: 'n2l', id2: 'n1l', partId: 'p1', kind: 'attach' },
    ],
    tris: [{ ids: ['n1l', 'n1r', 'n3'], partId: 'p1' }],
    proxy: { parts: {}, refNodes: { ref: 'n3', back: 'n1l', left: 'n1l', up: 'n2l', leftCorner: 'n2l', rightCorner: 'n2r' } },
  };
}

describe('structure editing', () => {
  it('beam keys ignore endpoint order', () => {
    expect(beamKey('a', 'b')).toBe(beamKey('b', 'a'));
  });

  it('finds mirror partners by position; centre-line and unmatched nodes have none', () => {
    const p = mirrorPartners(makeDoc().nodes);
    expect(p.get('n1l')).toBe('n1r');
    expect(p.get('n1r')).toBe('n1l');
    expect(p.get('n2l')).toBe('n2r');
    expect(p.has('n3')).toBe(false);
    expect(p.has('lone')).toBe(false);
  });

  it('soft falloff is 1 at the centre, ½ halfway and 0 at the edge', () => {
    expect(softWeight(0, 1)).toBe(1);
    expect(softWeight(0.5, 1)).toBeCloseTo(0.5);
    expect(softWeight(1, 1)).toBe(0);
    expect(softWeight(0, 0)).toBe(0);
  });

  it('a plain move only moves the selection', () => {
    const moves = planMove(makeDoc().nodes, ['n1l'], [0.1, 0.2, 0.3], { symmetry: false, softRadius: 0 });
    expect([...moves.keys()]).toEqual(['n1l']);
    expect(moves.get('n1l')).toEqual([0.1, 0.2, 0.3]);
  });

  it('symmetry mirrors the partner and keeps centre-line nodes on the centre line', () => {
    const doc = makeDoc();
    const moves = planMove(doc.nodes, ['n1l'], [0.1, 0.2, 0.3], { symmetry: true, softRadius: 0 });
    expect(moves.get('n1r')).toEqual([-0.1, 0.2, 0.3]);
    const centre = planMove(doc.nodes, ['n3'], [0.1, 0.2, 0], { symmetry: true, softRadius: 0 });
    expect(centre.get('n3')).toEqual([0, 0.2, 0]);
  });

  it('soft-move drags nearby nodes with falloff, limited to the chosen parts', () => {
    const doc = makeDoc();
    // n3 is 0.5 m from n1l (half weight); n1r is exactly 1 m away (zero); n2l is ~1.45 m away (outside).
    const moves = planMove(doc.nodes, ['n1l'], [0.2, 0, 0], { symmetry: false, softRadius: 1 });
    expect(moves.get('n3')![0]).toBeCloseTo(0.1);
    expect(moves.has('n1r')).toBe(false);
    expect(moves.has('n2l')).toBe(false);
    const limited = planMove(doc.nodes, ['n1l'], [0.2, 0, 0], { symmetry: false, softRadius: 1, softParts: new Set(['p2']) });
    expect(limited.has('n3')).toBe(false);
  });

  it('applying a move shifts nodes and marks them manual', () => {
    const doc = makeDoc();
    applyMove(doc, new Map([['n1l', [0.1, 0.2, 0.3]]]));
    expect(doc.nodes[0]!.pos).toEqual([0.6, 1.2, 0.6]);
    expect(doc.nodes[0]!.manual).toBe(true);
    expect(doc.nodes[1]!.manual).toBeUndefined();
  });

  it('deleting a node takes its beams and triangles with it', () => {
    const doc = makeDoc();
    expect(deleteNodes(doc, ['n1l'])).toEqual({ nodes: 1, beams: 2, tris: 1 });
    expect(doc.beams.map((b) => beamKey(b.id1, b.id2))).toEqual([beamKey('n2l', 'n2r')]);
  });

  it('deletes beams by key in either order', () => {
    const doc = makeDoc();
    expect(deleteBeams(doc, [beamKey('n1l', 'n2l')])).toBe(1);
    expect(doc.beams).toHaveLength(2);
  });

  it('renaming a node updates beams, triangles and reference nodes', () => {
    const doc = makeDoc();
    renameNode(doc, 'n1l', 'door1l');
    expect(doc.nodes[0]!.id).toBe('door1l');
    expect(doc.beams[0]!.id1).toBe('door1l');
    expect(doc.beams[2]!.id2).toBe('door1l');
    expect(doc.tris[0]!.ids[0]).toBe('door1l');
    expect(doc.proxy.refNodes).toMatchObject({ back: 'door1l', left: 'door1l' });
  });

  it('refuses invalid or taken node ids', () => {
    const doc = makeDoc();
    expect(() => renameNode(doc, 'n1l', '1bad')).toThrow();
    expect(() => renameNode(doc, 'n1l', 'n1r')).toThrow(/already/);
  });

  it('sets one axis exactly and marks the node manual', () => {
    const doc = makeDoc();
    setNodeAxis(doc, ['n1l'], 2, 0.75);
    expect(doc.nodes[0]!.pos).toEqual([0.5, 1, 0.75]);
    expect(doc.nodes[0]!.manual).toBe(true);
  });

  it('centroid averages positions', () => {
    expect(centroid([{ pos: [0, 0, 0] }, { pos: [2, 4, 6] }])).toEqual([1, 2, 3]);
    expect(centroid([])).toEqual([0, 0, 0]);
  });
});

describe('topology', () => {
  it('connects nodes as a chain, skipping beams that exist, and makes cross-part beams attachments', () => {
    const doc = makeDoc();
    expect(connectNodes(doc, ['n1r', 'n1l', 'n3', 'lone'])).toBe(2); // n1r-n1l exists
    const added = doc.beams.slice(-2);
    expect(added[0]).toMatchObject({ id1: 'n1l', id2: 'n3', kind: 'edge', partId: 'p1' });
    expect(added[1]).toMatchObject({ id1: 'n3', id2: 'lone', kind: 'attach', partId: 'p1' });
  });

  it('splits a beam at its midpoint into two', () => {
    const doc = makeDoc();
    const [id] = splitBeams(doc, [beamKey('n1r', 'n1l')]);
    const node = doc.nodes.find((n) => n.id === id)!;
    expect(node.pos).toEqual([0, 1, 0.3]);
    expect(node.manual).toBe(true);
    expect(doc.beams.filter((b) => b.id1 === id || b.id2 === id)).toHaveLength(2);
    expect(doc.beams.some((b) => beamKey(b.id1, b.id2) === beamKey('n1l', 'n1r'))).toBe(false);
  });

  it('merges nodes into the first: centre position, summed weight, references follow, collapsed beams go', () => {
    const doc = makeDoc();
    expect(mergeNodes(doc, ['n1l', 'n1r'])).toBe('n1l');
    const kept = doc.nodes.find((n) => n.id === 'n1l')!;
    expect(kept.pos).toEqual([0, 1, 0.3]);
    expect(kept.weight).toBe(2);
    expect(doc.nodes.some((n) => n.id === 'n1r')).toBe(false);
    expect(doc.beams.some((b) => b.id1 === b.id2)).toBe(false);
    expect(doc.tris).toHaveLength(0); // n1l, n1r, n3 collapsed to two corners
    expect(doc.proxy.refNodes!.rightCorner).toBe('n2r');
  });

  it('adopts a manual node in place of the regenerated one with the same id, else the nearest', () => {
    const derived = {
      nodes: [
        { id: 'a1', partId: 'p', pos: [0, 0, 0] as [number, number, number], weight: 1 },
        { id: 'a2', partId: 'p', pos: [1, 0, 0] as [number, number, number], weight: 1 },
        { id: 'a3', partId: 'p', pos: [2, 0, 0] as [number, number, number], weight: 1 },
      ],
      beams: [{ id1: 'a1', id2: 'a2' }, { id1: 'a2', id2: 'a3' }],
      tris: [] as { ids: [string, string, string] }[],
    };
    const manual = [
      { id: 'a1', partId: 'p', pos: [0, 0, 0.05] as [number, number, number], weight: 1, manual: true },
      { id: 'old7', partId: 'p', pos: [2.05, 0, 0] as [number, number, number], weight: 1, manual: true },
      { id: 'far', partId: 'p', pos: [9, 9, 9] as [number, number, number], weight: 1, manual: true },
    ];
    expect(adoptManualNodes(derived, manual)).toEqual({ kept: 2, loose: 1 });
    expect(derived.nodes.map((n) => n.id)).toEqual(['a2']);
    expect(derived.beams).toEqual([{ id1: 'a1', id2: 'a2' }, { id1: 'a2', id2: 'old7' }]);
  });
});
