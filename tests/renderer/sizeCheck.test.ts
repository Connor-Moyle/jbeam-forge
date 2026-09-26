import { describe, expect, it } from 'vitest';
import { dimensionsFor, sizeAdvice } from '../../src/renderer/import/sizeCheck';

// A 4.5 m × 1.8 m × 1.4 m car in loader space (Y up, front toward +Z).
const carBox = { min: [-0.9, 0, -2.25] as const, max: [0.9, 1.4, 2.25] as const };

describe('dimensionsFor', () => {
  it('maps loader-space bounds to length/width/height in metres', () => {
    const d = dimensionsFor({ min: [...carBox.min], max: [...carBox.max] }, '+y', '+z', 1)!;
    expect(d.length).toBeCloseTo(4.5);
    expect(d.width).toBeCloseTo(1.8);
    expect(d.height).toBeCloseTo(1.4);
  });

  it('applies the unit scale', () => {
    const cm = { min: [-90, 0, -225] as [number, number, number], max: [90, 140, 225] as [number, number, number] };
    expect(dimensionsFor(cm, '+y', '+z', 0.01)!.length).toBeCloseTo(4.5);
  });

  it('returns null for parallel axes', () => {
    expect(dimensionsFor({ min: [0, 0, 0], max: [1, 1, 1] }, '+y', '-y', 1)).toBeNull();
  });
});

describe('sizeAdvice', () => {
  it('accepts a normal car', () => {
    expect(sizeAdvice({ length: 4.5, width: 1.8, height: 1.4 }, 1).level).toBe('ok');
  });

  it('spots centimetres and suggests the preset', () => {
    const a = sizeAdvice({ length: 450, width: 180, height: 140 }, 1);
    expect(a).toMatchObject({ level: 'warning', suggestScale: 0.01 });
    expect(a.message).toMatch(/centimetres/);
  });

  it('spots millimetres', () => {
    expect(sizeAdvice({ length: 4500, width: 1800, height: 1400 }, 1).suggestScale).toBe(0.001);
  });

  it('flags a sideways vehicle (wrong forward axis)', () => {
    expect(sizeAdvice({ length: 1.8, width: 4.5, height: 1.4 }, 1).message).toMatch(/forward axis/);
  });

  it('flags a vehicle standing on its tail (wrong up axis)', () => {
    expect(sizeAdvice({ length: 1.4, width: 1.3, height: 4.5 }, 1).message).toMatch(/up axis/);
  });
});
