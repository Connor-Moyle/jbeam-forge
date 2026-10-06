import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '@shared/jbeam/parse';
import { definedNodes, externalNodeRefs, planeDistance, setGroups, shiftOffset, thickness, transplantSuspension, tuningVariables, type V3 } from '@shared/suspension/transplant';

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

  it('points a slot it does not bring at another transplanted set', () => {
    const engine: Record<string, JbeamObject> = { eng: { slotType: 'car_engine', slots: [['type', 'default', 'description'], ['car_transmission', 'car_transmission_6M', 'Transmission']] } };
    const r = transplantSuspension({ parts: engine, root: 'eng', anchors: {}, offset: [0, 0, 0], partPrefix: 'm_E_', nodePrefix: 'e_', target: [], meshNames: {}, tuning: {}, slotRewrites: { car_transmission: { slotType: 'm_G_box_transmission', part: 'm_G_box_6M' } } });
    expect(r.parts.m_E_eng!.slots).toEqual([['type', 'default', 'description'], ['m_G_box_transmission', 'm_G_box_6M', 'Transmission']]);
    expect(r.rootSlotType).toBe('m_E_car_engine');
  });

  it("puts an engine's mounts on the gearbox's renamed nodes, not the nearest body node", () => {
    const engine = {
      eng: { information: { name: 'Engine' }, slotType: 'car_engine', nodes: [['id', 'posX', 'posY', 'posZ'], ['e1', 0, -1.2, 0.5]], beams: [['id1:', 'id2:'], ['e1', 'tra1']] },
    };
    const r = transplantSuspension({ parts: engine, root: 'eng', anchors: { tra1: [0, -0.8, 0.5] }, offset: [0, 0, 0], partPrefix: 'm_E_', nodePrefix: 'e_', target: [{ id: 'b1', pos: [0, -0.8, 0.5] }], meshNames: {}, tuning: {}, linkedNodes: { tra1: 'g_tra1' } });
    expect(r.parts.m_E_eng!.beams).toEqual([['id1:', 'id2:'], ['e_e1', 'g_tra1']]);
    expect(r.attached).toEqual({});
  });

  it("binds meshes on groups only the original car had to the new car's body group", () => {
    const set = {
      eng: {
        information: { name: 'Engine' },
        slotType: 'car_engine',
        nodes: [['id', 'posX', 'posY', 'posZ'], { group: 'car_engine' }, ['e1', 0, -1.2, 0.5], { group: '' }],
        flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['engine_block', ['car_engine']], ['radiator_hose', ['car_engine', 'car_radiator', 'car_body']]],
      },
    };
    const r = transplantSuspension({ parts: set, root: 'eng', anchors: {}, offset: [0, 0, 0], partPrefix: 'm_E_', nodePrefix: 'e_', target: [], meshNames: { engine_block: 'mod_block', radiator_hose: 'mod_hose' }, tuning: {}, fallbackGroup: 'mod_body' });
    expect(r.parts.m_E_eng!.flexbodies).toEqual([['mesh', '[group]:', 'nonFlexMaterials'], ['mod_block', ['car_engine', 'mod_body']], ['mod_hose', ['car_engine', 'mod_body']]]);
  });

  it('lists the tuning variables', () => {
    expect(tuningVariables(PARTS)).toEqual([{ name: '$camber_F', unit: '', category: 'Wheel Alignment', title: 'Camber', description: 'Camber angle', default: 1, min: 0.95, max: 1.05, step: 0.001 }]);
  });
});

