import { describe, expect, it } from 'vitest';
import { carBox, DEFAULT_SKIN_OPTIONS, planSkinLayout, projectPoint, skinStats, skinUvs, skinViews, triangleNeighbours, triangleShade, type SkinLayout, type SkinView } from '@shared/uv/skinUnwrap';
import { projectUvs } from '@shared/mesh/meshEdit';
import { demoCarPieces } from '@shared/tutorial/demoCar';
import { buildTemplate, partColor, templateSvg } from '@shared/uv/skinTemplate';

type V3 = [number, number, number];

/** A quad (a, b, c, d counter-clockwise from outside) as two triangles, split into n×n cells. */
function quad(a: V3, b: V3, c: V3, d: V3, n = 4): number[] {
  const lerp = (p: V3, q: V3, t: number): V3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const at = (i: number, j: number) => lerp(lerp(a, b, i / n), lerp(d, c, i / n), j / n);
  const out: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p = at(i, j);
      const q = at(i + 1, j);
      const r = at(i + 1, j + 1);
      const s = at(i, j + 1);
      out.push(...p, ...q, ...r, ...p, ...r, ...s);
    }
  return out;
}

// A box car: 1.8 wide (x), 4.5 long (y, front at −2.25), 1.3 tall (z from 0.2). +X is the left.
const [x0, x1, y0, y1, z0, z1] = [-0.9, 0.9, -2.25, 2.25, 0.2, 1.5];
const leftSide = quad([x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]);
const rightSide = quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]);
// Wound inwards (faces down), like a flipped face in a real model: still the roof, by where it is.
const roof = quad([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]);
const nose = quad([x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]);
const tail = quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
const car = [leftSide, rightSide, roof, nose, tail];
const box = carBox(car)!;

const inRect = (uv: [number, number], r: readonly number[]) => uv[0] >= r[0]! - 1e-6 && uv[0] <= r[0]! + r[2]! + 1e-6 && uv[1] >= r[1]! - 1e-6 && uv[1] <= r[1]! + r[3]! + 1e-6;
const only = (views: SkinView[]) => [...new Set(views)];

describe('skin layout', () => {
  const L = planSkinLayout(box);

  it('puts every view on the sheet, apart, at one scale', () => {
    const rects = [L.rects.left, L.rects.top, L.rects.right, L.rects.front, L.rects.rear, L.rects.bottom!];
    for (const r of rects) {
      expect(r[0]).toBeGreaterThanOrEqual(0);
      expect(r[1]).toBeGreaterThanOrEqual(0);
      expect(r[0] + r[2]).toBeLessThanOrEqual(1 + 1e-9);
      expect(r[1] + r[3]).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i]!, rects[j]!];
        const apart = a[0] + a[2] <= b[0] + 1e-9 || b[0] + b[2] <= a[0] + 1e-9 || a[1] + a[3] <= b[1] + 1e-9 || b[1] + b[3] <= a[1] + 1e-9;
        expect(apart).toBe(true);
      }
    // The side band is the car's length × height at the shared scale.
    expect(L.rects.left[2]).toBeCloseTo(4.5 * L.scale, 9);
    expect(L.rects.left[3]).toBeCloseTo(1.3 * L.scale, 9);
    expect(L.rects.top[3]).toBeCloseTo(1.8 * L.scale, 9);
    // Bands top to bottom: left side, top, right side, then the ends.
    expect(L.rects.left[1]).toBeGreaterThan(L.rects.top[1]);
    expect(L.rects.top[1]).toBeGreaterThan(L.rects.right[1]);
    expect(L.rects.right[1]).toBeGreaterThan(L.rects.front[1]);
  });

  it('shares one band for both sides when asked, and adds an underside band', () => {
    const both = planSkinLayout(box, { ...DEFAULT_SKIN_OPTIONS, bothSides: true });
    expect(both.rects.right).toEqual(both.rects.left);
    expect(both.scale).toBeGreaterThan(L.scale); // one band fewer: everything gets bigger
    const under = planSkinLayout(box, { ...DEFAULT_SKIN_OPTIONS, bottom: true });
    expect(under.rects.bottom).toBeDefined();
    expect(under.bottomScale).toBeUndefined();
  });

  it('puts the undersides small beside the ends, out of the painted views', () => {
    const r = L.rects.bottom!;
    expect(r).toBeDefined();
    expect(L.bottomScale!).toBeLessThan(L.scale);
    expect(r[0]).toBeGreaterThanOrEqual(L.rects.rear[0] + L.rects.rear[2]);
    expect(r[0] + r[2]).toBeLessThanOrEqual(1);
    const floor = quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    const { uv, views } = skinUvs(floor, L);
    expect(only(views)).toEqual(['bottom']);
    for (let i = 0; i < uv.length; i += 2) expect(inRect([uv[i]!, uv[i + 1]!], r)).toBe(true);
  });
});

