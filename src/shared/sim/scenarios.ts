import { Solver, type Obstacle, type SimModel } from './solver';

/**
 * One-click sandbox scenarios (SPEC §4.6). Each runs a fresh solver on the
 * model and summarises what happened. They validate structure — stability,
 * sag, what breaks and where — not BeamNG's exact behaviour.
 */

export type ScenarioId = 'settle' | 'drop' | 'corner-drop' | 'yank' | 'crash-pole' | 'crash-wall' | 'crash-offset' | 'hinge-swing' | 'hinge-yank' | 'suspension-drop';

/** What a hinge scenario needs to know about the hinge (a subset of the project's Hinge). */
export interface HingeSpec {
  partId: string;
  axis: [[number, number, number], [number, number, number]];
  openAngle: number;
  direction: 1 | -1;
  strength: number;
}

export interface ScenarioResult {
  scenario: ScenarioId;
  /** Simulated seconds. */
  seconds: number;
  diverged: { nodeId: string; speed: number; atSeconds: number } | null;
  /** Beams broken, in order. */
  broken: number[];
  /** Per node: displacement from the start (m), after re-basing for rigid motion where meaningful. */
  nodeDisplacement: Float32Array;
  /** Per beam: max |force| / strength (0–1+) — the stress heatmap. */
  beamStress: Float32Array;
  /** Per beam: plastic change of rest length (m). */
  beamPlastic: Float32Array;
  /** Final positions (for display). */
  positions: Float32Array;
  /** Rigid obstacles the scenario used (drawn in the viewport). */
  obstacles: Obstacle[];
  summary: string[];
}

function finish(s: Solver, scenario: ScenarioId, seconds: number, start: Float64Array, summary: string[]): ScenarioResult {
  const n = s.n;
  const disp = new Float32Array(n);
  for (let i = 0; i < n; i++) disp[i] = Math.hypot(s.x[i * 3]! - start[i * 3]!, s.x[i * 3 + 1]! - start[i * 3 + 1]!, s.x[i * 3 + 2]! - start[i * 3 + 2]!);
  const stress = new Float32Array(s.m);
  const plastic = new Float32Array(s.m);
  for (let b = 0; b < s.m; b++) {
    const lim = Number.isFinite(s.model.strength[b]!) ? s.model.strength[b]! : Math.max(1, s.model.deform[b]! * 3);
    stress[b] = s.broken[b] ? 1.5 : s.beamForceMax[b]! / lim;
    plastic[b] = s.rest[b]! - s.rest0[b]!;
  }
  const d = s.divergence;
  if (d) summary.unshift(`Diverged at ${(d.step * s.dt).toFixed(3)} s: node ${d.nodeId} reached ${Math.round(d.speed)} m/s. Add mass to it or soften its beams.`);
  return {
    scenario,
    seconds,
    diverged: d ? { nodeId: d.nodeId, speed: d.speed, atSeconds: d.step * s.dt } : null,
    broken: [...s.breakLog],
    nodeDisplacement: disp,
    beamStress: stress,
    beamPlastic: plastic,
    positions: Float32Array.from(s.x),
    obstacles: s.obstacles.map((o) => ({ ...o })),
    summary,
  };
}

/** Lift the structure so its lowest node sits `clearance` above the ground. */
function placeOnGround(s: Solver, clearance: number): void {
  let minZ = Infinity;
  for (let i = 0; i < s.n; i++) minZ = Math.min(minZ, s.x[i * 3 + 2]!);
  const dz = clearance - minZ;
  s.transform(([x, y, z]) => [x, y, z + dz]);
}

function bounds(s: Solver) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.n; i++)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, s.x[i * 3 + k]!);
      hi[k] = Math.max(hi[k]!, s.x[i * 3 + k]!);
    }
  return { lo, hi };
}

function run(s: Solver, seconds: number): void {
  const steps = Math.round(seconds / s.dt);
  const chunk = 200;
  for (let done = 0; done < steps; done += chunk) if (!s.step(Math.min(chunk, steps - done))) return;
}

/**
 * Four jack stands under the wheel positions (about 18 % from the front and 20 %
 * from the rear, ±35 % of the width): the lowest nodes near each point are held
 * by stiff springs. Until suspension exists (Phase 10) this is how a body is
 * supported, so a settle measures chassis flex, not the car lying on its skirts.
 */
