import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yazl from 'yazl';
import { buildPartObjects, panelCategory } from '../../src/main/beamng/partObjects';
import { panelModFiles } from '../../src/shared/export/modKinds';
import { parseJbeam } from '../../src/shared/jbeam/parse';

const ROOT = join(__dirname, '..', '..');

// A car with a body, a hood (own nodes and beams, and a glass slot), a front bumper (flexbody only)
// and a headlight lens: the hood and the bumper are body panels, the lens is not.
const jbeam = {
  fakecar_body: {
    information: { name: 'Body' },
    slotType: 'main',
    slots: [['type', 'default', 'description'], ['fakecar_hood', 'fakecar_hood', 'Hood'], ['fakecar_bumper_F', 'fakecar_bumper_F', 'Front bumper'], ['fakecar_headlight_glass', 'fakecar_headlight_glass', 'Lens']],
    flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_body', ['fakecar_body']]],
    nodes: [['id', 'posX', 'posY', 'posZ'], ['b1', 0, -1, 0.5], ['b2', 1, -1, 0.5]],
  },
  fakecar_hood: {
    information: { name: 'Hood', value: 400 },
    slotType: 'fakecar_hood',
    slots: [['type', 'default', 'description'], ['fakecar_hood_ornament', '', 'Ornament']],
    flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_wheel_FL', ['fakecar_hood', 'fakecar_hood_latch']]],
    nodes: [['id', 'posX', 'posY', 'posZ'], { group: 'fakecar_hood' }, ['h1', 0, -1.5, 0.9], ['h2', 0.5, -1.5, 0.9]],
    beams: [['id1:', 'id2:'], ['h1', 'h2'], ['h1', 'b1']],
  },
  fakecar_bumper_F: {
    information: { name: 'Front bumper' },
    slotType: 'fakecar_bumper_F',
    flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_mirror', ['fakecar_bumper_F']]],
  },
  fakecar_headlight_glass: {
    information: { name: 'Lens' },
    slotType: 'fakecar_headlight_glass',
    flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['dup', ['fakecar_body']]],
  },
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-panels-'));
  await mkdir(join(dir, 'content', 'vehicles'), { recursive: true });
  const dae = readFileSync(join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae'));
  await new Promise<void>((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(jbeam)), 'vehicles/fakecar/fakecar.jbeam');
    zip.addBuffer(dae, 'vehicles/fakecar/fakecar.dae');
    zip.addBuffer(Buffer.from(JSON.stringify({ Name: 'Fake Car', Brand: 'Forge' })), 'vehicles/fakecar/info.json');
    zip.end();
    zip.outputStream.pipe(createWriteStream(join(dir, 'content', 'vehicles', 'fakecar.zip'))).on('close', resolve).on('error', reject);
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('body panels from the install', () => {
  it('tells body panels from the rest by their slot', () => {
    expect(panelCategory('pickup_hood')).toBe('Hoods');
    expect(panelCategory('etk800_bumper_F')).toBe('Bumpers');
    expect(panelCategory('covet_door_FR')).toBe('Doors');
    expect(panelCategory('sunburst_tailgate')).toBe('Trunks & tailgates');
    expect(panelCategory('bx_spoiler')).toBe('Spoilers & wings');
    expect(panelCategory('pickup_door_FR_glass')).toBeNull();
    expect(panelCategory('pickup_headlight')).toBeNull();
    expect(panelCategory('pickup_bumper_F_support')).toBeNull();
    expect(panelCategory('pickup_door_handle_FR')).toBeNull();
  });

  it('packages each car’s panels with their jbeam and a model of the stock part', async () => {
    const out = join(dir, 'out');
    await buildPartObjects(dir, out);
    const sets = join(out, 'sets', 'fakecar');
    const folders = await readdir(sets);
    const kinds = folders.map((f) => JSON.parse(readFileSync(join(sets, f, 'set.json'), 'utf8')) as { kind: string; type: string; part: string; slotType: string; vehicleName: string });
    const panels = kinds.filter((k) => k.kind === 'panel');
    expect(panels.map((p) => p.part).sort()).toEqual(['fakecar_bumper_F', 'fakecar_hood']);
    expect(panels.find((p) => p.part === 'fakecar_hood')).toMatchObject({ type: 'Hoods', slotType: 'fakecar_hood', vehicleName: 'Forge Fake Car' });
    const hood = join(sets, 'fakecar_hood');
    expect(existsSync(join(hood, 'fakecar_fakecar_hood.dae'))).toBe(true);
    const parts = JSON.parse(readFileSync(join(hood, 'jbeam.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(parts)).toEqual(['fakecar_hood']);
  });

  it('writes the new panel as the stock part with the new mesh, in the same slot', async () => {
    const out = join(dir, 'out');
    await buildPartObjects(dir, out);
    const parts = JSON.parse(readFileSync(join(out, 'sets', 'fakecar', 'fakecar_hood', 'jbeam.json'), 'utf8')) as Record<string, never>;
    const r = panelModFiles('vented', 'me', 'Vented Hood', { vehicle: 'fakecar', part: 'fakecar_hood' }, { parts, anchors: {}, root: 'fakecar_hood' }, ['vented_hood', 'vented_hood_scoop']);
    expect(r.errors).toEqual([]);
    expect(r.files.map((f) => f.path)).toEqual(['vehicles/fakecar/vented_fakecar_hood.jbeam']);
    const doc = parseJbeam(r.files[0]!.text).value as Record<string, Record<string, unknown>>;
    const part = doc.vented_fakecar_hood!;
    expect(part.slotType).toBe('fakecar_hood');
    expect(part.information).toMatchObject({ name: 'Vented Hood', authors: 'me', value: 400 });
    // The stock physics and slots stay.
    expect(part.nodes).toEqual(jbeam.fakecar_hood.nodes);
    expect(part.beams).toEqual(jbeam.fakecar_hood.beams);
    expect(part.slots).toEqual(jbeam.fakecar_hood.slots);
    // The new meshes, bound to the stock groups.
    expect(part.flexbodies).toEqual([
      ['mesh', '[group]:', 'nonFlexMaterials'],
      ['vented_hood', ['fakecar_hood', 'fakecar_hood_latch'], []],
      ['vented_hood_scoop', ['fakecar_hood', 'fakecar_hood_latch'], []],
    ]);
  });

  it('says what is missing', () => {
    expect(panelModFiles('x', '', 'X', { vehicle: 'fakecar', part: 'fakecar_hood' }, undefined, ['m']).errors[0]).toMatch(/isn't loaded/);
    const parts = { fakecar_hood: jbeam.fakecar_hood } as never;
    expect(panelModFiles('x', '', 'X', { vehicle: 'fakecar', part: 'fakecar_hood' }, { parts, anchors: {}, root: 'fakecar_hood' }, []).errors[0]).toMatch(/Import your panel/);
  });
});

describe('reading an install', () => {
  it('skips an unreadable zip instead of giving up on every car', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'content', 'vehicles', 'broken.zip'), '');
    const out = join(dir, 'out');
    await buildPartObjects(dir, out);
    expect((await readdir(join(out, 'sets', 'fakecar'))).length).toBeGreaterThan(0);
  });
});
