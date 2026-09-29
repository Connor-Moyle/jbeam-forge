/**
 * The viewport's frame-rate cap (Settings → Viewport & graphics). Frames are
 * due on a fixed schedule: the last frame time advances by the interval, not
 * to "now", so the rate averages out to the cap whatever the display's
 * refresh; a frame up to 1 ms early still counts, and after a pause the
 * schedule restarts. Returns the new last-frame time, or null to skip.
 */
export function frameDue(now: number, last: number, maxFps: number): number | null {
  if (maxFps <= 0) return now;
  const interval = 1000 / maxFps;
  if (now - last < interval - 1) return null;
  return now - last > interval * 3 ? now : last + interval;
}
