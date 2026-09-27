import { describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { assignMeshes, createPart } from '../../src/shared/parts/ops';
import { buildSceneTree } from '../../src/shared/parts/tree';
import { groupInfo, groupItems, type TreeItem } from '../../src/shared/parts/grouping';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

function outline(items: TreeItem[], depth = 0): string[] {
  return items.flatMap((i) => (i.type === 'group' ? [`${'  '.repeat(depth)}[${i.label}] ${i.count}`, ...outline(i.items, depth + 1)] : [`${'  '.repeat(depth)}${i.node.part.displayName}`]));
}

describe('scene tree grouping', () => {
  it('groups a body’s children into Doors → Front/Rear doors, Glass, Lights; singletons stay loose in category order', () => {
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const body = createPart(doc, tax, { taxonomyId: 'body' });
    for (const pos of ['FL', 'FR', 'RL', 'RR']) createPart(doc, tax, { taxonomyId: 'door', position: pos });
    createPart(doc, tax, { taxonomyId: 'headlight', position: 'L' });
    createPart(doc, tax, { taxonomyId: 'headlight', position: 'R' });
    createPart(doc, tax, { taxonomyId: 'hood' });
    const meshes = doc.parts.map((p, i) => ({ key: `m${i}`, name: `m${i}`, triangles: 1 }));
    doc.parts.forEach((p, i) => assignMeshes(doc, [`m${i}`], p.id));
    const tree = buildSceneTree(doc.parts, doc.assignments, [], meshes);
    const bodyNode = tree.roots.find((r) => r.part.id === body.id)!;
    const items = groupItems(bodyNode.children, (p) => groupInfo(tax.entry(p.taxonomyId), p), body.id);
    expect(outline(items)).toEqual([
      '[Doors] 4',
      '  [Front doors] 2',
      '    Front Left door',
      '    Front Right door',
      '  [Rear doors] 2',
      '    Rear Left door',
      '    Rear Right door',
      'Hood', // a lone body panel stays loose, in category order
      '[Lights] 2',
      '  Left headlight',
      '  Right headlight',
    ]);
  });
});
