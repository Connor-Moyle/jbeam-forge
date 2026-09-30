/**
 * Keys for vehicle scripts, as BeamNG's input maps name them ("lctrl m",
 * "numpad5", "lalt lshift f6"), from a key press, and back into something
 * readable ("Ctrl + M").
 */

const NAMED: Record<string, string> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ' ': 'space',
  Enter: 'return',
  Tab: 'tab',
  Insert: 'insert',
  Delete: 'delete',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  '.': 'period',
  ',': 'comma',
  '/': 'slash',
  '\\': 'backslash',
  ';': 'semicolon',
  "'": 'apostrophe',
  '[': 'lbracket',
  ']': 'rbracket',
  '-': 'minus',
  '=': 'equals',
  '`': 'tilde',
};

const NUMPAD: Record<string, string> = {
  NumpadAdd: 'numpadadd',
  NumpadSubtract: 'numpadminus',
  NumpadMultiply: 'numpadmult',
  NumpadDivide: 'numpaddivide',
  NumpadDecimal: 'numpaddecimal',
  NumpadEnter: 'numpadenter',
};

export interface KeyPress {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

/** BeamNG's name for a key press; null for a modifier on its own or a key it has no name for. */
export function beamngControl(e: KeyPress): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
  let key: string | undefined;
  if (e.code && /^Numpad\d$/.test(e.code)) key = `numpad${e.code.slice(6)}`;
  else if (e.code && NUMPAD[e.code]) key = NUMPAD[e.code];
  else if (e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase(); // the key, whatever the layout or Shift made of it
  else if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(e.key)) key = e.key.toLowerCase();
  else key = NAMED[e.key] ?? (/^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : undefined);
  if (!key) return null;
  const mods = [e.ctrlKey || e.metaKey ? 'lctrl' : '', e.shiftKey ? 'lshift' : '', e.altKey ? 'lalt' : ''].filter(Boolean);
  return [...mods, key].join(' ');
}

const LABELS: Record<string, string> = {
  lctrl: 'Ctrl',
  rctrl: 'Right Ctrl',
  ctrl: 'Ctrl',
  lshift: 'Shift',
  rshift: 'Right Shift',
  shift: 'Shift',
  lalt: 'Alt',
  ralt: 'Right Alt',
  alt: 'Alt',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  space: 'Space',
  return: 'Enter',
  period: '.',
  comma: ',',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  apostrophe: "'",
  lbracket: '[',
  rbracket: ']',
  minus: '-',
  equals: '=',
  tilde: '`',
  numpadadd: 'Numpad +',
  numpadminus: 'Numpad −',
  numpadmult: 'Numpad ×',
  numpaddivide: 'Numpad ÷',
  numpaddecimal: 'Numpad .',
  numpadenter: 'Numpad Enter',
};

/** "lctrl m" → "Ctrl + M". */
export function controlLabel(control: string): string {
  const parts = control.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts
    .map((p) => LABELS[p] ?? (/^numpad\d$/.test(p) ? `Numpad ${p.slice(6)}` : /^f\d+$/.test(p) ? p.toUpperCase() : p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))
    .join(' + ');
}

/** A problem with a key before it reaches the game, or null. */
export function controlWarning(control: string): string | null {
  const parts = control.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const mods = parts.filter((p) => /^[lr]?(ctrl|shift|alt)$/.test(p));
  const key = parts[parts.length - 1]!;
  if (!mods.length && /^[a-z0-9]$|^(up|down|left|right|space|return|tab)$/.test(key)) return 'Without Ctrl or Alt this is probably one of the game’s own driving keys, so the script won’t get it.';
  return null;
}