describe('engine sets from another car (regressions from a real export)', () => {
  // An engine whose set also has its own transaxle part, and option parts that use the block's nodes.
  const ENGINE: Record<string, JbeamObject> = {
    car_engine: {
      slotType: 'car_engine',
      slots: [['type', 'default', 'description'], ['car_transaxle', 'car_transaxle_7DCT', 'Transaxle'], ['car_exhaust', 'car_exhaust', 'Exhaust']],
      nodes: [['id', 'posX', 'posY', 'posZ'], ['e1r', -0.15, -1.9, 0.17], ['e1l', 0.15, -1.9, 0.17]],
      beams: [['id1:', 'id2:'], ['e1r', 'e1l'], ['e1r', 'b7r']],
    },
    car_transaxle_7DCT: { slotType: 'car_transaxle', nodes: [['id', 'posX', 'posY', 'posZ'], ['tra1r', -0.2, -2.5, 0.2]] },
    car_exhaust: { slotType: 'car_exhaust', beams: [['id1:', 'id2:'], ['e1r', 'b20']] },
  };
  const target = [
    { id: 'b7r', pos: [-0.14, -1.87, 0.18] as V3 },
    { id: 'b21', pos: [0.14, -1.3, 0.17] as V3 },
    { id: 'b20', pos: [0, -3, 0.3] as V3 },
  ];

  it('never attaches the engine block’s own nodes to the body (an options anchor list names them)', () => {
    const r = transplantSuspension({
      parts: ENGINE,
      root: 'car_engine',
      // The anchors of the option parts: the exhaust uses e1r, which the engine part defines.
      anchors: { e1r: [-0.15, -1.9, 0.17], b7r: [-0.14, -1.87, 0.18], b20: [0, -3, 0.3] },
      offset: [0, 0, 0],
      partPrefix: 'mymod_E_',
      nodePrefix: 'e_',
      target,
      meshNames: {},
      tuning: {},
    });
    const nodes = (r.parts.mymod_E_car_engine!.nodes as unknown[][]).slice(1).map((n) => n[0]);
    expect(nodes).toEqual(['e_e1r', 'e_e1l']);
    expect(r.attached.e1r).toBeUndefined();
    expect(r.parts.mymod_E_car_exhaust!.beams).toEqual([['id1:', 'id2:'], ['e_e1r', 'b20']]);
  });

  it('points the engine’s transaxle slot at the chosen gearbox even when the set has its own transaxle', () => {
    const r = transplantSuspension({
      parts: ENGINE,
      root: 'car_engine',
      anchors: { b7r: [-0.14, -1.87, 0.18], b20: [0, -3, 0.3] },
      offset: [0, 0, 0],
      partPrefix: 'mymod_E_',
      nodePrefix: 'e_',
      target,
      meshNames: {},
      tuning: {},
      slotRewrites: { car_transaxle: { slotType: 'mymod_G_other_transmission', part: 'mymod_G_other_gearbox' } },
    });
    const rows = r.parts.mymod_E_car_engine!.slots as unknown[][];
    expect(rows[1]!.slice(0, 2)).toEqual(['mymod_G_other_transmission', 'mymod_G_other_gearbox']);
    expect(rows[2]!.slice(0, 2)).toEqual(['mymod_E_car_exhaust', 'mymod_E_car_exhaust']);
  });
});

describe('nodes with formula positions (the Autobello front suspension)', () => {
  const SUSP: Record<string, JbeamObject> = {
    car_suspension_F: {
      slotType: 'car_suspension_F',
      variables: [['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'], ['$caster_F', 'range', 'm', 'Alignment', 0.02, -0.05, 0.05, 'Caster', '']],
      nodes: [['id', 'posX', 'posY', 'posZ'], ['fe11r', -0.57, '$=-1.147-$caster_F', 0.217], ['fh1r', -0.6, -1.2, 0.3]],
      beams: [['id1:', 'id2:'], ['fe11r', 'fh1r'], ['fe11r', 'b1r']],
    },
  };

  it('reads them as the set’s own nodes, at their default position', () => {
    const nodes = definedNodes(SUSP.car_suspension_F!);
    expect([...nodes.keys()]).toEqual(['fe11r', 'fh1r']);
    expect(nodes.get('fe11r')![1]).toBeCloseTo(-1.167, 6);
  });

  it('renames them like any of its nodes, and moves them with the set', () => {
    const r = transplantSuspension({
      parts: SUSP,
      root: 'car_suspension_F',
      // An anchor list that (wrongly) names one: it must not be attached to the body.
      anchors: { fe11r: [-0.57, -1.167, 0.217], b1r: [-0.5, -1.0, 0.5] },
      offset: [0, 0.1, 0],
      partPrefix: 'mymod_F_',
      nodePrefix: 'f_',
      target: [{ id: 'fe11r', pos: [-0.57, -1.06, 0.22] }, { id: 'b1r', pos: [-0.5, -0.9, 0.5] }],
      meshNames: {},
      tuning: {},
    });
    const rows = (r.parts.mymod_F_car_suspension_F!.nodes as unknown[][]).slice(1);
    expect(rows[0]).toEqual(['f_fe11r', -0.57, '$=(-1.147-$caster_F) + 0.1', 0.217]);
    expect(r.parts.mymod_F_car_suspension_F!.beams).toEqual([['id1:', 'id2:'], ['f_fe11r', 'f_fh1r'], ['f_fe11r', 'b1r']]);
  });
});