export function standNodes(s: Solver): number[] {
  const { lo, hi } = bounds(s);
  const L = hi[1]! - lo[1]!;
  const W = hi[0]! - lo[0]!;
  const H = hi[2]! - lo[2]!;
  const cx = (lo[0]! + hi[0]!) / 2;
  const targets: [number, number][] = [
    [cx + 0.35 * W, lo[1]! + 0.18 * L],
    [cx - 0.35 * W, lo[1]! + 0.18 * L],
    [cx + 0.35 * W, hi[1]! - 0.2 * L],
    [cx - 0.35 * W, hi[1]! - 0.2 * L],
  ];
  const picked: number[] = [];
  for (const [tx, ty] of targets) {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < s.n; i++) {
      if (picked.includes(i) || s.model.mass[i] === 0) continue;
      const z = s.x[i * 3 + 2]!;
      if (z > lo[2]! + 0.4 * H) continue; // low nodes only (sills, floor)
      const d = Math.hypot(s.x[i * 3]! - tx, s.x[i * 3 + 1]! - ty) + (z - lo[2]!) * 0.5;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) picked.push(best);
  }
  return picked;
}

/** Settle under gravity: sag heatmap (how far each node drops relative to the start pose). */
export function settle(model: SimModel, seconds = 2, supports: 'stands' | 'ground' = 'stands'): ScenarioResult {
  const s = new Solver(model);
  placeOnGround(s, supports === 'stands' ? 0.3 : 0.005);
  if (supports === 'stands') {
    for (const node of standNodes(s)) {
      // Stiff enough to carry the car, soft enough to stay stable at 2000 Hz for light nodes.
      const m = model.mass[node]!;
      s.anchors.push({ node, point: [s.x[node * 3]!, s.x[node * 3 + 1]!, s.x[node * 3 + 2]!], stiffness: Math.min(5e6, 2e6 * Math.max(0.5, m)), damping: 4000 });
    }
  }
  const start = Float64Array.from(s.x);
  run(s, seconds);
  const summary: string[] = [];
  let maxSag = 0;
  let maxNode = '';
  for (let i = 0; i < s.n; i++) {
    const sag = start[i * 3 + 2]! - s.x[i * 3 + 2]!;
    if (sag > maxSag) {
      maxSag = sag;
      maxNode = model.nodeIds[i]!;
    }
  }
  summary.push(`${supports === 'stands' ? 'On four stands under the wheel positions' : 'Resting on the ground'}: max sag ${(maxSag * 1000).toFixed(0)} mm at ${maxNode || '—'}; kinetic energy at the end ${s.kineticEnergy().toFixed(1)} J.`);
  if (s.breakLog.length) summary.push(`${s.breakLog.length} beam(s) broke just from sitting still: they are far too weak.`);
  return finish(s, 'settle', seconds, start, summary);
}

/** Flat drop from `height` metres. */
export function drop(model: SimModel, height = 1, seconds = 1.5): ScenarioResult {
  const s = new Solver(model);
  placeOnGround(s, height);
  const start = Float64Array.from(s.x);
  run(s, seconds);
  const plastic = s.rest.reduce((m, r, b) => Math.max(m, Math.abs(r - s.rest0[b]!)), 0);
  return finish(s, 'drop', seconds, start, [`Dropped ${height} m: ${s.breakLog.length} beam(s) broke; largest permanent beam deformation ${(plastic * 1000).toFixed(0)} mm.`]);
}

/** Drop tilted by `angleDeg` about a diagonal so one corner lands first. */
export function cornerDrop(model: SimModel, angleDeg = 20, height = 0.5, seconds = 1.5): ScenarioResult {
  const s = new Solver(model);
  const c = s.centroid();
  const a = (angleDeg * Math.PI) / 180;
  const k = [Math.SQRT1_2, Math.SQRT1_2, 0]; // rotation axis: diagonal in the ground plane
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  s.transform(([x, y, z]) => {
    const v = [x - c[0], y - c[1], z - c[2]];
    const dot = k[0]! * v[0]! + k[1]! * v[1]! + k[2]! * v[2]!;
    const cr = [k[1]! * v[2]! - k[2]! * v[1]!, k[2]! * v[0]! - k[0]! * v[2]!, k[0]! * v[1]! - k[1]! * v[0]!];
    return [0, 1, 2].map((i) => v[i]! * cos + cr[i]! * sin + k[i]! * dot * (1 - cos) + c[i]!) as [number, number, number];
  });
  placeOnGround(s, height);
  const start = Float64Array.from(s.x);
  run(s, seconds);
  return finish(s, 'corner-drop', seconds, start, [`${angleDeg}° corner drop from ${height} m: ${s.breakLog.length} beam(s) broke.`]);
}

