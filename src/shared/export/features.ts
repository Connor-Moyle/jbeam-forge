import type { Features, Skin } from '../project/schema';
import type { WritableObject, WritableValue } from '../jbeam/serialize';

/**
 * The game's extras (Phase 12d), written the way the stock cars do them
 * (studied in 0.39's pickup, covet and common folder):
 *
 *  - global slots on the main part: paint design, glass tint, plate design;
 *  - licence plates: the game's own `licenseplate` mesh (common/empty.dae),
 *    a flexbody placed with pos/rot on the part it's mounted to;
 *  - tow hitch: a coupler node tagged `tow_hitch`, beamed to the nearest
 *    structure, with the common `towhitch` mesh;
 *  - nitrous: an n2o system part (bottle + shot size sub-slots) on the main
 *    engine, the bottle a node on the nearest structure;
 *  - paint designs: a `paint_design` part per skin, naming its globalSkin.
 */

type Vec3 = [number, number, number];

export const GLOBAL_SLOTS: WritableValue[] = [
  ['paint_design', ['paint_design'], [], '', 'Paint Design'],
  ['skin_glass', ['skin_glass'], [], '', 'Glass Tint'],
  ['licenseplate_design_2_1', ['licenseplate_design_2_1'], [], '', 'License Plate Design'],
];

/** Where the ball sits in common/towhitch.DAE's `towhitch` mesh (it's modelled in place on a car). */
export const TOWHITCH_BALL: Vec3 = [0, 2.77, 0.6];
/** The game's plate: 30.5 × 15.2 cm (common/empty.dae), facing forward (−Y) unturned. */
export const PLATE_SIZE: [number, number] = [0.305, 0.152];
export const N2O_BOTTLE_KG = { '10lb': 4.54, '20lb': 9.07 } as const;
export const N2O_SHOTS_KW = [50, 100, 150] as const;

export interface FeatureContext {
  slug: string;
  author: string;
  /** Node group a part's meshes ride on (null: it has none). */
  groupOf(partId: string): string | null;
  /** Structure nodes to attach to. */
  nodes: readonly { id: string; pos: Vec3; partId: string }[];
  /** Whether the main part will be the part a feature mounts to (it isn't exported as a part otherwise). */
  hasPart(partId: string): boolean;
  /** The body, for anything whose mount part is gone. */
  bodyPartId: string | null;
  /** An engine is fitted (nitrous needs one). */
  hasEngine: boolean;
  /** The fuel tanks the fitted engines draw from, by name (the game's default, mainTank, when not given). */
  fuelStorages?: readonly string[];
}

export interface FeatureExport {
  /** Rows for the main part's slots2. */
  mainSlots: WritableValue[];
  /** part id → rows for its slots2. */
  partSlots: Map<string, WritableValue[]>;
  /** part name → content. */
  parts: Record<string, WritableObject>;
}

export const skinSlug = (skin: Pick<Skin, 'name'>) => skin.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'skin';
/** The game's name for a material in a paint design. */
export const skinMaterialName = (material: string, skin: Pick<Skin, 'name'>) => `${material}.skin.${skinSlug(skin)}`;

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const xyz = (v: readonly number[]) => ({ x: r4(v[0]!), y: r4(v[1]!), z: r4(v[2]!) });

