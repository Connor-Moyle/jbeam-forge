/**
 * Physics sandbox solver (SPEC §4.6). It validates *structure* (stability,
 * rigidity, break behaviour); it is not BeamNG's solver, and the UI says so.
 *
 * - Symplectic Euler at 2000 Hz (BeamNG's physics rate), flat typed arrays.
 * - Beams are spring-dampers with the exact values the exporter writes:
 *   force = beamSpring·(length − rest) + beamDamp·(closing speed).
 * - Plastic deformation: past ±beamDeform (N) the rest length shifts so the
 *   force stays at the threshold, limited by deformLimitExpansion (stretch) and
 *   deformLimit (compression) as ratios of the original length (BeamNG docs).
 * - Breaking: past beamStrength (N) a beam breaks, and every beam in its
 *   breakGroup breaks with it.
 * - SUPPORT beams push only (compression).
 * - Ground plane z = groundZ with penalty contact and Coulomb friction; optional
 *   rigid obstacles (poles, walls) for crash scenarios.
 * - Deterministic: same model + same inputs → same result.
 */

export interface SimModel {
  nodeIds: string[];
  /** xyz per node, BeamNG space (Z up). */
  pos: Float64Array;
  /** kg; 0 = fixed in place (like BeamNG's `fixed` nodes). */
  mass: Float64Array;
  friction: Float64Array;
  /** Nodes that collide with ground/obstacles. */
  collide: Uint8Array;
  beamA: Uint32Array;
  beamB: Uint32Array;
  spring: Float64Array;
  damp: Float64Array;
  /** N; Infinity = never deforms. */
  deform: Float64Array;
  /** N; Infinity = never breaks. */
  strength: Float64Array;
  /** Max stretch as ratio of original length (e.g. 1.1). */
  expansionLimit: Float64Array;
  /** Min compression as ratio of original length (e.g. 0.5 = may shrink to half). */
  compressionLimit: Float64Array;
  /** 0 normal, 1 support (compression only), 2 bounded (free between its bounds, then limitSpring). */
  beamType: Uint8Array;
  /** Bounded beams: how much longer/shorter than rest they move freely, as ratios of rest length. */
  longBound?: Float64Array;
  shortBound?: Float64Array;
  /** Bounded beams: spring (N/m) and damping once past a bound. */
  limitSpring?: Float64Array;
  limitDamp?: Float64Array;
  /** Index into breakGroups, −1 = none. */
  breakGroup: Int32Array;
  breakGroups: string[];
  /** Beam owner (part id) — for results and heatmaps. */
  beamPart: string[];
  /** Node owner (part id), when known. */
  nodePart?: string[];
}

export interface Obstacle {
  kind: 'pole' | 'wall';
  /** pole: axis point (x, y) with radius; wall: plane point + outward normal (horizontal). */
  x: number;
  y: number;
  radius?: number;
  nx?: number;
  ny?: number;
  /** Wall extent along its tangent (half width, m). Infinity = endless. */
  halfWidth?: number;
}

export interface SolverOptions {
  dt?: number;
  gravity?: number;
  groundZ?: number;
  /** Ground penalty stiffness per kg (N/m/kg) and damping per kg. */
  groundStiffness?: number;
  groundDamping?: number;
  /** Any node faster than this (m/s) counts as divergence. */
  divergeSpeed?: number;
}

export interface Divergence {
  step: number;
  nodeIndex: number;
  nodeId: string;
  speed: number;
}

export class Solver {
  readonly n: number;
  readonly m: number;
  readonly x: Float64Array;
  readonly v: Float64Array;
  readonly f: Float64Array;
  readonly rest: Float64Array;
  readonly rest0: Float64Array;
  readonly broken: Uint8Array;
  /** Last |force| per beam (N), for stress heatmaps. */
  readonly beamForce: Float64Array;
  /** Highest |force| seen per beam (N) since reset. */
  readonly beamForceMax: Float64Array;
  /** Order in which beams broke. */
  readonly breakLog: number[] = [];
  steps = 0;
  gravityOn = true;
  obstacles: Obstacle[] = [];
  divergence: Divergence | null = null;
  /** Stiff springs holding nodes to fixed points (jack stands, test rigs). */
  anchors: { node: number; point: [number, number, number]; stiffness: number; damping: number }[] = [];
  /** External per-node forces (N), e.g. a drag spring or a yank. Cleared by the caller. */
  readonly extForce: Float64Array;
  readonly dt: number;
  /**
   * Integration sub-steps per 2000 Hz step. Plain symplectic Euler goes
   * unstable once a node's ω·Δt passes 2; BeamNG copes with official content up
   * to ~3.4, so the sandbox integrates finer instead of flagging valid cars.
   * Forces and beam values are unchanged — only the time step is subdivided.
   */
  readonly substeps: number;
  private readonly h: number;
  private readonly g: number;
  private readonly groundZ: number;
  private readonly kg: number;
  private readonly cg: number;
  private readonly divergeSpeed: number;
  private readonly invMass: Float64Array;

