/**
 * The active viewport, for app-level features that need a rendered frame
 * (project thumbnails on save; preview capture later).
 */
import { ALL_CAPS, type GpuTextureCaps } from '@renderer/import/textures';
import type { StudioOptions } from './studio';

export interface ViewportHandle {
  /** Render now and return a JPEG data URL of `width`×`height` (cover-cropped), or null. */
  capture(width: number, height: number): string | null;
  /** A studio picture of the car (vehicle-selector style), or null. */
  captureStudio(opts: StudioOptions): string | null;
  /** Block-compressed texture formats this GPU can sample. */
  textureCaps(): GpuTextureCaps;
}

let active: ViewportHandle | null = null;

export function registerViewport(handle: ViewportHandle): () => void {
  active = handle;
  return () => {
    if (active === handle) active = null;
  };
}

export const THUMBNAIL_SIZE = { width: 320, height: 180 } as const; // token-lint-ignore: output image pixels, not UI layout

export function captureThumbnail(): string | null {
  try {
    return active?.capture(THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height) ?? null;
  } catch {
    return null; // a thumbnail is never worth failing a save over
  }
}

/** GPU texture support of the active viewport (optimistic when no viewport exists yet). */
export function textureCaps(): GpuTextureCaps {
  return active?.textureCaps() ?? ALL_CAPS;
}

/** Config preview size BeamNG's vehicle selector uses (16:9). */
export const PREVIEW_SIZE = { width: 500, height: 281 } as const; // token-lint-ignore: output image pixels, not UI layout

/** Vehicle-selector preview (JPEG data URL), or null when no viewport is rendering. */
export function capturePreview(): string | null {
  try {
    return active?.capture(PREVIEW_SIZE.width, PREVIEW_SIZE.height) ?? null;
  } catch {
    return null;
  }
}

/** A studio picture of the car for the vehicle selector (JPEG data URL), or null when no viewport is rendering. */
export function captureStudio(opts: StudioOptions): string | null {
  try {
    return active?.captureStudio(opts) ?? null;
  } catch {
    return null;
  }
}
