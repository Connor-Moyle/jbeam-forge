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

  it('gives a wing lift on its upward faces and drag on all, scaled by its downforce setting', () => {
    const { doc, meshes } = carProject();
    const wing = createPart(doc, tax, { taxonomyId: 'wing', id: 'p_wing', parentPartId: 'p_body' });
    assignMeshes(doc, ['s:wing'], wing.id);
    generateStructure(doc, tax, [{ partId: wing.id, mesh: box(0.7, 1.9, 2.1, 1.2, 1.25, 3) }]);
    doc.variables = [{ id: 'v', partId: 'p_wing', setting: 'downforce', min: 0.3, max: 2, default: 1 }];
    const names = exportMeshNames(doc, [...meshes, { key: 's:wing', name: 'wing', sourceId: 's' }]);
    const part = [...buildJbeamFiles(doc, tax, { meshNames: names, author: 'x' }).map((f) => parsePart(f.text)[1])].find((p) => p.slotType === 'test_wing')!;
    expect(part.triangles).toBeDefined();
    const rows = readTable(part.triangles!).records;
    const pos = new Map(doc.nodes.map((n) => [n.id, n.pos]));
    const lifting = rows.filter((r) => r.inlineOptions?.liftCoef !== undefined);
    expect(lifting.length).toBeGreaterThan(0);
    expect(lifting.length).toBeLessThan(rows.length);
    expect(lifting.every((r) => r.inlineOptions.liftCoef === '$=70*$test_wing_downforce' && r.inlineOptions.stallAngle === 0.24)).toBe(true);
    // Lifting faces are the top: right-hand normals pointing up.
    for (const r of lifting) {
      const [a, b, c] = ['id1:', 'id2:', 'id3:'].map((k) => pos.get(r.values[k] as string)!);
      const nz = (b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0]);
      expect(nz).toBeGreaterThan(0);
    }
    expect(rows.every((r) => r.options.dragCoef === 44)).toBe(true);
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
    const race = { id: 'c1', name: 'Race Spec!', description: 'Lighter', type: 'Custom', parts: { test_bumper_F: 'test_bumper_F_race', test_badge_R: '' }, vars: { $test_body_mass: 0.8 }, paints: [null, null, null] as [null, null, null] };
    const pc = resolveConfig(doc, tax, race);
    expect(pc.parts).toMatchObject({ test_bumper_F: 'test_bumper_F_race', test_badge_R: '' });
    expect(pc.vars).toEqual({ $test_body_mass: 0.8 });
    expect([...includedParts(doc, tax, pc)].sort()).toEqual(['p_body', 'p_bumper_race', 'p_hood']);
    expect(configFileName(race)).toBe('race_spec');
    expect(configInfoJson(doc, tax, pc, race)).toMatchObject({ Configuration: 'Race Spec!', 'Config Type': 'Custom', Description: 'Lighter' });
  });

  it('lets a configuration leave a fitted axle off', () => {
    const { doc } = carProject();
    const set = createPart(doc, tax, { taxonomyId: 'suspension_set', id: 'p_rear_set' });
    assignMeshes(doc, ['susp:arm_R'], set.id);
    doc.axles = [
      { id: 'a1', name: 'Front', y: -1.3, track: 1.5, steered: true, tuning: {}, ownMeshes: [], fitted: null },
      { id: 'a2', name: 'Rear', y: 1.3, track: 1.5, steered: false, tuning: {}, ownMeshes: [], fitted: { setId: 'pickup/rear', name: 'Leaf', vehicle: 'Gavril D-Series', type: 'leaf', sourceId: 'susp' } },
    ];
    const sets = { 'pickup/rear': { root: 'pickup_leaf_R', parts: { pickup_leaf_R: { slotType: 'pickup_suspension_R' } } } };
    const slots = slotChoices(doc, tax, sets);
    // The stand-in part isn't a slot of its own; the axle is, right under the body.
    expect(slots.some((s) => s.slotType.includes('suspension_set'))).toBe(false);
    const bodyAt = slots.findIndex((s) => s.core);
    expect(slots[bodyAt + 1]).toMatchObject({ slotType: 'test_R_pickup_suspension_R', defaultPart: 'test_R_pickup_leaf_R', label: 'Rear suspension', core: false, setPartIds: ['p_rear_set'] });
    const base = resolveConfig(doc, tax, null, sets);
    expect(base.parts.test_R_pickup_suspension_R).toBe('test_R_pickup_leaf_R');
    expect(includedParts(doc, tax, base, sets).has('p_rear_set')).toBe(true);
    const noRear = resolveConfig(doc, tax, { id: 'c', name: 'Trike', description: '', type: 'Custom', parts: { test_R_pickup_suspension_R: '' }, vars: {}, paints: [null, null, null] as [null, null, null] }, sets);
    expect(includedParts(doc, tax, noRear, sets).has('p_rear_set')).toBe(false);
  });

  it('with a game suspension fitted, the axle’s own wheels, tyres and brakes ride on the game’s wheel', () => {
    const { doc, meshes } = carProject();
    const rim = createPart(doc, tax, { taxonomyId: 'wheel', position: 'FL', id: 'p_rim' });
    const tyre = createPart(doc, tax, { taxonomyId: 'tire', position: 'FL', id: 'p_tyre' });
    const caliper = createPart(doc, tax, { taxonomyId: 'brake_caliper', position: 'FL', id: 'p_caliper' });
    const rearRim = createPart(doc, tax, { taxonomyId: 'wheel', position: 'RL', id: 'p_rim_r' });
    assignMeshes(doc, ['w:rim'], rim.id);
    assignMeshes(doc, ['w:tyre'], tyre.id);
    assignMeshes(doc, ['w:caliper'], caliper.id);
    assignMeshes(doc, ['w:rim_r'], rearRim.id);
    const set = createPart(doc, tax, { taxonomyId: 'suspension_set', id: 'p_front_set' });
    assignMeshes(doc, ['susp:arm_F'], set.id);
    doc.axles = [{ id: 'a1', name: 'Front', y: -1.3, track: 1.5, steered: true, tuning: {}, ownMeshes: [], fitted: { setId: 'car/front', name: 'Strut', vehicle: 'Car', type: 'strut', sourceId: 'susp' } }];
    doc.sources.push({ id: 'susp', placement: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } } as never);
    const hub = {
      slotType: 'car_suspension_F',
      nodes: [['id', 'posX', 'posY', 'posZ'], { group: 'car_hub_FL' }, ['fh1l', 0.7, -1.3, 0.3], ['fw1l', 0.8, -1.3, 0.3], ['fw1ll', 0.7, -1.3, 0.3], { group: '' }],
      pressureWheels: [['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'], ['FL', 'wheel_FL', 'tire_FL', 'fw1ll', 'fw1l', 9999, 'fh1l', 1]],
    };
    const names = new Map([...exportMeshNames(doc, meshes), ['w:rim', 'test_rim_FL'], ['w:tyre', 'test_tyre_FL'], ['w:caliper', 'test_caliper_FL'], ['w:rim_r', 'test_rim_RL']]);
    const files = new Map(buildJbeamFiles(doc, tax, { meshNames: names, author: 'x', suspensions: { 'car/front': { root: 'car_suspension_F', anchors: {}, parts: { car_suspension_F: hub } } } }).map((f) => [f.part, parsePart(f.text)[1]]));
    const groupsOf = (part: string) => readTable(files.get(part)!.flexbodies!).records[0]!.values['[group]:'];
    expect(groupsOf(rim.name)).toEqual(['wheel_FL']); // spins with the hub
    expect(groupsOf(tyre.name)).toEqual(['tire_FL']);
    expect(groupsOf(caliper.name)).toEqual(['car_hub_FL']); // steers with the knuckle, doesn't spin
    expect(groupsOf(rearRim.name)).not.toEqual(['wheel_RL']); // no suspension on that axle: unchanged
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

describe('configurations manager', () => {
  it('brings in a .pc: slots this car has, skipping the rest', async () => {
    const { configFromPc, configDiff } = await import('../../src/shared/export/configs');
    const { doc } = carProject();
    const text = JSON.stringify({ format: 2, model: 'other', parts: { test_bumper_F: 'test_bumper_F_race', test_badge_R: '', test_body: 'test_body', other_slot: 'other_part', test_hood: 'no_such_hood' }, vars: { $test_body_mass: 0.9, $unknown: 3 } });
    const { config, skipped } = configFromPc(doc, tax, text, 'street_racer.pc');
    expect(config.name).toBe('Street racer');
    expect(config.parts).toEqual({ test_bumper_F: 'test_bumper_F_race', test_badge_R: '' });
    expect(skipped.sort()).toEqual(['other_slot → other_part', 'test_hood → no_such_hood']);
    expect(Object.keys(config.vars)).not.toContain('$unknown');
    expect(() => configFromPc(doc, tax, 'nope', 'x.pc')).toThrow(/isn't a .pc file/);
    expect(() => configFromPc(doc, tax, '{"model":"x"}', 'x.pc')).toThrow(/no parts list/);

    const slots = slotChoices(doc, tax);
    const base = resolveConfig(doc, tax, null);
    const race = resolveConfig(doc, tax, { id: 'r', ...config });
    expect(configDiff(base, race, slots).map((d) => [d.slot.slotType, d.b])).toEqual([
      ['test_bumper_F', 'Front bumper (Race)'],
      ['test_badge_R', '(empty)'],
    ]);
    expect(configDiff(base, base, slots)).toEqual([]);
  });

  it('adds up weight and value, and writes the selector labels', async () => {
    const { configStats, configLabels } = await import('../../src/shared/export/configStats');
    const { doc } = carProject();
    const weightOf = (ids: Set<string>) => Math.round(doc.nodes.filter((n) => ids.has(n.partId)).reduce((s, n) => s + n.weight, 0));
    const basePc = resolveConfig(doc, tax, null);
    const base = configStats(doc, tax, basePc);
    expect(base.weightKg).toBe(weightOf(includedParts(doc, tax, basePc)));
    expect(base.weightKg).toBeGreaterThan(0);
    expect(base.powerKw).toBeNull();
    const racePc = resolveConfig(doc, tax, { id: 'r', name: 'Race', description: '', type: 'Race', parts: { test_bumper_F: 'test_bumper_F_race' }, vars: {}, paints: [null, null, null] });
    const race = configStats(doc, tax, racePc);
    expect(race.weightKg).toBe(weightOf(includedParts(doc, tax, racePc)));
    expect(configLabels(race, { drivetrain: 'AWD', years: { min: 1998, max: 2004 }, population: 500 })).toEqual({ Drivetrain: 'AWD', Years: { min: 1998, max: 2004 }, Population: 500 });
    const cfg = { id: 'r', name: 'Race', description: '', type: 'Race', parts: {}, vars: {}, paints: [null, null, null] as [null, null, null], info: { value: 42000 } };
    expect(configInfoJson(doc, tax, resolveConfig(doc, tax, cfg), cfg, { Drivetrain: 'RWD' })).toMatchObject({ Value: 42000, Drivetrain: 'RWD' });
  });

  it('writes the default configuration and vehicle details to info.json', () => {
    const { doc } = carProject();
    doc.meta.bodyStyle = 'Coupe';
    doc.meta.years = { min: 1990, max: 1995 };
    expect(infoJson(doc, 'me', 'race')).toMatchObject({ default_pc: 'race', 'Body Style': 'Coupe', Years: { min: 1990, max: 1995 } });
    expect(infoJson(doc, 'me')).toMatchObject({ default_pc: 'default' });
  });
});
