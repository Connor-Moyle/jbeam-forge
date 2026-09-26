/**
 * The active viewport, for app-level features that need a rendered frame
 * (project thumbnails on save; preview capture later).
 */
export interface ViewportHandle {
  /** Render now and return a JPEG data URL of `width`×`height` (cover-cropped), or null. */
  capture(width: number, height: number): string | null;
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
