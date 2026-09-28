import { Box3 } from 'three';
import { create } from 'zustand';
import { guessDriverEye, type InternalCamera } from '@shared/cameras/cameras';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';

/** Interior cameras as undoable commands, and "look through it" in the viewport. */

/** The camera the viewport is looking through (null = the usual orbit view). */
export const useCameraUi = create<{ look: { pos: [number, number, number]; fov: number } | null; setLook: (look: { pos: [number, number, number]; fov: number } | null) => void }>()((set) => ({
  look: null,
  setLook: (look) => set({ look }),
}));

function bodyBounds(): { min: number[]; max: number[] } {
  const doc = projectStore.getState().doc;
  const nodes = doc?.nodes ?? [];
  if (nodes.length) {
    const min = [0, 1, 2].map((i) => Math.min(...nodes.map((n) => n.pos[i]!)));
    const max = [0, 1, 2].map((i) => Math.max(...nodes.map((n) => n.pos[i]!)));
    return { min, max };
  }
  const box = new Box3();
  for (const src of Object.values(useSceneStore.getState().sources))
    for (const m of src.meshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
    }
  return box.isEmpty() ? { min: [-0.9, -2.2, 0], max: [0.9, 2.2, 1.4] } : { min: box.min.toArray(), max: box.max.toArray() };
}

export function addCamera(type: string, rightHandDrive = false): void {
  const cams = projectStore.getState().doc?.cameras ?? [];
  const eye = guessDriverEye(bodyBounds(), rightHandDrive);
  const pos: [number, number, number] = type === 'passenger' ? [-eye[0], eye[1], eye[2]] : type === 'hood' ? [0, eye[1] - (bodyBounds().max[1]! - bodyBounds().min[1]!) * 0.2, eye[2] - 0.15] : eye;
  const cam: InternalCamera = { id: `cam_${crypto.randomUUID().slice(0, 8)}`, type: cams.some((c) => c.type === type) ? `${type}${cams.length + 1}` : type, pos, fov: type === 'hood' ? 70 : 65 };
  projectStore.getState().execute({
    label: `Add ${type} camera`,
    apply: (d) => {
      d.cameras = [...(d.cameras ?? []), cam];
    },
  });
}

export function updateCamera(id: string, patch: Partial<Omit<InternalCamera, 'id'>>, label = 'Move camera'): void {
  projectStore.getState().execute({
    label,
    coalesce: `camera:${id}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      const c = d.cameras?.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
  });
  const c = projectStore.getState().doc?.cameras?.find((x) => x.id === id);
  if (c && useCameraUi.getState().look) useCameraUi.getState().setLook({ pos: c.pos, fov: c.fov });
}

export function removeCamera(id: string): void {
  projectStore.getState().execute({
    label: 'Remove camera',
    apply: (d) => {
      d.cameras = (d.cameras ?? []).filter((c) => c.id !== id);
    },
  });
  useCameraUi.getState().setLook(null);
}
