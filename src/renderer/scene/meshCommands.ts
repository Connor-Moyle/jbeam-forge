import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { projectStore } from '@renderer/app/stores/project';
import type { MeshGizmoTransform } from '@renderer/panels/viewport/viewportRuntime';
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

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const deg = (r: number) => round((r * 180) / Math.PI);

/** Where a mesh's edit turns about: its centre before the edit. */
function editPivot(key: string): Vector3 {
  for (const src of Object.values(useSceneStore.getState().sources)) {
    const m = src.meshes.find((x) => x.key === key);
    if (!m) continue;
    const saved = m.geometry.userData.editPivot as [number, number, number] | undefined;
    if (saved) return new Vector3(...saved);
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    return m.geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
  }
  return new Vector3();
}

/**
 * Apply a viewport gizmo drag (move, turn, resize about a shared pivot). A
 * model whose meshes are all selected moves as a whole (its placement), so a
 * fitted suspension or an object stays in one piece; other meshes get their
 * own edits. One undo step.
 */
export function transformMeshes(keys: readonly string[], t: MeshGizmoTransform): void {
  const doc = projectStore.getState().doc;
  if (!doc || !keys.length) return;
  const selected = new Set(keys);
  const sources = useSceneStore.getState().sources;
  const whole = doc.sources.filter((s) => {
    const meshes = sources[s.id]?.meshes ?? [];
    return meshes.length > 0 && meshes.every((m) => selected.has(m.key));
  });
  const wholeIds = new Set(whole.map((s) => s.id));
  const loose = keys.filter((k) => k.startsWith('copy:') || !wholeIds.has(k.slice(0, k.indexOf(':'))));
  const p = new Vector3(...t.pivot);
  const d = new Vector3(...t.translate);
  const q = new Quaternion(...t.rotate);
  const s = new Vector3(...t.scale);
  const uniform = (s.x + s.y + s.z) / 3;
  const pivots = new Map(loose.map((k) => [k, editPivot(k)]));
  const turned = (euler: readonly number[]) => {
    const r = new Matrix4().makeRotationFromEuler(new Euler((euler[0]! * Math.PI) / 180, (euler[1]! * Math.PI) / 180, (euler[2]! * Math.PI) / 180, 'ZYX'));
    const e = new Euler().setFromRotationMatrix(new Matrix4().makeRotationFromQuaternion(q).multiply(r), 'ZYX');
    return [deg(e.x), deg(e.y), deg(e.z)] as [number, number, number];
  };
  const kind = Math.abs(q.w) < 0.999999 ? 'Turn' : Math.abs(uniform - 1) > 1e-6 || Math.abs(s.x - s.y) > 1e-6 ? 'Resize' : 'Move';
  projectStore.getState().execute({
    label: `${kind} ${keys.length === 1 ? 'mesh' : `${keys.length} meshes`}`,
    apply: (dd) => {
      for (const src of whole) {
        const cur = dd.sources.find((x) => x.id === src.id);
        if (!cur) continue;
        const at = new Vector3(...cur.placement.position).sub(p).multiplyScalar(uniform).applyQuaternion(q).add(p).add(d);
        cur.placement = { position: [round(at.x), round(at.y), round(at.z)], rotation: turned(cur.placement.rotation), scale: round(cur.placement.scale * uniform) };
      }
      for (const k of loose) {
        const c = pivots.get(k)!;
        const cur = dd.meshEdits[k] ?? structuredClone(IDENTITY_EDIT);
        const at = new Vector3(...cur.position).add(c).sub(p).multiply(s).applyQuaternion(q).add(p).add(d).sub(c);
        dd.meshEdits[k] = { ...cur, position: [round(at.x), round(at.y), round(at.z)], rotation: turned(cur.rotation), scale: [round(cur.scale[0] * s.x), round(cur.scale[1] * s.y), round(cur.scale[2] * s.z)] };
      }
    },
  });
}