describe('skin unwrap', () => {
  const L = planSkinLayout(box);

  it('sees each face of the car from its own side, inside that view’s area', () => {
    const expected: [number[], SkinView][] = [
      [leftSide, 'left'],
      [rightSide, 'right'],
      [roof, 'top'],
      [nose, 'front'],
      [tail, 'rear'],
    ];
    for (const [pos, view] of expected) {
      const { uv, views } = skinUvs(pos, L);
      expect(only(views)).toEqual([view]);
      for (let i = 0; i < uv.length; i += 2) expect(inRect([uv[i]!, uv[i + 1]!], L.rects[view]!)).toBe(true);
    }
  });

  it('reads each side from outside: the front at the left of the left view, at the right of the right view', () => {
    const frontLeft = projectPoint([x1, y0, 1], 'left', L);
    const rearLeft = projectPoint([x1, y1, 1], 'left', L);
    expect(frontLeft[0]).toBeLessThan(rearLeft[0]);
    const frontRight = projectPoint([x0, y0, 1], 'right', L);
    const rearRight = projectPoint([x0, y1, 1], 'right', L);
    expect(frontRight[0]).toBeGreaterThan(rearRight[0]);
    // Up is up.
    expect(projectPoint([x1, 0, z1], 'left', L)[1]).toBeGreaterThan(projectPoint([x1, 0, z0], 'left', L)[1]);
  });

  it('keeps the same scale in every view, so stripes line up', () => {
    const a = projectPoint([x1, -1, 1], 'left', L);
    const b = projectPoint([x1, 1, 1], 'left', L);
    const c = projectPoint([0, -1, z1], 'top', L);
    const d = projectPoint([0, 1, z1], 'top', L);
    expect(b[0] - a[0]).toBeCloseTo(d[0] - c[0], 9);
    // And the same length along the car lands at the same u in both views.
    expect(a[0]).toBeCloseTo(c[0], 9);
  });

  it('puts the inside of a left door on the left, under its outside', () => {
    // The door's inner skin faces into the car (normal −X) but is on the left.
    const inner = quad([0.85, y0 + 1, z0], [0.85, y0 + 2, z0], [0.85, y0 + 2, z1 - 0.3], [0.85, y0 + 1, z1 - 0.3]);
    expect(only(skinViews(inner, L))).toEqual(['left']);
  });

  it('keeps a panel on the side/top boundary from breaking into specks', () => {
    // A shoulder line sloped where the side and top views score about the same, with a little
    // shape noise (shared grid points, so the triangles stay joined): alone, neighbours flip.
    const n = 12;
    const k = (1.3 / 1.1) * 0.98; // rise per step out, just on the side's side of the boundary
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const grid: V3[][] = [];
    for (let i = 0; i <= n; i++) {
      grid.push([]);
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        grid[i]!.push([0.9 - t * 0.3 + noise(), y0 + (i / n) * 4, 1.2 + t * 0.3 * k + noise()]);
      }
    }
    const pos: number[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const [a, b, c, d] = [grid[i]![j]!, grid[i + 1]![j]!, grid[i + 1]![j + 1]!, grid[i]![j + 1]!];
        pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    const specks = (views: SkinView[]) => {
      const nb = triangleNeighbours(pos);
      return views.filter((v, t) => nb[t]!.length >= 2 && nb[t]!.every((o) => views[o] !== v)).length;
    };
    const raw = skinViews(pos, { ...L, smoothing: 0 });
    expect(new Set(raw).size).toBeGreaterThan(1); // the noise does flip some
    const smooth = skinViews(pos, L);
    expect(specks(smooth)).toBeLessThan(specks(raw));
    expect(specks(smooth)).toBe(0);
  });

  it('mirrors the right side onto the left band with one design for both sides', () => {
    const both: SkinLayout = planSkinLayout(box, { ...DEFAULT_SKIN_OPTIONS, bothSides: true });
    const l = projectPoint([x1, -1, 1], 'left', both);
    const r = projectPoint([x0, -1, 1], 'right', both);
    expect(r[0]).toBeCloseTo(l[0], 9);
    expect(r[1]).toBeCloseTo(l[1], 9);
  });

  it('is what a mesh gets when its texture coordinates are set to the skin layout', () => {
    expect(Array.from(projectUvs(leftSide, { kind: 'skin', size: 1, layout: L }))).toEqual(Array.from(skinUvs(leftSide, L).uv));
  });
});

