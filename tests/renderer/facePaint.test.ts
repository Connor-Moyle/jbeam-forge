import { beforeEach, describe, expect, it } from 'vitest';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { createEmptyProject } from '../../src/shared/project/io';
import { defaultMaterial } from '../../src/shared/materials/schema';
import { projectStore } from '../../src/renderer/app/stores/project';
import { useSceneStore } from '../../src/renderer/app/stores/scene';
import { usePainter } from '../../src/renderer/paint/painter';
import { addPresetMaterial, facePointer, paintedCounts, weaveScale, withPaintedFaces } from '../../src/renderer/paint/facePaint';
import type { ImportedMesh } from '../../src/renderer/import/normalize';

const box = new BoxGeometry(1, 1, 1, 4, 4, 4); // 6 groups, 192 triangles
const mesh: ImportedMesh = { key: 'src:panel', sourceId: 'src', name: 'panel', geometry: box, material: new MeshBasicMaterial(), triangles: 192 };

beforeEach(() => {
  const doc = createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  doc.materials.push(defaultMaterial('carbon', 'carbon'), defaultMaterial('body', 'body'));
  doc.materialSlots['src:panel'] = ['body'];
  projectStore.getState().load(doc, 'C:/test.jbforge');
  useSceneStore.getState().clear();
  useSceneStore.getState().setSource({ sourceId: 'src', status: 'ready', fingerprint: 'x', fileName: 'p.obj', raw: [mesh], meshes: [mesh], splitsKey: '[]', textures: null, error: null, stats: null });
  usePainter.getState().set({ tool: 'material', faceMaterialId: 'carbon', faceMode: 'brush', size: 40, mirror: false });
});

const faces = () => projectStore.getState().doc!.faceMaterials['src:panel'];
const hit = (face: number, point: [number, number, number]) => ({ meshKey: 'src:panel', face, uv: null, point });

describe('material brush', () => {
  it('a drag paints the triangles near the pointer, as one undo step', () => {
    facePointer(hit(0, [0.5, 0.4, 0.4]), 'start');
    facePointer(hit(1, [0.5, 0.2, 0.2]), 'move');
    expect(faces()).toBeUndefined(); // not in the project until the stroke ends
    facePointer(null, 'end');
    const painted = paintedCounts(projectStore.getState().doc!).get('carbon')!;
    expect(painted).toBeGreaterThan(4);
    expect(painted).toBeLessThan(32); // only the +X face's corner, not the whole box
    projectStore.getState().undo();
    expect(faces()).toBeUndefined();
  });

  it('whole mesh, whole piece and erase', () => {
    usePainter.getState().set({ faceMode: 'mesh' });
    facePointer(hit(0, [0.5, 0, 0]), 'start');
    facePointer(null, 'end');
    expect(paintedCounts(projectStore.getState().doc!).get('carbon')).toBe(192);
    usePainter.getState().set({ faceMode: 'erase', size: 30 });
    facePointer(hit(0, [0.5, 0.4, 0.4]), 'start');
    facePointer(null, 'end');
    expect(paintedCounts(projectStore.getState().doc!).get('carbon')).toBeLessThan(192);
    usePainter.getState().set({ faceMode: 'smooth', faceAngle: 20, faceMaterialId: 'body' });
    facePointer(hit(40, [0, 0.5, 0]), 'start');
    facePointer(null, 'end');
    // one flat side of the box: 32 triangles
    expect(paintedCounts(projectStore.getState().doc!).get('body')).toBe(32);
  });

  it('exports painted faces as groups of their own', () => {
    usePainter.getState().set({ faceMode: 'smooth', faceAngle: 20 });
    facePointer(hit(0, [0.5, 0, 0]), 'start');
    facePointer(null, 'end');
    const out = withPaintedFaces(box, faces(), { materials: ['test_body'] }, (id) => (id === 'carbon' ? { name: 'test_carbon', back: null } : null));
    // the box has 6 groups of its own (all the body material here); carbon comes after them
    expect(out.materials).toEqual([...Array(6).fill('test_body'), 'test_carbon']);
    const carbon = out.geometry.groups.filter((g) => g.materialIndex === 6).reduce((n, g) => n + g.count / 3, 0);
    expect(carbon).toBe(32);
    expect(out.geometry.index!.count).toBe(box.index!.count);
    // a painted material that no longer exists leaves the mesh as it was
    expect(withPaintedFaces(box, faces(), { materials: ['test_body'] }, () => null).geometry).toBe(box);
  });

  it('adds library materials once and picks them', () => {
    const a = addPresetMaterial('chrome');
    const b = addPresetMaterial('chrome');
    expect(a).toBe(b);
    expect(usePainter.getState().faceMaterialId).toBe(a);
    expect(weaveScale(3, 0.25)).toBeCloseTo(133.3, 0);
  });
});
