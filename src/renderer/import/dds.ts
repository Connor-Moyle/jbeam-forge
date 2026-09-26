/**
 * Minimal DDS reader for the block-compressed formats BeamNG ships.
 * Verified on 0.39.1: every Sunburst texture is a DX10-header DDS with
 * DXGI format 99 (BC7_UNORM_SRGB), which three's DDSLoader can't read.
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
  | { ok: false; reason: string };

const DDS_MAGIC = 0x20534444; // "DDS "
const DDPF_FOURCC = 0x4;
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
  if (!(pfFlags & DDPF_FOURCC)) return { ok: false, reason: 'uncompressed DDS (not supported yet)' };

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
