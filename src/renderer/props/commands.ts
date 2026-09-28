import { type Box3, Vector3 } from 'three';
import { create } from 'zustand';
import { PROP_KINDS, type Prop } from '@shared/props/props';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';

/**
 * Animated parts (props) as undoable commands, and the Inspector's preview:
 * the prop's mesh shown turned to a test value in the viewport.
 */

export const usePropUi = create<{ propId: string | null; value: number; show: (propId: string | null) => void; setValue: (value: number) => void }>()((set) => ({
  propId: null,
  value: 0,
  show: (propId) => set((s) => (s.propId === propId ? s : { propId, value: 0 })),
  setValue: (value) => set({ value }),
}));

function meshBox(key: string): Box3 | null {
  for (const src of Object.values(useSceneStore.getState().sources)) {
    const m = src.meshes.find((x) => x.key === key);
    if (!m) continue;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    return m.geometry.boundingBox?.clone() ?? null;
  }
  return null;
}

/**
 * First guesses from the mesh's shape: a flat round thing (wheel, dial
 * needle) turns about its thinnest direction through its centre; pedals and
 * levers pivot sideways (X) at their top or bottom end.
 */
export function guessPivot(key: string, kind: string): { pivot: [number, number, number]; axis: [number, number, number] } {
  const box = meshBox(key);
  if (!box || box.isEmpty()) return { pivot: [0, 0, 0], axis: [0, 0, 1] };
  const c = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  if (kind === 'throttle' || kind === 'brake' || kind === 'clutch') return { pivot: [c.x, c.y, box.max.z], axis: [1, 0, 0] };
  if (kind === 'handbrake') return { pivot: [c.x, box.max.y, box.min.z], axis: [1, 0, 0] };
  const dims = [size.x, size.y, size.z];
  const thin = dims.indexOf(Math.min(...dims));
  const axis: [number, number, number] = [0, 0, 0];
  // Towards the driver (rearwards, +Y) for a wheel or dial facing them; flip it if it turns the wrong way.
  axis[thin] = 1;
  return { pivot: [c.x, c.y, c.z], axis };
}

export function addProp(meshKey: string, kindId: string): void {
  const kind = PROP_KINDS.find((k) => k.id === kindId) ?? PROP_KINDS[0]!;
  const { pivot, axis } = guessPivot(meshKey, kind.id);
  const prop: Prop = { id: `prop_${crypto.randomUUID().slice(0, 8)}`, meshKey, func: kind.func, pivot, axis, slide: [0, 0, 0], min: kind.min, max: kind.max, offset: kind.offset, multiplier: kind.multiplier };
  projectStore.getState().execute({
    label: `Animate as ${kind.label.toLowerCase()}`,
    apply: (d) => {
      d.props = [...(d.props ?? []).filter((p) => p.meshKey !== meshKey), prop];
    },
  });
  usePropUi.getState().show(prop.id);
}

export function updateProp(id: string, patch: Partial<Omit<Prop, 'id' | 'meshKey'>>, label = 'Change animation'): void {
  projectStore.getState().execute({
    label,
    coalesce: `prop:${id}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      const p = d.props?.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    },
  });
}

export function removeProp(id: string): void {
  projectStore.getState().execute({
    label: 'Stop animating',
    apply: (d) => {
      d.props = (d.props ?? []).filter((p) => p.id !== id);
    },
  });
  if (usePropUi.getState().propId === id) usePropUi.getState().show(null);
}
