import { describe, expect, it } from 'vitest';
import { categoryOf, indexDae, partsOf, subsetDae, suspensionClosure } from '../../src/main/beamng/partObjects';

const DAE = `<?xml version="1.0"?>
<COLLADA><asset><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
<library_geometries>
<geometry id="Arm-mesh" name="arm"><mesh>ARM</mesh></geometry>
<geometry id="Hub-mesh" name="hub"><mesh>HUB</mesh></geometry>
<geometry id="Body-mesh" name="body"><mesh>BODY</mesh></geometry>
</library_geometries>
<library_visual_scenes><visual_scene id="Scene">
<node id="car_arm_F" name="car_arm_F" type="NODE"><matrix>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
  <instance_geometry url="#Arm-mesh"><bind_material><technique_common><instance_material symbol="m" target="#car_chassis-material"/></technique_common></bind_material></instance_geometry>
  <node id="car_arm_F_bolt" name="car_arm_F_bolt"/>
</node>
<node id="car_hub_F" name="car_hub_F" type="NODE"><instance_geometry url="#Hub-mesh"><bind_material><technique_common><instance_material symbol="m" target="#car_chassis-material"/></technique_common></bind_material></instance_geometry></node>
<node id="car_body" name="car_body" type="NODE"><instance_geometry url="#Body-mesh"/></node>
</visual_scene></library_visual_scenes></COLLADA>`;

describe('BeamNG part objects', () => {
  it('sorts slot types into object categories', () => {
    expect(categoryOf('etk800_brake_F')).toBe('Brakes');
    expect(categoryOf('etk800_coilover_R')).toBe('Springs & Dampers');
    expect(categoryOf('etk800_strutbrace_F')).toBe('Strut Braces');
    expect(categoryOf('etk800_suspension_F')).toBe('Front Suspension');
    expect(categoryOf('pickup_suspension_R')).toBe('Rear Suspension');
    expect(categoryOf('etk800_steering')).toBe('Steering');
    expect(categoryOf('etk800_hood')).toBeNull();
  });

  it('reads suspension parts and their meshes from a jbeam', () => {
    const parts = partsOf(
      {
        car_suspension_F: { slotType: 'car_suspension_F', information: { name: 'Sport Front Suspension' }, flexbodies: [['mesh', '[group]'], ['car_arm_F', ['g']], ['car_hub_F', ['g']], ['car_arm_F', ['g']]] },
        car_hood: { slotType: 'car_hood', flexbodies: [['mesh'], ['car_hood', []]] },
      },
      'car',
      'Test Car',
    );
    expect(parts).toEqual([{ vehicle: 'car', vehicleName: 'Test Car', part: 'car_suspension_F', partName: 'Sport Front Suspension', slotType: 'car_suspension_F', category: 'Front Suspension', meshes: ['car_arm_F', 'car_hub_F'] }]);
  });

  it('cuts just the wanted nodes (children included) out of a DAE', () => {
    const doc = indexDae(DAE);
    expect([...doc.nodes.keys()]).toEqual(['car_arm_F', 'car_arm_F_bolt', 'car_hub_F', 'car_body']);
    const out = subsetDae([{ doc, names: ['car_arm_F', 'car_hub_F'] }], '0.5 0.5 0.5')!;
    expect(out).toContain('<node id="car_arm_F_bolt"');
    expect(out).toContain('<geometry id="Arm-mesh"');
    expect(out).toContain('<geometry id="Hub-mesh"');
    expect(out).not.toContain('Body-mesh');
    expect(out).toContain('<up_axis>Z_UP</up_axis>');
    // The game's material name survives, as a plain material.
    expect(out).toContain('<material id="car_chassis-m" name="car_chassis">');
    expect(out).toContain('target="#car_chassis-m"');
  });

  it('keeps ids apart when meshes come from two DAEs', () => {
    const doc = indexDae(DAE);
    const out = subsetDae(
      [
        { doc, names: ['car_arm_F'] },
        { doc, names: ['car_hub_F'] },
      ],
      '0.5 0.5 0.5',
    )!;
    expect(out).toContain('<geometry id="d0_Arm-mesh"');
    expect(out).toContain('url="#d1_Hub-mesh"');
  });

  it('returns nothing when no node is found', () => {
    expect(subsetDae([{ doc: indexDae(DAE), names: ['missing'] }], '0 0 0')).toBeNull();
  });
});

describe('what a suspension brings along', () => {
  const parts: Record<string, Record<string, unknown>> = {
    covet_hub_R_3wheel: { slotType: 'covet_hub_R_3wheel', slots2: [['name', 'allowTypes', 'default'], ['wheel_R_3wheel', ['wheel_R_3wheel'], 'tractor_wheel_35x10'], ['wheel_R_4', ['wheel_R_4'], 'steelwheel_14x6_R']] },
    tractor_wheel_35x10: { slotType: 'wheel_R_3wheel' },
    steelwheel_14x6_R: { slotType: 'wheel_R_4' },
  };
  const find = (n: string) => parts[n] as never;

  it('leaves the game’s shared wheels to the game, but brings a wheel only this car has', () => {
    expect(suspensionClosure('covet_hub_R_3wheel', find, 40, new Set(['wheel_R_4']))).toEqual(['covet_hub_R_3wheel', 'tractor_wheel_35x10']);
  });
});

describe('nodes of a suspension its car’s body also holds', () => {
  it('are found from the body’s beams, not from parts that go in the set’s own slots or replace it', async () => {
    const { heldByBody } = await import('../../src/main/beamng/partObjects');
    const closure = {
      susp_F: { slotType: 'susp_F', slots2: [['name', 'allowTypes', 'default'], ['spring_F', ['spring_F'], 'spring_F']], nodes: [['id', 'posX', 'posY', 'posZ'], ['fx0', 0, -1.1, 0.3], ['fh5r', -0.6, -1.2, 0.3]], beams: [['id1:', 'id2:'], ['fx0', 'fh5r']] },
    };
    const car = new Map<string, Record<string, unknown>>([
      ['susp_F', closure.susp_F],
      ['body', { slotType: 'body', nodes: [['id', 'posX', 'posY', 'posZ'], ['b1', 0, -1, 0.3]], beams: [['id1:', 'id2:'], ['b1', 'fx0']] }],
      ['spring_F_sport', { slotType: 'spring_F', beams: [['id1:', 'id2:'], ['fh5r', 'b1']] }],
      ['susp_F_wide', { slotType: 'susp_F', nodes: [['id', 'posX', 'posY', 'posZ'], ['fh5r', -0.7, -1.2, 0.3]], beams: [['id1:', 'id2:'], ['fh5r', 'b1']] }],
    ]);
    expect(heldByBody(closure as never, car as never)).toEqual(['fx0']);
  });
});
