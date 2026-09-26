import { beforeAll, describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { createPart } from '../../src/shared/parts/ops';
import type { StructNode } from '../../src/shared/project/schema';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import type { ProxyMesh } from '../../src/shared/proxy/mesh';
import { attachToParent, braces, deriveStructure, nameNodes, placeRefNodes, positionTag, predictStability, STABILITY_OK } from '../../src/shared/proxy/derive';
import { defaultProxySettings, generateStructure, removePartStructure, structureTotals, swapSafeParentNodes } from '../../src/shared/proxy/generate';
import { kindDefaults, targetVertices } from '../../src/shared/proxy/presets';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

/** Closed box shell spanning x∈[-w,w], y∈[y0,y1], z∈[z0,z1], subdivided n×n per face (symmetric about X=0). */
function boxShell(w: number, y0: number, y1: number, z0: number, z1: number, n = 4): ProxyMesh {
  const p: number[] = [];
  const idx: number[] = [];
  const face = (o: number[], u: number[], v: number[]) => {
    const base = p.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) p.push(o[0]! + (u[0]! * i + v[0]! * j) / n, o[1]! + (u[1]! * i + v[1]! * j) / n, o[2]! + (u[2]! * i + v[2]! * j) / n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = base + i * (n + 1) + j;
        idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
  };
  const W = 2 * w;
  const L = y1 - y0;
  const H = z1 - z0;
  face([-w, y0, z0], [0, L, 0], [W, 0, 0]); // bottom
  face([-w, y0, z1], [W, 0, 0], [0, L, 0]); // top
  face([-w, y0, z0], [W, 0, 0], [0, 0, H]); // front
  face([-w, y1, z0], [0, 0, H], [W, 0, 0]); // rear
  face([-w, y0, z0], [0, 0, H], [0, L, 0]); // right (−X)
  face([w, y0, z0], [0, L, 0], [0, 0, H]); // left (+X)
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

beforeAll(async () => {
  await meshoptReady;
});

describe('node naming', () => {
  it('pairs mirror twins with one number, numbers front→rear, and skips taken ids', () => {
    const pos = new Float32Array([0.5, -1, 1, -0.5, -1, 1, 0, 0, 1, 0.5, 1, 1]);
    expect(nameNodes(pos, 'b')).toEqual(['b1l', 'b1r', 'b2', 'b3l']);
    expect(nameNodes(pos, 'b', new Set(['b1l']))).toEqual(['b2l', 'b2r', 'b3', 'b4l']);
  });

  it('tags front/rear parts but not left/right ones (the suffix carries the side)', () => {
    expect(positionTag('fr', 'R')).toBe('r');
    expect(positionTag('fr', 'F')).toBe('f');
    expect(positionTag('corner', 'RL')).toBe('r');
    expect(positionTag('lr', 'R')).toBe('');
    expect(positionTag('none', null)).toBe('');
  });
});

describe('derivation', () => {
  it('maps vertices, edges and faces to nodes, beams and triangles with even weights', () => {
    const mesh = boxShell(0.5, -1, 1, 0, 1, 1); // 6 faces × 4 verts (unwelded) — derive works on what it is given
    const d = deriveStructure({ partId: 'p', mesh, prefix: 'x', massKg: 24, bracing: 'none' });
    expect(d.nodes).toHaveLength(24);
    expect(d.nodes.every((n) => n.weight === 1)).toBe(true);
    expect(d.tris).toHaveLength(12);
    expect(d.beams.every((b) => b.kind === 'edge')).toBe(true);
    expect(new Set(d.nodes.map((n) => n.id)).size).toBe(24);
  });

  it('warns about very light nodes', () => {
    const d = deriveStructure({ partId: 'p', mesh: boxShell(0.5, -1, 1, 0, 1, 1), prefix: 'x', massKg: 1, bracing: 'none' });
    expect(d.warnings.join()).toMatch(/kg each/);
  });

  it('bending braces connect the opposite vertices of adjacent triangles', () => {
    const quad: ProxyMesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2, 0, 2, 3]) };
    expect(braces(quad, 'standard')).toEqual([[1, 3]]);
    expect(braces(quad, 'none')).toEqual([]);
  });

  it('attaches the child nodes nearest the parent with the style’s link count', () => {
    const node = (id: string, x: number, y: number, z: number): StructNode => ({ id, partId: 'x', pos: [x, y, z], weight: 1 });
    const parent = [node('p1', 0, 0, 0), node('p2', 1, 0, 0), node('p3', 0, 1, 0), node('p4', 5, 5, 5)];
    const child = [node('c1', 0, 0, 0.05), node('c2', 1, 0, 0.05), node('c3', 0, 1, 0.05), node('c4', 0, 0, 3)];
    const beams = attachToParent(child, parent, 'clipped', 'child');
    expect(new Set(beams.map((b) => b.id1))).toEqual(new Set(['c1', 'c2', 'c3'])); // the far node isn't attached
    expect(beams.filter((b) => b.id1 === 'c1')).toHaveLength(2); // clipped = 2 links
    expect(beams.every((b) => b.kind === 'attach' && b.partId === 'child')).toBe(true);
    // Far from the parent: only the 3 nearest child nodes attach.
    const far = child.map((c) => ({ ...c, pos: [c.pos[0], c.pos[1], c.pos[2] + 3] as [number, number, number] }));
    expect(new Set(attachToParent(far, parent, 'bolted', 'child').map((b) => b.id1)).size).toBe(3);
  });
});