/**
 * Attachment yank: pull one part's nodes away from the car with a slowly rising
 * force until it detaches. Good behaviour: it comes off at its attachment
 * breakGroup, not by tearing its own skin.
 */
export function yank(model: SimModel, partId: string, direction: [number, number, number] = [0, 0, 1], maxForce = 60_000, seconds = 1.5): ScenarioResult {
  const s = new Solver(model);
  placeOnGround(s, 0.005);
  s.gravityOn = false;
  const start = Float64Array.from(s.x);
  const partNodes = new Set<number>();
  for (let b = 0; b < s.m; b++) if (model.beamPart[b] === partId) {
    partNodes.add(model.beamA[b]!);
    partNodes.add(model.beamB[b]!);
  }
  // Only nodes owned by the part: those not also on a beam of another part except its attachment beams.
  const own = [...partNodes];
  // Pin the rest of the car in place by making it very heavy relative to the pull.
  const steps = Math.round(seconds / s.dt);
  const len = Math.hypot(...direction) || 1;
  const dir = direction.map((d) => d / len);
  let detachedAt: number | null = null;
  for (let t = 0; t < steps; t += 50) {
    const F = (maxForce * t) / steps / Math.max(1, own.length);
    s.extForce.fill(0);
    for (const i of own) for (let k = 0; k < 3; k++) s.extForce[i * 3 + k] = F * dir[k]!;
    if (!s.step(50)) break;
    if (detachedAt === null && s.breakLog.some((b) => model.breakGroup[b]! >= 0 && model.beamPart[b] === partId)) detachedAt = F * own.length;
  }
  const attachBroken = s.breakLog.filter((b) => model.beamPart[b] === partId && model.breakGroup[b]! >= 0).length;
  const skinBroken = s.breakLog.filter((b) => model.beamPart[b] === partId && model.breakGroup[b]! < 0).length;
  const summary = [
    detachedAt !== null ? `Detached at about ${(detachedAt / 1000).toFixed(1)} kN via its attachment breakGroup.` : `Did not detach under ${(maxForce / 1000).toFixed(0)} kN.`,
    skinBroken > attachBroken ? `Warning: ${skinBroken} of its own beams tore — it rips apart before it unbolts. Strengthen its skin or weaken its attachment.` : `Clean: ${attachBroken} attachment beam(s) broke, ${skinBroken} skin beam(s).`,
  ];
  return finish(s, 'yank', seconds, start, summary);
}

/** Drive into a rigid obstacle at `kmh`: stress heatmap + what broke. Front is −Y in BeamNG space. */
export function crash(model: SimModel, kind: 'pole' | 'wall' | 'offset', kmh = 50, seconds = 0.35): ScenarioResult {
  const s = new Solver(model);
  placeOnGround(s, 0.005);
  const { lo, hi } = bounds(s);
  const front = lo[1]!;
  const gap = 0.05;
  const cx = (lo[0]! + hi[0]!) / 2;
  const width = hi[0]! - lo[0]!;
  const obstacle: Obstacle =
    kind === 'pole'
      ? { kind: 'pole', x: cx, y: front - gap - 0.15, radius: 0.15 }
      : kind === 'wall'
        ? { kind: 'wall', x: cx, y: front - gap, nx: 0, ny: 1 }
        : { kind: 'wall', x: cx + width * 0.3, y: front - gap, nx: 0, ny: 1, halfWidth: width * 0.2 }; // 40 % offset barrier on the left side
  s.obstacles = [obstacle];
  const speed = kmh / 3.6;
  for (let i = 0; i < s.n; i++) s.v[i * 3 + 1] = -speed;
  const start = Float64Array.from(s.x);
  run(s, seconds);
  // Intrusion: how much the car got shorter (front crush), relative to rigid motion.
  const after = bounds(s);
  const crush = hi[1]! - lo[1]! - (after.hi[1]! - after.lo[1]!);
  const labels = { pole: 'pole', wall: 'full-width wall', offset: '40 % offset barrier' } as const;
  const crushText = crush > 0.005 ? `front crushed ${(crush * 1000).toFixed(0)} mm` : 'no lasting crush (it sprang back)';
  return finish(s, `crash-${kind}` as ScenarioId, seconds, start, [`${kmh} km/h into a ${labels[kind]}: ${crushText}, ${s.breakLog.length} beam(s) broke.`]);
}

