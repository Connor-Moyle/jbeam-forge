import { describe, expect, it } from 'vitest';
import { ancestorIds, buildSceneTree, subtreeIds } from '../../src/shared/parts/tree';
import type { Part } from '../../src/shared/project/schema';

const part = (id: string, displayName: string, parentPartId: string | null, variantOf: string | null = null): Part => ({
  id,
  taxonomyId: 'x',
  name: `t_${id}`,
  displayName,
  position: null,
  parentPartId,
  variantOf,
  price: 0,
  description: '',
  constructionMaterial: 'steel',
});

const parts = [part('body', 'Body', null), part('door', 'Door', 'body'), part('door_race', 'Door (Race)', 'body', 'door'), part('bumper', 'Bumper', 'body'), part('glass', 'Door glass', 'door')];
const meshes = ['m_body', 'm_door', 'm_glass', 'm_loose', 'm_ign'].map((key) => ({ key, name: key, triangles: 10 }));
const assignments = { m_body: 'body', m_door: 'door', m_glass: 'glass' };

describe('buildSceneTree', () => {
  it('nests parts, counts subtree meshes, and lists unassigned/ignored separately', () => {
    const t = buildSceneTree(parts, assignments, ['m_ign'], meshes);
    expect(t.roots.map((r) => r.part.id)).toEqual(['body']);
    const body = t.roots[0]!;
    expect(body.total).toBe(3);
    // Alphabetical, variants right after their base.
    expect(body.children.map((c) => c.part.id)).toEqual(['bumper', 'door', 'door_race']);
    expect(body.children[1]!.children[0]!.part.id).toBe('glass');
    expect(t.unassigned.map((m) => m.key)).toEqual(['m_loose']);
    expect(t.ignored.map((m) => m.key)).toEqual(['m_ign']);
  });

  it('filters by query and reports the path to expand', () => {
    const t = buildSceneTree(parts, assignments, [], meshes, 'glass');
    expect(t.roots[0]!.children.map((c) => c.part.id)).toEqual(['door']);
    expect([...t.hitPath].sort()).toEqual(['body', 'door']);
    expect(t.unassigned).toEqual([]);
  });

  it('survives parent cycles in bad data', () => {
    const loop = [part('a', 'A', 'b'), part('b', 'B', 'a')];
    const t = buildSceneTree(loop, {}, [], []);
    expect(t.roots.length).toBeGreaterThan(0);
  });
});

describe('subtree / ancestors', () => {
  it('walks down and up', () => {
    expect(subtreeIds(parts, 'door').sort()).toEqual(['door', 'glass']);
    expect(ancestorIds(parts, 'glass')).toEqual(['door', 'body']);
  });
});
