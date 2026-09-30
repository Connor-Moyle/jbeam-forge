import { PAINT_SCHEMES, presetByName } from '@shared/paints/paints';
import type { Paint } from '@shared/project/schema';
import { projectStore } from '@renderer/app/stores/project';
import { call } from '@renderer/diagnostics/ipc';
import { setTexture } from '@renderer/materials/commands';

/** Undoable edits to the factory paints and where they go. */

type Slot = 0 | 1 | 2;

function uniqueName(base: string): string {
  const taken = new Set((projectStore.getState().doc?.paints.list ?? []).map((p) => p.name.toLowerCase()));
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  return name;
}

/** Add a paint (a preset or a copy); the first one also becomes every default slot. */
export function addPaint(from: Omit<Paint, 'id'>): string {
  const id = `paint_${crypto.randomUUID().slice(0, 8)}`;
  const paint: Paint = { ...structuredClone(from), id, name: uniqueName(from.name) };
  projectStore.getState().execute({
    label: `Add paint ${paint.name}`,
    apply: (d) => {
      d.paints.list.push(paint);
      d.paints.defaults = d.paints.defaults.map((x) => x ?? id) as typeof d.paints.defaults;
    },
  });
  return id;
}

export function updatePaint(id: string, patch: Partial<Omit<Paint, 'id'>>): void {
  projectStore.getState().execute({
    label: 'Edit paint',
    coalesce: `paint:${id}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      const p = d.paints.list.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    },
  });
}

/** Delete a paint; slots that used it go back to the default (or the first paint). */
export function deletePaint(id: string): void {
  projectStore.getState().execute({
    label: 'Delete paint',
    apply: (d) => {
      d.paints.list = d.paints.list.filter((p) => p.id !== id);
      const first = d.paints.list[0]?.id ?? null;
      d.paints.defaults = d.paints.defaults.map((x) => (x === id ? first : x)) as typeof d.paints.defaults;
      for (const c of d.configs) c.paints = c.paints.map((x) => (x === id ? null : x)) as typeof c.paints;
    },
  });
}

export function setDefaultPaint(slot: Slot, id: string | null): void {
  projectStore.getState().execute({ label: `Default paint ${slot + 1}`, apply: (d) => void (d.paints.defaults[slot] = id) });
}

/** A three-paint scheme: its paints added where missing, and made the default slots. */
export function applyScheme(name: string): void {
  const scheme = PAINT_SCHEMES.find((s) => s.name === name);
  if (!scheme) return;
  // Adding the scheme's paints and setting them is one undo step.
  void projectStore.getState().group(`Paint scheme ${scheme.name}`, () => {
    const ids = scheme.slots.map((n) => {
    const have = projectStore.getState().doc?.paints.list.find((p) => p.name.toLowerCase() === n.toLowerCase());
    return have?.id ?? addPaint(presetByName(n)!);
  }) as [string, string, string];
    projectStore.getState().execute({ label: `Paint scheme ${scheme.name}`, apply: (d) => void (d.paints.defaults = ids) });
  });
}

/** A canvas as PNG bytes. */
export async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the image');
  return new Uint8Array(await blob.arrayBuffer());
}

export const MASK_COLORS = ['#ff0000', '#00ff00', '#0000ff'] as const; // token-lint-ignore: paint mask data (the game's red/green/blue slot channels), not UI colour

/** A small all-one-slot mask (red, green or blue), saved once and shared. */
async function solidMask(slot: Slot): Promise<string> {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('2d')!;
  g.fillStyle = MASK_COLORS[slot];
  g.fillRect(0, 0, 4, 4);
  return call('materials:saveTexture', { name: `paint_slot_${slot + 1}_mask.png`, bytes: await canvasPng(c) });
}

/**
 * Put a whole paint material on one paint slot. Slot 1 needs no file: the
 * game's own mask (everything slot 1) is used when there's none.
 */
export async function setMaterialSlot(materialId: string, slot: Slot): Promise<void> {
  setTexture(materialId, 0, 'colorPaletteMap', slot === 0 ? null : await solidMask(slot));
}
