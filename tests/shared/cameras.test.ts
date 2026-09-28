import { describe, expect, it } from 'vitest';
import { cameraAnchors, camerasInternalSection, guessDriverEye } from '../../src/shared/cameras/cameras';

const cube = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => ({ id: `n${x}${y}${z}`, pos: [x * 0.5, y * 0.5, 1 + z * 0.3] }))));

describe('interior cameras', () => {
  it('guesses the driver’s eye on the driver’s side, behind the middle, high up', () => {
    const b = { min: [-0.9, -2, 0.2], max: [0.9, 2, 1.4] };
    const [x, y, z] = guessDriverEye(b);
    expect(x).toBeGreaterThan(0.2); // left-hand drive: +X
    expect(guessDriverEye(b, true)[0]).toBeLessThan(-0.2);
    expect(y).toBeGreaterThan(-0.2);
    expect(z).toBeGreaterThan(0.9);
  });

  it('hangs a camera off six nodes from all round', () => {
    const ids = cameraAnchors(cube, [0, 0, 1])!;
    expect(new Set(ids).size).toBe(6);
    const pos = ids.map((id) => cube.find((n) => n.id === id)!.pos);
    expect(pos.some((p) => p[0]! > 0) && pos.some((p) => p[0]! < 0)).toBe(true);
    expect(pos.some((p) => p[2]! > 1) && pos.some((p) => p[2]! < 1)).toBe(true);
    expect(cameraAnchors(cube.slice(0, 5), [0, 0, 1])).toBeNull();
  });

  it('writes the camerasInternal table', () => {
    const t = camerasInternalSection([{ id: 'c', type: 'driver', pos: [0.3, 0.1, 1.1], fov: 65 }], cube)!;
    expect(t[0]).toEqual(['type', 'x', 'y', 'z', 'fov', 'id1:', 'id2:', 'id3:', 'id4:', 'id5:', 'id6:']);
    expect(t[1]).toMatchObject({ nodeWeight: 1.3, collision: false, selfCollision: false });
    expect((t[2] as unknown[]).slice(0, 5)).toEqual(['driver', 0.3, 0.1, 1.1, 65]);
    expect(t[2]).toHaveLength(11);
    expect(camerasInternalSection([], cube)).toBeNull();
  });
});
