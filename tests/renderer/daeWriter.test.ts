import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three';
import { writeDae } from '../../src/renderer/export/dae';
import { loadIntoLoaderSpace } from '../../src/renderer/import/loaders';
import { bakeMeshes, toBeamng } from '../../src/renderer/import/normalize';
import { defaultSettings } from '../../src/renderer/import/pipeline';
import { subsetGeometry } from '../../src/renderer/import/applySplits';

const noSide = () => Promise.resolve(null);

function sortedPositions(g: BufferGeometry): string[] {
  const p = g.getAttribute('position');
  const idx = g.index;
  const n = idx ? idx.count : p.count;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = idx ? idx.getX(i) : i;
    out.push([p.getX(v), p.getY(v), p.getZ(v)].map((x) => x.toFixed(4)).join(','));
  }
  return out.sort();
}

async function reimport(text: string) {
  const { root } = await loadIntoLoaderSpace('dae', new TextEncoder().encode(text), 'out.dae', noSide);
  return toBeamng(bakeMeshes(root), 'src', defaultSettings('dae'));
}

describe('DAE writer', () => {
  it('writes back faces with their own material, turned round with reversed normals', async () => {
    const box = new BoxGeometry(1, 1, 1);
    box.clearGroups();
    const text = writeDae([{ name: 'test_panel', geometry: box, materials: ['test_paint'], backMaterials: ['test_inside'], flipV: false }], [{ name: 'test_paint', color: [1, 0, 0, 1] }, { name: 'test_inside', color: [0, 0, 1, 1] }], new Date('2026-01-01T00:00:00Z'));
    expect(text).toContain('<triangles material="test_paint" count="12">');
    expect(text).toContain('<triangles material="test_inside" count="12">');
    expect(text).toContain('<instance_material symbol="test_inside" target="#test_inside">');
    const [mesh] = await reimport(text);
    const g = mesh!.geometry;
    // Every face twice: once each way. Each back triangle's normal is its front's reversed.
    expect(sortedPositions(g)).toHaveLength(72);
    const n = g.getAttribute('normal');
    const at = (i: number) => (g.index ? g.index.getX(i) : i);
    const back = g.groups.find((gr) => gr.materialIndex === 1)!;
    expect(back.count).toBe(36);
    const [a, b] = [at(0), at(back.start)];
    expect(n.getX(b) + n.getX(a) + n.getY(b) + n.getY(a) + n.getZ(b) + n.getZ(a)).toBeCloseTo(0);
  });

  it('round-trips through our own importer: same names and BeamNG-space positions', async () => {
    const box = new BoxGeometry(1, 2, 0.5);
    box.translate(0.3, -1.5, 0.8); // BeamNG space: left, forward, up
    const text = writeDae([{ name: 'test_body', geometry: box, materials: ['test_paint'], flipV: false }], [{ name: 'test_paint', color: [0.8, 0.1, 0.1, 1] }], new Date('2026-01-01T00:00:00Z'));
    expect(text).toContain('<up_axis>Z_UP</up_axis>');
    const meshes = await reimport(text);
    expect(meshes.map((m) => m.name)).toEqual(['test_body']);
    expect(sortedPositions(meshes[0]!.geometry)).toEqual(sortedPositions(box));
  });

  it('keeps material groups and writes only the vertices a split subset uses', async () => {
    const box = new BoxGeometry(1, 1, 1); // 6 groups, 24 vertices
    const top = subsetGeometry(box, [4, 5]); // one face
    const text = writeDae(
      [{ name: 'test_top', geometry: top, materials: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'], flipV: false }],
      ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'].map((name) => ({ name, color: [1, 1, 1, 1] as [number, number, number, number] })),
    );
    expect(text.match(/<triangles /g)).toHaveLength(1);
    expect(text).toContain('<triangles material="m2" count="2">');
    expect(text).toMatch(/-positions-array" count="12"/); // 4 vertices × 3
    const meshes = await reimport(text);
    expect(meshes[0]!.triangles).toBe(2);
  });

  it('defines every material a mesh uses, also the game’s own ones it was not given', () => {
    const text = writeDae([{ name: 'a', geometry: new BoxGeometry(1, 1, 1), materials: ['bx_main'], backMaterials: ['bx_interior'], flipV: false }], []);
    expect(text).toContain('<material id="bx_main" name="bx_main">');
    expect(text).toContain('<material id="bx_interior" name="bx_interior">');
    expect(text).toContain('<effect id="bx_main-effect">');
  });

  it('flips V for glTF-origin UVs', () => {
    const g = new BoxGeometry(1, 1, 1);
    const plain = writeDae([{ name: 'a', geometry: g, materials: ['m'], flipV: false }], [{ name: 'm', color: [1, 1, 1, 1] }]);
    const flipped = writeDae([{ name: 'a', geometry: g, materials: ['m'], flipV: true }], [{ name: 'm', color: [1, 1, 1, 1] }]);
    const uvs = (t: string) => t.match(/-map-0-array" count="\d+">([^<]*)</)![1]!.split(' ').map(Number);
    const a = uvs(plain);
    const b = uvs(flipped);
    for (let i = 1; i < a.length; i += 2) expect(b[i]).toBeCloseTo(1 - a[i]!, 6);
  });
});

describe('DAE writer: animated parts', () => {
  it('writes a prop mesh relative to its pivot, with the node moved there', () => {
    const g = new BoxGeometry(0.2, 0.2, 0.2).translate(1, 2, 3);
    const text = writeDae([{ name: 'wheel', geometry: g, materials: ['m'], flipV: false, origin: [1, 2, 3] }], [{ name: 'm', color: [1, 1, 1, 1] }]);
    expect(text).toContain('<matrix sid="transform">1 0 0 1 0 1 0 2 0 0 1 3 0 0 0 1</matrix>');
    const pos = /<float_array id="[^"]*-positions-array"[^>]*>([^<]*)</.exec(text)![1]!.trim().split(/\s+/).map(Number);
    expect(Math.max(...pos.map(Math.abs))).toBeCloseTo(0.1, 6);
  });

  it('writes a model with broken data instead of failing the export', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3)); // too few normals
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0]), 2)); // too few UVs
    g.setIndex([0, 1, 2, 1, 3, 9]); // the second triangle points past the vertices
    const text = writeDae([{ name: 'broken', geometry: g, materials: ['m'], flipV: false }], [{ name: 'm', color: [1, 0, 0] as unknown as [number, number, number, number] }]);
    expect(text).toContain('<triangles material="m" count="1">');
    expect(text).not.toMatch(/NaN|undefined/);
  });
});

