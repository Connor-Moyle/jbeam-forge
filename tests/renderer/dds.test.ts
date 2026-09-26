import { describe, expect, it } from 'vitest';
import { mipByteSize, parseDds, type BlockKind } from '../../src/renderer/import/dds';

function fourCC(s: string): number {
  return s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
}

/** Build a DDS file with the given header fields and correctly sized mip data. */
function makeDds(opts: { width: number; height: number; mips: number; fourcc?: string; dxgi?: number; kind: BlockKind; truncateBy?: number }): Uint8Array {
  const dx10 = opts.dxgi !== undefined;
  let data = 0;
  let w = opts.width;
  let h = opts.height;
  for (let i = 0; i < opts.mips; i++) {
    data += mipByteSize(opts.kind, w, h);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  const total = 128 + (dx10 ? 20 : 0) + data - (opts.truncateBy ?? 0);
  const bytes = new Uint8Array(total);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x20534444, true);
  v.setUint32(4, 124, true);
  v.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | (opts.mips > 1 ? 0x20000 : 0), true);
  v.setUint32(12, opts.height, true);
  v.setUint32(16, opts.width, true);
  v.setUint32(28, opts.mips, true);
  v.setUint32(76, 32, true);
  v.setUint32(80, 0x4, true);
  v.setUint32(84, fourCC(dx10 ? 'DX10' : opts.fourcc!), true);
  if (dx10) {
    v.setUint32(128, opts.dxgi!, true);
    v.setUint32(132, 3, true); // TEXTURE2D
    v.setUint32(140, 1, true); // arraySize
  }
  for (let i = 128 + (dx10 ? 20 : 0); i < total; i++) bytes[i] = i & 0xff;
  return bytes;
}

describe('parseDds', () => {
  it('reads DX10 BC7 sRGB with a full mip chain (the BeamNG case)', () => {
    const r = parseDds(makeDds({ width: 256, height: 128, mips: 9, dxgi: 99, kind: 'bc7' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ kind: 'bc7', srgb: true, width: 256, height: 128 });
    expect(r.mipmaps.map((m) => [m.width, m.height])).toEqual([
      [256, 128],
      [128, 64],
      [64, 32],
      [32, 16],
      [16, 8],
      [8, 4],
      [4, 2],
      [2, 1],
      [1, 1],
    ]);
    expect(r.mipmaps[0]!.data.byteLength).toBe(64 * 32 * 16);
    expect(r.mipmaps[8]!.data.byteLength).toBe(16); // sub-block mips still occupy one block
  });

  it.each([
    ['DXT1', 'bc1'],
    ['DXT5', 'bc3'],
    ['ATI2', 'bc5'],
  ] as const)('reads legacy fourCC %s as %s', (fcc, kind) => {
    const r = parseDds(makeDds({ width: 64, height: 64, mips: 1, fourcc: fcc, kind }));
    expect(r).toMatchObject({ ok: true, kind, srgb: false });
  });

  it('reads DX10 BC1 sRGB and BC5', () => {
    expect(parseDds(makeDds({ width: 8, height: 8, mips: 1, dxgi: 72, kind: 'bc1' }))).toMatchObject({ ok: true, kind: 'bc1', srgb: true });
    expect(parseDds(makeDds({ width: 8, height: 8, mips: 1, dxgi: 83, kind: 'bc5' }))).toMatchObject({ ok: true, kind: 'bc5' });
  });

  it('keeps the complete mip levels of a truncated file', () => {
    const r = parseDds(makeDds({ width: 64, height: 64, mips: 7, dxgi: 98, kind: 'bc7', truncateBy: 16 }));
    expect(r.ok && r.mipmaps.length).toBe(6);
  });

  it.each([
    [new Uint8Array(10), /too small/],
    [new Uint8Array(200), /not a DDS/],
  ])('rejects bad input %#', (bytes, reason) => {
    expect(parseDds(bytes)).toEqual({ ok: false, reason: expect.stringMatching(reason) });
  });

  it('rejects unsupported DXGI formats with the number', () => {
    const r = parseDds(makeDds({ width: 8, height: 8, mips: 1, dxgi: 95, kind: 'bc7' }));
    expect(r).toEqual({ ok: false, reason: 'DXGI format 95 not supported' });
  });
});
