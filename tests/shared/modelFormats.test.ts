import { beforeAll, describe, expect, it } from 'vitest';
import { triangleCount, writeFbx, writeObj, writePly, writeStl, type ModelScene } from '../../src/shared/export/modelFormats';

/** Two meshes: a quad of two materials (with UVs and normals) and a bare triangle. */
const scene: ModelScene = {
  name: 'test car',
  materials: [
    { name: 'paint', color: [0.1, 0.2, 0.8, 1] },
    { name: 'glass', color: [0.5, 0.6, 0.7, 0.4] },
  ],
  meshes: [
    {
      name: 'door skin',
      group: 'Front left door',
      positions: [0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 2, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      indices: [0, 1, 2, 0, 2, 3],
      groups: [
        { start: 0, count: 3, material: 0 },
        { start: 3, count: 3, material: 1 },
      ],
      materials: ['paint', 'glass'],
    },
    { name: 'bracket', group: 'Body', positions: [0, 0, 1, 1, 0, 1, 0, 0, 2], indices: [0, 1, 2], groups: [], materials: ['paint'] },
  ],
};

const buffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

beforeAll(() => {
  // three's loaders look for a DOM to make images with; none are made here.
  const g = globalThis as Record<string, unknown>;
  g.self ??= globalThis;
  g.window ??= globalThis;
  g.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, getContext: () => null }), createElement: () => ({ style: {}, addEventListener() {}, getContext: () => null }) };
});

describe('model writers', () => {
  it('counts triangles', () => {
    expect(triangleCount(scene)).toBe(3);
  });

  it('writes an OBJ three reads back: objects, both materials, Y up', async () => {
    const { obj, mtl } = writeObj(scene, 'car.mtl');
    expect(obj).toContain('mtllib car.mtl');
    expect(obj).toContain('o door_skin');
    expect(obj).toContain('g Front_left_door');
    expect(obj.match(/^usemtl /gm)).toHaveLength(3);
    // The second mesh's faces count on from the first's vertices; it has no UVs or normals.
    expect(obj).toContain('f 5 6 7');
    expect(mtl).toContain('newmtl glass');
    expect(mtl).toContain('d 0.4');
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const root = new OBJLoader().parse(obj);
    const meshes: { name: string; count: number; maxY: number }[] = [];
    root.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; name: string; geometry: { getAttribute(n: string): { count: number; getY(i: number): number } } };
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position');
      meshes.push({ name: m.name, count: pos.count, maxY: Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getY(i))) });
    });
    expect(meshes.map((m) => [m.name, m.count])).toEqual([
      ['door_skin', 6],
      ['bracket', 3],
    ]);
    // The bracket reaches z = 2 in the car's space: that is up, so y = 2 here.
    expect(meshes[1]!.maxY).toBeCloseTo(2, 5);
  });

  it('writes a binary STL of every triangle, Z up', async () => {
    const stl = writeStl(scene);
    expect(stl.byteLength).toBe(84 + 3 * 50);
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const geo = new STLLoader().parse(buffer(stl));
    const pos = geo.getAttribute('position');
    expect(pos.count).toBe(9);
    expect(Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getZ(i)))).toBeCloseTo(2, 5);
  });

  it('writes a binary PLY with normals and material colours', async () => {
    const ply = writePly(scene);
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
    const geo = new PLYLoader().parse(buffer(ply));
    expect(geo.getAttribute('position').count).toBe(7);
    expect(geo.index!.count).toBe(9);
    expect(geo.getAttribute('normal')).toBeDefined();
    expect(geo.getAttribute('color')).toBeDefined();
  });

  it('writes a binary FBX three reads back: a model per mesh with its materials, UVs and Y up', async () => {
    const fbx = writeFbx(scene, new Date('2026-01-01T00:00:00Z'));
    expect(new TextDecoder().decode(fbx.subarray(0, 18))).toBe('Kaydara FBX Binary');
    const THREE = await import('three');
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    const warn = console.warn;
    console.warn = () => {};
    const root = new FBXLoader().parse(buffer(fbx), '');
    console.warn = warn;
    root.updateMatrixWorld(true);
    const found: { name: string; verts: number; mats: string[]; uv: boolean; top: number }[] = [];
    root.traverse((o) => {
      const m = o as InstanceType<typeof THREE.Mesh>;
      if (!m.isMesh) return;
      const box = new THREE.Box3().setFromObject(m);
      found.push({ name: m.name, verts: m.geometry.getAttribute('position').count, mats: (Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.name), uv: !!m.geometry.getAttribute('uv'), top: box.max.y });
    });
    expect(found).toHaveLength(2);
    const door = found.find((f) => /door_skin/.test(f.name))!;
    expect(door.verts).toBe(6);
    expect(door.mats).toEqual(['paint', 'glass']);
    expect(door.uv).toBe(true);
    const bracket = found.find((f) => /bracket/.test(f.name))!;
    expect(bracket.mats).toEqual(['paint']);
    // In metres whatever the reader's own unit: the bracket's top is 2 units of the file up.
    expect(bracket.top / 2).toBeGreaterThan(0.99);
  });
});
