import { beforeAll, describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { assignMeshes, createPart, duplicateAsVariant } from '../../src/shared/parts/ops';
import type { Project } from '../../src/shared/project/schema';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import type { ProxyMesh } from '../../src/shared/proxy/mesh';
import { generateStructure } from '../../src/shared/proxy/generate';
import { buildJbeamFiles, flexGroupOf } from '../../src/shared/export/jbeam';
import { defaultConfig, exportMeshNames, infoJson, materialsJson } from '../../src/shared/export/files';
import { configFileName, configInfoJson, includedParts, resolveConfig, slotChoices } from '../../src/shared/export/configs';
import { validateExport } from '../../src/shared/export/validate';
import { parseJbeam, isJbeamObject, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';

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

/** A small car: body, hood (opens), front bumper + race variant, a badge riding on the body. */
function carProject(): { doc: Project; meshes: { key: string; name: string; sourceId: string }[] } {
  const doc = createEmptyProject({ name: 'Test Car', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  const body = createPart(doc, tax, { taxonomyId: 'body', id: 'p_body' });
  const hood = createPart(doc, tax, { taxonomyId: 'hood', id: 'p_hood' });
  const bumper = createPart(doc, tax, { taxonomyId: 'bumper', position: 'F', id: 'p_bumper', parentPartId: body.id });
  const race = duplicateAsVariant(doc, tax, bumper.id, 'race')!;
  race.id = 'p_bumper_race';
  const badge = createPart(doc, tax, { taxonomyId: 'badge', position: 'R', id: 'p_badge', parentPartId: body.id });
  const meshes = [
    { key: 's:sunburst2_body_main', name: 'sunburst2_body_main', sourceId: 's' },
    { key: 's:sunburst2_hood', name: 'sunburst2_hood', sourceId: 's' },
    { key: 's:sunburst2_bumper_F', name: 'sunburst2_bumper_F', sourceId: 's' },
    { key: 's:sunburst2_bumper_race_F', name: 'sunburst2_bumper_race_F', sourceId: 's' },
    { key: 's:sunburst2_lettering_RS', name: 'sunburst2_lettering_RS', sourceId: 's' },
    { key: 's:loose', name: 'loose bits', sourceId: 's' },
  ];
  assignMeshes(doc, ['s:sunburst2_body_main'], body.id);
  assignMeshes(doc, ['s:sunburst2_hood'], hood.id);
  assignMeshes(doc, ['s:sunburst2_bumper_F'], bumper.id);
  assignMeshes(doc, ['s:sunburst2_bumper_race_F'], race.id);
  assignMeshes(doc, ['s:sunburst2_lettering_RS'], badge.id);
  generateStructure(doc, tax, [
    { partId: body.id, mesh: box(0.8, -2, 2, 0.2, 1.4, 6) },
    { partId: hood.id, mesh: box(0.7, -2, -0.8, 1.42, 1.5, 3) },
    { partId: bumper.id, mesh: box(0.8, -2.3, -2.02, 0.2, 0.6, 3) },
    { partId: race.id, mesh: box(0.85, -2.4, -2.02, 0.15, 0.6, 3) },
    { partId: badge.id, mesh: box(0.1, 2.0, 2.02, 0.8, 0.9, 1) },
  ]);
  return { doc, meshes };
}

beforeAll(async () => {
  await meshoptReady;
});

function parsePart(text: string): [string, JbeamObject] {
  const v = parseJbeam(text).value;
  if (!isJbeamObject(v)) throw new Error('not an object');
  const [name, part] = Object.entries(v)[0]!;
  return [name, part as JbeamObject];
}

describe('jbeam export', () => {
  it('writes a main part plus one file per part, all re-parseable', () => {
    const { doc, meshes } = carProject();
    const names = exportMeshNames(doc, meshes);
    const files = buildJbeamFiles(doc, tax, { meshNames: names, author: 'Fatkiwi' });
    expect(files.map((f) => f.file).sort()).toEqual(['test.jbeam', 'test_badge_R.jbeam', 'test_body.jbeam', 'test_bumper_F.jbeam', 'test_bumper_F_race.jbeam', 'test_hood.jbeam']);
    const [mainName, main] = parsePart(files.find((f) => f.file === 'test.jbeam')!.text);
    expect(mainName).toBe('test');
    expect(main.slotType).toBe('main');
    const mainSlots = readTable(main.slots2!).records;
    const bodySlot = mainSlots.find((r) => r.values.name === 'test_body')!;
    expect(bodySlot.values.default).toBe('test_body');
    expect(bodySlot.inlineOptions).toEqual({ coreSlot: true });
  });

  it('writes settings adjustable in game as variables the part nodes and beams use', () => {
    const { doc, meshes } = carProject();
    doc.variables = [
      { id: 'v1', partId: 'p_body', setting: 'mass', min: 0.5, max: 1.5, default: 1 },
      { id: 'v2', partId: 'p_body', setting: 'stiffness', min: 0.8, max: 1.2, default: 1 },
    ];
    const names = exportMeshNames(doc, meshes);
    const body = new Map(buildJbeamFiles(doc, tax, { meshNames: names, author: 'x' }).map((f) => [f.part, parsePart(f.text)[1]])).get('test_body')!;
    const vars = readTable(body.variables!).records;
    expect(vars.map((r) => [r.values.name, r.values.min, r.values.max, r.values.default])).toEqual([
      ['$test_body_mass', 0.5, 1.5, 1],
      ['$test_body_stiffness', 0.8, 1.2, 1],
    ]);
    const nodes = readTable(body.nodes!).records;
    expect(nodes.every((r) => typeof r.options.nodeWeight === 'string' && /^\$=[\d.]+\*\$test_body_mass$/.test(r.options.nodeWeight))).toBe(true);
    const beams = readTable(body.beams!).records;
    expect(beams.some((r) => typeof r.options.beamSpring === 'string' && String(r.options.beamSpring).endsWith('*$test_body_stiffness'))).toBe(true);
  });

  it('makes glass shatter: its beams trigger the damaged material on its flexbodies', () => {
    const { doc, meshes } = carProject();
    const glass = createPart(doc, tax, { taxonomyId: 'windshield', id: 'p_ws', parentPartId: 'p_body' });
    assignMeshes(doc, ['s:ws'], glass.id);
    generateStructure(doc, tax, [{ partId: glass.id, mesh: box(0.7, -0.8, -0.3, 1.2, 1.4, 3) }]);
    const names = exportMeshNames(doc, [...meshes, { key: 's:ws', name: 'windshield_glass', sourceId: 's' }]);
    const wsMesh = names.get('s:ws')!;
    const files = new Map(buildJbeamFiles(doc, tax, { meshNames: names, author: 'x', meshMaterials: new Map([[wsMesh, ['test_glass']]]) }).map((f) => [f.part, parsePart(f.text)[1]]));
    const ws = [...files.values()].find((p) => p.flexbodies && readTable(p.flexbodies).records.some((r) => r.values.mesh === wsMesh))!;
    const flex = readTable(ws.flexbodies!).records.find((r) => r.values.mesh === wsMesh)!;
    expect(flex.options).toMatchObject({ deformMaterialBase: 'test_glass', deformMaterialDamaged: 'test_glass_dmg' });
    expect(flex.options.deformGroup).toEqual(expect.stringMatching(/_break$/));
    const beams = readTable(ws.beams!).records;
    expect(beams.some((r) => r.options.deformGroup === flex.options.deformGroup && r.options.deformationTriggerRatio === 0.02)).toBe(true);
  });

  it('writes licence plates, a tow hitch and paint designs the way the stock cars do', () => {
    const { doc, meshes } = carProject();
    doc.features = {
      plates: { front: { partId: 'p_bumper', pos: [0, -2.31, 0.4], tilt: 5 }, rear: { partId: 'gone', pos: [0, 2.02, 0.6], tilt: 0 } },
      hitch: { partId: 'p_body', pos: [0, 2.1, 0.35] },
      nitrous: { partId: 'p_body', pos: [0, 1.5, 0.5], bottle: '10lb', shotKw: 100 },
      skins: [{ id: 'k1', name: 'Race Stripes', overrides: {} }],
    };
    const files = new Map(buildJbeamFiles(doc, tax, { meshNames: exportMeshNames(doc, meshes), author: 'x' }).map((f) => [f.part, parsePart(f.text)[1]]));
    // Nitrous needs an engine; there's none fitted.
    expect([...files.keys()].filter((k) => /plate|hitch|n2o|skin/.test(k)).sort()).toEqual(['test_licenseplate_F', 'test_licenseplate_R', 'test_skin_race_stripes', 'test_towhitch']);
    const slotNames = (part: string) => readTable(files.get(part)!.slots2!).records.map((r) => r.values.name);
    // The front plate hangs on the bumper's slot (both variants); the rear's mount is gone, so it goes on the body.
    expect(slotNames('test_bumper_F')).toContain('test_licenseplate_F');
    expect(slotNames('test_bumper_F_race')).toContain('test_licenseplate_F');
    expect(slotNames('test_body')).toEqual(expect.arrayContaining(['test_licenseplate_R', 'test_towhitch']));
    expect(slotNames('test')).toEqual(expect.arrayContaining(['paint_design', 'skin_glass', 'licenseplate_design_2_1']));
    const front = readTable(files.get('test_licenseplate_F')!.flexbodies!).records[0]!;
    expect(front.values.mesh).toBe('licenseplate');
    expect(front.values['[group]:']).toEqual(['test_bumper_F']);
    expect(front.inlineOptions).toMatchObject({ pos: { x: 0, y: -2.31, z: 0.4 }, rot: { x: 5, y: 0, z: 0 } });
    expect(readTable(files.get('test_licenseplate_R')!.flexbodies!).records[0]!.inlineOptions).toMatchObject({ rot: { z: 180 } });
    const hitch = files.get('test_towhitch')!;
    const node = readTable(hitch.nodes!).records[0]!;
    expect(node.options).toMatchObject({ couplerTag: 'tow_hitch' });
    const bodyIds = new Set(doc.nodes.filter((n) => n.partId === 'p_body').map((n) => n.id));
    const anchors = readTable(hitch.beams!).records.map((r) => r.values['id2:']);
    expect(anchors).toHaveLength(6);
    expect(anchors.every((id) => bodyIds.has(id as string))).toBe(true);
    expect(files.get('test_skin_race_stripes')).toMatchObject({ slotType: 'paint_design', globalSkin: 'race_stripes' });
  });

  it('resolves configurations: slots, overrides, empty slots and what ends up on the car', () => {
    const { doc } = carProject();
    const slots = slotChoices(doc, tax);
    expect(slots.map((s) => [s.slotType, s.depth, s.options.map((o) => o.name)])).toEqual([
      ['test_body', 0, ['test_body']],
      ['test_hood', 1, ['test_hood']],
      ['test_bumper_F', 1, ['test_bumper_F', 'test_bumper_F_race']],
      ['test_badge_R', 1, ['test_badge_R']],
    ]);
    expect(resolveConfig(doc, tax, null)).toEqual(defaultConfig(doc, tax));
    const race = { id: 'c1', name: 'Race Spec!', description: 'Lighter', type: 'Custom', parts: { test_bumper_F: 'test_bumper_F_race', test_badge_R: '' }, vars: { $test_body_mass: 0.8 } };
    const pc = resolveConfig(doc, tax, race);
    expect(pc.parts).toMatchObject({ test_bumper_F: 'test_bumper_F_race', test_badge_R: '' });
    expect(pc.vars).toEqual({ $test_body_mass: 0.8 });
    expect([...includedParts(doc, tax, pc)].sort()).toEqual(['p_body', 'p_bumper_race', 'p_hood']);
    expect(configFileName(race)).toBe('race_spec');
    expect(configInfoJson(doc, tax, pc, race)).toMatchObject({ Configuration: 'Race Spec!', 'Config Type': 'Custom', Description: 'Lighter' });
  });

  it('binds flexbodies to slot node groups; riders bind to their parent; variants share the slot', () => {
    const { doc, meshes } = carProject();
    const names = exportMeshNames(doc, meshes);
    expect(names.get('s:sunburst2_hood')).toBe('test_hood'); // vehicle prefix swapped for the mod slug
    expect(names.has('s:loose')).toBe(false); // unassigned: not exported
    const files = new Map(buildJbeamFiles(doc, tax, { meshNames: names, author: 'x' }).map((f) => [f.part, parsePart(f.text)[1]]));
    const body = files.get('test_body')!;
    const bodyNodes = readTable(body.nodes!).records;
    expect(bodyNodes.every((r) => r.options.group === 'test_body' && typeof r.options.nodeWeight === 'number')).toBe(true);
    expect(readTable(body.flexbodies!).records[0]!.values).toEqual({ mesh: 'test_body_main', '[group]:': ['test_body'] });
    expect(readTable(body.refNodes!).header).toEqual(['ref:', 'back:', 'left:', 'up:', 'leftCorner:', 'rightCorner:']);
    expect(body.cameraExternal).toBeTruthy();
    // Body declares the bumper and badge slots (and the hood, its taxonomy child).
    expect(readTable(body.slots2!).records.map((r) => r.values.name).sort()).toEqual(['test_badge_R', 'test_bumper_F', 'test_hood']);
    // Race bumper: same slot, same node group name, its own nodes.
    const race = files.get('test_bumper_F_race')!;
    expect(race.slotType).toBe('test_bumper_F');
    expect(readTable(race.nodes!).records.every((r) => r.options.group === 'test_bumper_F')).toBe(true);
    // Badge rides: no nodes, flexbody bound to the body's group.
    const badge = files.get('test_badge_R')!;
    expect(badge.nodes).toBeUndefined();
    expect(readTable(badge.flexbodies!).records[0]!.values['[group]:']).toEqual(['test_body']);
    expect(flexGroupOf(doc, doc.parts.find((p) => p.id === 'p_badge')!)).toBe('test_body');
    // Attach beams carry a breakGroup; the hood (opens) is bolted shut the same way until hinges exist (Phase 9).
    const bumperBeams = readTable(files.get('test_bumper_F')!.beams!).records;
    expect(bumperBeams.some((r) => r.options.breakGroup === 'test_bumper_F_attach')).toBe(true);
    expect(readTable(files.get('test_hood')!.beams!).records.some((r) => r.options.breakGroup === 'test_hood_attach')).toBe(true);
    // Every beam references a node that exists in some exported part.
    const allNodes = new Set([...files.values()].flatMap((p) => (p.nodes ? readTable(p.nodes).records.map((r) => r.values.id as string) : [])));
    for (const part of files.values()) if (part.beams) for (const r of readTable(part.beams).records) expect(allNodes.has(r.values['id1:'] as string) && allNodes.has(r.values['id2:'] as string)).toBe(true);
  });

  it('writes the body part deterministically (snapshot)', () => {
    const { doc, meshes } = carProject();
    const files = buildJbeamFiles(doc, tax, { meshNames: exportMeshNames(doc, meshes), author: 'Fatkiwi' });
    expect(files.find((f) => f.part === 'test_hood')!.text).toMatchSnapshot();
    expect(files.find((f) => f.part === 'test')!.text).toMatchSnapshot();
  });
});

describe('export files', () => {
  it('default config lists every slot with its base part', () => {
    const { doc } = carProject();
    expect(defaultConfig(doc, tax)).toEqual({ format: 2, model: 'test', parts: { test_body: 'test_body', test_hood: 'test_hood', test_bumper_F: 'test_bumper_F', test_badge_R: 'test_badge_R' }, vars: {} });
  });

  it('info.json and materials.json (snapshot)', () => {
    const { doc } = carProject();
    expect(infoJson(doc, 'Fatkiwi')).toMatchSnapshot();
    expect(materialsJson('test', [{ name: 'test_paint', baseColor: [0.8, 0.1, 0.1, 1], metallic: 0.4, roughness: 0.3, maps: { baseColorMap: 'test_paint_b.color.dds' }, translucent: false, doubleSided: false }])).toMatchSnapshot();
  });
});

describe('validateExport', () => {
  const run = (doc: Project, meshes: { key: string; name: string; sourceId: string }[], daeOmit: string[] = []) => {
    const names = exportMeshNames(doc, meshes);
    return validateExport(doc, tax, { meshNames: names, daeNodes: new Set([...names.values()].filter((n) => !daeOmit.includes(n))), missingTextures: [], loadedMeshKeys: meshes.map((m) => m.key) });
  };

  it('passes a generated car and warns about unhinged openables and unassigned meshes', () => {
    const { doc, meshes } = carProject();
    const r = run(doc, meshes);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(['meshes-unassigned', 'openable-unhinged']);
  });

  it('hard-fails the mistakes that made the old build invisible or broken', () => {
    const { doc, meshes } = carProject();
    // 1. flexbody mesh missing from the DAE
    expect(run(doc, meshes, ['test_hood']).errors.map((e) => e.code)).toContain('flexbody-missing-mesh');
    // 2. a part with meshes but no structure
    const d2 = carProject().doc;
    d2.nodes = d2.nodes.filter((n) => n.partId !== 'p_hood');
    d2.beams = d2.beams.filter((b) => b.partId !== 'p_hood');
    expect(run(d2, meshes).errors.map((e) => e.code)).toContain('not-generated');
    // 3. dangling beams and missing refNodes
    const d3 = carProject().doc;
    d3.beams.push({ id1: 'ghost1', id2: 'ghost2', partId: 'p_body', kind: 'edge' });
    d3.proxy.refNodes = null;
    const codes = run(d3, meshes).errors.map((e) => e.code);
    expect(codes).toContain('beam-dangling');
    expect(codes).toContain('refnodes-missing');
  });
});
