import { isJbeamObject, type JbeamObject } from '../jbeam/parse';
import { readTable } from '../jbeam/tables';
import { Solver, type SimModel } from '../sim/solver';
import { coordinate, definedNodes, definedWeights, variableDefaults } from './transplant';
import { setWheels } from './wheels';

type V3 = readonly [number, number, number];

/**
 * A suspension worked through its travel, to see what the wheel does on the way: how its camber
 * and toe change as it rises and falls (bump steer shows as toe that moves with travel). The set's
 * own jbeam is put on a rig: the points it bolts to on its car are held still, a load is put on the
 * wheel from below, step by step, and where the wheel's axle points is read off at each step. The
 * springs, dampers and bump stops are the set's own, so the travel for each load is what the game
 * gives.
 *
 * Struts and steering racks that slide a node along a rail are held to their rails. Tyres,
 * anti-roll bars and the steering's own movement are not in it: each wheel is worked on its own
 * with the steering held straight.
 */
export interface SweepPoint {
  /** Load on the wheel from below, N (negative: pulled down, the wheel hanging). */
  load: number;
  /** How far the wheel has risen from where the jbeam draws it, mm. */
  travel: number;
  /** Degrees; negative with the top of the wheel leaning in. */
  camber: number;
  /** Degrees; positive with the front of the wheel pointing in. */
  toeIn: number;
}

export interface WheelSweep {
  wheel: string;
  points: SweepPoint[];
}

export interface SweepResult {
  wheels: WheelSweep[];
  /** Why there is nothing to show, when there isn't. */
  problem: string | null;
}

/** Loads tried on each wheel, N: from hanging to about twice a family car's corner weight. */
export const SWEEP_LOADS = [-1000, -500, 0, 1000, 2000, 3000, 4000, 5500, 7000] as const;

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** More travel than this (mm) is a wheel that has come loose on the rig. */
const MAX_TRAVEL_MM = 450;

const DEFAULT_SPRING = 4_300_000;
const DEFAULT_DAMP = 580;

interface Rig {
  model: SimModel;
  precompression: number[];
  index: Map<string, number>;
  /** Hubs put in for wheels whose hub comes with the wheel part. */
  hubs: { wheel: string; inner: string; outer: string }[];
  /** Nodes held to a rail (a strut's slider, a steering rack): the node, the rail's nodes in order, and the spring holding it there. */
  slides: { node: number; rail: number[]; spring: number }[];
}

/** A stand-in hub's two nodes: how far apart along the axle (m), and what each weighs (kg). */
const HUB_WIDTH = 0.2;
const HUB_KG = 8;