describe('stability predictor', () => {
  it('flags a light node on stiff beams with a concrete fix', () => {
    const nodes: StructNode[] = [
      { id: 'a1', partId: 'p', pos: [0, 0, 0], weight: 0.05 },
      { id: 'a2', partId: 'p', pos: [1, 0, 0], weight: 5 },
    ];
    const r = predictStability(nodes, [{ id1: 'a1', id2: 'a2', partId: 'p', kind: 'edge' }], { spring: () => 4_000_000 });
    expect(r.verdict).toBe('unstable');
    expect(r.offenders[0]!.nodeId).toBe('a1');
    expect(r.offenders[0]!.message).toMatch(/a1 0\.05 kg with ~4\.0M of beams: add mass/);
    const ok = predictStability([{ ...nodes[0]!, weight: 3 }, nodes[1]!], [{ id1: 'a1', id2: 'a2', partId: 'p', kind: 'edge' }], { spring: () => 1_000_000 });
    expect(ok.verdict).toBe('ok');
    expect(ok.worst).toBeLessThan(STABILITY_OK);
  });
});

describe('refNodes', () => {
  it('places ref low in the middle, back behind, left to +X, up above, corners front-low', () => {
    const d = deriveStructure({ partId: 'b', mesh: boxShell(0.8, -2, 2, 0.2, 1.4), prefix: 'b', massKg: 300, bracing: 'none' });
    const r = placeRefNodes(d.nodes)!;
    const pos = (id: string) => d.nodes.find((n) => n.id === id)!.pos;
    expect(pos(r.back)[1]).toBeGreaterThan(pos(r.ref)[1]);
    expect(pos(r.left)[0]).toBeGreaterThan(pos(r.ref)[0]);
    expect(pos(r.up)[2]).toBeGreaterThan(pos(r.ref)[2]);
    expect(pos(r.leftCorner)[0]).toBeGreaterThan(0);
    expect(pos(r.rightCorner)[0]).toBeLessThan(0);
    expect(new Set(Object.values(r)).size).toBe(6);
  });
});

