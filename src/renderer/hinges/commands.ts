import { create } from 'zustand';
import { projectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { clearHinge } from '@shared/hinges/apply';
import { guessHinge } from '@shared/hinges/geometry';
import { defaultOpenAngle, hingeAction, HINGE_DEFAULTS, type Hinge, type Vec3 } from '@shared/hinges/schema';
import type { Project } from '@shared/project/schema';
import { hingeUp, nodePrefix, reattachPart } from '@shared/proxy/generate';

/**
 * Hinge wizard commands. Every change rebuilds the part's hinge structure
 * (hinge nodes, limiter, latch, seals) in the same undo step.
 */

/** Which part's hinge the viewport shows, and the swing preview (0 = shut, 1 = fully open). */
export const useHingeUi = create<{ partId: string | null; swing: number; show: (partId: string | null) => void; setSwing: (swing: number) => void }>()((set) => ({
  partId: null,
  swing: 0,
  show: (partId) => set((s) => (s.partId === partId ? s : { partId, swing: 0 })),
  setSwing: (swing) => set({ swing }),
}));

function context(doc: Project, partId: string) {
  const part = doc.parts.find((p) => p.id === partId);
  const entry = part ? currentTaxonomy().entry(part.taxonomyId) : undefined;
  return part && entry ? { part, entry } : null;
}

/** Why a part can't have a hinge right now, or null. */
export function hingeProblem(doc: Project, partId: string): string | null {
  const c = context(doc, partId);
  if (!c?.entry.openable) return 'This kind of part doesn’t open.';
  if (!c.part.parentPartId) return 'Give it a parent part first: the body it hinges on.';
  if (doc.nodes.filter((n) => n.partId === partId).length < 3) return 'Generate its structure first: the hinge is built on its nodes.';
  if (doc.nodes.filter((n) => n.partId === c.part.parentPartId).length < 3) return 'Generate its parent part’s structure first.';
  return null;
}

function rebuild(d: Project, partId: string): void {
  const c = context(d, partId);
  if (c) hingeUp(d, c.part, c.entry);
}

/** A hinge guessed from the part's shape: axis, swing direction, latch and handles. */
function guessedHinge(doc: Project, partId: string): Hinge | null {
  const c = context(doc, partId);
  if (!c || hingeProblem(doc, partId)) return null;
  const own = doc.nodes.filter((n) => n.partId === partId).map((n) => n.pos);
  const body = doc.nodes.filter((n) => n.partId === c.part.parentPartId).map((n) => n.pos);
  const guess = guessHinge(c.part.taxonomyId, own, body);
  return {
    id: `hinge_${crypto.randomUUID().slice(0, 8)}`,
    partId,
    axis: guess.axis,
    openAngle: defaultOpenAngle(c.part.taxonomyId),
    direction: guess.direction,
    latch: guess.latch,
    handles: guess.handles,
    action: hingeAction(c.part.taxonomyId, c.part.position).action,
    ...HINGE_DEFAULTS,
  };
}

/** Add a hinge, guessed from the part's shape. */
export function addHinge(partId: string): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const problem = hingeProblem(doc, partId);
  const c = context(doc, partId);
  const hinge = guessedHinge(doc, partId);
  if (problem || !c || !hinge) {
    useUiStore.getState().pushStatus(problem ?? 'Part not found', 'warning');
    return;
  }
  projectStore.getState().execute({
    label: `Add hinge to ${c.part.displayName}`,
    apply: (d) => {
      d.hinges = d.hinges.filter((h) => h.partId !== partId);
      d.hinges.push(hinge);
      rebuild(d, partId);
    },
  });
  useHingeUi.getState().show(partId);
  useUiStore.getState().pushStatus(`${c.part.displayName} now hinges. Check the axis and latch in the viewport, and drag the swing preview to see it open.`, 'success', 8000);
}

/** Parts that open and could take a hinge now but have none (the wizard's list), and those that can't yet, with why. */
export function unhingedParts(doc: Project): { ready: string[]; blocked: { partId: string; problem: string }[] } {
  const ready: string[] = [];
  const blocked: { partId: string; problem: string }[] = [];
  for (const p of doc.parts) {
    if (p.variantOf || doc.hinges.some((h) => h.partId === p.id) || !currentTaxonomy().entry(p.taxonomyId)?.openable) continue;
    const problem = hingeProblem(doc, p.id);
    if (problem) blocked.push({ partId: p.id, problem });
    else ready.push(p.id);
  }
  return { ready, blocked };
}

