import { describe, expect, it } from 'vitest';
import { editMatrix, flipsWinding, IDENTITY_EDIT, isIdentityTransform, mapUv, MIRROR_X, mirroredName, multiply } from '@shared/mesh/meshEdit';

const apply = (m: number[], [x, y, z]: number[]) => [0, 1, 2].map((r) => m[r]! * x! + m[4 + r]! * y! + m[8 + r]! * z! + m[12 + r]!);
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!));

describe('mesh edits', () => {
  it('identity does nothing', () => {
    expect(isIdentityTransform(IDENTITY_EDIT)).toBe(true);
    close(apply(editMatrix(IDENTITY_EDIT, [1, 2, 3]), [4, 5, 6]), [4, 5, 6]);
  });

  it('scales and turns about the pivot, then moves', () => {
    const e = { ...IDENTITY_EDIT, position: [0, 0, 1] as [number, number, number], rotation: [0, 0, 90] as [number, number, number], scale: [2, 2, 2] as [number, number, number] };
    // A point 1 m in +X from the pivot: doubled, turned to +Y, lifted 1 m.
    close(apply(editMatrix(e, [5, 0, 0]), [6, 0, 0]), [5, 2, 1]);
    // The pivot itself only moves.
    close(apply(editMatrix(e, [5, 0, 0]), [5, 0, 0]), [5, 0, 1]);
  });

  it('mirrors left to right and flips winding', () => {
    close(apply(multiply(MIRROR_X, editMatrix(IDENTITY_EDIT, [0, 0, 0])), [0.7, -1.2, 0.3]), [-0.7, -1.2, 0.3]);
    expect(flipsWinding(MIRROR_X)).toBe(true);
    expect(flipsWinding(editMatrix(IDENTITY_EDIT, [0, 0, 0]))).toBe(false);
  });

  it('maps textures: tiling, turn, offset', () => {
    close(mapUv(0.5, 0.25, { scale: [2, 4], offset: [0.1, 0], rotation: 0 }), [1.1, 1]);
    close(mapUv(1, 0, { scale: [1, 1], offset: [0, 0], rotation: 90 }), [0, 1]);
  });

  it('names the mirrored mesh for the other side', () => {
    expect(mirroredName('brake_caliper_FL')).toBe('brake_caliper_FR');
    expect(mirroredName('hub_RR')).toBe('hub_RL');
    expect(mirroredName('mirror_L')).toBe('mirror_R');
    expect(mirroredName('Left Door')).toBe('Right Door');
    expect(mirroredName('caliper')).toBe('caliper (mirror)');
  });
});
