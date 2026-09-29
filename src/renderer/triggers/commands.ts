import { create } from 'zustand';
import { projectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { GAME_ACTIONS, mirrorTrigger, TRIGGER_ID, TRIGGER_PRESETS, uniqueTriggerId, type Trigger } from '@shared/triggers/schema';
import type { Project } from '@shared/project/schema';
import { EMPTY_ARR } from '@shared/empty';
import { scriptActions } from '@shared/lua/templates';
import { templateById } from '@renderer/scripts/registry';

/**
 * Triggers workspace (fork): add, place and wire clickable boxes. Every
 * change is one undo step.
 */

type Vec3 = [number, number, number];

interface TriggerUi {
  /** The triggers workspace is showing: the 3D view draws the boxes. */
  visible: number;
  selected: string | null;
  /** Click on the car to put the selected trigger there. */
  placing: boolean;
  select: (id: string | null) => void;
  setPlacing: (on: boolean) => void;
  show: (on: boolean) => void;
}

export const useTriggerUi = create<TriggerUi>()((set) => ({
  visible: 0,
  show: (on) => set((s) => ({ visible: Math.max(0, s.visible + (on ? 1 : -1)), ...(on ? {} : { placing: false }) })),
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
/** What a new trigger does until it's changed (or dropped on something that opens). */
export const DEFAULT_ACTION = 'horn';

export function addTrigger(kind: string, at?: Vec3, action = DEFAULT_ACTION): string | null {
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
  // A trigger still on its first action, dropped on a door, hood or trunk, opens it.
  const hinge = doc.hinges.find((h) => h.partId === partId);
  const opens = hinge && t.action === DEFAULT_ACTION ? hinge.action : null;
  updateTrigger(id, { pos: pos.map((v) => Math.round(v * 1e4) / 1e4) as Vec3, partId, ...(opens ? { action: opens } : {}) }, `Place trigger ${id}`);
  useTriggerUi.getState().setPlacing(false);
  const part = doc.parts.find((p) => p.id === partId)?.displayName ?? '';
  status(opens ? `Placed ${id} on ${part}: it opens it (${opens})` : `Placed ${id} on ${part}`, 'success');
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

/** Everything a trigger can run: the game's own actions, the car's doors and hood, and its scripts' keys. */
export function triggerActions(doc: Project | null): { value: string; label: string; group: string }[] {
  const out = GAME_ACTIONS.map((a) => ({ ...a }));
  for (const h of doc?.hinges ?? []) {
    if (out.some((a) => a.value === h.action)) continue;
    const part = doc?.parts.find((p) => p.id === h.partId);
    out.push({ value: h.action, label: part?.displayName ?? h.action, group: 'Opening' });
  }
  for (const script of doc?.scripts ?? []) {
    for (const a of scriptActions(templateById(script.templateId ?? '') ?? null, script)) out.push({ value: `jbf_${doc!.meta.slug}_${script.name}_${a.id}`, label: `${script.label}: ${a.label}`, group: 'Scripts' });
  }
  return out;
}
