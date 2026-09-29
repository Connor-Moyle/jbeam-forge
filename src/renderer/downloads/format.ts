import { IpcCallError } from '@renderer/diagnostics/ipc';

/** "12.3 MB", "840 KB", "1.2 GB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** "28 Sep 2026" (empty for an unknown date). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The message of an IPC failure (the main process's own words). */
export function errorText(err: unknown): string {
  return err instanceof IpcCallError ? err.ipcError.message : err instanceof Error ? err.message : String(err);
}
