import { beforeAll, describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { assignMeshes, createPart } from '../../src/shared/parts/ops';
import { ProjectSchema, type Project } from '../../src/shared/project/schema';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import type { ProxyMesh } from '../../src/shared/proxy/mesh';
import { generateStructure } from '../../src/shared/proxy/generate';
import { buildJbeamFiles } from '../../src/shared/export/jbeam';
import { exportMeshNames } from '../../src/shared/export/files';
import { parseJbeam, isJbeamObject, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';
import { beamKey } from '../../src/shared/structure/edit';
import * as wb from '../../src/shared/jbeam/workbench';
import { coerceProperty, propertyOf } from '../../src/shared/jbeam/properties';

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

describe('logical node names', () => {
  it('names pairs l/r with the same number, front to back, and centre nodes without an ending', () => {
    const doc = car();
    const map = wb.logicalNames(doc, ['p_hood']);
    wb.renameNodes(doc, map);
    const hood = doc.nodes.filter((n) => n.partId === 'p_hood');
    expect(hood.every((n) => /^h\d+[lr]?$/.test(n.id))).toBe(true);
    for (const n of hood.filter((x) => x.id.endsWith('l'))) {
      const twin = hood.find((m) => m.id === `${n.id.slice(0, -1)}r`)!;
      expect(twin).toBeDefined();
      expect(twin.pos[0]).toBeCloseTo(-n.pos[0], 3);
      expect(n.pos[0]).toBeGreaterThan(0);
    }
    const byNum = (id: string) => Number(/\d+/.exec(id)![0]);
    const sorted = [...hood].sort((a, b) => byNum(a.id) - byNum(b.id));
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.pos[1]).toBeGreaterThanOrEqual(sorted[i - 1]!.pos[1] - 1e-3);
    // Beams and triangles follow.
    const ids = new Set(doc.nodes.map((n) => n.id));
    expect(doc.beams.every((b) => ids.has(b.id1) && ids.has(b.id2))).toBe(true);
    expect(doc.tris.every((t) => t.ids.every((id) => ids.has(id)))).toBe(true);
    expect(() => ProjectSchema.parse(doc)).not.toThrow();
  });

  it('gives two parts different prefixes and never clashes with names that stay', () => {
    const doc = car();
    const map = wb.logicalNames(doc, ['p_body', 'p_hood'], { ...wb.DEFAULT_NAMING, prefixes: { p_body: 'h', p_hood: 'h' } });
    wb.renameNodes(doc, map);
    expect(new Set(doc.nodes.map((n) => n.id)).size).toBe(doc.nodes.length);
  });

  it('renames in swaps and refuses duplicates or bad names', () => {
    const doc = car();
    const [a, b] = doc.nodes.map((n) => n.id);
    wb.renameNodes(doc, new Map([[a!, b!], [b!, a!]]));
    expect(doc.nodes[0]!.id).toBe(b);
    expect(doc.nodes[1]!.id).toBe(a);
    expect(wb.renameProblem(doc, new Map([[a!, doc.nodes[2]!.id]]))).toMatch(/same name/);
    expect(wb.renameProblem(doc, new Map([[a!, '9x']]))).toMatch(/valid/);
  });

  it('pairs the nodes of a left and a right part that share a prefix', () => {
    const doc = car();
    const l = createPart(doc, tax, { taxonomyId: 'headlight', position: 'L', id: 'p_hl' });
    const r = createPart(doc, tax, { taxonomyId: 'headlight', position: 'R', id: 'p_hr' });
    doc.nodes.push({ id: 'a', partId: l.id, pos: [0.6, -2, 0.7], weight: 1 }, { id: 'b', partId: l.id, pos: [0.5, -2, 0.7], weight: 1 });
    doc.nodes.push({ id: 'c', partId: r.id, pos: [-0.6, -2, 0.7], weight: 1 }, { id: 'd', partId: r.id, pos: [-0.5, -2, 0.7], weight: 1 });
    const map = wb.logicalNames(doc, [l.id, r.id], { ...wb.DEFAULT_NAMING, prefixes: { [l.id]: 'hl', [r.id]: 'hl' } });
    expect(map.get('a')?.replace(/l$/, '')).toBe(map.get('c')?.replace(/r$/, ''));
    expect(map.get('a')).toMatch(/^hl\d+l$/);
    expect(map.get('d')).toMatch(/^hl\d+r$/);
  });

  it('suggests short prefixes', () => {
    expect(wb.suggestPrefix({ name: 'car_hood', taxonomyId: 'hood', position: null })).toBe('h');
    expect(wb.suggestPrefix({ name: 'car_door_FL', taxonomyId: 'door', position: 'FL' })).toBe('dfl');
  });
});

describe('row properties', () => {
  it('set, clear and export on the row only', () => {
    const doc = car();
    const hood = doc.nodes.filter((n) => n.partId === 'p_hood');
    const beam = doc.beams.find((b) => b.partId === 'p_hood')!;
    wb.setRowOption(doc, 'node', [hood[0]!.id], 'collision', false);
    wb.setRowOption(doc, 'beam', [beamKey(beam.id1, beam.id2)], 'beamSpring', 1234);
    wb.setRowOption(doc, 'tri', [wb.triKey(doc.tris.find((t) => t.partId === 'p_hood')!.ids)], 'dragCoef', 7);
    expect(() => ProjectSchema.parse(doc)).not.toThrow();
    const out = parts(doc).get('bench_hood')!;
    const nodes = readTable(out.nodes!).records;
    expect(nodes.find((r) => r.values.id === hood[0]!.id)!.options.collision).toBe(false);
    expect(nodes.filter((r) => r.options.collision === false)).toHaveLength(1);
    const beams = readTable(out.beams!).records;
    expect(beams.filter((r) => r.options.beamSpring === 1234)).toHaveLength(1);
    const tris = readTable(out.triangles!).records;
    expect(tris.filter((r) => r.options.dragCoef === 7)).toHaveLength(1);
    wb.setRowOption(doc, 'node', [hood[0]!.id], 'collision', null);
    expect(doc.nodes.find((n) => n.id === hood[0]!.id)!.options).toBeUndefined();
  });

  it('scales a value from its base when not set yet', () => {
    const doc = car();
    const b = doc.beams[0]!;
    wb.scaleRowOption(doc, 'beam', [beamKey(b.id1, b.id2)], 'beamSpring', 2, () => 100);
    expect(doc.beams[0]!.options).toEqual({ beamSpring: 200 });
  });

  it('checks typed values', () => {
    expect(coerceProperty(propertyOf('beam', 'beamSpring'), '-5')).toBe(0);
    expect(coerceProperty(propertyOf('beam', 'beamType'), '|BOUNDED')).toBe('|BOUNDED');
    expect(coerceProperty(propertyOf('beam', 'beamType'), 'nope')).toBeNull();
    expect(coerceProperty(undefined, '12')).toBe(12);
    expect(coerceProperty(undefined, 'true')).toBe(true);
  });
});

describe('triangles, positions and weights', () => {
  it('adds, flips and deletes triangles', () => {
    const doc = car();
    const [a, b, c] = doc.nodes;
    const n0 = doc.tris.length;
    const key = wb.addTriangle(doc, [a!.id, b!.id, c!.id]) ?? wb.triKey([a!.id, b!.id, c!.id]);
    expect(wb.addTriangle(doc, [a!.id, b!.id, c!.id])).toBeNull();
    const before = doc.tris.find((t) => wb.triKey(t.ids) === key)!.ids.slice();
    wb.flipTriangles(doc, [key]);
    expect(doc.tris.find((t) => wb.triKey(t.ids) === key)!.ids).toEqual([before[0], before[2], before[1]]);
    wb.deleteTriangles(doc, [key]);
    expect(doc.tris.length).toBeLessThanOrEqual(n0);
  });

  it('aligns, snaps, offsets and scales positions; distributes weight', () => {
    const doc = car();
    const ids = doc.nodes.filter((n) => n.partId === 'p_hood').map((n) => n.id);
    wb.alignNodes(doc, ids, 2, 1.5);
    expect(doc.nodes.filter((n) => ids.includes(n.id)).every((n) => n.pos[2] === 1.5)).toBe(true);
    wb.offsetNodes(doc, ids, [0, 0, 0.1]);
    expect(doc.nodes.find((n) => n.id === ids[0])!.pos[2]).toBeCloseTo(1.6, 5);
    wb.snapNodes(doc, ids, 0.05);
    for (const n of doc.nodes.filter((m) => ids.includes(m.id))) for (const v of n.pos) expect(Math.abs(v / 0.05 - Math.round(v / 0.05))).toBeLessThan(1e-6);
    wb.distributeWeight(doc, ids, 20, false);
    const total = doc.nodes.filter((n) => ids.includes(n.id)).reduce((s, n) => s + n.weight, 0);
    expect(total).toBeCloseTo(20, 1);
  });

  it('makes nearly mirrored nodes exactly symmetric', () => {
    const doc = car();
    const left = doc.nodes.find((n) => n.pos[0] > 0.1)!;
    left.pos = [left.pos[0] + 0.004, left.pos[1], left.pos[2]];
    expect(wb.symmetrise(doc, doc.nodes.map((n) => n.id))).toBeGreaterThan(0);
    expect(wb.asymmetricNodes(doc, ['p_body', 'p_hood'])).toEqual([]);
  });
});

describe('structure checks', () => {
  it('finds loose nodes, duplicates, short beams, overlaps and missing nodes', () => {
    const doc = car();
    expect(wb.checkStructure(doc).filter((i) => i.severity === 'error')).toEqual([]);
    const [a, b] = doc.nodes;
    doc.beams.push({ ...doc.beams[0]! });
    doc.nodes.push({ id: 'lonely', partId: 'p_body', pos: [5, 5, 5], weight: 1 });
    doc.nodes.push({ id: 'twin', partId: 'p_body', pos: [a!.pos[0] + 0.0005, a!.pos[1], a!.pos[2]], weight: 1 });
    doc.beams.push({ id1: a!.id, id2: 'ghost', partId: 'p_body', kind: 'edge' });
    doc.beams.push({ id1: a!.id, id2: 'twin', partId: 'p_body', kind: 'edge' });
    void b;
    const kinds = new Set(wb.checkStructure(doc).map((i) => i.kind));
    for (const k of ['duplicate-beam', 'loose-node', 'overlap', 'missing-node', 'short-beam'] as const) expect(kinds).toContain(k);
    expect(wb.checkStructure(doc)[0]!.severity).toBe('error');
  });
});