type V = [number, number, number];

/** The hinged part's own nodes (not the body nodes its hinge beams reach). */
function ownNodes(model: SimModel, partId: string): number[] {
  if (model.nodePart) {
    const mine = (i: number) => model.nodePart![i] === partId;
    // Nodes of the part that are bolted rigidly to the body (the latch's body half) stay with the body.
    const bodyLinks = new Uint16Array(model.mass.length);
    for (let b = 0; b < model.beamA.length; b++) {
      if (model.beamType[b] !== 0 || model.breakGroup[b]! >= 0) continue;
      const a = model.beamA[b]!;
      const c = model.beamB[b]!;
      if (mine(a) && !mine(c)) bodyLinks[a]!++;
      if (mine(c) && !mine(a)) bodyLinks[c]!++;
    }
    return model.nodePart.flatMap((p, i) => (p === partId && bodyLinks[i]! < 2 ? [i] : []));
  }
  const out = new Set<number>();
  for (let b = 0; b < model.beamA.length; b++) if (model.beamPart[b] === partId && model.breakGroup[b]! < 0) {
    out.add(model.beamA[b]!);
    out.add(model.beamB[b]!);
  }
  return [...out];
}

/** Axis unit vector, and for a point: its offset from the axis (perpendicular) and the opening direction there. */
function swingFrame(h: HingeSpec) {
  const [a, b] = h.axis;
  const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(ax[0]!, ax[1]!, ax[2]!) || 1;
  const k: V = [ax[0]! / len, ax[1]! / len, ax[2]! / len];
  const radial = (p: V): V => {
    const v: V = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
    return [v[0] - d * k[0], v[1] - d * k[1], v[2] - d * k[2]];
  };
  // Opening = right-hand rotation about a→b times the direction: tangent = k × r.
  const tangent = (r: V): V => [(k[1] * r[2] - k[2] * r[1]) * h.direction, (k[2] * r[0] - k[0] * r[2]) * h.direction, (k[0] * r[1] - k[1] * r[0]) * h.direction];
  /** Signed swing (degrees, + = opening) from r0 to r. */
  const angle = (r0: V, r: V): number => {
    const c: V = [r0[1] * r[2] - r0[2] * r[1], r0[2] * r[0] - r0[0] * r[2], r0[0] * r[1] - r0[1] * r[0]];
    const sin = (c[0] * k[0] + c[1] * k[1] + c[2] * k[2]) * h.direction;
    const cos = r0[0] * r[0] + r0[1] * r[1] + r0[2] * r[2];
    return (Math.atan2(sin, cos) * 180) / Math.PI;
  };
  return { radial, tangent, angle };
}

const at = (s: Solver, i: number): V => [s.x[i * 3]!, s.x[i * 3 + 1]!, s.x[i * 3 + 2]!];

/** Hold everything but the hinged part where it is (a test rig), with no ground in the way. */
function rig(model: SimModel, own: ReadonlySet<number>): Solver {
  const s = new Solver(model, { groundZ: -1e6 });
  for (let i = 0; i < s.n; i++) if (!own.has(i) && model.mass[i]! > 0) s.anchors.push({ node: i, point: at(s, i), stiffness: Math.min(5e6, 2e6 * Math.max(0.5, model.mass[i]!)), damping: 4000 });
  return s;
}

/**
 * Hinge swing: the body held in a rig, the part pushed open by a hand at its
 * far edge, held against its stop, then pushed shut. Good behaviour: it swings
 * freely, the limiter stops it near its opening angle, it closes back onto its
 * seals, and nothing breaks.
 */