/** The hinge wizard's one click: hinge every door, hood, trunk, tailgate and fuel door that has none, in one undo step. */
export function hingeAll(): number {
  const doc = projectStore.getState().doc;
  if (!doc) return 0;
  const { ready, blocked } = unhingedParts(doc);
  const hinges = ready.map((id) => guessedHinge(doc, id)).filter((h): h is Hinge => !!h);
  if (hinges.length) {
    projectStore.getState().execute({
      label: `Hinge ${hinges.length} part${hinges.length === 1 ? '' : 's'}`,
      apply: (d) => {
        for (const h of hinges) {
          d.hinges = d.hinges.filter((x) => x.partId !== h.partId);
          d.hinges.push(h);
          rebuild(d, h.partId);
        }
      },
    });
  }
  const names = (ids: string[]) => ids.map((id) => doc.parts.find((p) => p.id === id)?.displayName ?? id).join(', ');
  const status = hinges.length ? `Hinged ${names(hinges.map((h) => h.partId))}.` : 'Nothing to hinge.';
  useUiStore.getState().pushStatus(blocked.length ? `${status} Not yet: ${blocked.map((b) => `${names([b.partId])} (${b.problem})`).join('; ')}` : status, hinges.length ? 'success' : 'info', 10000);
  return hinges.length;
}

/** Change hinge settings; slider drags merge into one undo step. */
export function updateHinge(partId: string, patch: Partial<Omit<Hinge, 'id' | 'partId'>>, label = 'Change hinge'): void {
  projectStore.getState().execute({
    label,
    coalesce: `hinge:${partId}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      const h = d.hinges.find((x) => x.partId === partId);
      if (!h) return;
      Object.assign(h, patch);
      rebuild(d, partId);
    },
  });
}

/** Guess the axis, direction, latch and handles again (keeps the tuning values). */
export function reguessHinge(partId: string): void {
  const doc = projectStore.getState().doc;
  const c = doc && context(doc, partId);
  if (!doc || !c || hingeProblem(doc, partId)) return;
  const guess = guessHinge(
    c.part.taxonomyId,
    doc.nodes.filter((n) => n.partId === partId).map((n) => n.pos),
    doc.nodes.filter((n) => n.partId === c.part.parentPartId).map((n) => n.pos),
  );
  updateHinge(partId, { axis: guess.axis, direction: guess.direction, latch: guess.latch, handles: guess.handles }, 'Re-guess hinge');
}

/** Take the hinge off: the part is bolted shut to its parent again. */
export function removeHinge(partId: string): void {
  const doc = projectStore.getState().doc;
  const c = doc && context(doc, partId);
  if (!doc || !c) return;
  projectStore.getState().execute({
    label: `Remove hinge from ${c.part.displayName}`,
    apply: (d) => {
      d.hinges = d.hinges.filter((h) => h.partId !== partId);
      const cc = context(d, partId);
      if (!cc) return;
      clearHinge(d, partId, nodePrefix(cc.part, cc.entry));
      reattachPart(d, cc.part, cc.entry);
    },
  });
  if (useHingeUi.getState().partId === partId) useHingeUi.getState().show(null);
}

/**
 * Use the nodes selected in edit mode: two for the hinge line, one for the
 * latch or a handle. Returns a problem, or null when applied.
 */
export function hingeFromSelection(partId: string, what: 'axis' | 'latch' | 'handle', selected: readonly string[]): string | null {
  const doc = projectStore.getState().doc;
  const h = doc?.hinges.find((x) => x.partId === partId);
  if (!doc || !h) return 'No hinge on this part.';
  const pos = selected.map((id) => doc.nodes.find((n) => n.id === id)?.pos).filter((p): p is Vec3 => !!p);
  if (what === 'axis') {
    if (pos.length !== 2) return 'Select exactly two nodes (Tab for edit mode) on the hinge line.';
    updateHinge(partId, { axis: [pos[0]!, pos[1]!] }, 'Set hinge axis');
  } else if (what === 'latch') {
    if (pos.length !== 1) return 'Select the one node where the latch goes.';
    updateHinge(partId, { latch: pos[0]! }, 'Set latch');
  } else {
    if (pos.length !== 1) return 'Select the one node where the handle goes.';
    updateHinge(partId, { handles: [...h.handles, { pos: pos[0]!, inside: false }] }, 'Add handle');
  }
  return null;
}
