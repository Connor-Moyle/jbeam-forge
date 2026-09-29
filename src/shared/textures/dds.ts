/**
 * DDS writer (fork): RGBA pixels → a block-compressed .dds the game loads
 * straight to the GPU, with a full mipmap chain.
 *
 *   BC1 (DXT1)  colour without alpha, 4 bits a pixel;
 *   BC3 (DXT5)  colour with alpha (and most of the game's normal maps);
 *   BC5 (ATI2)  two channels (red and green), for normal maps.
 *
 * The encoder fits each 4×4 block's colours along their widest axis and
 * picks the nearest of the four palette entries: quick, and close to what
 * texture tools produce at their fast setting.
 */

export type DdsFormat = 'BC1' | 'BC3' | 'BC5';

export interface Rgba {
  width: number;
  height: number;
  /** width × height × 4 bytes, rows top to bottom. */
  data: Uint8Array | Uint8ClampedArray;
}

/** Does any pixel have alpha below `cutoff`? */
export function hasAlpha(img: Rgba, cutoff = 250): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! < cutoff) return true;
  return false;
}

/** Which format suits a texture: normal maps BC5 or BC3 as chosen, colour BC1 unless it has alpha. */
export function chooseFormat(img: Rgba, kind: 'color' | 'normal' | 'data', normalFormat: 'BC3' | 'BC5' = 'BC3'): DdsFormat {
  if (kind === 'normal') return normalFormat;
  return hasAlpha(img) ? 'BC3' : 'BC1';
}

/** Half size with a 2×2 box filter (odd sizes round up; edges clamp). */
export function halve(img: Rgba): Rgba {
  const w = Math.max(1, img.width >> 1);
  const h = Math.max(1, img.height >> 1);
  const out = new Uint8Array(w * h * 4);
  const src = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(img.width - 1, x * 2);
      const x1 = Math.min(img.width - 1, x * 2 + 1);
      const y0 = Math.min(img.height - 1, y * 2);
      const y1 = Math.min(img.height - 1, y * 2 + 1);
      for (let c = 0; c < 4; c++) {
        const s = src[(y0 * img.width + x0) * 4 + c]! + src[(y0 * img.width + x1) * 4 + c]! + src[(y1 * img.width + x0) * 4 + c]! + src[(y1 * img.width + x1) * 4 + c]!;
        out[(y * w + x) * 4 + c] = (s + 2) >> 2;
      }
    }
  return { width: w, height: h, data: out };
}

/** Largest side at most `max` (halving): 0 = no limit. */
export function limitSize(img: Rgba, max: number): Rgba {
  let cur = img;
  while (max > 0 && Math.max(cur.width, cur.height) > max) cur = halve(cur);
  return cur;
}

const to565 = (r: number, g: number, b: number) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
const from565 = (c: number): [number, number, number] => {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
};

/** The 16 pixels of block (bx, by), edges clamped. */
function block(img: Rgba, bx: number, by: number, out: Uint8Array): void {
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const sx = Math.min(img.width - 1, bx * 4 + x);
      const sy = Math.min(img.height - 1, by * 4 + y);
      const s = (sy * img.width + sx) * 4;
      const d = (y * 4 + x) * 4;
      out[d] = img.data[s]!;
      out[d + 1] = img.data[s + 1]!;
      out[d + 2] = img.data[s + 2]!;
      out[d + 3] = img.data[s + 3]!;
    }
}