  constructor(
    readonly model: SimModel,
    opts: SolverOptions = {},
  ) {
    this.n = model.mass.length;
    this.m = model.beamA.length;
    this.dt = opts.dt ?? 1 / 2000;
    this.g = opts.gravity ?? -9.81;
    this.groundZ = opts.groundZ ?? 0;
    this.kg = opts.groundStiffness ?? 150_000;
    this.cg = opts.groundDamping ?? 600;
    this.divergeSpeed = opts.divergeSpeed ?? 400;
    this.x = Float64Array.from(model.pos);
    this.v = new Float64Array(this.n * 3);
    this.f = new Float64Array(this.n * 3);
    this.extForce = new Float64Array(this.n * 3);
    this.invMass = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) this.invMass[i] = model.mass[i]! > 0 ? 1 / model.mass[i]! : 0;
    // Conservative per-node bound ω ≈ √(2·Σk/m) (Gershgorin); symplectic Euler needs ω·h < 2 — aim for 1.6.
    const springSum = new Float64Array(this.n);
    for (let b = 0; b < model.beamA.length; b++) {
      springSum[model.beamA[b]!]! += model.spring[b]!;
      springSum[model.beamB[b]!]! += model.spring[b]!;
    }
    let omega = 0;
    for (let i = 0; i < this.n; i++) if (model.mass[i]! > 0) omega = Math.max(omega, Math.sqrt((2 * springSum[i]!) / model.mass[i]!));
    this.substeps = Math.min(16, Math.max(1, Math.ceil((omega * this.dt) / 1.6)));
    this.h = this.dt / this.substeps;
    this.rest = new Float64Array(this.m);
    this.rest0 = new Float64Array(this.m);
    for (let b = 0; b < this.m; b++) {
      const i = model.beamA[b]! * 3;
      const j = model.beamB[b]! * 3;
      const L = Math.hypot(model.pos[j]! - model.pos[i]!, model.pos[j + 1]! - model.pos[i + 1]!, model.pos[j + 2]! - model.pos[i + 2]!);
      this.rest[b] = L;
      this.rest0[b] = L;
    }
    this.broken = new Uint8Array(this.m);
    this.beamForce = new Float64Array(this.m);
    this.beamForceMax = new Float64Array(this.m);
  }

  /** Back to the authored state (the model is never mutated). */
  reset(): void {
    this.x.set(this.model.pos);
    this.v.fill(0);
    this.rest.set(this.rest0);
    this.broken.fill(0);
    this.beamForce.fill(0);
    this.beamForceMax.fill(0);
    this.extForce.fill(0);
    this.breakLog.length = 0;
    this.steps = 0;
    this.divergence = null;
  }

  /** Move every node rigidly (drop / tilt scenarios). */
  transform(fn: (p: [number, number, number]) => [number, number, number]): void {
    for (let i = 0; i < this.n; i++) {
      const [a, b, c] = fn([this.x[i * 3]!, this.x[i * 3 + 1]!, this.x[i * 3 + 2]!]);
      this.x[i * 3] = a;
      this.x[i * 3 + 1] = b;
      this.x[i * 3 + 2] = c;
    }
  }

  private breakBeam(b: number): void {
    if (this.broken[b]) return;
    this.broken[b] = 1;
    this.breakLog.push(b);
    const g = this.model.breakGroup[b]!;
    if (g < 0) return;
    for (let o = 0; o < this.m; o++) if (!this.broken[o] && this.model.breakGroup[o] === g) {
      this.broken[o] = 1;
      this.breakLog.push(o);
    }
  }

  /** Advance `count` steps. Returns false (and stops) once diverged. */
  step(count = 1): boolean {
    if (this.divergence) return false;
    const { x, v, f, rest, rest0, model, invMass } = this;
    const dt = this.h;
    for (let s = 0; s < count * this.substeps; s++) {
      f.set(this.extForce);
      for (const a of this.anchors) {
        const i = a.node * 3;
        for (let k = 0; k < 3; k++) f[i + k]! += a.stiffness * (a.point[k]! - x[i + k]!) - a.damping * v[i + k]!;
      }
      if (this.gravityOn) for (let i = 0; i < this.n; i++) f[i * 3 + 2]! += model.mass[i]! * this.g;
      for (let b = 0; b < this.m; b++) {
        if (this.broken[b]) continue;
        const i = model.beamA[b]! * 3;
        const j = model.beamB[b]! * 3;
        const dx = x[j]! - x[i]!;
        const dy = x[j + 1]! - x[i + 1]!;
        const dz = x[j + 2]! - x[i + 2]!;
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L < 1e-9) continue;
        const ux = dx / L;
        const uy = dy / L;
        const uz = dz / L;
        const vrel = (v[j]! - v[i]!) * ux + (v[j + 1]! - v[i + 1]!) * uy + (v[j + 2]! - v[i + 2]!) * uz;
        const k = model.spring[b]!;
        let springF = k * (L - rest[b]!); // + tension, − compression
        // Plasticity: the rest length yields so the spring force stays at the threshold.
        const yieldF = model.deform[b]!;
        if (springF > yieldF) {
          const nr = Math.min(L - yieldF / k, rest0[b]! * model.expansionLimit[b]!);
          rest[b] = Math.max(rest[b]!, nr);
          springF = k * (L - rest[b]!);
        } else if (springF < -yieldF) {
          const nr = Math.max(L + yieldF / k, rest0[b]! * model.compressionLimit[b]!);
          rest[b] = Math.min(rest[b]!, nr);
          springF = k * (L - rest[b]!);
        }
        let F = springF + model.damp[b]! * vrel;
        if (model.beamType[b] === 1 && F > 0) F = 0; // support: push only
        else if (model.beamType[b] === 2) {
          // Bounded: free between the bounds, a limit spring beyond them (hinge stops, suspension bump stops).
          const hi = rest0[b]! * (1 + (model.longBound?.[b] ?? 0));
          const lo = rest0[b]! * (1 - (model.shortBound?.[b] ?? 0));
          const over = L > hi ? L - hi : L < lo ? L - lo : 0;
          if (over !== 0) F += (model.limitSpring?.[b] ?? 0) * over + (model.limitDamp?.[b] ?? 0) * vrel;
        }
        const absF = Math.abs(F);
        this.beamForce[b] = absF;
        if (absF > this.beamForceMax[b]!) this.beamForceMax[b] = absF;
        if (absF > model.strength[b]!) {
          this.breakBeam(b);
          continue;
        }
        f[i]! += F * ux;
        f[i + 1]! += F * uy;
        f[i + 2]! += F * uz;
        f[j]! -= F * ux;
        f[j + 1]! -= F * uy;
        f[j + 2]! -= F * uz;
      }
      // Contacts: ground and obstacles (penalty + Coulomb friction, per unit mass so light nodes behave).
      for (let i = 0; i < this.n; i++) {
        if (!model.collide[i]) continue;
        const m = model.mass[i]!;
        const pz = this.groundZ - x[i * 3 + 2]!;
        if (pz > 0) {
          const N = Math.max(0, this.kg * m * pz - this.cg * m * v[i * 3 + 2]!);
          f[i * 3 + 2]! += N;
          this.friction(i, N, 0, 0, 1);
        }
        for (const o of this.obstacles) this.obstacleContact(i, o, m);
      }
      // Poles are thinner than node spacing: beams must collide too, or the car slips between nodes.
      for (const o of this.obstacles) if (o.kind === 'pole') this.poleBeamContact(o);
      // Symplectic Euler.
      for (let i = 0; i < this.n; i++) {
        const w = invMass[i]!;
        v[i * 3]! += f[i * 3]! * w * dt;
        v[i * 3 + 1]! += f[i * 3 + 1]! * w * dt;
        v[i * 3 + 2]! += f[i * 3 + 2]! * w * dt;
        x[i * 3]! += v[i * 3]! * dt;
        x[i * 3 + 1]! += v[i * 3 + 1]! * dt;
        x[i * 3 + 2]! += v[i * 3 + 2]! * dt;
      }
      if ((s + 1) % this.substeps !== 0) continue;
      this.steps++;
      // Divergence (checked once per 2000 Hz step): the first node to exceed the speed limit is the offender.
      for (let i = 0; i < this.n; i++) {
        const sp = Math.hypot(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
        if (!(sp < this.divergeSpeed)) {
          this.divergence = { step: this.steps, nodeIndex: i, nodeId: model.nodeIds[i]!, speed: sp };
          return false;
        }
      }
    }
    return true;
  }

  /** Friction opposing tangential velocity at a contact with normal (nx, ny, nz). */
  private friction(i: number, N: number, nx: number, ny: number, nz: number): void {
    const { v, f } = this;
    const vn = v[i * 3]! * nx + v[i * 3 + 1]! * ny + v[i * 3 + 2]! * nz;
    const tx = v[i * 3]! - vn * nx;
    const ty = v[i * 3 + 1]! - vn * ny;
    const tz = v[i * 3 + 2]! - vn * nz;
    const ts = Math.hypot(tx, ty, tz);
    if (ts < 1e-6) return;
    const mu = this.model.friction[i]!;
    // Kinetic friction, capped so it cannot reverse the sliding direction within one step.
    const maxF = (ts * this.model.mass[i]!) / this.h;
    const Ff = Math.min(mu * N, maxF);
    f[i * 3]! -= (Ff * tx) / ts;
    f[i * 3 + 1]! -= (Ff * ty) / ts;
    f[i * 3 + 2]! -= (Ff * tz) / ts;
  }

  private obstacleContact(i: number, o: Obstacle, m: number): void {
    const px = this.x[i * 3]!;
    const py = this.x[i * 3 + 1]!;
    let nx = 0;
    let ny = 0;
    let depth = 0;
    if (o.kind === 'pole') {
      const dx = px - o.x;
      const dy = py - o.y;
      const d = Math.hypot(dx, dy);
      const r = o.radius ?? 0.15;
      if (d >= r || d < 1e-9) return;
      nx = dx / d;
      ny = dy / d;
      depth = r - d;
    } else {
      nx = o.nx ?? 0;
      ny = o.ny ?? 1;
      const along = (px - o.x) * -ny + (py - o.y) * nx; // tangent coordinate
      if (Math.abs(along) > (o.halfWidth ?? Infinity)) return;
      const s = (px - o.x) * nx + (py - o.y) * ny;
      if (s >= 0) return; // in front of the wall
      depth = -s;
    }
    const vn = this.v[i * 3]! * nx + this.v[i * 3 + 1]! * ny;
    const N = Math.max(0, this.kg * m * depth - this.cg * m * vn);
    this.f[i * 3]! += N * nx;
    this.f[i * 3 + 1]! += N * ny;
    this.friction(i, N, nx, ny, 0);
  }

  /** Beam-segment vs vertical pole: push the segment out, split between its two nodes by position along it. */
  private poleBeamContact(o: Obstacle): void {
    const { x, v, f, model } = this;
    const r = o.radius ?? 0.15;
    for (let b = 0; b < this.m; b++) {
      if (this.broken[b]) continue;
      const a = model.beamA[b]!;
      const c = model.beamB[b]!;
      if (!model.collide[a] || !model.collide[c]) continue;
      const ax = x[a * 3]!;
      const ay = x[a * 3 + 1]!;
      const dx = x[c * 3]! - ax;
      const dy = x[c * 3 + 1]! - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.y - ay) * dy) / len2));
      if (t <= 0 || t >= 1) continue; // end points are handled as node contacts
      const px = ax + dx * t - o.x;
      const py = ay + dy * t - o.y;
      const d = Math.hypot(px, py);
      if (d >= r || d < 1e-9) continue;
      const nx = px / d;
      const ny = py / d;
      const depth = r - d;
      const mEff = model.mass[a]! * (1 - t) + model.mass[c]! * t;
      const vn = (v[a * 3]! * (1 - t) + v[c * 3]! * t) * nx + (v[a * 3 + 1]! * (1 - t) + v[c * 3 + 1]! * t) * ny;
      const N = Math.max(0, this.kg * mEff * depth - this.cg * mEff * vn);
      f[a * 3]! += N * nx * (1 - t);
      f[a * 3 + 1]! += N * ny * (1 - t);
      f[c * 3]! += N * nx * t;
      f[c * 3 + 1]! += N * ny * t;
    }
  }

  /** Mean node position (for scenario metrics). */
  centroid(): [number, number, number] {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let M = 0;
    for (let i = 0; i < this.n; i++) {
      const m = this.model.mass[i]!;
      sx += this.x[i * 3]! * m;
      sy += this.x[i * 3 + 1]! * m;
      sz += this.x[i * 3 + 2]! * m;
      M += m;
    }
    return M ? [sx / M, sy / M, sz / M] : [0, 0, 0];
  }

  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) e += 0.5 * this.model.mass[i]! * (this.v[i * 3]! ** 2 + this.v[i * 3 + 1]! ** 2 + this.v[i * 3 + 2]! ** 2);
    return e;
  }
}
