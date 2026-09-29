import { describe, expect, it } from 'vitest';
import { chooseFormat, encodeDds, halve, hasAlpha, limitSize, type Rgba } from '../../src/shared/textures/dds';
import { parseDds } from '../../src/renderer/import/dds';

/** A test picture: a colour gradient with a soft alpha ramp. */
function picture(w: number, h: number, alpha: boolean): Rgba {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = Math.round((x / (w - 1)) * 255);
      data[i + 1] = Math.round((y / (h - 1)) * 255);
      data[i + 2] = 128;
      data[i + 3] = alpha ? Math.round(((x + y) / (w + h - 2)) * 255) : 255;
    }
  return { width: w, height: h, data };
}

const c565 = (c: number) => [(((c >> 11) & 31) * 255) / 31, (((c >> 5) & 63) * 255) / 63, ((c & 31) * 255) / 31];

/** Decode one BC1/BC3 colour block's pixel. */
function colorAt(b: Uint8Array, o: number, i: number): number[] {
  const c0 = b[o]! | (b[o + 1]! << 8);
  const c1 = b[o + 2]! | (b[o + 3]! << 8);
  const idx = (b[o + 4]! | (b[o + 5]! << 8) | (b[o + 6]! << 16) | (b[o + 7]! << 24)) >>> 0;
  const e0 = c565(c0);
  const e1 = c565(c1);
  const pal = [e0, e1, e0.map((v, k) => (2 * v + e1[k]!) / 3), e0.map((v, k) => (v + 2 * e1[k]!) / 3)];
  return pal[(idx >>> (2 * i)) & 3]!;
}

function singleAt(b: Uint8Array, o: number, i: number): number {
  const a0 = b[o]!;
  const a1 = b[o + 1]!;
  let bits = 0n;
  for (let k = 5; k >= 0; k--) bits = (bits << 8n) | BigInt(b[o + 2 + k]!);
  const idx = Number((bits >> BigInt(3 * i)) & 7n);
  const pal = a0 > a1 ? [a0, a1, ...[1, 2, 3, 4, 5, 6].map((k) => ((7 - k) * a0 + k * a1) / 7)] : [a0, a1, ...[1, 2, 3, 4].map((k) => ((5 - k) * a0 + k * a1) / 5), 0, 255];
  return pal[idx]!;
}

describe('DDS writer', () => {
  it('writes a DXT1 file the reader accepts, with every mipmap, close to the picture', () => {
    const img = picture(64, 32, false);
    const file = encodeDds(img, 'BC1');
    const dds = parseDds(file);
    expect(dds.ok).toBe(true);
    if (!dds.ok || dds.kind === 'rgba8') return;
    expect(dds.kind).toBe('bc1');
    expect([dds.width, dds.height]).toEqual([64, 32]);
    expect(dds.mipmaps.map((m) => `${m.width}x${m.height}`)).toEqual(['64x32', '32x16', '16x8', '8x4', '4x2', '2x1', '1x1']);
    // Average error per channel stays small.
    const top = dds.mipmaps[0]!.data;
    let err = 0;
    for (let by = 0; by < 8; by++)
      for (let bx = 0; bx < 16; bx++)
        for (let i = 0; i < 16; i++) {
          const x = bx * 4 + (i % 4);
          const y = by * 4 + (i >> 2);
          const c = colorAt(top, (by * 16 + bx) * 8, i);
          for (let k = 0; k < 3; k++) err += Math.abs(c[k]! - img.data[(y * 64 + x) * 4 + k]!);
        }
    expect(err / (64 * 32 * 3)).toBeLessThan(6);
  });

  it('writes DXT5 with alpha and ATI2 two-channel files', () => {
    const img = picture(16, 16, true);
    const bc3 = parseDds(encodeDds(img, 'BC3'));
    expect(bc3.ok && bc3.kind).toBe('bc3');
    if (bc3.ok && bc3.kind !== 'rgba8') {
      const b = bc3.mipmaps[0]!.data;
      let err = 0;
      for (let i = 0; i < 16; i++) err += Math.abs(singleAt(b, 0, i) - img.data[((i >> 2) * 16 + (i % 4)) * 4 + 3]!);
      expect(err / 16).toBeLessThan(10);
    }
    const bc5 = parseDds(encodeDds(img, 'BC5', false));
    expect(bc5.ok && bc5.kind).toBe('bc5');
    if (bc5.ok && bc5.kind !== 'rgba8') expect(bc5.mipmaps).toHaveLength(1);
  });

  it('handles sizes that are not multiples of four', () => {
    const dds = parseDds(encodeDds(picture(5, 3, false), 'BC1'));
    expect(dds.ok).toBe(true);
    if (dds.ok) expect([dds.width, dds.height]).toEqual([5, 3]);
  });

  it('picks formats and limits sizes', () => {
    expect(chooseFormat(picture(8, 8, false), 'color')).toBe('BC1');
    expect(chooseFormat(picture(8, 8, true), 'color')).toBe('BC3');
    expect(chooseFormat(picture(8, 8, false), 'normal', 'BC5')).toBe('BC5');
    expect(hasAlpha(picture(4, 4, false))).toBe(false);
    expect(halve(picture(5, 3, false))).toMatchObject({ width: 2, height: 1 });
    expect(limitSize(picture(64, 32, false), 16)).toMatchObject({ width: 16, height: 8 });
  });
});
