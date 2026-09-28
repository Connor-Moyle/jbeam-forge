import { describe, expect, it } from 'vitest';
import { composeVinyls, layerAt, mirrored, newLayer, placement, planeCoords, sideFacing, toShape, viewCentre, type LayerLook, type Texels } from '../../src/shared/paints/vinyl';
import { VINYL_SHAPES } from '../../src/shared/paints/shapes';
import type { VinylLayer } from '../../src/shared/project/schema';

const bounds = { min: [-0.9, -2, 0] as [number, number, number], max: [0.9, 2, 1.4] as [number, number, number] };

/** Texels on the car's left (+X) and right (−X) sides, 5 cm apart. */
function sides(): Texels & { side: ('L' | 'R')[]; at: [number, number, number][] } {
  const at: [number, number, number][] = [];
  const nrm: number[] = [];
  const side: ('L' | 'R')[] = [];
  for (const [x, nx, s] of [
    [0.9, 1, 'L'],
    [-0.9, -1, 'R'],
  ] as const) {
    for (let y = -2; y <= 2.0001; y += 0.05) {
      for (let z = 0; z <= 1.4001; z += 0.05) {
        at.push([x, y, z]);
        nrm.push(nx, 0, 0);
        side.push(s);
      }
    }
  }
  return { count: at.length, pos: new Float32Array(at.flat()), nrm: new Float32Array(nrm), side, at };
}

const full: LayerLook = { alpha: () => 1 };
const colorOf = (l: VinylLayer, which: 1 | 2) => (which === 1 ? l.color : l.color2);

describe('vinyl placement', () => {
  it('round-trips plane points through a turned, slanted, flipped layer', () => {
    const l = newLayer('a', { x: 0.3, y: -0.2, w: 0.8, h: 0.4, rotation: 30, skew: 15, flipX: true });
    const p = placement(l);
    // the layer's centre is shape (0, 0); its box contains the centre
    expect(toShape(p, 0.3, -0.2)).toEqual([expect.closeTo(0), expect.closeTo(0)]);
    expect(p.box.minH).toBeLessThan(0.3);
    expect(p.box.maxV).toBeGreaterThan(-0.2);
  });

  it('knows which side a surface faces and where points are in its view', () => {
    expect(sideFacing([0.9, 0.1, 0.3])).toBe('left');
    expect(sideFacing([0, 0.2, 0.95])).toBe('top');
    expect(sideFacing([0, -1, 0])).toBe('front');
    const c = viewCentre(bounds);
    // left side: to the viewer's right is rearward (+Y), up is +Z
    expect(planeCoords('left', [0.9, 1, 1.2], c)).toEqual([expect.closeTo(1), expect.closeTo(0.5)]);
    expect(planeCoords('right', [-0.9, 1, 1.2], c)).toEqual([expect.closeTo(-1), expect.closeTo(0.5)]);
  });

  it('mirrors across the centre line; text stays readable', () => {
    const shape = newLayer('s', { side: 'left', x: 0.5, rotation: 20, kind: 'shape' });
    expect(mirrored(shape)).toMatchObject({ side: 'right', x: -0.5, rotation: -20, flipX: true });
    const text = newLayer('t', { side: 'left', x: 0.5, kind: 'text', readable: true });
    expect(mirrored(text).flipX).toBe(false);
    expect(mirrored(newLayer('f', { side: 'front', x: 0.3 })).side).toBe('front');
  });
});

describe('vinyl compositor', () => {
  const t = sides();
  const covered = (c: { rgba: Uint8ClampedArray }, where: 'L' | 'R') => t.side.filter((s, i) => s === where && c.rgba[i * 4 + 3]! > 128).length;

  it('paints a layer on its side only, and its mirror on the other', () => {
    const l = newLayer('a', { side: 'left', x: 0, y: 0, w: 1, h: 0.5, color: [1, 0, 0] });
    const one = composeVinyls(t, [l], { bounds, looks: new Map([['a', full]]), colorOf });
    expect(covered(one, 'L')).toBeGreaterThan(150);
    expect(covered(one, 'R')).toBe(0);
    const i = t.at.findIndex((p) => p[0] > 0 && Math.abs(p[1]) < 0.01 && Math.abs(p[2] - 0.7) < 0.01);
    expect([...one.rgba.slice(i * 4, i * 4 + 4)]).toEqual([255, 0, 0, 255]);
    const both = composeVinyls(t, [{ ...l, mirror: true }], { bounds, looks: new Map([['a', full]]), colorOf });
    expect(covered(both, 'R')).toBe(covered(both, 'L'));
  });

  it('erase cuts through, clip shows only over the layer below', () => {
    const base = newLayer('base', { side: 'left', w: 1, h: 0.5, color: [0, 0, 1] });
    const cut = newLayer('cut', { side: 'left', w: 0.3, h: 0.3, mode: 'erase' });
    const big = newLayer('clip', { side: 'left', w: 3, h: 1.2, mode: 'clip', color: [0, 1, 0] });
    const looks = new Map([
      ['base', full],
      ['cut', full],
      ['clip', full],
    ]);
    const erased = composeVinyls(t, [base, cut], { bounds, looks, colorOf });
    const centre = t.at.findIndex((p) => p[0] > 0 && Math.abs(p[1]) < 0.01 && Math.abs(p[2] - 0.7) < 0.01);
    expect(erased.rgba[centre * 4 + 3]).toBe(0);
    const clipped = composeVinyls(t, [base, big], { bounds, looks, colorOf });
    // the clip layer is much bigger than the base, but only shows where the base is
    expect(covered(clipped, 'L')).toBe(covered(composeVinyls(t, [base], { bounds, looks, colorOf }), 'L'));
    expect(clipped.rgba[centre * 4 + 1]).toBe(255); // green over the blue
  });

  it('fills with a gradient and outlines the selected layer', () => {
    const l = newLayer('g', { side: 'left', w: 2, h: 0.5, fill: 'linear', color: [0, 0, 0], color2: [1, 1, 1] });
    const c = composeVinyls(t, [l], { bounds, looks: new Map([['g', full]]), colorOf, selected: new Set(['g']) });
    const at = (y: number) => t.at.findIndex((p) => p[0] > 0 && Math.abs(p[1] - y) < 0.01 && Math.abs(p[2] - 0.7) < 0.01);
    // left to right in the side view is front (−Y) to back
    expect(c.rgba[at(-0.9) * 4]).toBeLessThan(40);
    expect(c.rgba[at(0.9) * 4]).toBeGreaterThan(215);
    expect(c.outline.reduce((a, b) => a + b, 0)).toBeGreaterThan(10);
  });

  it('finds the topmost layer under a click', () => {
    const a = newLayer('a', { side: 'left', w: 1, h: 1 });
    const b = newLayer('b', { side: 'left', w: 0.2, h: 0.2 });
    const looks = new Map([
      ['a', full],
      ['b', full],
    ]);
    expect(layerAt([a, b], looks, [0.9, 0, 0.7], [1, 0, 0], bounds)).toBe('b');
    expect(layerAt([a, b], looks, [0.9, 0.4, 0.7], [1, 0, 0], bounds)).toBe('a');
    expect(layerAt([a, b], looks, [-0.9, 0, 0.7], [-1, 0, 0], bounds)).toBeNull();
  });

  it('has a shape library with valid paths', () => {
    expect(VINYL_SHAPES.length).toBeGreaterThan(35);
    expect(new Set(VINYL_SHAPES.map((s) => s.id)).size).toBe(VINYL_SHAPES.length);
    for (const s of VINYL_SHAPES) expect(s.path, s.id).toMatch(/^M[\d. ]/);
  });
});
