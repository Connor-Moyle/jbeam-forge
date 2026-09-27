import type { Project } from '@shared/project/schema';
import { subtreeIds } from '@shared/parts/tree';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';

/**
 * Part Focus Mode: one part (and everything attached to it) stays solid, the
 * rest of the car fades to a ghost, and the camera glides to it. The ghost
 * opacity is a user setting.
 */

/**
 * What a focused part brings along: everything attached to it (a door keeps its glass, card and
 * handle). A root part like the body shell has the whole car under it, so it stands alone.
 */
export function focusScope(doc: Pick<Project, 'parts' | 'assignments'>, partId: string): { parts: string[]; meshKeys: string[] } {
  const part = doc.parts.find((p) => p.id === partId);
  const parts = part && part.parentPartId === null ? [partId] : subtreeIds(doc.parts, partId);
  const inFocus = new Set(parts);
  return { parts, meshKeys: Object.keys(doc.assignments).filter((k) => inFocus.has(doc.assignments[k]!)) };
}

/** Focus a part: select it, ghost everything else, glide the camera to it. */
export function focusPart(partId: string): void {
  const doc = projectStore.getState().doc;
  if (!doc || !doc.parts.some((p) => p.id === partId)) return;
  const { parts, meshKeys } = focusScope(doc, partId);
  const own = meshKeys.filter((k) => doc.assignments[k] === partId);
  const scene = useSceneStore.getState();
  scene.selectPart(partId, own);
  scene.setFocus({ partId, parts, meshKeys });
  scene.requestFrame(meshKeys, true);
}

/** Focus what's selected: the active part, the part a selected mesh belongs to, or the loose meshes themselves. */
export function focusSelection(): boolean {
  const scene = useSceneStore.getState();
  if (scene.activePart) {
    focusPart(scene.activePart);
    return true;
  }
  const assignments = projectStore.getState().doc?.assignments ?? {};
  const owner = scene.selection.map((k) => assignments[k]).find((p): p is string => !!p);
  if (owner) {
    focusPart(owner);
    return true;
  }
  if (!scene.selection.length) return false;
  scene.setFocus({ partId: null, parts: [], meshKeys: [...scene.selection] });
  scene.requestFrame(scene.selection, true);
  return true;
}

/** Double-click in the viewport: jump to the clicked mesh's part, or leave focus on empty space. */
export function focusMesh(meshKey: string | null): void {
  if (!meshKey) {
    exitFocus();
    return;
  }
  const partId = projectStore.getState().doc?.assignments[meshKey];
  if (partId) focusPart(partId);
  else {
    const scene = useSceneStore.getState();
    scene.select([meshKey]);
    scene.setFocus({ partId: null, parts: [], meshKeys: [meshKey] });
    scene.requestFrame([meshKey], true);
  }
}

export function exitFocus(): boolean {
  const scene = useSceneStore.getState();
  if (!scene.focus) return false;
  scene.setFocus(null);
  return true;
}

/** Keep focus honest when the document changes under it (part deleted, meshes reassigned). */
export function refreshFocus(): void {
  const focus = useSceneStore.getState().focus;
  if (!focus?.partId) return;
  const doc = projectStore.getState().doc;
  if (!doc || !doc.parts.some((p) => p.id === focus.partId)) {
    useSceneStore.getState().setFocus(null);
    return;
  }
  const { parts, meshKeys } = focusScope(doc, focus.partId);
  if (meshKeys.length === focus.meshKeys.length && meshKeys.every((k, i) => k === focus.meshKeys[i]) && parts.length === focus.parts.length) return;
  useSceneStore.getState().setFocus({ partId: focus.partId, parts, meshKeys });
}