export function hingeSwing(model: SimModel, h: HingeSpec, seconds = 3): ScenarioResult {
  const ownList = ownNodes(model, h.partId);
  const own = new Set(ownList);
  const s = rig(model, own);
  const start = Float64Array.from(s.x);
  const f = swingFrame(h);
  const partMass = ownList.reduce((m, i) => m + model.mass[i]!, 0);
  const r0 = ownList.map((i) => f.radial(at(s, i)));
  const reach = ownList.map((_, j) => Math.hypot(...r0[j]!));
  const far = reach.reduce((best, d, j) => (d > reach[best]! ? j : best), 0);
  if (!ownList.length || reach[far]! < 0.05) return finish(s, 'hinge-swing', 0, start, ['This part has no nodes away from its hinge line to swing.']);
  // Push: an angular acceleration of ~6 rad/s² (a firm hand), as per-node tangential forces.
  const push = (sign: number) => {
    s.extForce.fill(0);
    ownList.forEach((i) => {
      const r = f.radial(at(s, i));
      const t = f.tangent(r);
      const g = model.mass[i]! * 6 * sign;
      for (let q = 0; q < 3; q++) s.extForce[i * 3 + q] = t[q]! * g;
    });
  };
  const angleNow = () => f.angle(r0[far]!, f.radial(at(s, ownList[far]!)));
  const openSteps = Math.round((seconds * 0.55) / s.dt);
  const closeSteps = Math.round((seconds * 0.45) / s.dt);
  let maxAngle = 0;
  for (let t = 0; t < openSteps; t += 20) {
    push(1);
    if (!s.step(20)) break;
    maxAngle = Math.max(maxAngle, angleNow());
  }
  const heldAt = angleNow();
  for (let t = 0; t < closeSteps && !s.divergence; t += 20) {
    push(-1);
    if (!s.step(20)) break;
  }
  s.extForce.fill(0);
  const closedAt = angleNow();
  const hingeBroken = s.breakLog.filter((b) => model.beamPart[b] === h.partId && model.breakGroup[b]! >= 0).length;
  const skinBroken = s.breakLog.filter((b) => model.beamPart[b] === h.partId && model.breakGroup[b]! < 0).length;
  const summary: string[] = [];
  if (maxAngle < h.openAngle * 0.5) summary.push(`Only opened to ${maxAngle.toFixed(0)}° of ${h.openAngle}°: something still holds it (bolts, or beams to the body besides the hinge). Check its attachment.`);
  else if (maxAngle > h.openAngle + 20) summary.push(`Swung past its stop to ${maxAngle.toFixed(0)}° (set ${h.openAngle}°): the limiter didn't hold. Guess the hinge again or check the limiter beam.`);
  else summary.push(`Opened to ${maxAngle.toFixed(0)}° (set ${h.openAngle}°) and held at ${heldAt.toFixed(0)}° against its stop.`);
  summary.push(Math.abs(closedAt) < 8 ? `Closed back to ${closedAt.toFixed(0)}° onto its seals.` : `Pushed shut it only got back to ${closedAt.toFixed(0)}°: it binds or sags on the hinge.`);
  summary.push(hingeBroken || skinBroken ? `${hingeBroken} hinge beam(s) and ${skinBroken} of its own beams broke just from opening: it's too weak.` : `Nothing broke (part ${partMass.toFixed(1)} kg).`);
  return finish(s, 'hinge-swing', seconds, start, summary);
}

/**
 * Hinge yank: the part wrenched outward (its opening direction) with a force
 * rising to four times the hinge strength. Good behaviour: it tears off at the
 * hinges, near the set strength, before its own skin rips.
 */
export function hingeYank(model: SimModel, h: HingeSpec, seconds = 1.5): ScenarioResult {
  const ownList = ownNodes(model, h.partId);
  const own = new Set(ownList);
  const s = rig(model, own);
  const start = Float64Array.from(s.x);
  const f = swingFrame(h);
  const maxForce = h.strength * 4;
  const steps = Math.round(seconds / s.dt);
  let tornAt: number | null = null;
  let after = 0;
  for (let t = 0; t < steps; t += 20) {
    const F = (maxForce * t) / steps / Math.max(1, ownList.length);
    s.extForce.fill(0);
    // Once it's off, let go (a free part pulled on would just fly away), and watch it a moment longer.
    if (tornAt !== null) {
      if ((after += 20) * s.dt > 0.1) break;
      if (!s.step(20)) break;
      continue;
    }
    for (const i of ownList) {
      const r = f.radial(at(s, i));
      const tan = f.tangent(r);
      const tl = Math.hypot(...tan) || 1;
      // Mostly outward (the opening direction), a little away from the hinge line: a wrench, not a swing.
      const rl = Math.hypot(...r) || 1;
      for (let q = 0; q < 3; q++) s.extForce[i * 3 + q] = F * (0.8 * (tan[q]! / tl) + 0.6 * (r[q]! / rl));
    }
    if (!s.step(20)) break;
    if (tornAt === null && s.breakLog.some((b) => model.beamPart[b] === h.partId && model.breakGroup[b]! >= 0)) tornAt = F * ownList.length;
  }
  const hingeBroken = s.breakLog.filter((b) => model.beamPart[b] === h.partId && model.breakGroup[b]! >= 0).length;
  const skinBroken = s.breakLog.filter((b) => model.beamPart[b] === h.partId && model.breakGroup[b]! < 0).length;
  const summary = [
    tornAt !== null ? `Tore off at the hinges at about ${(tornAt / 1000).toFixed(1)} kN (hinge strength ${(h.strength / 1000).toFixed(0)} kN).` : `The hinges held ${(maxForce / 1000).toFixed(0)} kN: they're stronger than set, or the pull spread over too many beams.`,
    skinBroken > hingeBroken ? `Warning: ${skinBroken} of its own beams tore first: it rips apart before the hinges give. Strengthen it or weaken the hinge.` : `Clean: ${hingeBroken} hinge beam(s) broke, ${skinBroken} of its own.`,
  ];
  return finish(s, 'hinge-yank', seconds, start, summary);
}