describe('skin unwrap on the practice car', () => {
  // Loader space (+Y up, facing +Z, +X left) → BeamNG (+Z up, facing −Y).
  const pieces = demoCarPieces().filter((p) => !/wheel|tyre|tire|seat|glass|window|light|interior|dash/i.test(p.name));
  const meshes = pieces.map((p) => p.tris.flatMap((t) => t.flatMap(([x, y, z]) => [x, -z, y])));
  const L = planSkinLayout(carBox(meshes)!);

  it('lays every panel on the sheet, sides on the sides, with little stretching', () => {
    let sides = 0;
    let total = 0;
    let stretchedArea = 0;
    for (const pos of meshes) {
      const { uv, views } = skinUvs(pos, L);
      for (const v of uv) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      const st = skinStats(pos, views);
      sides += st.perView.left + st.perView.right;
      total += st.triangles;
      stretchedArea += st.stretched;
    }
    expect(total).toBeGreaterThan(0);
    expect(sides / total).toBeGreaterThan(0.3);
    expect(stretchedArea / meshes.length).toBeLessThan(0.35);
  });
});

describe('skin template', () => {
  const L = planSkinLayout(box);
  const pieces = [
    { part: 'Body shell', color: partColor(0), ...skinUvs(leftSide, L) },
    { part: 'Roof', color: partColor(1), ...skinUvs(roof, L) },
    { part: 'Front bumper', color: partColor(2), ...skinUvs(nose, L) },
  ];
  const d = buildTemplate(L, pieces, 2048);

  it('fills every triangle with one winding, so faces lying on each other add up', () => {
    for (const f of d.fills)
      for (let i = 0; i + 5 < f.tris.length; i += 6) {
        const t = f.tris;
        expect((t[i + 2]! - t[i]!) * (t[i + 5]! - t[i + 1]!) - (t[i + 4]! - t[i]!) * (t[i + 3]! - t[i + 1]!)).toBeGreaterThanOrEqual(0);
      }
  });

  it('outlines each panel, names it on the sheet and titles the views', () => {
    expect(d.outlines.length).toBeGreaterThan(0);
    expect(d.labels.map((l) => l.text)).toEqual(expect.arrayContaining(['Body shell', 'Roof']));
    for (const l of d.labels) {
      expect(l.x).toBeGreaterThan(0);
      expect(l.x).toBeLessThan(2048);
    }
    expect(d.frames.map((f) => f.view)).toEqual(['left', 'top', 'right', 'front', 'rear', 'bottom']);
    expect(d.scaleBar.w).toBeCloseTo(L.scale * 2048, 6);
  });

  it('shades panels turning from the light on a layer of its own, when asked', () => {
    expect(d.shading).toEqual([]);
    const sideLight = triangleShade(leftSide)[0]!;
    const roofLight = triangleShade(roof)[0]!;
    expect(roofLight).toBeGreaterThan(sideLight); // the light is from above
    const shaded = buildTemplate(L, pieces.map((p, i) => ({ ...p, shade: triangleShade([leftSide, roof, nose][i]!) })), 1024, { shading: true });
    expect(shaded.shading.length).toBeGreaterThan(0);
    expect(templateSvg(shaded, 'x')).toContain('id="shading" inkscape:groupmode="layer"');
    expect(templateSvg(d, 'x')).not.toContain('id="shading"');
  });

  it('writes a layered SVG with a path per part', () => {
    const svg = templateSvg(d, 'Test & car');
    expect(svg).toContain('<title>Test &amp; car</title>');
    for (const layer of ['panels', 'outlines', 'labels', 'guides']) expect(svg).toContain(`id="${layer}" inkscape:groupmode="layer"`);
    expect(svg).toContain('data-part="Body shell"');
    expect(svg).toContain('Left side');
  });
});
