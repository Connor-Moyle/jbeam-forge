import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/shared/project/io';
import { defaultMaterial } from '../../src/shared/materials/schema';
import { projectStore } from '../../src/renderer/app/stores/project';
import { usePainter } from '../../src/renderer/paint/painter';
import * as v from '../../src/renderer/paint/vinyls';

beforeEach(() => {
  const doc = createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  doc.materials.push(defaultMaterial('m1', 'body', { paint: true }));
  projectStore.getState().load(doc, 'C:/test.jbforge');
  usePainter.getState().set({ materialId: 'm1', target: 'livery', color: [0.2, 0.4, 0.6], slot: 2 });
  v.useVinylUi.setState({ selected: [], side: 'left' });
});

const layers = () => v.currentSet()?.layers ?? [];
const byName = (n: string) => layers().find((l) => l.name === n)!;

describe('vinyl commands', () => {
  it('adds shapes on the side being looked at, in the current colour, and selects them', () => {
    v.viewSide('right');
    v.addShape('star');
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ name: 'Star', kind: 'shape', shape: 'star', side: 'right', color: [0.2, 0.4, 0.6], slot: 2 });
    expect(v.useVinylUi.getState().selected).toEqual([layers()[0]!.id]);
    expect(usePainter.getState().tool).toBe('vinyl');
    v.addShape('star');
    expect(layers()[1]!.name).toBe('Star 2');
  });

  it('adds ready-made designs as a group, and undoes in one step', () => {
    v.addLibraryGroup('Race number roundel');
    const set = v.currentSet()!;
    expect(set.layers).toHaveLength(3);
    expect(set.groups).toHaveLength(1);
    expect(set.layers.every((l) => l.groupId === set.groups[0]!.id)).toBe(true);
    projectStore.getState().undo();
    expect(v.currentSet()?.layers ?? []).toHaveLength(0);
  });

  it('reorders, groups and ungroups', () => {
    v.addShape('circle');
    v.addShape('square');
    v.addShape('star');
    const [c, s, st] = layers().map((l) => l.id) as [string, string, string];
    v.reorder([c], 'top');
    expect(layers().map((l) => l.name)).toEqual(['Square', 'Star', 'Circle']);
    v.reorder([c], 'down');
    expect(layers().map((l) => l.name)).toEqual(['Square', 'Circle', 'Star']);
    v.moveLayerTo(st, 0);
    expect(layers()[0]!.name).toBe('Star');
    v.groupLayers([c, s], 'Badge');
    expect(v.currentSet()!.groups.map((g) => g.name)).toEqual(['Badge']);
    // the group's layers sit together in the stack
    const idx = layers().map((l) => l.groupId !== null);
    expect(idx.indexOf(true) + 1).toBe(idx.lastIndexOf(true));
    v.ungroupLayers([c, s]);
    expect(v.currentSet()!.groups).toEqual([]);
  });

  it('moves, resizes and turns a selection about its middle', () => {
    v.addShape('circle');
    v.addShape('circle');
    v.updateLayers([layers()[0]!.id], { x: -0.5, y: 0 });
    v.updateLayers([layers()[1]!.id], { x: 0.5, y: 0 });
    const from = structuredClone(layers());
    v.transformLayers(from, { dx: 1, dy: 0.2 }, 't1');
    expect(layers().map((l) => [l.x, l.y])).toEqual([
      [expect.closeTo(0.5), expect.closeTo(0.2)],
      [expect.closeTo(1.5), expect.closeTo(0.2)],
    ]);
    v.transformLayers(from, { scale: 2 }, 't2');
    expect(layers()[0]!.x).toBeCloseTo(-1);
    expect(layers()[0]!.w).toBeCloseTo(1);
    v.transformLayers(from, { rotate: 90 }, 't3');
    expect(layers()[1]!.y).toBeCloseTo(0.5);
    expect(layers()[1]!.rotation).toBeCloseTo(90);
    // locked layers stay put
    v.updateLayers([layers()[0]!.id], { locked: true });
    const locked = structuredClone(layers());
    v.transformLayers(locked, { dx: 3 }, 't4');
    expect(layers()[0]!.x).toBeCloseTo(locked[0]!.x);
  });

  it('lines layers up and makes mirrored copies', () => {
    v.addShape('square');
    v.addShape('square');
    const [a, b] = layers().map((l) => l.id) as [string, string];
    v.updateLayers([a], { x: -0.4, y: 0.3, w: 0.2 });
    v.updateLayers([b], { x: 0.4, y: -0.1, w: 0.6 });
    v.alignLayers([a, b], 'left');
    expect(byName('Square').x - 0.1).toBeCloseTo(byName('Square 2').x - 0.3);
    v.alignLayers([a, b], 'middle');
    expect(byName('Square').y).toBeCloseTo(byName('Square 2').y);
    v.mirrorCopy([a]);
    const copy = byName('Square (mirror)');
    expect(copy).toMatchObject({ side: 'right', flipX: true });
    expect(copy.x).toBeCloseTo(-byName('Square').x);
  });

  it('duplicates and deletes, keeping only groups that still have layers', () => {
    v.addLibraryGroup('Speed chevrons');
    const ids = layers().map((l) => l.id);
    v.duplicateLayers([ids[0]!]);
    expect(layers()).toHaveLength(4);
    v.deleteLayers(ids);
    expect(layers().map((l) => l.name)).toEqual(['Chevron 1 copy']);
    expect(v.currentSet()!.groups).toHaveLength(1); // the copy is still in the group
    v.deleteLayers([layers()[0]!.id]);
    expect(v.currentSet()!.groups).toHaveLength(0);
  });
});
