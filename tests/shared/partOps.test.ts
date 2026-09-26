import { describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier, proposeParts } from '../../src/shared/taxonomy/classify';
import {
  applyProposal,
  assignMeshes,
  createPart,
  defaultDisplayName,
  deletePart,
  distributePositions,
  duplicateAsVariant,
  mergeParts,
  reparent,
  setIgnored,
  wouldCycle,
} from '../../src/shared/parts/ops';
import type { Project } from '../../src/shared/project/schema';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

type Doc = Pick<Project, 'meta' | 'parts' | 'assignments' | 'ignoredMeshes'>;
const emptyDoc = (): Doc => ({ meta: { slug: 'test' } as Project['meta'], parts: [], assignments: {}, ignoredMeshes: [] });

describe('createPart', () => {
  it('names parts <slug>_<slotType>_<position>_<variant>, uniquely', () => {
    const d = emptyDoc();
    expect(createPart(d, tax, { taxonomyId: 'door', position: 'FL' }).name).toBe('test_door_FL');
    expect(createPart(d, tax, { taxonomyId: 'door', position: 'FL', variant: 'race' }).name).toBe('test_door_FL_race');
    expect(createPart(d, tax, { taxonomyId: 'door', position: 'FL' }).name).toBe('test_door_FL_2');
  });

  it('drops positions the kind cannot have and builds a readable display name', () => {
    const d = emptyDoc();
    expect(createPart(d, tax, { taxonomyId: 'hood', position: 'FL' }).position).toBeNull();
    expect(defaultDisplayName(tax.entry('headlight')!, 'R', 'widebody')).toBe('Right headlight (Widebody)');
    expect(defaultDisplayName(tax.entry('bumper')!, 'R', '')).toBe('Rear bumper');
  });

  it('attaches to the nearest ancestor kind with a compatible position', () => {
    const d = emptyDoc();
    const body = createPart(d, tax, { taxonomyId: 'body' });
    const fl = createPart(d, tax, { taxonomyId: 'door', position: 'FL' });
    const fr = createPart(d, tax, { taxonomyId: 'door', position: 'FR' });
    expect(fl.parentPartId).toBe(body.id);
    expect(createPart(d, tax, { taxonomyId: 'door_glass', position: 'FR' }).parentPartId).toBe(fr.id);
    // Kind whose parent kind (knuckle) is absent walks further up (subframe missing too → body).
    expect(createPart(d, tax, { taxonomyId: 'hub', position: 'FL' }).parentPartId).toBe(body.id);
  });
});

describe('applyProposal', () => {
  it('creates linked parts and assignments from a classification', () => {
    const names = ['car_body', 'car_door_FL', 'car_doorglass_FL', 'car_door_race_FL', 'car_zzz'];
    const proposal = proposeParts(
      names.map((n) => ({ key: `s:${n}`, name: n })),
      tax,
    );
    const d = emptyDoc();
    const ids = applyProposal(d, tax, proposal);
    expect(ids).toHaveLength(4);
    const byMesh = (n: string) => d.parts.find((p) => p.id === d.assignments[`s:${n}`])!;
    expect(byMesh('car_doorglass_FL').parentPartId).toBe(byMesh('car_door_FL').id);
    expect(byMesh('car_door_FL').parentPartId).toBe(byMesh('car_body').id);
    expect(byMesh('car_door_race_FL').variantOf).toBe(byMesh('car_door_FL').id);
    expect(d.assignments['s:car_zzz']).toBeUndefined();
  });
});

describe('editing', () => {
  it('guards reparenting against cycles', () => {
    const d = emptyDoc();
    const a = createPart(d, tax, { taxonomyId: 'body' });
    const b = createPart(d, tax, { taxonomyId: 'door', position: 'FL' });
    const c = createPart(d, tax, { taxonomyId: 'door_glass', position: 'FL' });
    expect(wouldCycle(d, a.id, c.id)).toBe(true);
    expect(reparent(d, a.id, c.id)).toBe(false);
    expect(a.parentPartId).toBeNull();
    expect(reparent(d, c.id, a.id)).toBe(true);
    expect(c.parentPartId).toBe(a.id);
    expect(reparent(d, b.id, b.id)).toBe(false);
  });

  it('ignoring unassigns and assigning un-ignores', () => {
    const d = emptyDoc();
    const p = createPart(d, tax, { taxonomyId: 'hood' });
    assignMeshes(d, ['m1'], p.id);
    setIgnored(d, ['m1'], true);
    expect(d.assignments).toEqual({});
    expect(d.ignoredMeshes).toEqual(['m1']);
    assignMeshes(d, ['m1'], p.id);
    expect(d.ignoredMeshes).toEqual([]);
  });

  it('delete moves children up and frees meshes; merge moves meshes to the target', () => {
    const d = emptyDoc();
    const body = createPart(d, tax, { taxonomyId: 'body' });
    const door = createPart(d, tax, { taxonomyId: 'door', position: 'FL' });
    const glass = createPart(d, tax, { taxonomyId: 'door_glass', position: 'FL' });
    const race = duplicateAsVariant(d, tax, door.id, 'race')!;
    assignMeshes(d, ['a'], door.id);
    deletePart(d, door.id);
    expect(glass.parentPartId).toBe(body.id);
    expect(race.variantOf).toBeNull();
    expect(d.assignments).toEqual({});

    const g2 = createPart(d, tax, { taxonomyId: 'door_glass', position: 'FL' });
    assignMeshes(d, ['x'], glass.id);
    assignMeshes(d, ['y'], g2.id);
    mergeParts(d, glass.id, [g2.id]);
    expect(d.assignments).toEqual({ x: glass.id, y: glass.id });
    expect(d.parts.some((p) => p.id === g2.id)).toBe(false);
  });

  it('duplicate as variant links to the base and copies details', () => {
    const d = emptyDoc();
    const door = createPart(d, tax, { taxonomyId: 'door', position: 'RR' });
    door.price = 500;
    const v = duplicateAsVariant(d, tax, door.id, '')!;
    expect(v).toMatchObject({ variantOf: door.id, position: 'RR', price: 500, name: 'test_door_RR_v2' });
    expect(duplicateAsVariant(d, tax, v.id, 'carbon')!.variantOf).toBe(door.id);
  });
});

describe('distributePositions', () => {
  it('reads BeamNG space: +X left, −Y front', () => {
    const centers = { a: [0.7, -1, 1], b: [-0.7, -1, 1], c: [0.7, 1, 1], d: [-0.7, 1, 1] } as const;
    expect(distributePositions('corner', centers, [0, 0, 0])).toEqual({ a: 'FL', b: 'FR', c: 'RL', d: 'RR' });
    expect(distributePositions('lr', centers, [0, 0, 0])).toMatchObject({ a: 'L', b: 'R' });
    expect(distributePositions('fr', centers, [0, 0, 0])).toMatchObject({ a: 'F', c: 'R' });
    expect(distributePositions('none', centers, [0, 0, 0]).a).toBeNull();
  });
});
