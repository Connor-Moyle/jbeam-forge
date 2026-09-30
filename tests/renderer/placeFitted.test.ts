import { beforeEach, describe, expect, it } from 'vitest';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { createEmptyProject } from '../../src/shared/project/io';
import { projectStore } from '../../src/renderer/app/stores/project';
import { useSceneStore } from '../../src/renderer/app/stores/scene';
import { useMeshMove } from '../../src/renderer/scene/meshMove';
import { transformMeshes } from '../../src/renderer/scene/meshCommands';
import { fittedSourceIds, startPlacing } from '../../src/renderer/scene/placeFitted';
import type { ImportedMesh } from '../../src/renderer/import/normalize';

const mesh = (key: string, sourceId: string): ImportedMesh => ({ key, sourceId, name: key, geometry: new BoxGeometry(1, 1, 1), material: new MeshBasicMaterial(), triangles: 12 });
const source = (id: string) => ({ id, path: `${id}.dae`, absolutePath: `C:/${id}.dae`, format: 'dae' as const, import: { scale: 1, upAxis: 'z' as const, forwardAxis: '-y' as const }, textureDirs: [], placement: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1 }, addedAt: '2026-01-01T00:00:00.000Z' });

beforeEach(() => {
  const doc = createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  doc.sources.push(source('eng'), source('obj'));
  doc.powertrain.engine = { setId: 'set', name: 'I6', vehicle: 'ETK', type: 'Inline-6', sourceId: 'eng', tuning: {}, edits: { fields: {}, torque: null, gearRatios: null } };
  projectStore.getState().load(doc, 'C:/test.jbforge');
  useSceneStore.getState().clear();
  for (const id of ['eng', 'obj']) {
    const meshes = [mesh(`${id}:a`, id), mesh(`${id}:b`, id)];
    useSceneStore.getState().setSource({ sourceId: id, status: 'ready', fingerprint: 'x', fileName: `${id}.dae`, raw: meshes, meshes, splitsKey: '[]', textures: null, error: null, stats: null });
  }
  useMeshMove.setState({ on: false, mode: 'rotate' });
});

const turnAndMove = { pivot: [0, 0, 0] as [number, number, number], translate: [0.1, 0.2, 0.3] as [number, number, number], rotate: [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)] as [number, number, number, number], scale: [2, 2, 2] as [number, number, number] };

describe('placing parts from the game', () => {
  it('knows which models are fitted sets', () => {
    expect([...fittedSourceIds(projectStore.getState().doc)]).toEqual(['eng']);
  });

  it('picks the whole set up with the move arrows', () => {
    startPlacing('eng', 'engine');
    expect(useSceneStore.getState().selection).toEqual(['eng:a', 'eng:b']);
    expect(useMeshMove.getState()).toMatchObject({ on: true, mode: 'translate' });
  });

  it('only moves a fitted set (its physics follows the position, not a turn or resize), while other models turn', () => {
    transformMeshes(['eng:a', 'eng:b', 'obj:a', 'obj:b'], turnAndMove);
    const doc = projectStore.getState().doc!;
    const eng = doc.sources.find((s) => s.id === 'eng')!.placement;
    const obj = doc.sources.find((s) => s.id === 'obj')!.placement;
    expect(eng).toEqual({ position: [0.1, 0.2, 0.3], rotation: [0, 0, 0], scale: 1 });
    expect(obj.scale).toBe(2);
    expect(obj.rotation.some((r) => Math.abs(r) > 1)).toBe(true);
  });
});
