import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { loadIntoLoaderSpace } from '../../src/renderer/import/loaders';
import { bakeMeshes, boundsOf, flipWinding, toBeamng } from '../../src/renderer/import/normalize';
import { defaultSettings, joinRef } from '../../src/renderer/import/pipeline';

const FIXTURES = join(__dirname, '../fixtures/models');
const bytes = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const noSide = () => Promise.resolve(null);

function positions(g: BufferGeometry): number[][] {
  const p = g.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
}

function expectPositions(g: BufferGeometry, expected: number[][]) {
  const got = positions(g);
  expect(got).toHaveLength(expected.length);
  got.forEach((v, i) => v.forEach((c, k) => expect(c).toBeCloseTo(expected[i]![k]!, 6)));
}

function faceNormal(g: BufferGeometry): Vector3 {
  const [a, b, c] = positions(g).map((v) => new Vector3(...v));
  return new Vector3().subVectors(b!, a!).cross(new Vector3().subVectors(c!, a!)).normalize();
}

async function importFixture(name: string) {
  const { root } = await loadIntoLoaderSpace('dae', bytes(name), name, noSide);
  const baked = bakeMeshes(root);
  return toBeamng(baked, 'src1', defaultSettings('dae'));
}

describe('Z-up DAE → BeamNG space (SPEC §2 lock-down)', () => {
  it('a BeamNG-style Z_UP DAE comes back in its own coordinates, with node matrices applied', async () => {
    const meshes = await importFixture('zup_nodes.dae');
    const byName = new Map(meshes.map((m) => [m.name, m]));
    // body: translate (0, -1, 0.5)
    expectPositions(byName.get('fixture_body')!.geometry, [
      [0, -1, 0.5],
      [1, -1, 0.5],
      [0, 0, 0.5],
    ]);
    // wheel: rotate +90° about Z then translate (0.8, -1.2, 0.3): (x,y) → (−y, x)
    expectPositions(byName.get('fixture_wheel_FL')!.geometry, [
      [0.8, -1.2, 0.3],
      [0.8, -0.2, 0.3],
      [-0.2, -1.2, 0.3],
    ]);
  });

  it('keys meshes by source and node name, de-duplicating repeated names', async () => {
    const meshes = await importFixture('zup_nodes.dae');
    expect(meshes.map((m) => m.key).sort()).toEqual(['src1:dup', 'src1:dup (2)', 'src1:fixture_body', 'src1:fixture_mirror', 'src1:fixture_wheel_FL']);
    expect(meshes.every((m) => m.triangles === 1)).toBe(true);
  });

  it('a mirrored node keeps outward-facing winding (flipped back after the negative scale)', async () => {
    const meshes = await importFixture('zup_nodes.dae');
    const mirror = meshes.find((m) => m.name === 'fixture_mirror')!;
    // Original triangle faces +Z; mirroring X must not turn it inside out.
    expect(faceNormal(mirror.geometry).z).toBeCloseTo(1, 6);
  });

  it('bounds are reported in loader space for the import dialog', async () => {
    const { root } = await loadIntoLoaderSpace('dae', bytes('zup_nodes.dae'), 'zup_nodes.dae', noSide);
    const box = boundsOf(bakeMeshes(root))!;
    // Loader space is Y-up: BeamNG z (0…0.5) becomes loader y.
    expect(box.min[1]).toBeCloseTo(0, 6);
    expect(box.max[1]).toBeCloseTo(0.5, 6);
  });
});

describe('other formats', () => {
  it('OBJ: one mesh per object, names kept, Y-up default', async () => {
    const obj = 'o hood\nv 0 1 0\nv 1 1 0\nv 0 1 1\nf 1 2 3\no door_FL\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 4 5 6\n';
    const { root } = await loadIntoLoaderSpace('obj', new TextEncoder().encode(obj), 'car.obj', noSide);
    const meshes = toBeamng(bakeMeshes(root), 's', defaultSettings('obj'));
    expect(meshes.map((m) => m.name)).toEqual(['hood', 'door_FL']);
    // loader (x, y, z) → BeamNG (x, −z, y)
    expectPositions(meshes[0]!.geometry, [
      [0, 0, 1],
      [1, 0, 1],
      [0, -1, 1],
    ]);
  });

  it('STL: named after the file, millimetres + Z-up by default', async () => {
    const stl = 'solid part\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1000 0 0\nvertex 0 1000 0\nendloop\nendfacet\nendsolid part\n';
    const { root } = await loadIntoLoaderSpace('stl', new TextEncoder().encode(stl), 'bracket.stl', noSide);
    const meshes = toBeamng(bakeMeshes(root), 's', defaultSettings('stl'));
    expect(meshes.map((m) => m.name)).toEqual(['bracket']);
    expectPositions(meshes[0]!.geometry, [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it('glTF: reads external .bin buffers through the side-file reader', async () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bin = new Uint8Array(pos.buffer);
    const gltf = {
      asset: { version: '2.0' },
      buffers: [{ uri: 'tri.bin', byteLength: bin.byteLength }],
      bufferViews: [{ buffer: 0, byteLength: bin.byteLength }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ name: 'spoiler', mesh: 0, translation: [0, 2, 0] }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };
    const asked: string[] = [];
    const readSide = (ref: string) => {
      asked.push(ref);
      return Promise.resolve(ref === 'tri.bin' ? bin : null);
    };
    const { root } = await loadIntoLoaderSpace('gltf', new TextEncoder().encode(JSON.stringify(gltf)), 'car.gltf', readSide);
    const meshes = toBeamng(bakeMeshes(root), 's', defaultSettings('gltf'));
    expect(asked).toEqual(['tri.bin']);
    expect(meshes.map((m) => m.name)).toEqual(['spoiler']);
    expect(meshes[0]!.geometry.boundingBox!.max.z).toBeCloseTo(3, 6); // node translation y=2 (+1 vertex) → BeamNG z
  });
});

describe('helpers', () => {
  it('flipWinding reverses indexed and non-indexed triangles', () => {
    const indexed = new BufferGeometry();
    indexed.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    indexed.setIndex([0, 1, 2]);
    flipWinding(indexed);
    expect(Array.from(indexed.index!.array)).toEqual([0, 2, 1]);

    const flat = new BufferGeometry();
    flat.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    flipWinding(flat);
    expect(positions(flat)).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ]);
  });

  it('joinRef keeps the model folder separator and strips leading slashes', () => {
    expect(joinRef('C:\\models', 'textures/a.png')).toBe('C:\\models\\textures\\a.png');
    expect(joinRef('/home/m', '/b.mtl')).toBe('/home/m/b.mtl');
  });
});
