import { describe, expect, it } from 'vitest';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { measureRide, splitForRide } from '../../src/renderer/sim/rideCheck';
import type { ImportedMesh } from '../../src/renderer/import/normalize';

const box = (key: string, size: [number, number, number], at: [number, number, number]): ImportedMesh => {
  const g = new BoxGeometry(...size);
  g.translate(...at);
  return { key: `car:${key}`, sourceId: 'car', name: key, geometry: g, material: new MeshBasicMaterial(), triangles: 12 };
};

// A tyre at the front left (x +0.75, y −1.3), its arch 60 mm above it, the sump 120 mm off the ground.
const tyre = box('tire_FL', [0.2, 0.6, 0.6], [0.75, -1.3, 0.3]);
const arch = box('fender_FL', [0.3, 0.9, 0.05], [0.75, -1.3, 0.6 + 0.06 + 0.025]);
const sump = box('engine', [0.4, 0.5, 0.3], [0, -1.2, 0.12 + 0.15]);
const doc = {
  parts: [
    { id: 'p_tire', taxonomyId: 'tire' },
    { id: 'p_body', taxonomyId: 'fender' },
    { id: 'p_eng', taxonomyId: 'engine' },
  ],
  assignments: { 'car:tire_FL': 'p_tire', 'car:fender_FL': 'p_body', 'car:engine': 'p_eng' },
  axles: [{ id: 'a', name: 'Front', y: -1.3, track: 1.5, fitted: null }],
  ignoredMeshes: [],
  powertrain: { engine: null, gearbox: null },
} as never;
const lookup = (id: string) => ({ tire: { subcategory: 'Wheels' }, fender: { subcategory: 'Body' }, engine: { subcategory: 'Engine' } })[id];

describe('suspension check', () => {
  const split = splitForRide(doc, [tyre, arch, sump], lookup);
  const meshes = new Map([tyre, arch, sump].map((m) => [m.key, m]));

  it('sorts wheels into corners and the rest onto the springs', () => {
    expect(split.corners.map((c) => [c.name, c.wheelKeys])).toEqual([['Front left', ['car:tire_FL']]]);
    expect(split.bodyKeys.sort()).toEqual(['car:engine', 'car:fender_FL']);
  });

  it('measures the tyre to the arch and the ground clearance with the body pushed down', () => {
    const r = measureRide(split, meshes, 0.04);
    expect(r.gaps[0]!.meshKey).toBe('car:fender_FL');
    expect(r.gaps[0]!.distance).toBeCloseTo(0.02, 3);
    expect(r.gaps[0]!.atRest).toBeCloseTo(0.06, 3);
    expect(r.ground.atRest).toBeCloseTo(0.12, 3);
    expect(r.ground.atBump).toBeCloseTo(0.08, 3);
  });

  it('a travel longer than the gap: they touch', () => {
    expect(measureRide(split, meshes, 0.08).gaps[0]!.distance).toBeLessThan(0.001);
  });
});
