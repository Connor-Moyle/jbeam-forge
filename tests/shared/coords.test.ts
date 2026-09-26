import { describe, expect, it } from 'vitest';
import { AXES } from '../../src/shared/project/schema';
import {
  axesValid,
  beamngToView,
  BEAMNG_TO_VIEW_ROTATION_X,
  loaderToBeamngMatrix,
  transformBox,
  transformPoint,
  type Vec3,
} from '../../src/shared/coords';

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 12));

describe('loader → BeamNG', () => {
  it('default (up +y, forward +z) undoes ColladaLoader Z_UP handling exactly', () => {
    // ColladaLoader maps a Z_UP file point (x, y, z) to loader space (x, z, −y).
    const file: Vec3 = [-0.72, -0.8, 0.865]; // a real-looking BeamNG node position (right side, front, up)
    const loader: Vec3 = [file[0], file[2], -file[1]];
    close(transformPoint(loaderToBeamngMatrix('+y', '+z', 1), loader), file);
  });

  it('puts the vehicle front at −Y, up at +Z and left at +X', () => {
    const m = loaderToBeamngMatrix('+y', '+z', 1);
    close(transformPoint(m, [0, 0, 1]), [0, -1, 0]); // forward → −Y
    close(transformPoint(m, [0, 1, 0]), [0, 0, 1]); // up → +Z
    close(transformPoint(m, [1, 0, 0]), [1, 0, 0]); // loader +X is the vehicle's left
  });

  it('handles Z-up sources (STL/CAD) with the front along −Y', () => {
    const m = loaderToBeamngMatrix('+z', '-y', 1);
    close(transformPoint(m, [1, 2, 3]), [1, 2, 3]); // already BeamNG convention: identity
  });

  it('applies metres-per-unit (FBX centimetres)', () => {
    const m = loaderToBeamngMatrix('+y', '+z', 0.01);
    close(transformPoint(m, [0, 150, 0]), [0, 0, 1.5]);
  });

  it('is a proper rotation (right-handed, det +1) for every valid axis pair', () => {
    for (const up of AXES) {
      for (const fwd of AXES) {
        if (!axesValid(up, fwd)) {
          expect(() => loaderToBeamngMatrix(up, fwd, 1)).toThrow(/different axes/);
          continue;
        }
        const m = loaderToBeamngMatrix(up, fwd, 1);
        const det =
          m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
        expect(det).toBeCloseTo(1, 12);
      }
    }
  });
});

describe('BeamNG → view', () => {
  it('matches a root rotation of −90° about X', () => {
    const c = Math.cos(BEAMNG_TO_VIEW_ROTATION_X);
    const s = Math.sin(BEAMNG_TO_VIEW_ROTATION_X);
    const p: Vec3 = [0.3, -1.2, 0.8];
    const rotated: Vec3 = [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
    close(beamngToView(p), rotated);
  });

  it('round-trips loader → BeamNG → view for the default axes', () => {
    const loader: Vec3 = [0.4, 1.1, -2.2];
    close(beamngToView(transformPoint(loaderToBeamngMatrix('+y', '+z', 1), loader)), loader);
  });
});

describe('transformBox', () => {
  it('maps boxes exactly under axis permutations', () => {
    const box = transformBox(loaderToBeamngMatrix('+y', '+z', 0.5), { min: [-1, 0, -2], max: [1, 1.5, 2] });
    close(box.min, [-0.5, -1, 0]);
    close(box.max, [0.5, 1, 0.75]);
  });
});
