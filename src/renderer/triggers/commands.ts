import { create } from 'zustand';
import { projectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { mirrorTrigger, TRIGGER_ID, TRIGGER_PRESETS, uniqueTriggerId, type Trigger } from '@shared/triggers/schema';
import type { Project } from '@shared/project/schema';
import { EMPTY_ARR } from '@shared/empty';

/**
 * Triggers workspace (fork): add, place and wire clickable boxes. Every
 * change is one undo step.
 */

type Vec3 = [number, number, number];

interface TriggerUi {
  selected: string | null;
  /** Click on the car to put the selected trigger there. */
  placing: boolean;
  select: (id: string | null) => void;
  setPlacing: (on: boolean) => void;
}

export const useTriggerUi = create<TriggerUi>()((set) => ({
  selected: null,
  placing: false,
  select: (selected) => set({ selected, placing: false }),
  setPlacing: (placing) => set({ placing }),
}));

const status = (text: string, tone: 'info' | 'success' | 'warning' = 'info') => useUiStore.getState().pushStatus(text, tone);

export function triggersOf(doc: Pick<Project, 'triggers'> | null): readonly Trigger[] {
  return doc?.triggers ?? EMPTY_ARR;
}

/** The part a point belongs to: the part with a node nearest to it. */
function nearestPart(doc: Project, at: Vec3): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of doc.nodes) {
    const d = Math.hypot(n.pos[0] - at[0], n.pos[1] - at[1], n.pos[2] - at[2]);
    if (d < bestD) {
      bestD = d;
      best = n.partId;
    }
  }
  return best;
}

/** A new trigger of a kind (handle, button…), at `at` or on the body's side, selected and ready to place. */
export function addTrigger(kind: string, at?: Vec3, action = 'horn'): string | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  if (!doc.nodes.length) {
    status('Generate the structure first: triggers sit on a part’s nodes so they move with it.', 'warning');
    return null;
  }
  const preset = TRIGGER_PRESETS.find((p) => p.id === kind) ?? TRIGGER_PRESETS[0]!;
  const pos: Vec3 = at ?? [0, 0, 1];
  const partId = nearestPart(doc, pos)!;
  const id = uniqueTriggerId(triggersOf(doc), preset.id);
  const t: Trigger = { id, partId, pos, size: [...preset.size], rotation: [0, 0, 0], action };
  projectStore.getState().execute({ label: `Add trigger ${id}`, apply: (d) => void (d.triggers = [...(d.triggers ?? []), t]) });
  useTriggerUi.getState().select(id);
  if (!at) useTriggerUi.getState().setPlacing(true);
  return id;
}

export function updateTrigger(id: string, patch: Partial<Trigger>, label = 'Change trigger'): string | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  if (patch.id !== undefined && patch.id !== id) {
    if (!TRIGGER_ID.test(patch.id)) return 'Trigger names start with a letter and use letters, digits and _.';
    if (triggersOf(doc).some((t) => t.id === patch.id)) return `There’s already a trigger called ${patch.id}.`;
  }
  projectStore.getState().execute({
    label,
    coalesce: `trigger:${id}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      d.triggers = (d.triggers ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t));
    },
  });
  if (patch.id && patch.id !== id) useTriggerUi.getState().select(patch.id);
  return null;
}

/** Put the trigger where the car was clicked, just proud of the surface, on the part it was placed on. */
export function placeTrigger(id: string, point: Vec3, normal: Vec3 | null): void {
  const doc = projectStore.getState().doc;
  const t = triggersOf(doc).find((x) => x.id === id);
  if (!doc || !t) return;
  const lift = normal ? Math.min(...t.size) / 2 : 0;
  const pos: Vec3 = normal ? [point[0] + normal[0] * lift, point[1] + normal[1] * lift, point[2] + normal[2] * lift] : point;
  const partId = nearestPart(doc, pos) ?? t.partId;
  updateTrigger(id, { pos: pos.map((v) => Math.round(v * 1e4) / 1e4) as Vec3, partId }, `Place trigger ${id}`);
  useTriggerUi.getState().setPlacing(false);
  status(`Placed ${id}`, 'success');
}

export function removeTrigger(id: string): void {
  projectStore.getState().execute({ label: `Delete trigger ${id}`, apply: (d) => void (d.triggers = (d.triggers ?? []).filter((t) => t.id !== id)) });
  if (useTriggerUi.getState().selected === id) useTriggerUi.getState().select(null);
}

export function duplicateTrigger(id: string, mirrored: boolean): void {
  const doc = projectStore.getState().doc;
  const t = triggersOf(doc).find((x) => x.id === id);
  if (!doc || !t) return;
  const copy = mirrored ? mirrorTrigger(t, triggersOf(doc)) : { ...t, id: uniqueTriggerId(triggersOf(doc), t.id), pos: [t.pos[0], t.pos[1] + 0.05, t.pos[2]] as Vec3 };
  if (mirrored) copy.partId = nearestPart(doc, copy.pos) ?? t.partId;
  projectStore.getState().execute({ label: mirrored ? `Mirror trigger ${id}` : `Duplicate trigger ${id}`, apply: (d) => void (d.triggers = [...(d.triggers ?? []), copy]) });
  useTriggerUi.getState().select(copy.id);
}

/** Door and hood handles from the car's hinges, as triggers (for hinges without handles). */
export function handlesFromHinges(): number {
  const doc = projectStore.getState().doc;
  if (!doc) return 0;
  const add: Trigger[] = [];
  const all = [...triggersOf(doc)];
  for (const h of doc.hinges) {
    if (h.handles.length || all.some((t) => t.action === h.action)) continue;
    // Halfway along the latch edge if there is one, else the hinge line's far side.
    const at: Vec3 = h.latch ?? [(h.axis[0][0] + h.axis[1][0]) / 2, (h.axis[0][1] + h.axis[1][1]) / 2, (h.axis[0][2] + h.axis[1][2]) / 2];
    const t: Trigger = { id: uniqueTriggerId(all, `${h.action}_handle`), partId: h.partId, pos: at, size: [...TRIGGER_PRESETS[0]!.size], rotation: [0, 0, 0], action: h.action };
    all.push(t);
    add.push(t);
  }
  if (add.length) projectStore.getState().execute({ label: `Add ${add.length} handle${add.length === 1 ? '' : 's'}`, apply: (d) => void (d.triggers = [...(d.triggers ?? []), ...add]) });
  status(add.length ? `Added ${add.length} handle${add.length === 1 ? '' : 's'}: move each onto its handle` : 'Every opening part already has a handle', add.length ? 'success' : 'info');
  return add.length;
}
