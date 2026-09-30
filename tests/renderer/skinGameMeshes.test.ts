import { beforeEach, describe, expect, it } from 'vitest';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { createEmptyProject } from '../../src/shared/project/io';
import { defaultMaterial } from '../../src/shared/materials/schema';
import { projectStore } from '../../src/renderer/app/stores/project';
import { useSceneStore } from '../../src/renderer/app/stores/scene';
import { applySkinLayout, gameMeshKeys, skinMeshes } from '../../src/renderer/skins/commands';
import { DEFAULT_SKIN_OPTIONS } from '../../src/shared/uv/skinUnwrap';
import type { ImportedMesh } from '../../src/renderer/import/normalize';

const mesh = (key: string, sourceId: string, at: number): ImportedMesh => {
  const g = new BoxGeometry(1, 2, 0.8);
  g.translate(at, 0, 0.6);
  return { key, sourceId, name: key.slice(key.indexOf(':') + 1), geometry: g, material: new MeshBasicMaterial(), triangles: 12 };
};

beforeEach(() => {
  const doc = createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  doc.materials.push(defaultMaterial('paint', 'paint'), defaultMaterial('game', 'game', { gameMaterial: 'etk800_body' }));
  doc.materialSlots = { 'car:door': ['paint'], 'car:hood': ['paint'], 'lib:caliper': ['game'], 'eng:block': ['paint'] };
  doc.powertrain.engine = { setId: 'set', name: 'I6', vehicle: 'ETK', type: 'Inline-6', sourceId: 'eng', tuning: {}, edits: { fields: {}, torque: null, gearRatios: null } };
  projectStore.getState().load(doc, 'C:/test.jbforge');
  useSceneStore.getState().clear();
  const add = (sourceId: string, meshes: ImportedMesh[]) => useSceneStore.getState().setSource({ sourceId, status: 'ready', fingerprint: 'x', fileName: `${sourceId}.dae`, raw: meshes, meshes, splitsKey: '[]', textures: null, error: null, stats: null });
  add('car', [mesh('car:door', 'car', 0.9), mesh('car:hood', 'car', 0)]);
  add('lib', [mesh('lib:caliper', 'lib', 0.5)]);
  add('eng', [mesh('eng:block', 'eng', 0)]);
});

describe('Skin studio and meshes from the game', () => {
  it('knows the game’s meshes: a fitted engine and anything wearing only BeamNG materials', () => {
    expect([...gameMeshKeys(projectStore.getState().doc!)].sort()).toEqual(['eng:block', 'lib:caliper']);
    expect(skinMeshes().map((m) => m.key).sort()).toEqual(['car:door', 'car:hood']);
  });

  it('never lays them out, even when asked to', () => {
    const n = applySkinLayout(new Set(['car:door', 'car:hood', 'lib:caliper', 'eng:block']), DEFAULT_SKIN_OPTIONS);
    expect(n).toBeGreaterThan(0);
    const edits = projectStore.getState().doc!.meshEdits;
    expect(edits['car:door']?.uv.project?.kind).toBe('skin');
    expect(edits['lib:caliper']?.uv.project).toBeFalsy();
    expect(edits['eng:block']?.uv.project).toBeFalsy();
  });
});
