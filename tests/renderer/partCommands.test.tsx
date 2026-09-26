import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { createEmptyProject } from '../../src/shared/project/io';
import { projectStore } from '../../src/renderer/app/stores/project';
import { useSceneStore } from '../../src/renderer/app/stores/scene';
import * as cmd from '../../src/renderer/parts/commands';
import { ClassifyDialog } from '../../src/renderer/parts/ClassifyDialog';
import { ScenePanel } from '../../src/renderer/panels/ScenePanel';
import { InspectorPanel } from '../../src/renderer/panels/InspectorPanel';
import { TooltipProvider } from '../../src/renderer/ui/components/Tooltip';
import type { ImportedMesh } from '../../src/renderer/import/normalize';

/** A tiny "car": body + 4 door glasses at the four corners (BeamNG space: +X left, −Y front). */
function mesh(name: string, x: number, y: number): ImportedMesh {
  const geometry = new BoxGeometry(0.2, 0.2, 0.2);
  geometry.translate(x, y, 1);
  return { key: `src:${name}`, sourceId: 'src', name, geometry, material: new MeshBasicMaterial(), triangles: 12 };
}

const MESHES = [mesh('car_body', 0, 0), mesh('car_glass_a', 0.8, -1), mesh('car_glass_b', -0.8, -1), mesh('car_glass_c', 0.8, 1), mesh('car_glass_d', -0.8, 1), mesh('car_door_FL', 0.8, -1), mesh('car_mystery', 0, 0)];

beforeEach(() => {
  const doc = createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  doc.sources.push({ id: 'src', path: 'car.dae', absolutePath: 'C:/car.dae', format: 'dae', import: { scale: 1, upAxis: '+z', forwardAxis: '-y' }, textureDirs: [], addedAt: '2026-01-01T00:00:00.000Z' });
  projectStore.getState().load(doc, 'C:/test.jbforge');
  useSceneStore.getState().clear();
  useSceneStore.getState().setSource({ sourceId: 'src', status: 'ready', fingerprint: 'x', fileName: 'car.dae', meshes: MESHES, textures: null, error: null, stats: null });
  cmd.useClassifyUi.getState().setPending(null);
});

describe('auto-classify flow', () => {
  it('summarises the proposal and applies it as one undoable step', () => {
    cmd.offerAutoClassify('car.dae', MESHES);
    render(
      <TooltipProvider>
        <ClassifyDialog />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('classify-unassigned')).toHaveTextContent('5'); // glass_a..d are not part names, plus mystery
    fireEvent.click(screen.getByTestId('classify-apply'));
    const doc = projectStore.getState().doc!;
    const body = doc.parts.find((p) => p.taxonomyId === 'body')!;
    const door = doc.parts.find((p) => p.taxonomyId === 'door')!;
    expect(door).toMatchObject({ position: 'FL', parentPartId: body.id, name: 'test_door_FL' });
    expect(doc.assignments['src:car_door_FL']).toBe(door.id);
    expect(projectStore.getState().undoStack).toHaveLength(1);
    projectStore.getState().undo();
    expect(projectStore.getState().doc!.parts).toEqual([]);
  });
});

describe('stale auto-classify offers', () => {
  it('are not applied once their source is gone (import undone)', () => {
    cmd.offerAutoClassify('car.dae', MESHES);
    projectStore.getState().execute({ label: 'remove source', apply: (d) => void d.sources.splice(0, 1) });
    cmd.applyPendingClassification();
    expect(projectStore.getState().doc!.parts).toEqual([]);
    expect(cmd.useClassifyUi.getState().pending).toBeNull();
  });
});

describe('assignment commands', () => {
  it('distributes a bulk assign over positions by bounding box', () => {
    const glasses = ['a', 'b', 'c', 'd'].map((x) => `src:car_glass_${x}`);
    const ids = cmd.assignDistributed(glasses, 'door_glass', '');
    expect(ids).toHaveLength(4);
    const doc = projectStore.getState().doc!;
    const posOf = (k: string) => doc.parts.find((p) => p.id === doc.assignments[k])?.position;
    expect(glasses.map(posOf)).toEqual(['FL', 'FR', 'RL', 'RR']);
    expect(projectStore.getState().undoStack).toHaveLength(1);
  });

  it('refuses a reparent that would create a cycle', () => {
    const body = cmd.assignToNewPart(['src:car_body'], { taxonomyId: 'body' })!;
    const door = cmd.assignToNewPart(['src:car_door_FL'], { taxonomyId: 'door', position: 'FL' })!;
    expect(cmd.reparentPart(body, door)).toBe(false);
    expect(cmd.reparentPart(door, null)).toBe(true);
    expect(projectStore.getState().doc!.parts.find((p) => p.id === door)!.parentPartId).toBeNull();
  });
});

describe('scene tree + inspector', () => {
  it('shows the hierarchy, and selecting a part shows its details for editing', () => {
    cmd.assignToNewPart(['src:car_body'], { taxonomyId: 'body' });
    const door = cmd.assignToNewPart(['src:car_door_FL'], { taxonomyId: 'door', position: 'FL' })!;
    cmd.setIgnored(['src:car_mystery'], true);
    render(
      <TooltipProvider>
        <ScenePanel />
        <InspectorPanel />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('scene-group-unassigned')).toHaveTextContent('4');
    expect(screen.getByTestId('scene-group-ignored')).toHaveTextContent('1');
    fireEvent.click(screen.getByText('Body shell'));
    expect(screen.getByTestId('inspector-part')).toHaveTextContent('Body shell');
    act(() => useSceneStore.getState().selectPart(door, ['src:car_door_FL']));
    const name = screen.getByTestId('inspector-display-name');
    fireEvent.change(name, { target: { value: 'Driver door' } });
    fireEvent.blur(name);
    expect(projectStore.getState().doc!.parts.find((p) => p.id === door)!.displayName).toBe('Driver door');
    expect(projectStore.getState().undoStack.at(-1)!.label).toBe('Rename part');
  });
});
