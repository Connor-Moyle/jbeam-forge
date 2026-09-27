import { Solver, type Obstacle, type SimModel } from './solver';

/**
 * One-click sandbox scenarios (SPEC §4.6). Each runs a fresh solver on the
 * model and summarises what happened. They validate structure — stability,
 * sag, what breaks and where — not BeamNG's exact behaviour.
 */

export type ScenarioId = 'settle' | 'drop' | 'corner-drop' | 'yank' | 'crash-pole' | 'crash-wall' | 'crash-offset';

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
