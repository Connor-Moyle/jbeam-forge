import { Box3 } from 'three';
import { create } from 'zustand';
import type { ObjectItem } from '@shared/ipc-contract';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { copyKey } from '@renderer/import/meshEdits';
import { setPlacement } from '@renderer/import/PlacementDialog';
import { assignToNewPart } from '@renderer/parts/commands';
import { useMeshMove } from '@renderer/scene/meshMove';
import { IDENTITY_EDIT } from '@shared/mesh/meshEdit';

/**
 * Objects that belong at a wheel (calipers, discs, drums, hubs) ask which
 * corner and land there: at the car's own hub/disc/wheel part for that
 * corner when it has one, else where the corner usually is for a body of
 * that size. "All four" adds mirrored and duplicated copies for the rest.
 */

export const CORNERS = ['FL', 'FR', 'RL', 'RR'] as const;
export type Corner = (typeof CORNERS)[number];
export type CornerChoice = Corner | 'all' | 'unsure';
type V3 = [number, number, number];

/** The part kind a corner object becomes (brake_caliper, brake_disc…). */
export function cornerKind(item: Pick<ObjectItem, 'category' | 'name'>): string {
  const t = `${item.category} ${item.name}`;
  return /caliper/i.test(t) ? 'brake_caliper' : /drum/i.test(t) ? 'brake_drum' : /disc|rotor/i.test(t) ? 'brake_disc' : 'hub';
}

export function isCornerObject(item: Pick<ObjectItem, 'category' | 'name'>): boolean {
  return /caliper|disc|drum|rotor|hub/i.test(`${item.category} ${item.name}`);
}

/** The object waiting for its corner (the prompt is open while this is set). */
export const usePlaceUi = create<{ item: ObjectItem | null; ask: (item: ObjectItem | null) => void }>()((set) => ({ item: null, ask: (item) => set({ item }) }));

const WHEEL_KINDS = ['hub', 'brake_disc', 'brake_drum', 'wheel', 'tire'];

function boxOf(keys: ReadonlySet<string>, exclude?: string): Box3 {
  const box = new Box3();
  for (const src of Object.values(useSceneStore.getState().sources)) {
    if (src.sourceId === exclude) continue;
    for (const m of src.meshes) {
      if (!keys.has(m.key) && keys.size) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
    }
  }
  return box;
}

/**
 * Where each wheel centre is (BeamNG space: +X left, −Y front, +Z up), and
 * how sure we are: from the car's wheel-area parts, or estimated from the
 * body's size.
 */
export function cornerTargets(excludeSource: string): { at: Record<Corner, V3>; from: 'parts' | 'estimate' } | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const found: Partial<Record<Corner, V3>> = {};
  for (const kind of WHEEL_KINDS) {
    for (const part of doc.parts.filter((p) => p.taxonomyId === kind && p.position && CORNERS.includes(p.position as Corner))) {
      const corner = part.position as Corner;
      if (found[corner]) continue;
      const keys = new Set(Object.entries(doc.assignments).filter(([, pid]) => pid === part.id).map(([k]) => k));
      if (!keys.size) continue;
      const box = boxOf(keys, excludeSource);
      if (!box.isEmpty()) {
        const c = box.getCenter(box.min.clone());
        found[corner] = [c.x, c.y, c.z];
      }
    }
  }
  if (CORNERS.every((c) => found[c])) return { at: found as Record<Corner, V3>, from: 'parts' };
  // Estimate from the body: axles at ~18% / ~80% of the length, wheels just inside the sides.
  const body = boxOf(new Set(), excludeSource);
  if (body.isEmpty()) return null;
  const len = body.max.y - body.min.y;
  const half = (body.max.x - body.min.x) / 2;
  const cx = (body.max.x + body.min.x) / 2;
  const z = body.min.z + Math.min(0.33, (body.max.z - body.min.z) * 0.22);
  const front = body.min.y + len * 0.18;
  const rear = body.min.y + len * 0.8;
  const x = Math.max(0.3, half - 0.12);
  const guess: Record<Corner, V3> = { FL: [cx + x, front, z], FR: [cx - x, front, z], RL: [cx + x, rear, z], RR: [cx - x, rear, z] };
  // Keep any corner the parts did give.
  return { at: { ...guess, ...found }, from: 'estimate' };
}

