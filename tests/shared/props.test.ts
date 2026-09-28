import { beforeAll, describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { assignMeshes, createPart } from '../../src/shared/parts/ops';
import { buildJbeamFiles } from '../../src/shared/export/jbeam';
import { parseJbeam, type JbeamObject } from '../../src/shared/jbeam/parse';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import { propAmount, PROP_KINDS, referenceNodes, toNodeFrame, type Prop } from '../../src/shared/props/props';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

describe('prop maths', () => {
  const nodes = [
    { id: 'a', pos: [0, 0, 0] },
    { id: 'b', pos: [0.5, 0.02, 0] },
    { id: 'c', pos: [0.02, 0.5, 0] },
    { id: 'd', pos: [0.3, 0.3, 0.01] },
  ];

  it('picks reference nodes lined up with the car', () => {
    expect(referenceNodes(nodes, [0.05, 0.05, 0])).toEqual(['a', 'b', 'c']);
    expect(referenceNodes(nodes.slice(0, 2), [0, 0, 0])).toBeNull();
  });

  it('expresses directions in the reference frame', () => {
    const f = toNodeFrame([0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(f).toEqual([0, 0, 1]);
    const g = toNodeFrame([0, 1, 0], [0, 0, 0], [0, 1, 0], [-1, 0, 0]); // frame turned 90°
    expect(g).toEqual([1, 0, 0]);
  });

  it('clamps value × multiplier + offset', () => {
    const tacho = PROP_KINDS.find((k) => k.id === 'tacho')!;
    expect(propAmount(tacho, 4000)).toBeCloseTo(135);
    expect(propAmount(tacho, 12000)).toBe(270);
    const temp = PROP_KINDS.find((k) => k.id === 'temp')!;
    expect(propAmount(temp, 50)).toBeCloseTo(0);
    expect(propAmount(temp, 130)).toBeCloseTo(90);
  });
});

describe('props on export', () => {
  beforeAll(async () => {
    await meshoptReady;
  });

  it('writes the props table on the mesh’s part and leaves it out of the flexbodies', () => {
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const body = createPart(doc, tax, { taxonomyId: 'body', id: 'p_body' });
    assignMeshes(doc, ['s:shell', 's:wheel'], body.id);
    doc.nodes.push(
      { id: 'b1', partId: body.id, pos: [0, -0.5, 0.8], weight: 1 },
      { id: 'b2', partId: body.id, pos: [0.6, -0.5, 0.8], weight: 1 },
      { id: 'b3', partId: body.id, pos: [0, 0.2, 0.8], weight: 1 },
    );
    const prop: Prop = { id: 'p1', meshKey: 's:wheel', func: 'steering', pivot: [0.1, -0.4, 0.85], axis: [0, 1, 0], slide: [0, 0, 0], min: -900, max: 900, offset: 0, multiplier: 1 };
    doc.props = [prop];
    const files = buildJbeamFiles(doc, tax, { meshNames: new Map([['s:shell', 't_shell'], ['s:wheel', 't_wheel']]), author: 'x' });
    const file = files.find((f) => f.part === body.name)!;
    const part = (parseJbeam(file.text).value as JbeamObject)[body.name] as JbeamObject;
    expect(part.props).toEqual([
      ['func', 'mesh', 'idRef:', 'idX:', 'idY:', 'baseRotation', 'rotation', 'translation', 'min', 'max', 'offset', 'multiplier'],
      ['steering', 't_wheel', 'b1', 'b2', 'b3', { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, -900, 900, 0, 1],
    ]);
    const flex = JSON.stringify(part.flexbodies);
    expect(flex).toContain('t_shell');
    expect(flex).not.toContain('t_wheel');
  });
});
