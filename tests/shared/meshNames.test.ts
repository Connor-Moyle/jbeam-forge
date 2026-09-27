import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/shared/project/schema';
import { applyAutoMeshNames, meshBaseName, meshNameProblem, renameMesh, tidyDisplayName, tidyDisplayNames, withMeshNames } from '../../src/shared/parts/meshNames';

type Doc = Pick<Project, 'meshNames' | 'assignments' | 'parts' | 'ignoredMeshes'>;
const part = (id: string, displayName: string, variantOf: string | null = null) => ({ id, displayName, name: `car_${id}`, variantOf }) as Project['parts'][number];

function doc(): Doc {
  return {
    parts: [part('hs', 'Rear Left halfshaft'), part('hood', 'Hood (2)')],
    assignments: { 's:Plane.200': 'hs', 's:Plane.200/sp_1': 'hs', 's:Plane.198': 'hs', 's:Hood_2': 'hood' },
    ignoredMeshes: [],
    meshNames: {},
  };
}

describe('friendly mesh names', () => {
  it('tidies numbered leftovers off display names', () => {
    expect(tidyDisplayName('Hood (2)')).toBe('Hood');
    expect(tidyDisplayName('Rear Left door card (2001)')).toBe('Rear Left door card');
    expect(tidyDisplayName('Front bumper (Race)')).toBe('Front bumper (Race)'); // real variants stay
    expect(meshBaseName(part('x', 'Rear Left halfshaft'))).toBe('rear_left_halfshaft');
  });

  it('names meshes after their part, numbering the rest', () => {
    const d = doc();
    applyAutoMeshNames(d);
    expect(Object.values(d.meshNames).map((e) => e.name).sort()).toEqual(['hood', 'rear_left_halfshaft', 'rear_left_halfshaft_2', 'rear_left_halfshaft_3']);
    expect(Object.values(d.meshNames).every((e) => !e.manual)).toBe(true);
  });

  it('keeps existing auto names stable when a mesh joins the part', () => {
    const d = doc();
    applyAutoMeshNames(d);
    const before = { ...d.meshNames };
    d.assignments['s:Plane.113'] = 'hs';
    applyAutoMeshNames(d);
    for (const [k, e] of Object.entries(before)) expect(d.meshNames[k]).toEqual(e);
    expect(d.meshNames['s:Plane.113']!.name).toBe('rear_left_halfshaft_4');
  });

  it('never overwrites or reuses a typed name', () => {
    const d = doc();
    renameMesh(d, 's:Plane.198', 'rear_left_halfshaft');
    applyAutoMeshNames(d);
    expect(d.meshNames['s:Plane.198']).toEqual({ name: 'rear_left_halfshaft', manual: true });
    const others = ['s:Plane.200', 's:Plane.200/sp_1'].map((k) => d.meshNames[k]!.name);
    expect(others).not.toContain('rear_left_halfshaft');
  });

  it('drops auto names when a mesh loses its part, keeps typed ones', () => {
    const d = doc();
    applyAutoMeshNames(d);
    renameMesh(d, 's:Hood_2', 'bonnet');
    delete d.assignments['s:Plane.200'];
    delete d.assignments['s:Hood_2'];
    applyAutoMeshNames(d);
    expect(d.meshNames['s:Plane.200']).toBeUndefined();
    expect(d.meshNames['s:Hood_2']).toEqual({ name: 'bonnet', manual: true });
  });

  it('tidies display names, keeping a part and its variants apart', () => {
    const d = { parts: [part('a', 'Hood (2)'), part('b', 'Hood (3)', 'a'), part('c', 'Trunk lid')] };
    tidyDisplayNames(d);
    expect(d.parts.map((p) => p.displayName)).toEqual(['Hood', 'Hood 2', 'Trunk lid']);
  });

  it('checks typed names and lets an empty one go back to automatic', () => {
    const d = doc();
    renameMesh(d, 's:Hood_2', 'bonnet');
    expect(meshNameProblem(d, 's:Plane.198', 'Bonnet')).toMatch(/already/);
    expect(meshNameProblem(d, 's:Plane.198', 'bad/name')).toMatch(/letters/);
    expect(meshNameProblem(d, 's:Plane.198', '')).toBeNull();
    renameMesh(d, 's:Hood_2', '  ');
    expect(d.meshNames['s:Hood_2']).toBeUndefined();
  });

  it('swaps friendly names in for export', () => {
    const d = doc();
    applyAutoMeshNames(d);
    expect(withMeshNames(d, [{ key: 's:Hood_2', name: 'Hood_2' }, { key: 's:Other', name: 'Other' }]).map((m) => m.name)).toEqual(['hood', 'Other']);
  });
});