describe('generateStructure', () => {
  it('generates parents before children, attaches, places refNodes, and regenerates cleanly', () => {
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const body = createPart(doc, tax, { taxonomyId: 'body' });
    const hood = createPart(doc, tax, { taxonomyId: 'hood' });
    expect(hood.parentPartId).toBe(body.id);
    const bumper = createPart(doc, tax, { taxonomyId: 'bumper', position: 'F', parentPartId: body.id });
    const geometries = [
      { partId: bumper.id, mesh: boxShell(0.8, -2.3, -2.0, 0.2, 0.6, 3) },
      { partId: body.id, mesh: boxShell(0.8, -2, 2, 0.2, 1.4, 8) },
      { partId: hood.id, mesh: boxShell(0.7, -2, -0.8, 1.35, 1.45, 4) },
    ];
    const { reports, skipped } = generateStructure(doc, tax, geometries);
    expect(skipped).toEqual([]);
    expect(reports[0]!.partId).toBe(body.id); // parents first
    expect(new Set(reports.map((r) => r.partId))).toEqual(new Set([body.id, hood.id, bumper.id]));
    const hoodReport = reports.find((r) => r.partId === hood.id)!;
    const bodyReport = reports[0]!;
    expect(bodyReport.mirrored).toBe(true);
    expect(bodyReport.vertices).toBeGreaterThanOrEqual(kindDefaults(tax.entry('body')!).budget[0] * 0.5);
    expect(bodyReport.vertices).toBeLessThanOrEqual(targetVertices(kindDefaults(tax.entry('body')!).budget, 0.5) * 1.6);
    // Every node id is unique vehicle-wide, and every beam/triangle references existing nodes.
    const ids = new Set(doc.nodes.map((n) => n.id));
    expect(ids.size).toBe(doc.nodes.length);
    for (const b of doc.beams) expect(ids.has(b.id1) && ids.has(b.id2), `${b.id1}-${b.id2}`).toBe(true);
    for (const t of doc.tris) for (const id of t.ids) expect(ids.has(id)).toBe(true);
    // Hood opens: held shut by temporary bolts until hinges (Phase 9), and a warning says so. Bumper attaches with breakable bolts.
    expect(doc.beams.some((b) => b.partId === hood.id && b.kind === 'attach')).toBe(true);
    expect(hoodReport.warnings.join()).toMatch(/temporary breakable bolts/);
    expect(doc.beams.filter((b) => b.partId === bumper.id && b.kind === 'attach').length).toBeGreaterThan(5);
    expect(doc.proxy.refNodes).not.toBeNull();
    // Masses come from taxonomy defaults × material.
    expect(structureTotals(doc).massKg).toBeGreaterThan(100);

    // Regenerating only the body re-attaches the (unchanged) bumper to the new body nodes.
    const bumperNodes = doc.nodes.filter((n) => n.partId === bumper.id).length;
    doc.proxy.parts[body.id] = { ...doc.proxy.parts[body.id]!, detail: 1 };
    generateStructure(doc, tax, [geometries[1]!]);
    const ids2 = new Set(doc.nodes.map((n) => n.id));
    expect(doc.nodes.filter((n) => n.partId === bumper.id)).toHaveLength(bumperNodes);
    for (const b of doc.beams) expect(ids2.has(b.id1) && ids2.has(b.id2)).toBe(true);
    expect(doc.beams.filter((b) => b.partId === bumper.id && b.kind === 'attach').length).toBeGreaterThan(5);

    removePartStructure(doc, bumper.id);
    expect(doc.nodes.some((n) => n.partId === bumper.id)).toBe(false);
  });

  it('leaves suspension-built and riding parts without own nodes, unless overridden', () => {
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const tire = createPart(doc, tax, { taxonomyId: 'tire', position: 'FL' });
    const arm = createPart(doc, tax, { taxonomyId: 'lower_arm', position: 'FL' });
    const badge = createPart(doc, tax, { taxonomyId: 'badge', position: 'R' });
    const shell = boxShell(0.1, -0.3, 0.3, 0, 0.6, 2);
    const r = generateStructure(doc, tax, [tire, arm, badge].map((p) => ({ partId: p.id, mesh: shell })));
    expect(r.notProxies).toEqual([
      { partId: tire.id, role: 'suspension' },
      { partId: arm.id, role: 'suspension' },
      { partId: badge.id, role: 'rides' },
    ]);
    expect(doc.nodes).toEqual([]);
    doc.proxy.parts[badge.id] = { ...defaultProxySettings(tax.entry('badge')!), role: 'own', massKg: 2 };
    generateStructure(doc, tax, [{ partId: badge.id, mesh: shell }]);
    expect(doc.nodes.length).toBeGreaterThan(0);
  });

  it('attaches only to parent node names every parent variant has (swap-safe)', () => {
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const n = (id: string, partId: string): StructNode => ({ id, partId, pos: [0, 0, 0], weight: 1 });
    const base = createPart(doc, tax, { taxonomyId: 'bumper', position: 'F', id: 'base' });
    const race = createPart(doc, tax, { taxonomyId: 'bumper', position: 'F', variant: 'race', variantOf: 'base', id: 'race' });
    doc.nodes.push(...['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => n(id, base.id)), ...['a1', 'a2', 'a3', 'a9'].map((id) => n(id, race.id)));
    expect(swapSafeParentNodes(doc, base.id).map((x) => x.id)).toEqual(['a1', 'a2', 'a3']);
    expect(swapSafeParentNodes(doc, race.id).map((x) => x.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('caps the node count by mass so nodes stay ≥ 0.1 kg', () => {
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const lip = createPart(doc, tax, { taxonomyId: 'lip', position: 'F' });
    doc.proxy.parts[lip.id] = { ...defaultProxySettings(tax.entry('lip')!), massKg: 0.8, symmetry: false };
    generateStructure(doc, tax, [{ partId: lip.id, mesh: boxShell(0.8, -2.3, -2.1, 0.1, 0.2, 6) }]);
    expect(doc.nodes.length).toBeLessThanOrEqual(12);
    expect(Math.min(...doc.nodes.map((n) => n.weight))).toBeGreaterThanOrEqual(0.06);
  });
});

describe('empty proxy fallback', () => {
  it('fits a box when decimation cleans a sliver-thin part down to nothing', async () => {
    await meshoptReady;
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const flare = createPart(doc, tax, { taxonomyId: 'fender_flare', position: 'RR' });
    // A long, paper-thin strip of slivers: every triangle fails the sliver test.
    const p: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < 40; i++) {
      const b = p.length / 3;
      p.push(-0.8, 1 + i * 0.05, 0.5, -0.8, 1 + i * 0.05 + 0.05, 0.5, -0.8, 1 + i * 0.05 + 0.025, 0.5 + 1e-6);
      idx.push(b, b + 1, b + 2);
    }
    const r = generateStructure(doc, tax, [{ partId: flare.id, mesh: { positions: new Float32Array(p), index: new Uint32Array(idx) } }]);
    expect(doc.nodes.filter((n) => n.partId === flare.id).length).toBeGreaterThanOrEqual(4);
    expect(r.reports[0]!.warnings.join()).toMatch(/box was fitted/);
  });
});
