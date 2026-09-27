import { create } from 'zustand';
import type { Features, Skin } from '@shared/project/schema';
import { suggestFeature, type FeatureKind } from '@shared/features/place';
import { bodyPart } from '@shared/export/jbeam';
import { call } from '@renderer/diagnostics/ipc';
import { projectStore } from '@renderer/app/stores/project';
import { currentTaxonomy } from '@renderer/parts/taxonomy';

/**
 * The game's extras (Phase 12d): licence plates, tow hitch, nitrous and
 * paint designs. Each one switched on lands where it usually goes on a car
 * (see suggestFeature) and can be moved from the panel.
 */

type Vec3 = [number, number, number];
type Mounted = FeatureKind;

/** Whether the viewport shows where the extras sit. */
export const useFeatureUi = create<{ preview: boolean; setPreview: (on: boolean) => void }>()((set) => ({
  preview: true,
  setPreview: (preview) => set({ preview }),
}));

function editFeatures(label: string, apply: (f: Features) => void, coalesce?: string): void {
  projectStore.getState().execute({ label, coalesce, apply: (d) => apply(d.features) });
}

/** Switch an extra on (placed where it usually goes) or off. Returns false when there's no structure to put it on. */
export function toggleFeature(kind: Mounted, on: boolean): boolean {
  const doc = projectStore.getState().doc;
  if (!doc) return false;
  if (!on) {
    editFeatures(`Remove ${LABELS[kind].toLowerCase()}`, (f) => {
      if (kind === 'plateFront') f.plates.front = null;
      else if (kind === 'plateRear') f.plates.rear = null;
      else if (kind === 'hitch') f.hitch = null;
      else f.nitrous = null;
    });
    return true;
  }
  const at = suggestFeature(doc, bodyPart(doc, currentTaxonomy())?.id ?? null, kind);
  if (!at) return false;
  editFeatures(`Add ${LABELS[kind].toLowerCase()}`, (f) => {
    if (kind === 'plateFront') f.plates.front = { ...at, tilt: 0 };
    else if (kind === 'plateRear') f.plates.rear = { ...at, tilt: 0 };
    else if (kind === 'hitch') f.hitch = at;
    else f.nitrous = { ...at, bottle: '10lb', shotKw: 50 };
  });
  return true;
}

export const LABELS: Record<Mounted, string> = { plateFront: 'Front plate', plateRear: 'Rear plate', hitch: 'Tow hitch', nitrous: 'Nitrous' };

function mounted(f: Features, kind: Mounted): { partId: string; pos: Vec3 } | null {
  return kind === 'plateFront' ? f.plates.front : kind === 'plateRear' ? f.plates.rear : kind === 'hitch' ? f.hitch : f.nitrous;
}

/** Move an extra, or put it on another part. */
export function updateMount(kind: Mounted, patch: { partId?: string; pos?: Vec3; tilt?: number }): void {
  editFeatures(
    `Move ${LABELS[kind].toLowerCase()}`,
    (f) => {
      const m = mounted(f, kind);
      if (!m) return;
      if (patch.partId) m.partId = patch.partId;
      if (patch.pos) m.pos = patch.pos;
      if (patch.tilt !== undefined && 'tilt' in m) (m as { tilt: number }).tilt = patch.tilt;
    },
    `feature:${kind}:${Object.keys(patch).join(',')}`,
  );
}

export function setNitrous(patch: { bottle?: '10lb' | '20lb'; shotKw?: number }): void {
  editFeatures('Change nitrous', (f) => {
    if (f.nitrous) Object.assign(f.nitrous, patch);
  });
}

export function addSkin(): string {
  const doc = projectStore.getState().doc;
  const taken = new Set((doc?.features.skins ?? []).map((s) => s.name.toLowerCase()));
  let name = 'New design';
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `New design ${i}`;
  const skin: Skin = { id: `skin_${crypto.randomUUID().slice(0, 8)}`, name, overrides: {} };
  editFeatures('Add paint design', (f) => void f.skins.push(skin));
  return skin.id;
}

export function renameSkin(id: string, name: string): void {
  editFeatures(
    'Rename paint design',
    (f) => {
      const s = f.skins.find((x) => x.id === id);
      if (s) s.name = name || 'Design';
    },
    `skin:${id}:name`,
  );
}

export function deleteSkin(id: string): void {
  editFeatures('Delete paint design', (f) => void (f.skins = f.skins.filter((s) => s.id !== id)));
}

/** A material's look in a design; null on both goes back to the material's own. */
export function setSkinOverride(id: string, materialId: string, patch: Partial<Skin['overrides'][string]>): void {
  editFeatures(
    'Change paint design',
    (f) => {
      const s = f.skins.find((x) => x.id === id);
      if (!s) return;
      const o = { ...(s.overrides[materialId] ?? { baseColor: null, baseColorMap: null }), ...patch };
      if (!o.baseColor && !o.baseColorMap) delete s.overrides[materialId];
      else s.overrides[materialId] = o;
    },
    patch.baseColor ? `skin:${id}:${materialId}:color` : undefined,
  );
}

export async function pickSkinTexture(id: string, materialId: string): Promise<void> {
  const path = await call('materials:pickTexture');
  if (path) setSkinOverride(id, materialId, { baseColorMap: path });
}
