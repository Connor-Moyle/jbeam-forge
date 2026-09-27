/**
 * Minimal DDS reader for the block-compressed formats BeamNG ships.
 * Verified on 0.39.1: every Sunburst texture is a DX10-header DDS with
 * DXGI format 99 (BC7_UNORM_SRGB), which three's DDSLoader can't read.
 * Uncompressed files (8–32 bit RGB(A), luminance(+alpha), as older mods and
 * converted cars use) are expanded to RGBA8 from their channel masks.
 *
 * Pure (no three/WebGL imports) so it's unit-testable; the texture pass maps
 * `kind` to a three.js compressed format and checks GPU support.
 */

export type BlockKind = 'bc1' | 'bc2' | 'bc3' | 'bc4' | 'bc5' | 'bc7';

export interface DdsMip {
  data: Uint8Array;
  width: number;
  height: number;
}

export type DdsResult =
  | { ok: true; kind: BlockKind; srgb: boolean; width: number; height: number; mipmaps: DdsMip[] }
  /** Uncompressed: mip data is RGBA8, top row first. */
  | { ok: true; kind: 'rgba8'; srgb: boolean; width: number; height: number; mipmaps: DdsMip[] }
  | { ok: false; reason: string };

const DDS_MAGIC = 0x20534444; // "DDS "
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_ALPHA = 0x2;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;
const DDSD_MIPMAPCOUNT = 0x20000;
const HEADER_BYTES = 128; // magic + 124-byte header
const DX10_BYTES = 20;

function fourCC(s: string): number {
  return s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
}

const FOURCC: Record<number, BlockKind> = {
  [fourCC('DXT1')]: 'bc1',
  [fourCC('DXT2')]: 'bc2',
  [fourCC('DXT3')]: 'bc2',
  [fourCC('DXT4')]: 'bc3',
  [fourCC('DXT5')]: 'bc3',
  [fourCC('ATI1')]: 'bc4',
  [fourCC('BC4U')]: 'bc4',
  [fourCC('ATI2')]: 'bc5',
  [fourCC('BC5U')]: 'bc5',
};

/** DXGI_FORMAT values → block kind + sRGB. */
const DXGI: Record<number, [BlockKind, boolean]> = {
  70: ['bc1', false], // BC1_TYPELESS
  71: ['bc1', false], // BC1_UNORM
  72: ['bc1', true], // BC1_UNORM_SRGB
  73: ['bc2', false],
  74: ['bc2', false],
  75: ['bc2', true],
  76: ['bc3', false],
  77: ['bc3', false],
  78: ['bc3', true],
  79: ['bc4', false],
  80: ['bc4', false],
  82: ['bc5', false],
  83: ['bc5', false],
  97: ['bc7', false], // BC7_TYPELESS
  98: ['bc7', false], // BC7_UNORM
  99: ['bc7', true], // BC7_UNORM_SRGB
};

export const BLOCK_BYTES: Record<BlockKind, number> = { bc1: 8, bc2: 16, bc3: 16, bc4: 8, bc5: 16, bc7: 16 };

export function mipByteSize(kind: BlockKind, width: number, height: number): number {
  return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * BLOCK_BYTES[kind];
}