/** Put a freshly added object (its own source) at a corner, or at all four. */
export function placeAtCorner(sourceId: string, choice: CornerChoice, kind?: string): void {
  const src = useSceneStore.getState().sources[sourceId];
  const doc = projectStore.getState().doc;
  if (!src || !doc) return;
  const keys = src.meshes.map((m) => m.key);
  const select = (k: readonly string[]) => useSceneStore.getState().select(k);
  if (choice === 'unsure') {
    select(keys);
    useMeshMove.getState().set(true);
    useUiStore.getState().pushStatus('Drag the arrows to put it in place, or set its position in the Inspector.', 'info', 8000);
    return;
  }
  const targets = cornerTargets(sourceId);
  if (!targets) {
    select(keys);
    useMeshMove.getState().set(true);
    useUiStore.getState().pushStatus('There’s no car in the scene to place it against yet: drag the arrows to put it in place.', 'warning', 8000);
    return;
  }
  const box = boxOf(new Set(keys));
  const centre = box.getCenter(box.min.clone());
  const first: Corner = choice === 'all' ? 'FL' : choice;
  const to = targets.at[first];
  const source = doc.sources.find((s) => s.id === sourceId);
  if (!source) return;
  const p = source.placement;
  setPlacement(sourceId, { ...p, position: [p.position[0] + to[0] - centre.x, p.position[1] + to[1] - centre.y, p.position[2] + to[2] - centre.z] });

  if (choice === 'all') {
    // FR mirrors FL; RL is FL moved back; RR mirrors RL.
    const d: V3 = [targets.at.RL[0] - to[0], targets.at.RL[1] - to[1], targets.at.RL[2] - to[2]];
    const id = () => crypto.randomUUID().slice(0, 8);
    const made = keys.map((from) => ({ fr: { id: id(), from, mirror: true }, rl: { id: id(), from, mirror: false } }));
    const rr = made.map((m) => ({ id: id(), from: copyKey(m.rl.id), mirror: true }));
    projectStore.getState().execute({
      label: 'Copy to all four corners',
      apply: (doc2) => {
        doc2.meshCopies.push(...made.map((m) => m.fr), ...made.map((m) => m.rl), ...rr);
        for (const m of made) doc2.meshEdits[copyKey(m.rl.id)] = { ...IDENTITY_EDIT, position: d };
      },
    });
    select([...keys, ...made.flatMap((m) => [copyKey(m.fr.id), copyKey(m.rl.id)]), ...rr.map((c) => copyKey(c.id))]);
    // Each corner becomes its own part (Brake caliper FL, FR, RL, RR).
    if (kind) {
      assignToNewPart(keys, { taxonomyId: kind, position: 'FL' });
      assignToNewPart(made.map((m) => copyKey(m.fr.id)), { taxonomyId: kind, position: 'FR' });
      assignToNewPart(made.map((m) => copyKey(m.rl.id)), { taxonomyId: kind, position: 'RL' });
      assignToNewPart(rr.map((c) => copyKey(c.id)), { taxonomyId: kind, position: 'RR' });
    }
  } else {
    select(keys);
    if (kind) assignToNewPart(keys, { taxonomyId: kind, position: first });
  }
  useUiStore
    .getState()
    .pushStatus(
      targets.from === 'parts' ? `Placed at the ${choice === 'all' ? 'four corners' : first} from your car’s wheel parts. Fine-tune with the arrows (M).` : `Placed where ${choice === 'all' ? 'the corners' : `the ${first} corner`} usually is for a car this size. Check it, and fine-tune with the arrows (M).`,
      'success',
      9000,
    );
}
