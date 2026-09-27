import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '@shared/jbeam/parse';
import { definedNodes, externalNodeRefs, shiftOffset, transplantSuspension, tuningVariables, type V3 } from '@shared/suspension/transplant';

const PARTS: Record<string, JbeamObject> = {
  car_suspension_F: {
    information: { name: 'Front Suspension' },
    slotType: 'car_suspension_F',
    slots2: [
      ['name', 'allowTypes', 'denyTypes', 'default', 'description'],
      ['car_coilover_F', ['car_coilover_F'], [], 'car_coilover_F', 'Front Coilovers'],
      ['wheel_F_5', ['wheel_F_5'], [], 'steelwheel_F', 'Front Wheels', { nodeOffset: { x: '$=$trackoffset_F + 0.26', y: -1.3, z: 0.3 } }],
    ],
    variables: [
      ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
      ['$camber_F', 'range', '', 'Wheel Alignment', 1, 0.95, 1.05, 'Camber', 'Camber angle', { stepDis: 0.001 }],
    ],
    flexbodies: [['mesh', '[group]:'], ['car_arm_F', ['car_arm_F']], ['car_not_exported', ['x']]],
    nodes: [['id', 'posX', 'posY', 'posZ'], { group: 'car_arm_F' }, ['fh1r', -0.7, -1.3, 0.3], ['fh1l', 0.7, -1.3, 0.3]],
    beams: [['id1:', 'id2:'], { beamSpring: 1000 }, ['fh1r', 'fx1r'], ['fh1l', 'fx1l'], ['fh1r', 'fh1l']],
    rails: { strut_FR: { 'links:': ['fh1r', 'fx1r'] } },
  },
  car_coilover_F: {
    information: { name: 'Front Coilovers' },
    slotType: 'car_coilover_F',
    beams: [['id1:', 'id2:'], ['fh1r', 'fx9r']],
  },
};

const BODY: [string, V3][] = [
  ['fx1r', [-0.6, -1.3, 0.5]],
  ['fx1l', [0.6, -1.3, 0.5]],
  ['fx9r', [-0.6, -1.3, 0.9]],
  ['fh1r', [-0.7, -1.3, 0.3]],
];

describe('suspension jbeam transplant', () => {
  it('finds the body nodes a set attaches to', () => {
    const vehicle = new Map<string, V3>([...BODY, ['unrelated', [0, 0, 0]]]);
    expect(externalNodeRefs(PARTS, vehicle)).toEqual({ fx1r: [-0.6, -1.3, 0.5], fx1l: [0.6, -1.3, 0.5], fx9r: [-0.6, -1.3, 0.9] });
    expect([...definedNodes(PARTS.car_suspension_F!).keys()]).toEqual(['fh1r', 'fh1l']);
  });

  it('renames, moves, re-attaches and re-points everything', () => {
    const anchors = externalNodeRefs(PARTS, new Map(BODY));
    const r = transplantSuspension({
      parts: PARTS,
      root: 'car_suspension_F',
      anchors,
      offset: [0, 0.2, 0.05],
      partPrefix: 'mymod_F_',
      nodePrefix: 'f_',
      target: [
        { id: 'b1r', pos: [-0.62, -1.1, 0.55] },
        { id: 'b1l', pos: [0.62, -1.1, 0.55] },
        { id: 'b9r', pos: [-0.6, -1.1, 0.95] },
      ],
      meshNames: { car_arm_F: 'front_arm' },
      tuning: { $camber_F: 1.02 },
    });
    expect(r.rootPart).toBe('mymod_F_car_suspension_F');
    expect(r.rootSlotType).toBe('mymod_F_car_suspension_F');
    expect(Object.keys(r.parts)).toEqual(['mymod_F_car_suspension_F', 'mymod_F_car_coilover_F']);
    const s = r.parts.mymod_F_car_suspension_F!;
    // Own nodes renamed and moved with the meshes.
    expect(s.nodes).toEqual([['id', 'posX', 'posY', 'posZ'], { group: 'car_arm_F' }, ['f_fh1r', -0.7, expect.closeTo(-1.1), expect.closeTo(0.35)], ['f_fh1l', 0.7, expect.closeTo(-1.1), expect.closeTo(0.35)]]);
    // Body attachments go to the new car's nearest nodes; own nodes use their new ids.
    expect(r.attached).toEqual({ fx1r: 'b1r', fx1l: 'b1l', fx9r: 'b9r' });
    expect(s.beams).toEqual([['id1:', 'id2:'], { beamSpring: 1000 }, ['f_fh1r', 'b1r'], ['f_fh1l', 'b1l'], ['f_fh1r', 'f_fh1l']]);
    expect(s.rails).toEqual({ strut_FR: { 'links:': ['f_fh1r', 'b1r'] } });
    expect(r.parts.mymod_F_car_coilover_F!.beams).toEqual([['id1:', 'id2:'], ['f_fh1r', 'b9r']]);
    // Own slots renamed, the game's wheel slot left alone.
    expect(s.slots2).toEqual([
      ['name', 'allowTypes', 'denyTypes', 'default', 'description'],
      ['mymod_F_car_coilover_F', ['mymod_F_car_coilover_F'], [], 'mymod_F_car_coilover_F', 'Front Coilovers'],
      ['wheel_F_5', ['wheel_F_5'], [], 'steelwheel_F', 'Front Wheels', { nodeOffset: { x: '$=$trackoffset_F + 0.26', y: -1.1, z: 0.35 } }],
    ]);
    // Flexbodies point at the exported meshes; unexported ones drop out.
    expect(s.flexbodies).toEqual([['mesh', '[group]:'], ['front_arm', ['car_arm_F']]]);
    // Tuning replaces the default.
    expect((s.variables as unknown[][])[1]![4]).toBe(1.02);
    expect(r.warnings).toEqual([]);
  });

  it('keeps attachment points on the suspension when the body has no structure yet', () => {
    const r = transplantSuspension({ parts: PARTS, root: 'car_suspension_F', anchors: { fx1r: [-0.6, -1.3, 0.5] }, offset: [0, 0, 0], partPrefix: 'm_', nodePrefix: 'f_', target: [], meshNames: {}, tuning: {} });
    expect((r.parts.m_car_suspension_F!.nodes as unknown[][]).at(-1)).toEqual(['f_fx1r', -0.6, -1.3, 0.5]);
    expect(r.warnings[0]).toMatch(/no structure yet/);
  });

  it('moves slot offsets: numbers add, expressions get + d', () => {
    expect(shiftOffset(-1.4, 0.2)).toBe(-1.2);
    expect(shiftOffset('$=$a + 1', 0.5)).toBe('$=($a + 1) + 0.5');
    expect(shiftOffset('$trackwidth_F', -0.1)).toBe('$=$trackwidth_F + -0.1');
    expect(shiftOffset('$trackwidth_F', 0)).toBe('$trackwidth_F');
  });

  it('lists the tuning variables', () => {
    expect(tuningVariables(PARTS)).toEqual([{ name: '$camber_F', unit: '', category: 'Wheel Alignment', title: 'Camber', description: 'Camber angle', default: 1, min: 0.95, max: 1.05, step: 0.001 }]);
  });
});
