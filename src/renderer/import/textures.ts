import {
  CompressedTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RED_GREEN_RGTC2_Format,
  RED_RGTC1_Format,
  RGBA_BPTC_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT3_Format,
  RGBA_S3TC_DXT5_Format,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  type CompressedPixelFormat,
  type Material,
} from 'three';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { parseDds, type BlockKind } from './dds';
import { refFromPlaceholder } from './loaders';

/**
 * Texture pass: find every placeholder the loaders left in material slots,
 * resolve the original references through main (texture search rules live in
 * src/main/import/textures.ts), decode and upload them. Missing/unsupported
 * slots are cleared so the base colour shows instead of a black placeholder.
 */

const SLOTS = ['map', 'normalMap', 'specularMap', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'lightMap', 'displacementMap'] as const;
type Slot = (typeof SLOTS)[number];
const COLOR_SLOTS = new Set<Slot>(['map', 'emissiveMap', 'specularMap']);

export type GpuTextureCaps = Record<BlockKind, boolean>;

export const ALL_CAPS: GpuTextureCaps = { bc1: true, bc2: true, bc3: true, bc4: true, bc5: true, bc7: true };

const THREE_FORMAT: Record<BlockKind, CompressedPixelFormat> = {
  bc1: RGBA_S3TC_DXT1_Format,
  bc2: RGBA_S3TC_DXT3_Format,
  bc3: RGBA_S3TC_DXT5_Format,
  bc4: RED_RGTC1_Format,
  bc5: RED_GREEN_RGTC2_Format,
  bc7: RGBA_BPTC_Format,
};

export interface TextureIO {
  resolve: (refs: string[]) => Promise<{ resolved: Record<string, string | null>; truncated: boolean }>;
  read: (path: string) => Promise<Uint8Array>;
}

export interface TextureReport {
  loaded: number;
  missing: string[];
  unsupported: { ref: string; reason: string }[];
  /** The texture search hit its file limit; some textures may exist but weren't indexed. */
  truncated: boolean;
}

type SlotUse = { material: Material; slot: Slot; placeholder: Texture };

function slotTexture(material: Material, slot: Slot): Texture | null {
  const t = (material as unknown as Record<string, unknown>)[slot];
  return t instanceof Texture ? t : null;
}

function setSlot(material: Material, slot: Slot, tex: Texture | null): void {
  (material as unknown as Record<string, unknown>)[slot] = tex;
  material.needsUpdate = true;
}

/** Placeholder textures by original reference. */
export function collectTextureRefs(materials: readonly Material[]): Map<string, SlotUse[]> {
  const refs = new Map<string, SlotUse[]>();
  for (const material of materials) {
    for (const slot of SLOTS) {
      const tex = slotTexture(material, slot);
      const src = (tex?.image as { src?: string } | undefined)?.src;
      const ref = refFromPlaceholder(src);
      if (!tex || !ref) continue;
      const list = refs.get(ref) ?? [];
      list.push({ material, slot, placeholder: tex });
      refs.set(ref, list);
    }
  }
  return refs;
}

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

async function decodeImage(bytes: Uint8Array): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes.slice()]));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * How the decoded pixels are oriented: `compressed` data can't be flipped on
 * upload; `image` follows the slot's flipY; `data` (TGA) carries its own flip.
 */
type Decoded = { texture: Texture; kind: 'compressed' | 'image' | 'data'; dataFlipY?: boolean } | { error: string };

async function decode(path: string, bytes: Uint8Array, caps: GpuTextureCaps): Promise<Decoded> {
  const ext = extensionOf(path);
  if (ext === 'dds') {
    const dds = parseDds(bytes);
    if (!dds.ok) return { error: dds.reason };
    if (dds.kind === 'rgba8') {
      // Rows are top-first like a decoded image, so it follows the slot's flipY the same way.
      const top = dds.mipmaps[0]!;
      const tex = new DataTexture(top.data, top.width, top.height, RGBAFormat);
      tex.generateMipmaps = true;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      return { texture: tex, kind: 'image' };
    }
    if (!caps[dds.kind]) return { error: `${dds.kind.toUpperCase()} textures aren't supported by this GPU/driver` };
    const tex = new CompressedTexture(
      dds.mipmaps.map((m) => ({ data: m.data, width: m.width, height: m.height })),
      dds.width,
      dds.height,
      THREE_FORMAT[dds.kind],
    );
    tex.minFilter = dds.mipmaps.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
    tex.magFilter = LinearFilter;
    return { texture: tex, kind: 'compressed' };
  }
  if (ext === 'tga') {
    const t = new TGALoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const tex = new DataTexture(t.data, t.width, t.height, RGBAFormat);
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    return { texture: tex, kind: 'data', dataFlipY: Boolean(t.flipY) };
  }
  try {
    return { texture: new Texture(await decodeImage(bytes)), kind: 'image' };
  } catch {
    return { error: `could not decode .${ext} image` };
  }
}

/**
 * Give the decoded texture the placeholder's UV settings and orientation.
 * Loaders set flipY on the placeholder to the convention of their format
 * (COLLADA/OBJ/FBX: true, glTF: false); we honour that for every kind.
 */
function adopt(next: Texture, from: Texture, slot: Slot, decoded: Exclude<Decoded, { error: string }>): void {
  next.wrapS = from.wrapS;
  next.wrapT = from.wrapT;
  next.channel = from.channel;
  next.rotation = from.rotation;
  next.center.copy(from.center);
  next.repeat.copy(from.repeat);
  next.offset.copy(from.offset);
  if (decoded.kind === 'image') {
    next.flipY = from.flipY;
  } else if (decoded.kind === 'data') {
    next.flipY = from.flipY ? Boolean(decoded.dataFlipY) : !decoded.dataFlipY;
  } else if (from.flipY) {
    // Compressed data can't be flipped on upload; flip V in the texture matrix instead.
    next.repeat.y = -from.repeat.y;
    next.offset.y = 1 - from.offset.y;
  }
  next.colorSpace = COLOR_SLOTS.has(slot) ? SRGBColorSpace : NoColorSpace;
  next.needsUpdate = true;
}

export async function applyTextures(materials: readonly Material[], io: TextureIO, caps: GpuTextureCaps = ALL_CAPS): Promise<TextureReport> {
  const uses = collectTextureRefs(materials);
  const report: TextureReport = { loaded: 0, missing: [], unsupported: [], truncated: false };
  if (uses.size === 0) return report;

  const { resolved, truncated } = await io.resolve([...uses.keys()]);
  report.truncated = truncated;

  for (const [ref, list] of uses) {
    const path = resolved[ref] ?? null;
    let decoded: Decoded;
    if (!path) {
      decoded = { error: 'missing' };
    } else {
      try {
        decoded = await decode(path, await io.read(path), caps);
      } catch (err) {
        decoded = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    if ('error' in decoded) {
      if (decoded.error === 'missing') report.missing.push(ref);
      else report.unsupported.push({ ref, reason: decoded.error });
      for (const u of list) {
        setSlot(u.material, u.slot, null);
        u.placeholder.dispose();
      }
      continue;
    }
    report.loaded++;
    list.forEach((u, i) => {
      // Slots sharing one image share the decoded data; each gets its own UV settings.
      const tex = i === 0 ? decoded.texture : decoded.texture.clone();
      adopt(tex, u.placeholder, u.slot, decoded);
      tex.userData.sourcePath = path; // the exporter copies this file into the mod
      tex.userData.sourceRef = ref;
      setSlot(u.material, u.slot, tex);
      u.placeholder.dispose();
    });
  }
  return report;
}
