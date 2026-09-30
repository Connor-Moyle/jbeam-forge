import type { Project } from '@shared/project/schema';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { useMeshMove } from './meshMove';

/**
 * Parts brought over from the game (fork): engines, gearboxes, suspensions,
 * a body panel's guide. Their jbeam is moved with the model's placement on
 * export, so they move as a whole and only move (turning or resizing isn't
 * carried over to the game's nodes).
 */
export function fittedSourceIds(doc: Pick<Project, 'powertrain' | 'axles'> | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!doc) return ids;
  const pt = doc.powertrain;
  for (const s of [pt?.engine, pt?.gearbox, ...(pt?.alternates ?? [])]) if (s?.sourceId) ids.add(s.sourceId);
  for (const a of doc.axles ?? []) if (a.fitted?.sourceId) ids.add(a.fitted.sourceId);
  return ids;
}

/**
 * Pick up a fitted part to place it: all its meshes selected and the move
 * arrows on, in whatever workspace is open.
 */
export function startPlacing(sourceId: string, what: string): void {
  const keys = (useSceneStore.getState().sources[sourceId]?.meshes ?? []).map((m) => m.key);
  if (!keys.length) return;
  useSceneStore.getState().select(keys);
  useMeshMove.setState({ on: true, mode: 'translate' });
  useUiStore.getState().pushStatus(`Drag the arrows to put the ${what} where it belongs: its physics moves with it. Press G to put the arrows away when it's in place.`, 'info', 12000);
}
