import { effectiveKeymap, keyOfEvent, type KeymapId } from '@shared/keymap';
import { useSettingsStore } from './stores/settings';

/**
 * The keymap as the renderer uses it (Settings → Keymap): whether a key
 * press is an action's key, and an action's key for tooltips.
 */

let lastOverrides: unknown = null;
let keys: Record<string, string> = effectiveKeymap({});

function current(): Record<string, string> {
  const overrides = useSettingsStore.getState().settings?.keymap;
  if (overrides !== lastOverrides) {
    lastOverrides = overrides;
    keys = effectiveKeymap(overrides);
  }
  return keys;
}

export function keyFor(id: KeymapId): string {
  return current()[id] ?? '';
}

/** Is this key press the action's key? */
export function isKey(e: KeyboardEvent, id: KeymapId): boolean {
  const k = current()[id];
  if (!k) return false;
  const pressed = keyOfEvent(e);
  if (!pressed) return false;
  // Backspace deletes too, wherever Delete does.
  if (k === 'Delete' && pressed === 'Backspace') return true;
  return pressed === k;
}

/** Typing in a field: keys belong to the field. */
export function inField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable || !!t.closest('.cm-editor'));
}
