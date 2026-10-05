/**
 * The keymap (fork): every action a key can do, with its default key, like
 * Blender's keymap preferences. Settings keep only the keys the user
 * changed; menus (accelerators) and the viewport read the result.
 *
 * Keys are written "Ctrl+Shift+S", "G", "Alt+2", "Home", "Delete", "F1".
 * Ctrl means Cmd on a Mac.
 */

export type KeymapGroup = 'File' | 'Edit' | 'View' | 'Workspaces' | 'Viewport' | 'Nodes & beams';

export interface KeymapAction {
  id: string;
  label: string;
  group: KeymapGroup;
  default: string;
  /** Menu actions run in the main process (their keys are menu accelerators). */
  menu?: boolean;
}

export const KEYMAP: readonly KeymapAction[] = [
  { id: 'new', label: 'New mod', group: 'File', default: 'Ctrl+N', menu: true },
  { id: 'open', label: 'Open project', group: 'File', default: 'Ctrl+O', menu: true },
  { id: 'import', label: 'Import a model', group: 'File', default: 'Ctrl+I', menu: true },
  { id: 'save', label: 'Save', group: 'File', default: 'Ctrl+S', menu: true },
  { id: 'saveAs', label: 'Save as', group: 'File', default: 'Ctrl+Shift+S', menu: true },
  { id: 'export', label: 'Export mod', group: 'File', default: 'Ctrl+E' },
  { id: 'settings', label: 'Settings', group: 'File', default: 'Ctrl+,', menu: true },
  { id: 'downloads', label: 'Downloads', group: 'File', default: 'Ctrl+Shift+D', menu: true },
  { id: 'undo', label: 'Undo', group: 'Edit', default: 'Ctrl+Z', menu: true },
  { id: 'redo', label: 'Redo', group: 'Edit', default: 'Ctrl+Y', menu: true },
  { id: 'selectAll', label: 'Select all', group: 'Edit', default: 'Ctrl+A', menu: true },
  { id: 'palette', label: 'Command palette', group: 'Edit', default: 'Ctrl+K', menu: true },
  { id: 'configs', label: 'Configurations manager', group: 'Edit', default: 'Ctrl+Shift+C' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'View', default: 'F1', menu: true },
  { id: 'help', label: 'Help and tutorials', group: 'View', default: 'Shift+F1', menu: true },
  { id: 'viewMesh', label: 'Show or hide the mesh', group: 'View', default: 'Alt+1' },
  { id: 'viewStructure', label: 'Show or hide nodes & beams', group: 'View', default: 'Alt+2' },
  { id: 'viewXray', label: 'X-ray on or off', group: 'View', default: 'Alt+3' },
  { id: 'layout1', label: 'Parts workspace', group: 'Workspaces', default: 'Ctrl+1' },
  { id: 'layout2', label: 'Materials workspace', group: 'Workspaces', default: 'Ctrl+2' },
  { id: 'layout3', label: 'JBeam workspace', group: 'Workspaces', default: 'Ctrl+3' },
  { id: 'layout4', label: 'Moving parts workspace', group: 'Workspaces', default: 'Ctrl+4' },
  { id: 'layout5', label: 'Triggers workspace', group: 'Workspaces', default: 'Ctrl+5' },
  { id: 'layout6', label: 'Scripts workspace', group: 'Workspaces', default: 'Ctrl+6' },
  { id: 'layout7', label: 'Testing workspace', group: 'Workspaces', default: 'Ctrl+7' },
  { id: 'layout8', label: 'Modelling workspace', group: 'Workspaces', default: 'Ctrl+8' },
  { id: 'layout9', label: 'Engine workspace', group: 'Workspaces', default: 'Ctrl+9' },
  { id: 'layout0', label: 'Suspension workspace', group: 'Workspaces', default: 'Ctrl+0' },
  { id: 'focus', label: 'Focus the selection', group: 'Viewport', default: 'F' },
  { id: 'frameAll', label: 'Frame everything', group: 'Viewport', default: 'Home' },
  { id: 'move', label: 'Move (gizmo)', group: 'Viewport', default: 'G' },
  { id: 'rotate', label: 'Rotate (gizmo)', group: 'Viewport', default: 'R' },
  { id: 'scale', label: 'Scale (gizmo)', group: 'Viewport', default: 'S' },
  { id: 'editMode', label: 'Edit nodes & beams on or off', group: 'Viewport', default: 'Tab' },
  { id: 'cancel', label: 'Cancel / leave focus', group: 'Viewport', default: 'Escape' },
  { id: 'nodeSelectAll', label: 'Select all nodes', group: 'Nodes & beams', default: 'Ctrl+A' },
  { id: 'nodeInvert', label: 'Invert the selection', group: 'Nodes & beams', default: 'I' },
  { id: 'nodeConnected', label: 'Select connected', group: 'Nodes & beams', default: 'L' },
  { id: 'nodeConnect', label: 'Connect with beams', group: 'Nodes & beams', default: 'B' },
  { id: 'nodeMerge', label: 'Merge nodes', group: 'Nodes & beams', default: 'M' },
  { id: 'beamSplit', label: 'Split beams', group: 'Nodes & beams', default: 'D' },
  { id: 'nodeDelete', label: 'Delete the selection', group: 'Nodes & beams', default: 'Delete' },
  { id: 'nodeAdd', label: 'Add a node', group: 'Nodes & beams', default: 'N' },
  { id: 'nodeMirror', label: 'Mirror the selection to the other side', group: 'Nodes & beams', default: 'Shift+M' },
  { id: 'triAdd', label: 'Make a triangle of three nodes', group: 'Nodes & beams', default: 'T' },
  { id: 'selectTris', label: 'Select the triangles of the selected nodes', group: 'Nodes & beams', default: 'Shift+T' },
  { id: 'selectBeams', label: 'Select the beams between the selected nodes', group: 'Nodes & beams', default: 'Shift+B' },
];

