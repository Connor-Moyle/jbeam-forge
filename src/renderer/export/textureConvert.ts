import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import type { DdsJob } from '../../workers/dds.worker';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';

/**
 * Textures → DDS for export (fork): each PNG, JPG, TGA… a material uses is
 * read, decoded and block-compressed (with mipmaps) into the mod as .dds,
 * which the game loads fastest. DDS files are copied as they are.
 */

const logger = rlog('dds');

export type TextureKind = 'color' | 'normal' | 'data';

export interface DdsOptions {
  mipmaps: boolean;
  normalFormat: 'BC3' | 'BC5';
  /** Largest side (px); 0 = keep. */
  maxSize: number;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

function encoder(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../workers/dds.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e: MessageEvent<{ id: number; bytes?: Uint8Array; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.bytes) p.resolve(e.data.bytes);
    else p.reject(new Error(e.data.error ?? 'DDS encoding failed'));
  });
  return worker;
}

const ext = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();

/** Can this file be turned into a DDS here? */
export function convertible(path: string): boolean {
  return ['png', 'jpg', 'jpeg', 'tga', 'bmp', 'webp', 'gif'].includes(ext(path));
}

/** Decode image file bytes to RGBA, top row first. */
export async function decodeImage(bytes: Uint8Array, path: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  if (ext(path) === 'tga') {
    const t = new TGALoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) as { data: Uint8Array; width: number; height: number; flipY?: boolean };
    const data = new Uint8ClampedArray(t.width * t.height * 4);
    const row = t.width * 4;
    // three's TGA data is bottom row first (flipY): turn it the right way up.
    for (let y = 0; y < t.height; y++) data.set(t.data.subarray((t.flipY ? t.height - 1 - y : y) * row, ((t.flipY ? t.height - 1 - y : y) + 1) * row), y * row);
    return { width: t.width, height: t.height, data };
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, data: g.getImageData(0, 0, canvas.width, canvas.height).data };
}

/** Read, decode and encode one texture file as DDS. */
export async function textureToDds(path: string, kind: TextureKind, opts: DdsOptions): Promise<Uint8Array> {
  const bytes = await call('import:readFile', { path });
  const img = await decodeImage(bytes, path);
  const id = nextId++;
  const job: DdsJob = { id, width: img.width, height: img.height, data: img.data, kind, normalFormat: opts.normalFormat, mipmaps: opts.mipmaps, maxSize: opts.maxSize };
  return new Promise<Uint8Array>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    encoder().postMessage(job, [img.data.buffer]);
  }).catch((err: unknown) => {
    logger.warn('dds failed for', path, err instanceof Error ? err.message : String(err));
    throw err;
  });
}

/** Base64 of bytes (for a mod file). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