describe('two of the original car’s nodes landing on one', () => {
  it('drops the zero-length and repeated beams that would make', () => {
    const r = transplantSuspension({
      parts: { s: { slotType: 's', nodes: [['id', 'posX', 'posY', 'posZ'], ['fx1', 0, 0, 0]], beams: [['id1:', 'id2:'], ['fx1', 'b1'], ['fx1', 'b2'], ['b1', 'b2'], ['fx1', 'b1']] } },
      root: 's',
      anchors: { b1: [0, 1, 0], b2: [0, 1.01, 0] },
      offset: [0, 0, 0],
      partPrefix: 'm_',
      nodePrefix: 'f_',
      target: [{ id: 'body1', pos: [0, 1, 0] }],
      meshNames: {},
      tuning: {},
    });
    expect(r.parts.m_s!.beams).toEqual([['id1:', 'id2:'], ['f_fx1', 'body1']]);
  });
});

describe('node groups given on a node’s own row (the BX rear suspension)', () => {
  it('count as the set’s, so meshes bound to them stay bound to them', () => {
    const parts: Record<string, JbeamObject> = {
      s: { slotType: 's', nodes: [['id', 'posX', 'posY', 'posZ'], ['rh1r', -0.64, 1.245, 0.2323, { group: ['bx_lowerarm_R', 'bx_hub_R'] }]] },
      bar: { slotType: 'bar', flexbodies: [['mesh', '[group]:'], ['bx_swaybar_R', ['bx_lowerarm_R', 'bx_body']]] },
    };
    expect([...setGroups(parts)].sort()).toEqual(['bx_hub_R', 'bx_lowerarm_R']);
    const r = transplantSuspension({ parts, root: 's', anchors: {}, offset: [0, 0, 0], partPrefix: 'm_', nodePrefix: 'r_', target: [], meshNames: { bx_swaybar_R: 'swaybar' }, tuning: {}, fallbackGroup: 'm_body' });
    expect(r.parts.m_bar!.flexbodies).toEqual([['mesh', '[group]:'], ['swaybar', ['bx_lowerarm_R', 'm_body']]]);
  });
});

describe('props of a borrowed set', () => {
  it('follow the mesh as exported, and are left out when it wasn’t; lights stay', () => {
    const r = transplantSuspension({
      parts: {
        e: {
          slotType: 'e',
          nodes: [['id', 'posX', 'posY', 'posZ'], ['e1', 0, 0, 0], ['e2', 1, 0, 0], ['e3', 0, 1, 0]],
          props: [['func', 'mesh', 'idRef:', 'idX:', 'idY:'], ['rpmspin', 'barstow_pulley', 'e1', 'e2', 'e3'], ['rpmspin', 'bx_driveshaft', 'e1', 'e2', 'e3'], ['lowhighbeam', 'SPOTLIGHT', 'e1', 'e2', 'e3']],
        },
      },
      root: 'e',
      anchors: {},
      offset: [0, 0, 0],
      partPrefix: 'm_',
      nodePrefix: 'e_',
      target: [],
      meshNames: { barstow_pulley: 'm_pulley' },
      tuning: {},
    });
    expect(r.parts.m_e!.props).toEqual([['func', 'mesh', 'idRef:', 'idX:', 'idY:'], ['rpmspin', 'm_pulley', 'e_e1', 'e_e2', 'e_e3'], ['lowhighbeam', 'SPOTLIGHT', 'e_e1', 'e_e2', 'e_e3']]);
  });
});