export type KeymapId = (typeof KEYMAP)[number]['id'];

const MOD_ORDER = ['Ctrl', 'Shift', 'Alt'] as const;
const KEY_NAMES: Record<string, string> = { ' ': 'Space', Esc: 'Escape', Del: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

/** Tidy a key: modifiers in a fixed order, the key capitalised ("shift+ctrl+s" → "Ctrl+Shift+S"). */
export function normaliseKey(combo: string): string {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const mods = new Set<string>();
  let key = '';
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === 'ctrl' || low === 'control' || low === 'cmd' || low === 'cmdorctrl' || low === 'meta') mods.add('Ctrl');
    else if (low === 'shift') mods.add('Shift');
    else if (low === 'alt' || low === 'option') mods.add('Alt');
    else key = KEY_NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1));
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].filter(Boolean).join('+');
}

/** The key a keyboard event is, in keymap form (null for a lone modifier). */
export function keyOfEvent(e: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  // Digits by their key position, so Shift+1 is "Shift+1", not "Shift+!".
  const key = e.code && /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key;
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : ''].filter(Boolean);
  return normaliseKey([...mods, key === '+' ? 'Plus' : key].join('+'));
}

/** Every action's key: the user's where set (empty = none), else the default. */
export function effectiveKeymap(overrides: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of KEYMAP) out[a.id] = normaliseKey(overrides?.[a.id] ?? a.default);
  return out;
}

/** Actions that share a key and could both fire (same group, or a global one with anything). */
export function keymapConflicts(keys: Readonly<Record<string, string>>): { key: string; actions: string[] }[] {
  const scopeOf = (a: KeymapAction) => (a.group === 'Nodes & beams' ? 'edit' : a.group === 'Viewport' ? 'viewport' : 'global');
  const byKey = new Map<string, KeymapAction[]>();
  for (const a of KEYMAP) {
    const k = keys[a.id];
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), a]);
  }
  const out: { key: string; actions: string[] }[] = [];
  for (const [key, actions] of byKey) {
    if (actions.length < 2) continue;
    const scopes = actions.map(scopeOf);
    // Edit-mode keys stand in for viewport and global ones while editing; that's intended (Ctrl+A, Ctrl+I).
    const clash = scopes.some((s, i) => scopes.some((t, j) => i !== j && s === t));
    if (clash) out.push({ key, actions: actions.map((a) => a.id) });
  }
  return out;
}

/** A keymap key as an Electron accelerator ("Ctrl+S" → "CmdOrCtrl+S"). */
export function toAccelerator(key: string): string | undefined {
  if (!key) return undefined;
  return key
    .split('+')
    .map((p) => (p === 'Ctrl' ? 'CmdOrCtrl' : p === 'Escape' ? 'Esc' : p === 'Delete' ? 'Delete' : p))
    .join('+');
}

/** How a key reads in the UI. */
export function keyLabel(key: string, mac = false): string {
  if (!key) return '—';
  return mac ? key.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥') : key;
}
