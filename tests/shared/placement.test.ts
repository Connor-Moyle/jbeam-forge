import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { placementMatrix, samePlacement } from '@shared/placement';
import { parseProject, serializeProject } from '@shared/project/io';
import { IDENTITY_PLACEMENT, type Placement } from '@shared/project/schema';

const FIXTURES = join(__dirname, '../fixtures/jbforge');

/** Apply a column-major 4×4 to a point. */
function transform(m: number[], [x, y, z]: [number, number, number]): number[] {
  return [0, 1, 2].map((r) => m[r]! * x + m[4 + r]! * y + m[8 + r]! * z + m[12 + r]!);
}

describe('placement', () => {
  it('identity leaves points where they are', () => {
    expect(transform(placementMatrix(IDENTITY_PLACEMENT), [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('scales, then rotates, then moves', () => {
    const p: Placement = { position: [0.5, 0, 1], rotation: [0, 0, 90], scale: 2 };
    const [x, y, z] = transform(placementMatrix(p), [1, 0, 0]);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(2);
    expect(z).toBeCloseTo(1);
  });

  it('rotates about X, then Y, then Z', () => {
    // X 90° takes +Y to +Z; Y 90° then takes +Z to +X.
    const [x, y, z] = transform(placementMatrix({ position: [0, 0, 0], rotation: [90, 90, 0], scale: 1 }), [0, 1, 0]);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
  });

  it('compares placements by value', () => {
    expect(samePlacement(IDENTITY_PLACEMENT, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })).toBe(true);
    expect(samePlacement(IDENTITY_PLACEMENT, { ...IDENTITY_PLACEMENT, position: [0, 0, 0.1] })).toBe(false);
  });

  it('the v8 fixture keeps a moved source through a save', () => {
    const { project } = parseProject(readFileSync(join(FIXTURES, 'v8-placement.jbforge'), 'utf8'));
    expect(project.sources[0]!.placement).toEqual({ position: [0.62, -1.28, 0.31], rotation: [0, 0, 180], scale: 1 });
    expect(parseProject(serializeProject(project)).project.sources[0]!.placement).toEqual(project.sources[0]!.placement);
  });

  it('older projects come in with every source unmoved', () => {
    const { project } = parseProject(readFileSync(join(FIXTURES, 'v7-hinges.jbforge'), 'utf8'));
    for (const s of project.sources) expect(s.placement).toEqual(IDENTITY_PLACEMENT);
  });
});