describe('a borrowed mesh whose own nodes lie flat (the Autobello’s tie rods, all at one height)', () => {
  it('also binds to the new car’s body, as it took a body node on its own car; one with depth stays as it was', () => {
    const r = transplantSuspension({
      parts: {
        s: {
          slotType: 's',
          nodes: [
            ['id', 'posX', 'posY', 'posZ'],
            { group: 'tierod_F' },
            ['fh3r', -0.53, -1.025, 0.31],
            ['fh3l', 0.53, -1.025, 0.31],
            ['st1r', -0.19, -1.126, 0.31],
            ['st1l', 0.19, -1.126, 0.31],
            { group: 'tierod_M' },
            ['st1rr', -0.295, -1.126, 0.31],
            ['st2r', -0.295, -1.254, 0.24],
            ['st3r', -0.295, -1.283, 0.395],
            ['st3l', 0.295, -1.283, 0.395],
            { group: '' },
          ],
          flexbodies: [['mesh', '[group]:'], ['tierod_F', ['tierod_F']], ['tierod_M', ['tierod_M']]],
        },
      },
      root: 's',
      anchors: {},
      offset: [0, 0, 0],
      partPrefix: 'm_',
      nodePrefix: 'f_',
      target: [],
      meshNames: { tierod_F: 'rod', tierod_M: 'rack' },
      tuning: {},
      fallbackGroup: 'm_body',
    });
    expect(r.parts.m_s!.flexbodies).toEqual([['mesh', '[group]:'], ['rod', ['tierod_F', 'm_body']], ['rack', ['tierod_M']]]);
  });

  it('measures how far points spread out of their plane', () => {
    expect(thickness([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]])).toBeLessThan(1e-6);
    expect(thickness([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeGreaterThan(0.1);
  });
});

describe('a borrowed mesh whose groups keep too few of the set’s nodes (the Hopper’s arms)', () => {
  it('also binds to the new car’s body, so it can be placed; one with enough stays as it was', () => {
    const r = transplantSuspension({
      parts: {
        s: {
          slotType: 's',
          nodes: [['id', 'posX', 'posY', 'posZ'], { group: 'hopper_lowerarm_F' }, ['faxs1r', -0.5, -1.4, 0.3], ['faxs1l', 0.5, -1.4, 0.3], { group: 'hopper_hub_F' }, ['fax1r', -0.7, -1.4, 0.3], ['fax2r', -0.7, -1.3, 0.4], ['fax5r', -0.7, -1.5, 0.35], { group: '' }],
          flexbodies: [['mesh', '[group]:'], ['hopper_lowerarm_F', ['hopper_lowerarm_F']], ['hopper_hub_F', ['hopper_hub_F']]],
        },
      },
      root: 's',
      anchors: {},
      offset: [0, 0, 0],
      partPrefix: 'm_',
      nodePrefix: 'f_',
      target: [],
      meshNames: { hopper_lowerarm_F: 'arm', hopper_hub_F: 'hub' },
      tuning: {},
      fallbackGroup: 'm_body',
    });
    expect(r.parts.m_s!.flexbodies).toEqual([['mesh', '[group]:'], ['arm', ['hopper_lowerarm_F', 'm_body']], ['hub', ['hopper_hub_F']]]);
  });
});

describe('attaching to the new car', () => {
  it('passes over a node too light for the beams that would land on it (the Barstow gearbox on the Autobello exhaust)', () => {
    const r = transplantSuspension({
      parts: { box: { slotType: 'box', nodes: [['id', 'posX', 'posY', 'posZ'], ['tra1', 0, 0, 0.3]], beams: [['id1:', 'id2:'], { beamSpring: 20_000_000 }, ['tra1', 'ex1r']] } },
      root: 'box',
      anchors: { ex1r: [0.3, 0, 0.3] },
      offset: [0, 0, 0],
      partPrefix: 'm_G_',
      nodePrefix: 'g_',
      target: [
        { id: 'e_ex1r', pos: [0.3, 0, 0.3], weight: 0.4 },
        { id: 'e_e1r', pos: [0.2, 0, 0.35], weight: 20 },
      ],
      meshNames: {},
      tuning: {},
    });
    expect(r.attached).toEqual({ ex1r: 'e_e1r' });
  });
});

describe('an attachment point with no body node close by', () => {
  it('stays where the set needs it, bolted to the nearest body nodes and heavy enough for them', () => {
    const r = transplantSuspension({
      parts: { s: { slotType: 's', nodes: [['id', 'posX', 'posY', 'posZ'], ['fh1r', -0.6, -1.3, 0.3]], beams: [['id1:', 'id2:'], ['fh1r', 'fx1r'], ['fh1r', 'fx2r']] } },
      root: 's',
      anchors: { fx1r: [-0.3, -1.45, 0.33], fx2r: [-0.3, -1.42, 0.47] },
      offset: [0, 0, 0],
      partPrefix: 'm_',
      nodePrefix: 'f_',
      target: [
        { id: 'b8r', pos: [-0.3, -1.8, 0.17], weight: 2 },
        { id: 'b13r', pos: [-0.55, -1.6, 0.58], weight: 2 },
        { id: 'b31r', pos: [-0.58, -0.93, 0.17], weight: 2 },
      ],
      meshNames: {},
      tuning: {},
    });
    const nodes = r.parts.m_s!.nodes as unknown[][];
    // Two points, two nodes: they no longer fall onto the same body node.
    expect(nodes.map((n) => n[0])).toEqual(['id', 'f_fh1r', 'f_fx1r', 'f_fx2r']);
    expect(nodes[2]!.slice(1, 4)).toEqual([-0.3, -1.45, 0.33]);
    expect((nodes[2]![4] as { nodeWeight: number }).nodeWeight).toBeGreaterThanOrEqual(2);
    const beams = (r.parts.m_s!.beams as unknown[]).filter(Array.isArray).slice(1) as string[][];
    expect(beams.slice(0, 2)).toEqual([['f_fh1r', 'f_fx1r'], ['f_fh1r', 'f_fx2r']]);
    expect(beams.slice(2).filter(([a]) => a === 'f_fx1r').map(([, b]) => b).sort()).toEqual(['b13r', 'b31r', 'b8r']);
  });
});

describe('a node its own car’s body also held', () => {
  it('is bolted to the new body with springs its weight can carry', () => {
    const r = transplantSuspension({
      parts: { s: { slotType: 's', nodes: [['id', 'posX', 'posY', 'posZ'], { nodeWeight: 0.5 }, ['fx0', 0, -1.1, 0.3], { nodeWeight: 5 }, ['fh5r', -0.6, -1.2, 0.3]], beams: [['id1:', 'id2:'], ['fx0', 'fh5r']] } },
      root: 's',
      anchors: {},
      offset: [0, 0, 0],
      partPrefix: 'm_',
      nodePrefix: 'f_',
      target: [
        { id: 'b1', pos: [0, -1, 0.3] },
        { id: 'b2', pos: [0.3, -1, 0.3] },
        { id: 'b3', pos: [-0.3, -1, 0.3] },
        { id: 'e1', pos: [0, -1.1, 0.35], structural: false },
      ],
      meshNames: {},
      tuning: {},
      held: ['fx0'],
    });
    const rows = r.parts.m_s!.beams as unknown[];
    const pairs = rows.filter(Array.isArray).slice(1) as string[][];
    // To the body's structure only (not the engine's e1), besides its own beam to the hub.
    expect(pairs.filter(([a]) => a === 'f_fx0').map(([, b]) => b).sort()).toEqual(['b1', 'b2', 'b3', 'f_fh5r']);
    const spring = (rows.find((x) => typeof x === 'object' && !Array.isArray(x) && (x as { beamSpring?: number }).beamSpring !== undefined && (x as { beamSpring: number }).beamSpring < 6_000_000) as { beamSpring: number }).beamSpring;
    expect(Math.sqrt((3 * spring) / 0.5) / 2000).toBeLessThanOrEqual(1.5 + 1e-9);
  });
});

describe('bolting a point to the body', () => {
  it('adds a fourth bolt out of the plane when the nearest three lie flat with the point', () => {
    const r = transplantSuspension({
      parts: { s: { slotType: 's', nodes: [['id', 'posX', 'posY', 'posZ'], ['h1', 0, 0, 0.5]], beams: [['id1:', 'id2:'], ['h1', 'st3r']] } },
      root: 's',
      anchors: { st3r: [0, 0, 0] },
      offset: [0, 0, 0],
      partPrefix: 'm_',
      nodePrefix: 'f_',
      target: [
        { id: 'b1', pos: [0.2, 0, 0] },
        { id: 'b2', pos: [-0.2, 0.1, 0] },
        { id: 'b3', pos: [0, -0.2, 0] },
        { id: 'b4', pos: [0.1, 0.3, 0.01] },
        { id: 'b5', pos: [0, 0.2, 0.4] },
      ],
      meshNames: {},
      tuning: {},
    });
    const bolts = ((r.parts.m_s!.beams as unknown[]).filter(Array.isArray) as string[][]).filter(([a]) => a === 'f_st3r').map(([, b]) => b);
    expect(bolts.sort()).toEqual(['b1', 'b2', 'b3', 'b5']);
    expect(planeDistance([0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0])).toBeCloseTo(1);
  });
});
