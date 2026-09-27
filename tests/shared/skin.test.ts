import { describe, expect, it } from 'vitest';
import { bindVertices, deformVertices } from '@shared/sim/skin';

const NODES = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
const VERTS = new Float32Array([0.2, 0.3, 0.1, 0.9, 0.1, 0.05, -0.1, 0.4, 0.6]);

describe('visual mesh skinning', () => {
  it('rebuilds vertices exactly when nothing moved', () => {
    const b = bindVertices(VERTS, NODES, [0, 1, 2, 3]);
    const out = new Float32Array(VERTS.length);
    deformVertices(b, NODES, out);
    out.forEach((v, i) => expect(v).toBeCloseTo(VERTS[i]!, 5));
  });

  it('moves and turns vertices with their nodes', () => {
    const b = bindVertices(VERTS, NODES, [0, 1, 2, 3]);
    // Every node turned 90° about Z and lifted 2 m.
    const turned = new Float64Array(NODES.length);
    for (let i = 0; i < 4; i++) {
      const [x, y, z] = [NODES[i * 3]!, NODES[i * 3 + 1]!, NODES[i * 3 + 2]!];
      turned.set([-y, x, z + 2], i * 3);
    }
    const out = new Float32Array(VERTS.length);
    deformVertices(b, turned, out);
    for (let v = 0; v < 3; v++) {
      const [x, y, z] = [VERTS[v * 3]!, VERTS[v * 3 + 1]!, VERTS[v * 3 + 2]!];
      expect(out[v * 3]).toBeCloseTo(-y, 5);
      expect(out[v * 3 + 1]).toBeCloseTo(x, 5);
      expect(out[v * 3 + 2]).toBeCloseTo(z + 2, 5);
    }
  });

  it('follows a single node when there are too few for a frame', () => {
    const b = bindVertices(new Float32Array([1, 1, 1]), new Float64Array([0, 0, 0]), [0]);
    const out = new Float32Array(3);
    deformVertices(b, new Float64Array([0.5, 0, 0]), out);
    expect([...out]).toEqual([1.5, 1, 1]);
  });
});