function buildRig(parts: Readonly<Record<string, JbeamObject>>, anchors: Readonly<Record<string, V3>>, tuning: Readonly<Record<string, number>>): Rig {
  const vars = variableDefaults(Object.values(parts));
  for (const [k, v] of Object.entries(tuning)) vars.set(k, v);
  const ids: string[] = [];
  const pos: number[] = [];
  const mass: number[] = [];
  const index = new Map<string, number>();
  const hubs: { wheel: string; inner: string; outer: string }[] = [];
  // Every node name the set's beams use.
  const referenced = new Set<string>();
  for (const part of Object.values(parts)) if (Array.isArray(part.beams)) for (const row of part.beams) if (Array.isArray(row)) for (const c of row.slice(0, 2)) if (typeof c === 'string') referenced.add(c);
  for (const part of Object.values(parts)) {
    const weights = definedWeights(part, vars);
    for (const [id, p] of definedNodes(part, vars)) {
      if (index.has(id)) continue;
      index.set(id, ids.length);
      ids.push(id);
      pos.push(p[0], p[1], p[2]);
      mass.push(weights.get(id) ?? 5);
    }
  }
  // A hub that comes with the game's wheel part: its two nodes are put where the suspension's wheel
  // slot puts the wheel, a hand's width apart along the axle. The beams the suspension has to them
  // take their length from there, so the linkage is whole; how far out the real wheel sits depends
  // on the wheel fitted and changes these angles very little.
  for (const w of setWheels(parts)) {
    if (w.exact) continue;
    for (const end of ['f', 'r']) {
      const side = w.side.toLowerCase();
      const inner = `${end}w1${side}`;
      const outer = `${end}w1${side}${side}`;
      if (index.has(inner) || index.has(outer) || !referenced.has(inner) || !referenced.has(outer)) continue;
      for (const [id, along] of [[inner, 0], [outer, HUB_WIDTH]] as const) {
        index.set(id, ids.length);
        ids.push(id);
        pos.push(w.centre[0] + w.axis[0] * along, w.centre[1] + w.axis[1] * along, w.centre[2] + w.axis[2] * along);
        mass.push(HUB_KG);
      }
      hubs.push({ wheel: `${end.toUpperCase()}${w.side}`, inner, outer });
    }
  }
  // The points on the car: held still.
  for (const [id, p] of Object.entries(anchors)) {
    if (index.has(id)) continue;
    index.set(id, ids.length);
    ids.push(id);
    pos.push(p[0], p[1], p[2]);
    mass.push(0);
  }
  const a: number[] = [];
  const b: number[] = [];
  const spring: number[] = [];
  const damp: number[] = [];
  const type: number[] = [];
  const longBound: number[] = [];
  const shortBound: number[] = [];
  const limitSpring: number[] = [];
  const limitDamp: number[] = [];
  const precompression: number[] = [];
  const seen = new Set<string>();
  for (const part of Object.values(parts))
    for (const section of ['beams', 'hydros'] as const) {
      const table = part[section];
      if (!Array.isArray(table)) continue;
      let records: ReturnType<typeof readTable>['records'] = [];
      try {
        records = readTable(table).records;
      } catch {
        continue;
      }
      for (const r of records) {
        const i = index.get(text(r.values['id1:']));
        const j = index.get(text(r.values['id2:']));
        if (i === undefined || j === undefined || i === j) continue;
        const kind = typeof r.options.beamType === 'string' ? r.options.beamType : '|NORMAL';
        const key = `${Math.min(i, j)}|${Math.max(i, j)}|${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const num = (v: unknown, fallback: number) => {
          const n = coordinate(v as never, vars);
          return Number.isFinite(n) ? n : fallback;
        };
        a.push(i);
        b.push(j);
        spring.push(Math.max(0, num(r.options.beamSpring, DEFAULT_SPRING)));
        damp.push(Math.max(0, num(r.options.beamDamp, DEFAULT_DAMP)));
        type.push(kind === '|SUPPORT' ? 1 : kind === '|BOUNDED' ? 2 : 0);
        longBound.push(num(r.options.beamLongBound, 1));
        shortBound.push(num(r.options.beamShortBound, 1));
        limitSpring.push(Math.max(0, num(r.options.beamLimitSpring, 0)));
        limitDamp.push(Math.max(0, num(r.options.beamLimitDamp, 0)));
        precompression.push(section === 'hydros' ? 1 : num(r.options.beamPrecompression, 1));
      }
    }
  const m = a.length;
  const model: SimModel = {
    nodeIds: ids,
    pos: Float64Array.from(pos),
    mass: Float64Array.from(mass),
    friction: new Float64Array(ids.length).fill(0.5),
    collide: new Uint8Array(ids.length),
    beamA: Uint32Array.from(a),
    beamB: Uint32Array.from(b),
    spring: Float64Array.from(spring),
    damp: Float64Array.from(damp),
    deform: new Float64Array(m).fill(Infinity),
    strength: new Float64Array(m).fill(Infinity),
    expansionLimit: new Float64Array(m).fill(10),
    compressionLimit: new Float64Array(m).fill(0.01),
    beamType: Uint8Array.from(type),
    longBound: Float64Array.from(longBound),
    shortBound: Float64Array.from(shortBound),
    limitSpring: Float64Array.from(limitSpring),
    limitDamp: Float64Array.from(limitDamp),
    breakGroup: new Int32Array(m).fill(-1),
    breakGroups: [],
    beamPart: new Array<string>(m).fill(''),
  };
  // Rails, and the nodes that slide on them.
  const rails = new Map<string, number[]>();
  for (const part of Object.values(parts)) {
    if (!isJbeamObject(part.rails)) continue;
    for (const [name, rail] of Object.entries(part.rails)) {
      const links = isJbeamObject(rail) && Array.isArray(rail['links:']) ? rail['links:'].map((id) => index.get(text(id))) : [];
      if (links.length >= 2 && links.every((n) => n !== undefined)) rails.set(name, links);
    }
  }
  const slides: Rig['slides'] = [];
  for (const part of Object.values(parts)) {
    if (!Array.isArray(part.slidenodes)) continue;
    try {
      for (const r of readTable(part.slidenodes).records) {
        const node = index.get(text(r.values['id:']));
        const rail = rails.get(text(r.values.railName));
        if (node === undefined || !rail || rail.includes(node) || mass[node] === 0) continue;
        const k = coordinate(r.values.spring, vars);
        // No stiffer than the node's weight lets the rig take in one step.
        slides.push({ node, rail, spring: Math.min(Number.isFinite(k) && k > 0 ? k : 2_000_000, mass[node]! * 1_200_000) });
      }
    } catch {
      // not a table
    }
  }
  return { model, precompression, index, hubs, slides };
}

/** The wheels a set makes and the two nodes each turns on (inner first), where the set defines them itself. */
function wheelAxles(parts: Readonly<Record<string, JbeamObject>>, rig: Rig): { wheel: string; inner: number; outer: number }[] {
  const index = rig.index;
  const out: { wheel: string; inner: number; outer: number }[] = rig.hubs.map((h) => ({ wheel: h.wheel, inner: index.get(h.inner)!, outer: index.get(h.outer)! }));
  for (const part of Object.values(parts))
    for (const section of ['pressureWheels', 'hubWheels'] as const) {
      const table = part[section];
      if (!Array.isArray(table)) continue;
      try {
        for (const r of readTable(table).records) {
          const name = r.values.name;
          const n1 = index.get(text(r.values['node1:']));
          const n2 = index.get(text(r.values['node2:']));
          if (typeof name !== 'string' || n1 === undefined || n2 === undefined || out.some((w) => w.wheel === name)) continue;
          out.push({ wheel: name, inner: n1, outer: n2 });
        }
      } catch {
        // not a table
      }
    }
  return out;
}

/**
 * Hold a sliding node to its rail for one step: a spring (and some damping) from the node to the
 * nearest point of the rail, with the same force back on the rail's two nodes there.
 */
function railForce(solver: Solver, mass: Float64Array, s: { node: number; rail: number[]; spring: number }): void {
  const x = solver.x;
  const n = s.node * 3;
  let best = { d: Infinity, a: 0, b: 0, u: 0, p: [0, 0, 0] };
  for (let i = 0; i + 1 < s.rail.length; i++) {
    const a = s.rail[i]! * 3;
    const b = s.rail[i + 1]! * 3;
    const ab = [x[b]! - x[a]!, x[b + 1]! - x[a + 1]!, x[b + 2]! - x[a + 2]!];
    const len2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2 || 1e-9;
    // The game lets a slider run on past the ends of a rail that isn't capped; so does this.
    const u = ((x[n]! - x[a]!) * ab[0]! + (x[n + 1]! - x[a + 1]!) * ab[1]! + (x[n + 2]! - x[a + 2]!) * ab[2]!) / len2;
    const p = [x[a]! + ab[0]! * u, x[a + 1]! + ab[1]! * u, x[a + 2]! + ab[2]! * u];
    const d = (p[0]! - x[n]!) ** 2 + (p[1]! - x[n + 1]!) ** 2 + (p[2]! - x[n + 2]!) ** 2;
    const inside = u >= 0 && u <= 1;
    if (d < best.d && (inside || s.rail.length === 2 || best.d === Infinity)) best = { d, a, b, u, p };
  }
  const damping = 0.6 * Math.sqrt(s.spring * mass[s.node]!);
  for (let k = 0; k < 3; k++) {
    const force = s.spring * (best.p[k]! - x[n + k]!) - damping * solver.v[n + k]!;
    solver.extForce[n + k] = solver.extForce[n + k]! + force;
    // The rail takes it back, shared by where along it the slider is.
    const u = Math.max(0, Math.min(1, best.u));
    if (mass[best.a / 3]! > 0) solver.extForce[best.a + k] = solver.extForce[best.a + k]! - force * (1 - u);
    if (mass[best.b / 3]! > 0) solver.extForce[best.b + k] = solver.extForce[best.b + k]! - force * u;
  }
}

const deg = (rad: number) => Math.round(((rad * 180) / Math.PI) * 100) / 100;

/** Work every wheel of a set through its travel. `settleSteps` is how long each load is held (2,000 a second). */
export function sweepSuspension(parts: Readonly<Record<string, JbeamObject>>, anchors: Readonly<Record<string, V3>>, tuning: Readonly<Record<string, number>> = {}, settleSteps = 3000): SweepResult {
  const rig = buildRig(parts, anchors, tuning);
  if (!rig.model.beamA.length) return { wheels: [], problem: 'This set has no beams to work.' };
  // (Torsion bars are left out: those are anti-roll bars, which tie one side to the other and don't locate a wheel.)
  const axles = wheelAxles(parts, rig);
  if (!axles.length) return { wheels: [], problem: 'No wheel was found on this suspension to work. Spawn the car to see it move.' };
  const wheels: WheelSweep[] = [];
  for (const axle of axles) {
    // Each wheel on its own rig, from rest.
    const solver = new Solver(rig.model, { gravity: 0 });
    solver.gravityOn = false;
    rig.precompression.forEach((p, i) => {
      solver.rest[i] = solver.rest[i]! * p;
      solver.rest0[i] = solver.rest0[i]! * p;
    });
    // The axle's nodes may sit inboard or outboard of each other in the table: the outer is the one further from the car's middle.
    const x = (n: number) => solver.x[n * 3]!;
    const [inner, outer] = Math.abs(x(axle.inner)) <= Math.abs(x(axle.outer)) ? [axle.inner, axle.outer] : [axle.outer, axle.inner];
    const z0 = (rig.model.pos[inner * 3 + 2]! + rig.model.pos[outer * 3 + 2]!) / 2;
    const points: SweepPoint[] = [];
    for (const load of SWEEP_LOADS) {
      let held = true;
      for (let step = 0; step < settleSteps && held; step++) {
        solver.extForce.fill(0);
        solver.extForce[inner * 3 + 2] = load / 2;
        solver.extForce[outer * 3 + 2] = load / 2;
        for (const s of rig.slides) railForce(solver, rig.model.mass, s);
        // Without rails the load is all there is: the rig can take the whole stretch at once.
        if (!rig.slides.length) {
          held = solver.step(settleSteps) && !solver.divergence;
          break;
        }
        held = solver.step(1) && !solver.divergence;
      }
      if (!held) break;
      const ax = solver.x[outer * 3]! - solver.x[inner * 3]!;
      const ay = solver.x[outer * 3 + 1]! - solver.x[inner * 3 + 1]!;
      const az = solver.x[outer * 3 + 2]! - solver.x[inner * 3 + 2]!;
      const z = (solver.x[inner * 3 + 2]! + solver.x[outer * 3 + 2]!) / 2;
      points.push({ load, travel: Math.round((z - z0) * 1000), camber: deg(-Math.atan2(az, Math.hypot(ax, ay))), toeIn: deg(-Math.atan2(ay, Math.abs(ax))) });
    }
    // A wheel that flew off the rig or turned over is a linkage this rig doesn't hold, not a result.
    const sane = points.every((p) => Math.abs(p.travel) < MAX_TRAVEL_MM && Math.abs(p.camber) < 25 && Math.abs(p.toeIn) < 25);
    if (points.length >= 2 && sane) wheels.push({ wheel: axle.wheel, points });
  }
  return { wheels, problem: wheels.length ? null : 'The suspension would not hold together on the rig (something that locates its wheel isn’t in its own parts), so there is nothing to show. Spawn the car to see it move.' };
}

/** What a sweep says in a line: how much camber and toe change over the travel, for the worst wheel. */
export function sweepSummary(result: SweepResult): { travel: number; camberChange: number; toeChange: number } | null {
  let best: { travel: number; camberChange: number; toeChange: number } | null = null;
  for (const w of result.wheels) {
    const span = (pick: (p: SweepPoint) => number) => Math.max(...w.points.map(pick)) - Math.min(...w.points.map(pick));
    const s = { travel: span((p) => p.travel), camberChange: Math.round(span((p) => p.camber) * 100) / 100, toeChange: Math.round(span((p) => p.toeIn) * 100) / 100 };
    if (!best || s.toeChange > best.toeChange) best = s;
  }
  return best;
}