/** One axle for the suspension drop: where it is, and (when known) its spring and damper per wheel. */
export interface AxleSpec {
  name: string;
  y: number;
  track: number;
  /** N/m per wheel; absent = sized from the car's weight for a ~1.5 Hz ride. */
  spring?: number;
  /** N·s/m per wheel; absent = ~30 % of critical. */
  damp?: number;
}

/**
 * Suspension drop: the car on a stand-in for its fitted suspension (a spring
 * and damper per wheel between the ground and the body, sized from the car's
 * weight or its tuning), dropped from `height`. It checks what the body does
 * on its suspension: whether it bottoms out, how far each axle compresses,
 * the ride height it settles at, pitch, how long it bounces, and what the
 * mounts do. The game's own suspension jbeam isn't simulated here; this is a
 * structure check, and the in-game test is the real one.
 */
export function suspensionDrop(model: SimModel, axles: readonly AxleSpec[], height = 0.3, seconds = 3): ScenarioResult {
  const s = new Solver(model);
  if (!axles.length) return finish(s, 'suspension-drop', 0, Float64Array.from(s.x), ['Add axles in the Suspension panel first: the drop puts the car on its wheels.']);
  const n = s.n;
  let lowZ = Infinity;
  let highZ = -Infinity;
  let total = 0;
  for (let i = 0; i < n; i++) {
    lowZ = Math.min(lowZ, s.x[i * 3 + 2]!);
    highZ = Math.max(highZ, s.x[i * 3 + 2]!);
    total += model.mass[i]!;
  }
  // The imported model's ground is z = 0 when its wheels touch it; else a hand below the lowest node.
  const contactZ = Math.min(0, lowZ - 0.1);
  const corners = axles.flatMap((a) => [1, -1].map((side) => ({ axle: a, x: (side * a.track) / 2, name: `${a.name} ${side > 0 ? 'left' : 'right'}` })));
  const perCorner = total / corners.length;
  // Mounts: body nodes at strut-tower height over each wheel, sharing its load.
  const topZ = lowZ + 0.6 * (highZ - lowZ);
  const used = new Set<number>();
  const springs = corners.map((c) => {
    const near: { i: number; d: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (used.has(i) || model.mass[i] === 0) continue;
      near.push({ i, d: Math.hypot(s.x[i * 3]! - c.x, s.x[i * 3 + 1]! - c.axle.y, (s.x[i * 3 + 2]! - topZ) * 0.5) });
    }
    near.sort((p, q) => p.d - q.d);
    const mounts = near.slice(0, 4).map((r) => r.i);
    for (const i of mounts) used.add(i);
    const k = c.axle.spring ?? perCorner * (2 * Math.PI * 1.5) ** 2;
    const damp = c.axle.damp ?? 2 * 0.3 * Math.sqrt(k * perCorner);
    const z = () => mounts.reduce((t, i) => t + s.x[i * 3 + 2]!, 0) / mounts.length;
    const vz = () => mounts.reduce((t, i) => t + s.v[i * 3 + 2]!, 0) / mounts.length;
    // Free length: mount to the ground as modelled (wheels just touching, unloaded).
    return { c, mounts, k, damp, z, vz, free: z() - contactZ };
  });
  s.transform(([x, y, zz]) => [x, y, zz + height - contactZ]);
  const start = Float64Array.from(s.x);
  const maxComp = corners.map(() => 0);
  const hitBump = corners.map(() => false);
  const bumpAt = 0.6 * (lowZ - contactZ);
  const comp = springs.map((sp) => Math.max(0, sp.free - sp.z()));
  let minBody = Infinity;
  let settledAt: number | null = null;
  let still = 0;
  const steps = Math.round(seconds / s.dt);
  const every = 4;
  for (let t = 0; t < steps; t += every) {
    s.extForce.fill(0);
    springs.forEach((sp, k) => {
      comp[k] = Math.max(0, sp.free - sp.z());
      if (!comp[k]) return;
      // Bump stop: much stiffer over the last 40 % of the travel to the floor, as real suspensions have.
      const bump = Math.max(0, comp[k] - bumpAt);
      if (bump > 0) hitBump[k] = true;
      const F = Math.max(0, sp.k * comp[k] + sp.k * 12 * bump - sp.damp * sp.vz());
      for (const i of sp.mounts) s.extForce[i * 3 + 2]! += F / sp.mounts.length;
      maxComp[k] = Math.max(maxComp[k]!, comp[k]);
    });
    if (!s.step(every)) break;
    let vz = 0;
    for (let i = 0; i < n; i++) {
      minBody = Math.min(minBody, s.x[i * 3 + 2]!);
      vz += s.v[i * 3 + 2]! * model.mass[i]!;
    }
    // Settled: the body's vertical speed stays under 2 cm/s for 0.25 s, once the wheels are loaded.
    if (comp.some((c) => c > 0) && Math.abs(vz / Math.max(1e-9, total)) < 0.02) {
      still += every;
      if (settledAt === null && still * s.dt > 0.25) settledAt = t * s.dt - 0.25;
    } else {
      still = 0;
      settledAt = null;
    }
  }
  s.extForce.fill(0);
  const byAxle = axles.map((a) => {
    const ks = corners.flatMap((c, k) => (c.axle === a ? [k] : []));
    const avg = (v: number[]) => ks.reduce((t, k) => t + v[k]!, 0) / ks.length;
    return { name: a.name, y: a.y, max: avg(maxComp), sag: avg(comp) };
  });
  const front = byAxle.reduce((p, q) => (q.y < p.y ? q : p));
  const rear = byAxle.reduce((p, q) => (q.y > p.y ? q : p));
  const pitch = front !== rear ? (Math.atan2(rear.sag - front.sag, rear.y - front.y) * 180) / Math.PI : 0;
  const summary: string[] = [];
  summary.push(`Dropped ${(height * 100).toFixed(0)} cm onto ${corners.length} wheels (${Math.round(total)} kg): ${minBody < 0.01 ? 'the body hit the ground: it bottoms out. Stiffer springs, or more ride height.' : `the lowest point of the body came within ${(minBody * 100).toFixed(0)} cm of the ground.`}`);
  summary.push(byAxle.map((a) => `${a.name}: compressed up to ${(a.max * 100).toFixed(1)} cm, settles ${(a.sag * 100).toFixed(1)} cm down`).join('; ') + '.');
  if (hitBump.some(Boolean)) summary.push(`Hit the bump stops on ${corners.filter((_, k) => hitBump[k]).map((c) => c.name).join(', ')}: fine on a hard landing, but if it happens at rest it needs stiffer springs.`);
  if (front !== rear) summary.push(Math.abs(pitch) < 0.5 ? 'Sits level.' : `Sits ${pitch > 0 ? 'nose up' : 'nose down'} by ${Math.abs(pitch).toFixed(1)}°: ${pitch > 0 ? 'the rear' : 'the front'} carries more weight for its springs.`);
  summary.push(settledAt !== null ? `Stopped bouncing after ${settledAt.toFixed(1)} s.` : `Still bouncing after ${seconds} s: more damping.`);
  const mountSet = new Set(springs.flatMap((sp) => sp.mounts));
  const mountBroken = s.breakLog.filter((b) => mountSet.has(model.beamA[b]!) || mountSet.has(model.beamB[b]!)).length;
  if (s.breakLog.length) summary.push(`${s.breakLog.length} beam(s) broke${mountBroken ? `, ${mountBroken} at the suspension mounts: strengthen the body there` : ''}.`);
  summary.push('The springs are a stand-in sized from the car (or its tuning); the fitted suspension itself is checked in game.');
  return finish(s, 'suspension-drop', seconds, start, summary);
}
