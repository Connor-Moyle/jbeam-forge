import { beforeAll, describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { createPart } from '../../src/shared/parts/ops';
import type { ProxyMesh } from '../../src/shared/proxy/mesh';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import { generateStructure } from '../../src/shared/proxy/generate';
import { buildSimModel } from '../../src/shared/sim/model';
import { suspensionDrop } from '../../src/shared/sim/scenarios';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

/** Closed box shell, n×n per face. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, n = 4): ProxyMesh {
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
  const [W, L, H] = [x1 - x0, y1 - y0, z1 - z0];
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

describe('suspension drop', () => {
  const car = () => {
    const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
    const body = createPart(doc, tax, { taxonomyId: 'body' });
    generateStructure(doc, tax, [{ partId: body.id, mesh: box(-0.85, 0.85, -2.1, 2.1, 0.25, 1.4, 6) }]);
    return buildSimModel(doc, tax);
  };
  const axles = [
    { name: 'Front', y: -1.4, track: 1.5 },
    { name: 'Rear', y: 1.3, track: 1.5 },
  ];

  it('lands on its wheels, settles about a static sag down and reports each axle', () => {
    const r = suspensionDrop(car(), axles);
    expect(r.diverged).toBeNull();
    expect(r.summary[0]).toMatch(/within \d+ cm of the ground/);
    const sags = [...r.summary[1]!.matchAll(/settles ([\d.]+) cm down/g)].map((m) => Number(m[1]));
    expect(sags).toHaveLength(2);
    // ~1.5 Hz ride: static sag g/ω² ≈ 11 cm.
    for (const s of sags) {
      expect(s).toBeGreaterThan(5);
      expect(s).toBeLessThan(20);
    }
    expect(r.summary.join(' ')).toMatch(/Stopped bouncing after/);
    expect(r.positions.length).toBe(car().pos.length);
  });

  it('bottoms out on springs far too soft', () => {
    const soft = axles.map((a) => ({ ...a, spring: 2000, damp: 100 }));
    expect(suspensionDrop(car(), soft).summary[0]).toMatch(/bottoms out/);
  });

  it('says which end sits low', () => {
    // Stiffer rear springs: the front sags more.
    const r = suspensionDrop(car(), [axles[0]!, { ...axles[1]!, spring: 12000 }]);
    expect(r.summary.join(' ')).toMatch(/nose down by [\d.]+°: the front carries more weight/);
  });

  it('asks for axles when there are none', () => {
    expect(suspensionDrop(car(), []).summary[0]).toMatch(/Add axles/);
  });
});
