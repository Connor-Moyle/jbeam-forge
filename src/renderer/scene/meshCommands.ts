import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { copyKey } from '@renderer/import/meshEdits';
import { IDENTITY_EDIT } from '@shared/mesh/meshEdit';
import type { MeshEdit } from '@shared/project/schema';
import { removeSourceFromDoc } from '@shared/project/removeSource';

/**
 * Per-mesh edits (move/turn/resize, texture mapping) and copies, as undoable
 * commands. Drags and field changes to the same meshes merge into one step.
 */

export function meshEdit(key: string): MeshEdit {
  return projectStore.getState().doc?.meshEdits[key] ?? IDENTITY_EDIT;
}

type EditPatch = Partial<Omit<MeshEdit, 'uv'>> & { uv?: Partial<MeshEdit['uv']> };

/** Set values on every given mesh (absolute, not relative). */
export function setMeshEdit(keys: readonly string[], patch: EditPatch, label = 'Move mesh'): void {
  if (!keys.length) return;
  projectStore.getState().execute({
    label,
    coalesce: `meshEdit:${keys.join(',')}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      for (const k of keys) {
        const cur = d.meshEdits[k] ?? structuredClone(IDENTITY_EDIT);
        d.meshEdits[k] = { ...cur, ...patch, uv: { ...cur.uv, ...patch.uv } };
      }
    },
  });
}

/** Move every given mesh by the same amount (the viewport gizmo). */
export function nudgeMeshes(keys: readonly string[], delta: [number, number, number]): void {
  if (!keys.length) return;
  projectStore.getState().execute({
    label: 'Move mesh',
    coalesce: `meshNudge:${keys.join(',')}`,
    apply: (d) => {
      for (const k of keys) {
        const cur = d.meshEdits[k] ?? structuredClone(IDENTITY_EDIT);
        d.meshEdits[k] = { ...cur, position: [cur.position[0] + delta[0], cur.position[1] + delta[1], cur.position[2] + delta[2]] };
      }
    },
  });
}

export function resetMeshEdit(keys: readonly string[]): void {
  projectStore.getState().execute({
    label: 'Reset mesh position',
    apply: (d) => {
      for (const k of keys) delete d.meshEdits[k];
    },
  });
}

/**
 * A mirrored copy of each mesh on the other side of the car. The copy
 * follows the original (move the original and the copy mirrors it) plus its
 * own edits. It joins the part on the other side when there is one.
 */
export function mirrorCopy(keys: readonly string[]): string[] {
  const doc = projectStore.getState().doc;
  if (!doc || !keys.length) return [];
  const made = keys.map((from) => ({ id: crypto.randomUUID().slice(0, 8), from, mirror: true }));
  projectStore.getState().execute({
    label: keys.length === 1 ? 'Mirror mesh to the other side' : `Mirror ${keys.length} meshes to the other side`,
    apply: (d) => {
      d.meshCopies.push(...made);
      for (const c of made) {
        // The part on the other side: same kind, mirrored position (FL ↔ FR, L ↔ R).
        const part = d.parts.find((p) => p.id === d.assignments[c.from]);
        if (!part?.position) continue;
        const other = part.position.replace(/L/g, '\0').replace(/R/g, 'L').replace(/\0/g, 'R');
        const twin = d.parts.find((p) => p.taxonomyId === part.taxonomyId && p.position === other);
        if (twin) d.assignments[copyKey(c.id)] = twin.id;
      }
    },
  });
  const copies = made.map((c) => copyKey(c.id));
  useSceneStore.getState().select(copies);
  useUiStore.getState().pushStatus(`Mirrored ${keys.length} mesh${keys.length === 1 ? '' : 'es'} to the other side`, 'success');
  return copies;
}

/** A plain copy of each mesh in the same place (move it afterwards); it joins the same part. */
export function duplicateMeshes(keys: readonly string[]): string[] {
  if (!keys.length) return [];
  const made = keys.map((from) => ({ id: crypto.randomUUID().slice(0, 8), from, mirror: false }));
  projectStore.getState().execute({
    label: keys.length === 1 ? 'Duplicate mesh' : `Duplicate ${keys.length} meshes`,
    apply: (d) => {
      d.meshCopies.push(...made);
      for (const c of made) if (d.assignments[c.from]) d.assignments[copyKey(c.id)] = d.assignments[c.from]!;
    },
  });
  const copies = made.map((c) => copyKey(c.id));
  useSceneStore.getState().select(copies);
  return copies;
}

/** Remove copies (only copies can be deleted; imported meshes can be ignored instead). */
export function deleteCopies(keys: readonly string[]): void {
  const ids = new Set(keys.filter((k) => k.startsWith('copy:')).map((k) => k.slice(5)));
  if (!ids.size) return;
  projectStore.getState().execute({
    label: 'Delete copy',
    apply: (d) => {
      const gone = new Set([...ids].map(copyKey));
      // Copies of these copies go too.
      let grew = true;
      while (grew) {
        grew = false;
        for (const c of d.meshCopies) {
          if (gone.has(c.from) && !gone.has(copyKey(c.id))) {
            gone.add(copyKey(c.id));
            grew = true;
          }
        }
      }
      d.meshCopies = d.meshCopies.filter((c) => !gone.has(copyKey(c.id)));
      for (const k of gone) {
        delete d.meshEdits[k];
        delete d.assignments[k];
        delete d.materialSlots[k];
        delete d.meshNames[k];
      }
      d.ignoredMeshes = d.ignoredMeshes.filter((k) => !gone.has(k));
    },
  });
}

/** Take a model (and everything referring to its meshes) out of the project. */
export function removeModel(sourceId: string): void {
  const doc = projectStore.getState().doc;
  const name = doc?.sources.find((s) => s.id === sourceId)?.path.split(/[\\/]/).pop() ?? 'model';
  projectStore.getState().execute({ label: `Remove ${name}`, apply: (d) => removeSourceFromDoc(d, sourceId) });
}