export function parseDds(bytes: Uint8Array): DdsResult {
  if (bytes.byteLength < HEADER_BYTES) return { ok: false, reason: 'file too small for a DDS header' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== DDS_MAGIC) return { ok: false, reason: 'not a DDS file' };

  const flags = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const mipCount = flags & DDSD_MIPMAPCOUNT ? Math.max(1, view.getUint32(28, true)) : 1;
  const pfFlags = view.getUint32(80, true);
  const pfFourCC = view.getUint32(84, true);
  if (!(pfFlags & DDPF_FOURCC)) return parseUncompressed(bytes, view, width, height, mipCount, pfFlags);

  let kind: BlockKind | undefined;
  let srgb = false;
  let offset = HEADER_BYTES;
  if (pfFourCC === fourCC('DX10')) {
    if (bytes.byteLength < HEADER_BYTES + DX10_BYTES) return { ok: false, reason: 'truncated DX10 header' };
    const dxgi = view.getUint32(HEADER_BYTES, true);
    const dimension = view.getUint32(HEADER_BYTES + 4, true);
    const arraySize = view.getUint32(HEADER_BYTES + 12, true);
    if (dimension !== 3) return { ok: false, reason: 'only 2D textures are supported' };
    if (arraySize > 1) return { ok: false, reason: 'texture arrays are not supported' };
    const hit = DXGI[dxgi];
    if (!hit) return { ok: false, reason: `DXGI format ${dxgi} not supported` };
    [kind, srgb] = hit;
    offset += DX10_BYTES;
  } else {
    kind = FOURCC[pfFourCC];
    if (!kind) return { ok: false, reason: 'unsupported compression' };
  }

  const mipmaps: DdsMip[] = [];
  let w = width;
  let h = height;
  for (let i = 0; i < mipCount; i++) {
    const size = mipByteSize(kind, w, h);
    if (offset + size > bytes.byteLength) {
      if (mipmaps.length === 0) return { ok: false, reason: 'truncated pixel data' };
      break; // keep the levels we have
    }
    mipmaps.push({ data: bytes.subarray(offset, offset + size), width: w, height: h });
    offset += size;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return { ok: true, kind, srgb, width, height, mipmaps };
}

/** One channel of a packed pixel: where its bits are and how to scale them to 0–255. */
function channel(mask: number): { shift: number; max: number } | null {
  if (!mask) return null;
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  return { shift, max: mask >>> shift };
}

function parseUncompressed(bytes: Uint8Array, view: DataView, width: number, height: number, mipCount: number, pfFlags: number): DdsResult {
  const bits = view.getUint32(88, true);
  if (bits !== 8 && bits !== 16 && bits !== 24 && bits !== 32) return { ok: false, reason: `${bits}-bit uncompressed DDS not supported` };
  if (!(pfFlags & (DDPF_RGB | DDPF_LUMINANCE | DDPF_ALPHA))) return { ok: false, reason: 'unsupported uncompressed DDS layout' };
  const luminance = !!(pfFlags & DDPF_LUMINANCE);
  const alphaOnly = !!(pfFlags & DDPF_ALPHA) && !(pfFlags & (DDPF_RGB | DDPF_LUMINANCE));
  const [r, g, b] = [channel(view.getUint32(92, true)), channel(view.getUint32(96, true)), channel(view.getUint32(100, true))];
  const a = pfFlags & (DDPF_ALPHAPIXELS | DDPF_ALPHA) ? channel(view.getUint32(104, true)) : null;
  const bpp = bits / 8;
  const scale = (v: number, c: { shift: number; max: number } | null, fallback: number) => (c ? Math.round((((v >>> c.shift) & c.max) * 255) / c.max) : fallback);

  const mipmaps: DdsMip[] = [];
  let offset = HEADER_BYTES;
  let w = width;
  let h = height;
  for (let level = 0; level < mipCount; level++) {
    const size = w * h * bpp;
    if (offset + size > bytes.byteLength) {
      if (mipmaps.length === 0) return { ok: false, reason: 'truncated pixel data' };
      break;
    }
    const out = new Uint8Array(w * h * 4);
    for (let i = 0, o = offset; i < w * h; i++, o += bpp) {
      const v = bpp === 1 ? bytes[o]! : bpp === 2 ? view.getUint16(o, true) : bpp === 3 ? bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) : view.getUint32(o, true);
      const red = alphaOnly ? 255 : scale(v, r, 0);
      out[i * 4] = red;
      out[i * 4 + 1] = luminance || alphaOnly ? red : scale(v, g, 0);
      out[i * 4 + 2] = luminance || alphaOnly ? red : scale(v, b, 0);
      out[i * 4 + 3] = scale(v, a, 255);
    }
    mipmaps.push({ data: out, width: w, height: h });
    offset += size;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return { ok: true, kind: 'rgba8', srgb: false, width, height, mipmaps };
}
