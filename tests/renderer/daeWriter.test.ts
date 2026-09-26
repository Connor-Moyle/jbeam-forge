import { describe, expect, it } from 'vitest';
import { BoxGeometry, type BufferGeometry } from 'three';
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
