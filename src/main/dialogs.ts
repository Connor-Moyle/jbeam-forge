import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions, type WebContents } from 'electron';

/**
 * Native file dialogs. Every path the renderer may touch comes from here (or
 * the recent list), never from renderer input.
 *
 * Harness mode: scripted answers queued via `harness:queueDialog` are used
 * instead of showing a native dialog (Playwright can't click those).
 */
const harnessQueue: (string | null)[] = [];

export function queueHarnessDialogAnswers(answers: (string | null)[]): void {
  harnessQueue.push(...answers);
}

function owner(sender: WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender);
}

export async function pickOpenFile(sender: WebContents, options: OpenDialogOptions): Promise<string | null> {
  if (harnessQueue.length) return harnessQueue.shift() ?? null;
  const win = owner(sender);
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return res.canceled ? null : (res.filePaths[0] ?? null);
}

/** Several files (harness: one queued path per call). */
export async function pickOpenFiles(sender: WebContents, options: OpenDialogOptions): Promise<string[]> {
  if (harnessQueue.length) return [harnessQueue.shift()!].filter(Boolean);
  const win = owner(sender);
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return res.canceled ? [] : res.filePaths;
}

export async function pickSaveFile(sender: WebContents, options: SaveDialogOptions): Promise<string | null> {
  if (harnessQueue.length) return harnessQueue.shift() ?? null;
  const win = owner(sender);
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return res.canceled || !res.filePath ? null : res.filePath;
}

export async function pickDirectory(sender: WebContents, options: OpenDialogOptions): Promise<string | null> {
  return pickOpenFile(sender, { ...options, properties: ['openDirectory'] });
}
