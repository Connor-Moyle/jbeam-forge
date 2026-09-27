import { describe, expect, it } from 'vitest';
import { legacyFbxName, legacyKeyMap, remapMeshKeys } from '../../src/shared/mesh/legacyKeys';

describe('pre-0.7.1 FBX mesh keys', () => {
  it('reproduces the old sanitised names', () => {
    expect(legacyFbxName('Circle.087')).toBe('Circle087');
    expect(legacyFbxName('Sunburst6_extra_gasCap_1.001')).toBe('Sunburst6_extra_gasCap_1001');
    expect(legacyFbxName('Front-Left-rotor.003')).toBe('Front-Left-rotor003');
    expect(legacyFbxName('My mesh')).toBe('My_mesh');
  });

  it('carries assignments, splits, names and ignores over to the real names', () => {
    const doc = {
      assignments: { 'fbx:Circle087': 'p1', 'fbx:Circle087/sp_1': 'p2', 'fbx:Body': 'p0' },
      ignoredMeshes: ['fbx:Plane202'],
      meshNames: { 'fbx:Circle087/sp_1': { name: 'lower_arm_r', manual: true } },
      splits: [{ id: 'sp_1', meshKey: 'fbx:Circle087', name: 'x', triangleRuns: [[0, 1]] as [number, number][] }],
    };
    const map = legacyKeyMap(doc, 'fbx', ['Circle.087', 'Plane.202', 'Body', 'Circle.099']);
    expect([...map]).toEqual([
      ['fbx:Circle087', 'fbx:Circle.087'],
      ['fbx:Plane202', 'fbx:Plane.202'],
    ]);
    remapMeshKeys(doc, map);
    expect(doc.assignments).toEqual({ 'fbx:Circle.087': 'p1', 'fbx:Circle.087/sp_1': 'p2', 'fbx:Body': 'p0' });
    expect(doc.ignoredMeshes).toEqual(['fbx:Plane.202']);
    expect(Object.keys(doc.meshNames)).toEqual(['fbx:Circle.087/sp_1']);
    expect(doc.splits[0]!.meshKey).toBe('fbx:Circle.087');
  });

  it('does nothing for projects already using the real names', () => {
    const doc = { assignments: { 'fbx:Circle.087': 'p' }, ignoredMeshes: [], meshNames: {}, splits: [] };
    expect(legacyKeyMap(doc, 'fbx', ['Circle.087']).size).toBe(0);
  });
});