/** The `count` nodes nearest `at`, preferring the mount part's own. */
export function nearestNodes(ctx: Pick<FeatureContext, 'nodes'>, at: Vec3, partId: string, count = 6): string[] {
  const own = ctx.nodes.filter((n) => n.partId === partId);
  const pool = own.length >= 3 ? own : ctx.nodes;
  const d = (p: Vec3) => (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 + (p[2] - at[2]) ** 2;
  return [...pool]
    .sort((a, b) => d(a.pos) - d(b.pos))
    .slice(0, count)
    .map((n) => n.id);
}

/** A node id not already taken. */
function freeId(ctx: Pick<FeatureContext, 'nodes'>, base: string): string {
  const taken = new Set(ctx.nodes.map((n) => n.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
  return id;
}

export function buildFeatureParts(features: Features, ctx: FeatureContext): FeatureExport {
  const out: FeatureExport = { mainSlots: [...GLOBAL_SLOTS], partSlots: new Map(), parts: {} };
  const info = (name: string, value: number) => ({ authors: ctx.author || 'JBeam Forge', name, value });
  const mountOf = (partId: string) => (ctx.hasPart(partId) ? partId : ctx.bodyPartId);
  /** Declare a slot on the mount part (or the main part), filled by default. */
  const slotOn = (partId: string | null, row: WritableValue) => {
    if (!partId) return void out.mainSlots.push(row);
    const rows = out.partSlots.get(partId) ?? [];
    rows.push(row);
    out.partSlots.set(partId, rows);
  };
  const flexRow = (mesh: string, group: string, pos: Vec3, rot: Vec3) => [mesh, [group], [], { pos: xyz(pos), rot: xyz(rot), scale: { x: 1, y: 1, z: 1 } }];

  for (const [end, label, turn] of [['front', 'Front License Plate', 0], ['rear', 'Rear License Plate', 180]] as const) {
    const plate = features.plates[end];
    if (!plate) continue;
    const mount = mountOf(plate.partId);
    const group = mount ? ctx.groupOf(mount) : null;
    if (!group) continue;
    const name = `${ctx.slug}_licenseplate_${end === 'front' ? 'F' : 'R'}`;
    out.parts[name] = {
      information: info(label, 0),
      slotType: name,
      flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], flexRow('licenseplate', group, plate.pos, [plate.tilt, 0, turn])],
    };
    slotOn(mount, [name, [name], [], name, label]);
  }

  if (features.hitch) {
    const h = features.hitch;
    const mount = mountOf(h.partId);
    const group = mount ? ctx.groupOf(mount) : null;
    const anchors = mount ? nearestNodes(ctx, h.pos, mount) : [];
    if (anchors.length >= 3) {
      const name = `${ctx.slug}_towhitch`;
      const id = freeId(ctx, 'tw_hitch');
      const ball: Vec3 = [h.pos[0] - TOWHITCH_BALL[0], h.pos[1] - TOWHITCH_BALL[1], h.pos[2] - TOWHITCH_BALL[2]];
      out.parts[name] = {
        information: info('Tow Hitch', 410),
        slotType: name,
        ...(group ? { flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], flexRow('towhitch', group, ball, [0, 0, 0])] } : {}),
        nodes: [
          ['id', 'posX', 'posY', 'posZ'],
          { collision: true, selfCollision: true, frictionCoef: 0.5, nodeMaterial: '|NM_METAL', nodeWeight: 4.7, group: name },
          [id, r4(h.pos[0]), r4(h.pos[1]), r4(h.pos[2]), { couplerTag: 'tow_hitch', couplerStrength: 2001000, couplerRadius: 1, breakGroup: `${name}_break` }],
        ],
        beams: [
          ['id1:', 'id2:'],
          { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1, beamShortBound: 1 },
          { beamSpring: 1264150, beamDamp: 183.3, beamDeform: 20300, beamStrength: 623000, breakGroup: `${name}_break` },
          ...anchors.map((a) => [id, a]),
          { breakGroup: '' },
        ],
      };
      slotOn(mount, [name, [name], [], name, 'Tow Hitch']);
    }
  }

  if (features.nitrous && ctx.hasEngine) {
    const n = features.nitrous;
    const mount = mountOf(n.partId);
    const group = mount ? ctx.groupOf(mount) : null;
    const anchors = mount ? nearestNodes(ctx, n.pos, mount) : [];
    if (anchors.length >= 3) {
      const system = `${ctx.slug}_n2o`;
      const bottle = `${ctx.slug}_n2o_bottle_${n.bottle}`;
      const id = freeId(ctx, 'n2o');
      const kg = N2O_BOTTLE_KG[n.bottle];
      out.parts[system] = {
        information: info('Nitrous Oxide Injection', 350),
        slotType: system,
        slots2: [
          ['name', 'allowTypes', 'denyTypes', 'default', 'description'],
          [`${system}_bottle`, [`${system}_bottle`], [], bottle, 'Nitrous Oxide Bottle'],
          [`${system}_shot`, [`${system}_shot`], [], `${system}_shot_${n.shotKw}`, 'Nitrous Oxide Shot Size'],
        ],
        variables: [
          ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
          ['$n2o_rpm', 'range', 'RPM', 'Nitrous Oxide', 3000, 1250, 6000, 'Minimum RPM', 'Minimum RPM where nitrous oxide can spray', { stepDis: 50 }],
          ['$n2o_gear', 'range', 'Gear', 'Nitrous Oxide', 2, 1, 6, 'Minimum Gear', 'Minimum gear where nitrous oxide can spray', { minDis: 1, maxDis: 6, stepDis: 1 }],
        ],
        mainEngine: { nitrousOxideInjection: 'n2o' },
        n2o: { cutInRPM: '$n2o_rpm', minimumGear: '$n2o_gear' },
        controller: [['fileName'], ['nitrousOxideInjection', {}]],
      };
      out.parts[bottle] = {
        information: info(`${n.bottle} Nitrous Oxide Bottle`, n.bottle === '10lb' ? 200 : 300),
        slotType: `${system}_bottle`,
        ...(group ? { flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], flexRow(`n2o_bottle_${n.bottle}`, group, n.pos, [0, 0, 0])] } : {}),
        energyStorage: [['type', 'name'], ['n2oTank', 'mainBottle']],
        mainBottle: { capacity: kg, startingCapacity: kg },
        // The bottle joins the engine's tanks; it must not replace them. Written as mainTank alone,
        // an engine with tanks of other names (the Bolide's fueltank_R and fueltank_L) had no fuel
        // and never started.
        mainEngine: { energyStorage: [...(ctx.fuelStorages?.length ? ctx.fuelStorages : ['mainTank']), 'mainBottle'] },
        nodes: [
          ['id', 'posX', 'posY', 'posZ'],
          { collision: true, selfCollision: false, frictionCoef: 0.5, nodeMaterial: '|NM_METAL', nodeWeight: r4(kg * 1.2 + 4), group: bottle },
          [id, r4(n.pos[0]), r4(n.pos[1]), r4(n.pos[2])],
        ],
        beams: [['id1:', 'id2:'], { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1, beamShortBound: 1 }, { beamSpring: 470940, beamDamp: 141, beamDeform: 9500, beamStrength: 95000 }, ...anchors.map((a) => [id, a])],
      };
      for (const kw of new Set([...N2O_SHOTS_KW, n.shotKw])) out.parts[`${system}_shot_${kw}`] = { information: info(`${kw}kW Shot Size`, 100), slotType: `${system}_shot`, n2o: { addedPower: kw } };
      out.mainSlots.push([system, [system], [], system, 'Nitrous Oxide Injection']);
    }
  }

  for (const skin of features.skins) {
    const name = `${ctx.slug}_skin_${skinSlug(skin)}`;
    out.parts[name] = { information: info(skin.name, 500), slotType: 'paint_design', globalSkin: skinSlug(skin) };
  }
  return out;
}
