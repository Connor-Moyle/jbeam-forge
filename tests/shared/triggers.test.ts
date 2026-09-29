import { beforeAll, describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { assignMeshes, createPart } from '../../src/shared/parts/ops';
import type { Project } from '../../src/shared/project/schema';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import type { ProxyMesh } from '../../src/shared/proxy/mesh';
import { generateStructure } from '../../src/shared/proxy/generate';
import { buildJbeamFiles } from '../../src/shared/export/jbeam';
import { exportMeshNames } from '../../src/shared/export/files';
import { parseJbeam, isJbeamObject, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';
import { mirrorTrigger, triggerCorners, uniqueTriggerId } from '../../src/shared/triggers/schema';
import { validateExport } from '../../src/shared/export/validate';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

function box(w: number, y0: number, y1: number, z0: number, z1: number, n = 3): ProxyMesh {
  const p: number[] = [];
  const idx: number[] = [];
  const face = (o: number[], u: number[], v: number[]) => {
    const b = p.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) p.push(o[0]! + (u[0]! * i + v[0]! * j) / n, o[1]! + (u[1]! * i + v[1]! * j) / n, o[2]! + (u[2]! * i + v[2]! * j) / n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = b + i * (n + 1) + j;
        idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
  };
  const W = 2 * w;
  const L = y1 - y0;
  const H = z1 - z0;
  face([-w, y0, z0], [0, L, 0], [W, 0, 0]);
  face([-w, y0, z1], [W, 0, 0], [0, L, 0]);
  face([-w, y0, z0], [W, 0, 0], [0, 0, H]);
  face([-w, y1, z0], [0, 0, H], [W, 0, 0]);
  face([-w, y0, z0], [0, 0, H], [0, L, 0]);
  face([w, y0, z0], [0, L, 0], [0, 0, H]);
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

function car(): Project {
  const doc = createEmptyProject({ name: 'Bench', slug: 'bench' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  const body = createPart(doc, tax, { taxonomyId: 'body', id: 'p_body' });
  const hood = createPart(doc, tax, { taxonomyId: 'hood', id: 'p_hood' });
  assignMeshes(doc, ['s:body'], body.id);
  assignMeshes(doc, ['s:hood'], hood.id);
  generateStructure(doc, tax, [
    { partId: body.id, mesh: box(0.8, -2, 2, 0.2, 1.4, 4) },
    { partId: hood.id, mesh: box(0.7, -2, -0.8, 1.42, 1.5, 3) },
  ]);
  return doc;
}

function parts(doc: Project): Map<string, JbeamObject> {
  const names = exportMeshNames(doc, [
    { key: 's:body', name: 'body', sourceId: 's' },
    { key: 's:hood', name: 'hood', sourceId: 's' },
  ]);
  return new Map(
    buildJbeamFiles(doc, tax, { meshNames: names, author: 'x' }).map((f) => {
      const v = parseJbeam(f.text).value;
      if (!isJbeamObject(v)) throw new Error('not an object');
      return [f.part, Object.values(v)[0] as JbeamObject];
    }),
  );
}

beforeAll(async () => {
  await meshoptReady;
});

describe('triggers', () => {
  it('export as triggers2 rows on their part, linked to their action', () => {
    const doc = car();
    doc.triggers = [{ id: 'horn_button', partId: 'p_hood', pos: [0, -1.5, 1.5], size: [0.1, 0.05, 0.03], rotation: [0, 0, 30], action: 'horn' }];
    const hood = parts(doc).get('bench_hood')!;
    const rows = readTable(hood.triggers2!).records;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.values.id).toBe('horn_button');
    expect(rows[0]!.values.type).toBe('box');
    const ids = new Set(doc.nodes.filter((n) => n.partId === 'p_hood').map((n) => n.id));
    for (const k of ['idRef:', 'idX:', 'idY:']) expect(ids.has(rows[0]!.values[k] as string)).toBe(true);
    const size = rows[0]!.values.size as { x: number; y: number; z: number };
    // Turned 30°, the box in the nodes' frame is at least as big as the box itself.
    expect(size.x * size.y * size.z).toBeGreaterThanOrEqual(0.1 * 0.05 * 0.03 - 1e-9);
    const links = readTable(hood.triggerEventLinks2!).records;
    expect(links[0]!.values).toMatchObject({ 'triggerId:triggers2': 'horn_button', triggerInput: 'action0', inputAction: 'horn' });
    expect(validateExport(doc, tax, { meshNames: new Map(), daeNodes: new Set(), missingTextures: [], loadedMeshKeys: [] }).warnings.filter((w) => w.code.startsWith('trigger'))).toEqual([]);
  });

  it('warns about triggers on a part that is gone', () => {
    const doc = car();
    doc.triggers = [{ id: 't', partId: 'nope', pos: [0, 0, 1], size: [0.1, 0.1, 0.1], rotation: [0, 0, 0], action: 'horn' }];
    expect(validateExport(doc, tax, { meshNames: new Map(), daeNodes: new Set(), missingTextures: [], loadedMeshKeys: [] }).warnings.some((w) => w.code === 'trigger-orphan')).toBe(true);
  });

  it('mirror to the other side with the names and actions swapped', () => {
    const t = { id: 'door_FL_handle', partId: 'p', pos: [0.8, -0.5, 0.9] as [number, number, number], size: [0.16, 0.03, 0.05] as [number, number, number], rotation: [0, 0, 10] as [number, number, number], action: 'door_FL' };
    const m = mirrorTrigger(t, [t]);
    expect(m.id).toBe('door_FR_handle');
    expect(m.action).toBe('door_FR');
    expect(m.pos).toEqual([-0.8, -0.5, 0.9]);
    expect(m.rotation).toEqual([0, -0, -10]);
    expect(uniqueTriggerId([t], 'door_FL_handle')).toBe('door_FL_handle2');
  });

  it('box corners surround the centre by half the size', () => {
    const c = triggerCorners({ pos: [1, 2, 3], size: [0.2, 0.4, 0.6], rotation: [0, 0, 0] });
    expect(c).toHaveLength(8);
    expect(Math.min(...c.map((p) => p[0]))).toBeCloseTo(0.9);
    expect(Math.max(...c.map((p) => p[2]))).toBeCloseTo(3.3);
  });
});
