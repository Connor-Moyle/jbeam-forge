import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@shared/project/io';
import { removeSourceFromDoc } from '@shared/project/removeSource';
import { IDENTITY_EDIT } from '@shared/mesh/meshEdit';

describe('removing a model', () => {
  it('takes its meshes, splits, copies and fitted suspension with it', () => {
    const d = createEmptyProject({ name: 'T', slug: 't', author: '', description: '', brand: '', type: 'Car' }, '0');
    const src = (id: string) => ({ id, path: `${id}.dae`, absolutePath: `C:/${id}.dae`, format: 'dae' as const, import: { scale: 1, upAxis: '+z' as const, forwardAxis: '-y' as const }, textureDirs: [], placement: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1 }, addedAt: new Date(0).toISOString() });
    d.sources.push(src('a'), src('b'));
    d.splits.push({ id: 's1', meshKey: 'a:arm', name: 'arm_2', triangleRuns: [[0, 1]] });
    d.assignments = { 'a:arm': 'p1', 'a:arm/s1': 'p1', 'b:hub': 'p2', 'copy:c1': 'p1', 'copy:c2': 'p1' };
    d.meshCopies.push({ id: 'c1', from: 'a:arm', mirror: true }, { id: 'c2', from: 'copy:c1', mirror: false }, { id: 'c3', from: 'b:hub', mirror: true });
    d.meshEdits = { 'a:arm': IDENTITY_EDIT, 'copy:c2': IDENTITY_EDIT, 'b:hub': IDENTITY_EDIT };
    d.axles.push({ id: 'ax', name: 'Front', y: -1.2, track: 1.5, steered: true, tuning: {}, ownMeshes: ['a:own', 'b:mine'], fitted: { setId: 'v/p', name: 'n', vehicle: 'v', type: 't', sourceId: 'a' } });
    removeSourceFromDoc(d, 'a');
    expect(d.sources.map((s) => s.id)).toEqual(['b']);
    expect(d.splits).toEqual([]);
    expect(Object.keys(d.assignments)).toEqual(['b:hub']);
    expect(d.meshCopies.map((c) => c.id)).toEqual(['c3']);
    expect(Object.keys(d.meshEdits)).toEqual(['b:hub']);
    expect(d.axles[0]!.fitted).toBeNull();
    expect(d.axles[0]!.ownMeshes).toEqual(['b:mine']);
  });
});
