import { readFile, writeFile } from 'node:fs/promises';
import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { z } from 'zod';
import type { Settings } from '@shared/settings-schema';

/**
 * Window & display settings: the window's size at startup (the last size,
 * a resolution preset or a custom size), whether it starts maximised or
 * full screen, and the interface zoom. Changes apply to the open window.
 */

const BoundsSchema = z.object({ x: z.number(), y: z.number(), width: z.number().min(400), height: z.number().min(300), maximized: z.boolean() });
export type SavedBounds = z.infer<typeof BoundsSchema>;

export async function loadBounds(path: string): Promise<SavedBounds | null> {
  try {
    const parsed = BoundsSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveBounds(path: string, win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || win.isFullScreen()) return;
  const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  await writeFile(path, JSON.stringify({ ...b, maximized: win.isMaximized() }));
}

/** Width × height for a size setting ("1920x1080", custom, or null for "remember"). */
export function presetSize(s: Pick<Settings, 'windowSize' | 'windowWidth' | 'windowHeight'>): { width: number; height: number } | null {
  if (s.windowSize === 'remember') return null;
  if (s.windowSize === 'custom') return { width: s.windowWidth, height: s.windowHeight };
  const [w, h] = s.windowSize.split('x').map(Number);
  return { width: w!, height: h! };
}

/** Clamp a size to the display's work area (a 4K preset on a 1080p screen fits the screen instead). */
export function fitToArea(size: { width: number; height: number }, area: Rectangle): { width: number; height: number } {
  return { width: Math.min(size.width, area.width), height: Math.min(size.height, area.height) };
}

/** Is a remembered window still on some display? */
function onScreen(b: Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 50 && b.x + b.width > a.x + 50 && b.y < a.y + a.height - 50 && b.y + 30 > a.y;
  });
}

/** The window's initial bounds and state. */
export function initialBounds(s: Settings, remembered: SavedBounds | null): { bounds: Partial<Rectangle> & { width: number; height: number }; maximize: boolean } {
  const area = screen.getPrimaryDisplay().workArea;
  const preset = presetSize(s);
  if (preset) return { bounds: fitToArea(preset, area), maximize: s.startMode === 'maximized' };
  if (remembered && onScreen(remembered)) return { bounds: remembered, maximize: remembered.maximized || s.startMode === 'maximized' };
  return { bounds: fitToArea({ width: 1440, height: 900 }, area), maximize: s.startMode === 'maximized' };
}

/** Apply display settings to the open window (only what changed since `prev`). */
export function applyDisplay(win: BrowserWindow, s: Settings, prev: Settings | null): void {
  if (win.isDestroyed()) return;
  if (!prev || prev.uiScale !== s.uiScale) win.webContents.setZoomFactor(s.uiScale);
  if (!prev) return;
  const sizeChanged = prev.windowSize !== s.windowSize || prev.windowWidth !== s.windowWidth || prev.windowHeight !== s.windowHeight;
  const preset = presetSize(s);
  if (sizeChanged && preset) {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const size = fitToArea(preset, area);
    win.setSize(size.width, size.height);
    win.center();
  }
  if (prev.startMode !== s.startMode) {
    if (s.startMode === 'fullscreen') win.setFullScreen(true);
    else {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (s.startMode === 'maximized') win.maximize();
      else if (win.isMaximized()) win.unmaximize();
    }
  }
}
