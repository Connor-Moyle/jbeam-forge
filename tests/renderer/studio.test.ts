import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { studioCamera, PREVIEW_ANGLES } from '../../src/renderer/panels/viewport/studio';

describe('studio pictures', () => {
  // A car in view space: 1.9 m wide (X), 1.4 m tall (Y), 4.6 m long (Z, front +Z).
  const box = new Box3(new Vector3(-0.95, 0, -2.3), new Vector3(0.95, 1.4, 2.3));

  it('looks at the front-left three-quarter, and the whole car fits the frame', () => {
    for (const a of PREVIEW_ANGLES) {
      const { position, target } = studioCamera(box, a.value, 16 / 9);
      const cam = new PerspectiveCamera(28, 16 / 9, 0.05, 500);
      cam.position.copy(position);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      for (let i = 0; i < 8; i++) {
        const p = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      }
      expect(position.y).toBeGreaterThan(target.y);
    }
    const fl = studioCamera(box, 'front-left', 16 / 9).position;
    expect(fl.x).toBeGreaterThan(0); // the car's left side (+X)
    expect(fl.z).toBeGreaterThan(0); // in front
    expect(studioCamera(box, 'rear-left', 16 / 9).position.z).toBeLessThan(0);
  });
});