/** A BC1 colour block (always four-colour mode, as BC3 needs). Writes 8 bytes at `o`. */
function colorBlock(px: Uint8Array, out: Uint8Array, o: number): void {
  // Endpoints: the extremes along the axis of greatest spread (from the min/max box's diagonal).
  let min = [255, 255, 255];
  let max = [0, 0, 0];
  for (let i = 0; i < 16; i++)
    for (let c = 0; c < 3; c++) {
      const v = px[i * 4 + c]!;
      if (v < min[c]!) min[c] = v;
      if (v > max[c]!) max[c] = v;
    }
  const axis = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
  let lo = Infinity;
  let hi = -Infinity;
  let loI = 0;
  let hiI = 0;
  for (let i = 0; i < 16; i++) {
    const t = px[i * 4]! * axis[0]! + px[i * 4 + 1]! * axis[1]! + px[i * 4 + 2]! * axis[2]!;
    if (t < lo) {
      lo = t;
      loI = i;
    }
    if (t > hi) {
      hi = t;
      hiI = i;
    }
  }
  min = [px[loI * 4]!, px[loI * 4 + 1]!, px[loI * 4 + 2]!];
  max = [px[hiI * 4]!, px[hiI * 4 + 1]!, px[hiI * 4 + 2]!];
  // Inset a little: the palette's ends sit just inside the extremes.
  const inset = (a: number, b: number) => Math.round(a + (b - a) / 16);
  let c0 = to565(inset(max[0]!, min[0]!), inset(max[1]!, min[1]!), inset(max[2]!, min[2]!));
  let c1 = to565(inset(min[0]!, max[0]!), inset(min[1]!, max[1]!), inset(min[2]!, max[2]!));
  if (c0 < c1) [c0, c1] = [c1, c0];
  let indices = 0;
  if (c0 !== c1) {
    const e0 = from565(c0);
    const e1 = from565(c1);
    const palette = [e0, e1, e0.map((v, k) => (2 * v + e1[k]!) / 3), e0.map((v, k) => (v + 2 * e1[k]!) / 3)];
    for (let i = 15; i >= 0; i--) {
      let best = 0;
      let bestD = Infinity;
      for (let p = 0; p < 4; p++) {
        const q = palette[p]!;
        const d = (px[i * 4]! - q[0]!) ** 2 + (px[i * 4 + 1]! - q[1]!) ** 2 + (px[i * 4 + 2]! - q[2]!) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      indices = ((indices << 2) | best) >>> 0;
    }
  }
  out[o] = c0 & 255;
  out[o + 1] = c0 >> 8;
  out[o + 2] = c1 & 255;
  out[o + 3] = c1 >> 8;
  out[o + 4] = indices & 255;
  out[o + 5] = (indices >>> 8) & 255;
  out[o + 6] = (indices >>> 16) & 255;
  out[o + 7] = (indices >>> 24) & 255;
}

/** A BC4 block of one channel (eight-value mode). Writes 8 bytes at `o`. */
function singleBlock(px: Uint8Array, channel: number, out: Uint8Array, o: number): void {
  let a0 = 0;
  let a1 = 255;
  for (let i = 0; i < 16; i++) {
    const v = px[i * 4 + channel]!;
    if (v > a0) a0 = v;
    if (v < a1) a1 = v;
  }
  out[o] = a0;
  out[o + 1] = a1;
  // a0 > a1: six values between them; equal: all index 0.
  const palette = [a0, a1, ...[1, 2, 3, 4, 5, 6].map((k) => ((7 - k) * a0 + k * a1) / 7)];
  let bits = 0n;
  for (let i = 15; i >= 0; i--) {
    const v = px[i * 4 + channel]!;
    let best = 0;
    if (a0 !== a1) {
      let bestD = Infinity;
      for (let p = 0; p < 8; p++) {
        const d = Math.abs(v - palette[p]!);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    bits = (bits << 3n) | BigInt(best);
  }
  for (let k = 0; k < 6; k++) out[o + 2 + k] = Number((bits >> BigInt(8 * k)) & 255n);
}

function encodeLevel(img: Rgba, format: DdsFormat): Uint8Array {
  const bw = Math.max(1, Math.ceil(img.width / 4));
  const bh = Math.max(1, Math.ceil(img.height / 4));
  const size = format === 'BC1' ? 8 : 16;
  const out = new Uint8Array(bw * bh * size);
  const px = new Uint8Array(64);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      block(img, bx, by, px);
      const o = (by * bw + bx) * size;
      if (format === 'BC1') colorBlock(px, out, o);
      else if (format === 'BC3') {
        singleBlock(px, 3, out, o);
        colorBlock(px, out, o + 8);
      } else {
        singleBlock(px, 0, out, o);
        singleBlock(px, 1, out, o + 8);
      }
    }
  return out;
}

const FOURCC: Record<DdsFormat, string> = { BC1: 'DXT1', BC3: 'DXT5', BC5: 'ATI2' };

/** A complete .dds file. */
export function encodeDds(img: Rgba, format: DdsFormat, mipmaps = true): Uint8Array {
  const levels: Uint8Array[] = [];
  let cur = img;
  for (;;) {
    levels.push(encodeLevel(cur, format));
    if (!mipmaps || (cur.width === 1 && cur.height === 1)) break;
    cur = halve(cur);
  }
  const header = new DataView(new ArrayBuffer(128));
  const u32 = (at: number, v: number) => header.setUint32(at, v, true);
  u32(0, 0x20534444); // "DDS "
  u32(4, 124);
  // CAPS | HEIGHT | WIDTH | PIXELFORMAT | LINEARSIZE (| MIPMAPCOUNT)
  u32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000 | (levels.length > 1 ? 0x20000 : 0));
  u32(12, img.height);
  u32(16, img.width);
  u32(20, levels[0]!.length);
  u32(28, levels.length);
  u32(76, 32); // pixel format size
  u32(80, 0x4); // FOURCC
  const fourcc = FOURCC[format];
  for (let i = 0; i < 4; i++) header.setUint8(84 + i, fourcc.charCodeAt(i));
  u32(108, 0x1000 | (levels.length > 1 ? 0x8 | 0x400000 : 0)); // TEXTURE (| COMPLEX | MIPMAP)
  const total = 128 + levels.reduce((s, l) => s + l.length, 0);
  const out = new Uint8Array(total);
  out.set(new Uint8Array(header.buffer), 0);
  let at = 128;
  for (const l of levels) {
    out.set(l, at);
    at += l.length;
  }
  return out;
}
