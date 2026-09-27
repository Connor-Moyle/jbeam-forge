import { beforeAll, describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { createPart } from '../../src/shared/parts/ops';
import type { ProxyMesh } from '../../src/shared/proxy/mesh';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import { generateStructure } from '../../src/shared/proxy/generate';
import { buildJbeamFiles } from '../../src/shared/export/jbeam';
import { parseJbeam } from '../../src/shared/jbeam/parse';
import { guessHinge, limiterBound, rotateAbout } from '../../src/shared/hinges/geometry';
import { HINGE_DEFAULTS, hingeAction, HingeSchema, type Hinge } from '../../src/shared/hinges/schema';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

/** Closed box shell (x∈[x0,x1], y∈[y0,y1], z∈[z0,z1]), n×n per face. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, n = 3): ProxyMesh {
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
  const W = x1 - x0;
  const L = y1 - y0;
  const H = z1 - z0;
  face([x0, y0, z0], [0, L, 0], [W, 0, 0]);
  face([x0, y0, z1], [W, 0, 0], [0, L, 0]);
  face([x0, y0, z0], [W, 0, 0], [0, 0, H]);
  face([x0, y1, z0], [0, 0, H], [W, 0, 0]);
  face([x0, y0, z0], [0, 0, H], [0, L, 0]);
  face([x1, y0, z0], [0, L, 0], [0, 0, H]);
  return { positions: new Float32Array(p), index: new Uint32Array(idx) };
}

beforeAll(async () => {
  await meshoptReady;
});

describe('hinge geometry', () => {
  it('rotates about a line (right-hand rule)', () => {
    const p = rotateAbout([1, 0, 0], [0, 0, 0], [0, 0, 1], 90);
    expect(p.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, 0]);
  });

  it('sizes the limiter bound from the opening angle', () => {
    // Far edge 1 m from a vertical axis, anchored on the axis: length never changes → minimal bound.
    expect(limiterBound([0, 1, 0], [0, 0, 0], [[0, 0, 0], [0, 0, 1]], 70)).toBeCloseTo(0.01);
    // Anchored 0.2 m behind the axis on the same side: opening stretches it.
    const b = limiterBound([0, 1, 0], [0, 0.2, 0], [[0, 0, 0], [0, 0, 1]], 70);
    expect(b).toBeGreaterThan(0.1);
  });

  it('guesses a left front door: hinge on its front edge, swinging outwards, latch at the back', () => {
    const door = [[0.9, -1, 0.3], [0.9, -1, 0.8], [0.9, 0, 0.3], [0.9, 0, 0.8], [0.9, -0.5, 0.55], [0.85, -0.9, 1.2], [0.85, -0.1, 1.2]] as [number, number, number][];
    const body = [[0, 0, 0.5], [0.8, -1, 0.5], [-0.8, 0, 0.5]] as [number, number, number][];
    const g = guessHinge('door', door, body);
    expect(g.axis[0][1]).toBe(-1);
    expect(g.axis[1][1]).toBe(-1);
    expect(g.axis[1][2]).toBeGreaterThan(g.axis[0][2]); // bottom → top
    expect(g.latch?.[1]).toBe(0);
    // Opening moves the rear edge outwards (+X on the left).
    const opened = rotateAbout([0.9, 0, 0.55], g.axis[0], g.axis[1], 30 * g.direction);
    expect(opened[0]).toBeGreaterThan(0.9);
    expect(g.handles.map((h) => h.inside)).toEqual([false, true]);
  });

  it('maps parts to the game’s own input actions', () => {
    expect(hingeAction('door', 'FL')).toEqual({ action: 'door_FL', coupler: 'door_FL_coupler' });
    expect(hingeAction('trunk', null)).toEqual({ action: 'trunk', coupler: 'trunkCoupler' });
    expect(hingeAction('hood', null).action).toBe('hoodRelease');
  });
});

describe('hinged parts in generation and export', () => {
  function carWithDoor(hinged: boolean) {
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const body = createPart(doc, tax, { taxonomyId: 'body' });
    const door = createPart(doc, tax, { taxonomyId: 'door', position: 'FL', parentPartId: body.id });
    const geometries = [
      { partId: body.id, mesh: box(-0.85, 0.85, -2, 2, 0.2, 1.4, 6) },
      { partId: door.id, mesh: box(0.86, 0.92, -1, 0, 0.3, 1.0, 3) },
    ];
    generateStructure(doc, tax, geometries);
    if (hinged) {
      const partNodes = doc.nodes.filter((n) => n.partId === door.id).map((n) => n.pos);
      const g = guessHinge('door', partNodes, doc.nodes.filter((n) => n.partId === body.id).map((n) => n.pos));
      const hinge: Hinge = HingeSchema.parse({ id: 'h1', partId: door.id, ...g, openAngle: 70, action: 'door_FL', ...HINGE_DEFAULTS });
      doc.hinges.push(hinge);
      generateStructure(doc, tax, geometries); // regenerating builds the hinge in
    }
    return { doc, door };
  }

  it('swaps the temporary bolts for a hinge, limiter, latch and seals', () => {
    const { doc, door } = carWithDoor(true);
    const kinds = new Set(doc.beams.filter((b) => b.partId === door.id).map((b) => b.kind));
    expect(kinds.has('attach')).toBe(false);
    for (const k of ['hinge', 'mount', 'limit']) expect(kinds.has(k as never), k).toBe(true);
    const ids = new Set(doc.nodes.map((n) => n.id));
    expect(ids.size).toBe(doc.nodes.length);
    for (const b of doc.beams) expect(ids.has(b.id1) && ids.has(b.id2), `${b.id1}-${b.id2}`).toBe(true);
    // Only the hinge nodes tie the door to the body (plus the latch in game), so it can swing.
    const bodyIds = new Set(doc.nodes.filter((n) => n.partId !== door.id).map((n) => n.id));
    const doorIds = new Set(doc.nodes.filter((n) => n.partId === door.id).map((n) => n.id));
    const rigidToBody = doc.beams.filter((b) => b.partId === door.id && b.kind !== 'support' && b.kind !== 'limit' && b.kind !== 'popopen' && (bodyIds.has(b.id1) || bodyIds.has(b.id2)));
    for (const b of rigidToBody) {
      const doorEnd = doorIds.has(b.id1) ? b.id1 : b.id2;
      expect(/h1$|h2$|lb$/.test(doorEnd), `${b.kind} ${b.id1}-${b.id2}`).toBe(true);
    }
  });

  it('exports the stock door wiring: coupler controller, bounded limiter, supports, triggers and action', () => {
    const { doc, door } = carWithDoor(true);
    const file = buildJbeamFiles(doc, tax, { meshNames: new Map(), author: 'me' }).find((f) => f.part === door.name)!;
    const json = parseJbeam(file.text).value as Record<string, Record<string, unknown>>;
    const partJson = json[door.name]!;
    expect(partJson.controller).toEqual([['fileName'], ['advancedCouplerControl', { name: 'door_FL_coupler' }]]);
    const coupler = partJson.door_FL_coupler as { couplerNodes: unknown[][]; groupType: string };
    expect(coupler.groupType).toBe('autoCoupling');
    expect(coupler.couplerNodes[1]![2]).toBe(35_000);
    expect(partJson.actionsEnabled).toEqual([['id'], ['door_FL']]);
    expect((partJson.triggerEventLinks2 as unknown[][]).slice(1)).toEqual([
      ['door_FL', 'action0', 'door_FL'],
      ['door_FL_int', 'action0', 'door_FL'],
    ]);
    expect(file.text).toContain('"beamType":"|BOUNDED"');
    expect(file.text).toContain('"beamType":"|SUPPORT"');
    expect(file.text).toMatch(/"beamLongBound":\d/);
  });

  it('an unhinged door keeps its temporary bolts and no controller', () => {
    const { doc, door } = carWithDoor(false);
    expect(doc.beams.some((b) => b.partId === door.id && b.kind === 'attach')).toBe(true);
    const file = buildJbeamFiles(doc, tax, { meshNames: new Map(), author: 'me' }).find((f) => f.part === door.name)!;
    expect(file.text).not.toContain('advancedCouplerControl');
  });
});
