/**
 * Keeping a car stable at the game's physics rate. BeamNG steps every node
 * explicitly at 2000 Hz, so a node whose beams add up to more spring (or
 * damping) than its weight can carry starts to vibrate on the first frame
 * and runs away: "Instability detected" and the car never spawns.
 *
 * Per node the limit is √(Σk / m)·Δt ≤ SAFE_RATIO and Σc / m·Δt ≤ SAFE_DAMP
 * (the explicit-step bound with a margin). Beams we generated are softened
 * just enough to meet it; beams whose values are fixed (set by hand, or a
 * fitted game part's own) are never changed, so the nodes they hang on get
 * the weight they need instead.
 */

export const PHYSICS_DT = 1 / 2000;
/** √(Σk/m)·Δt a node may reach. The explicit step diverges near √2 (Gershgorin); this keeps a margin. */
export const SAFE_RATIO = 1.25;
/** Σc/m·Δt a node may reach (diverges at 2). */
export const SAFE_DAMP = 0.9;
/** A beam is softened at most this far before its nodes get weight instead. */
const MIN_SCALE = 0.15;

export interface StabiliseBeam {
  id1: string;
  id2: string;
  spring: number;
  damp: number;
  /** Values we may not change (set by hand, or from a game part): the node takes weight instead. */
  fixed: boolean;
}

export interface StabiliseResult {
  /** Per beam, the factor its spring is multiplied by (1 for fixed beams). */
  springScale: Float64Array;
  dampScale: Float64Array;
  /** Nodes that needed more weight: id → the weight to use. */
  weights: Map<string, number>;
  /** Beams softened, and the weight added (kg). */
  softened: number;
  addedKg: number;
}

const maxSpring = (m: number) => (SAFE_RATIO * SAFE_RATIO * m) / (PHYSICS_DT * PHYSICS_DT);
const maxDamp = (m: number) => (SAFE_DAMP * m) / PHYSICS_DT;

/** The weight a node needs to carry this much spring and damping. */
export function weightFor(springSum: number, dampSum: number): number {
  return Math.max((springSum * PHYSICS_DT * PHYSICS_DT) / (SAFE_RATIO * SAFE_RATIO), (dampSum * PHYSICS_DT) / SAFE_DAMP);
}

/** How close a node is to its limit (1 = at it). */
export function stabilityLoad(weight: number, springSum: number, dampSum: number): number {
  if (!(weight > 0)) return springSum > 0 || dampSum > 0 ? Infinity : 0;
  return Math.max(Math.sqrt(springSum / weight) * PHYSICS_DT / SAFE_RATIO, (dampSum / weight) * PHYSICS_DT / SAFE_DAMP);
}

/**
 * Nodes with no weight given (one the caller doesn't own, e.g. a game part's) are left out:
 * beams to them still count on the other end.
 */
export function stabilise(weights: ReadonlyMap<string, number>, beams: readonly StabiliseBeam[]): StabiliseResult {
  const fixedK = new Map<string, number>();
  const fixedC = new Map<string, number>();
  const softK = new Map<string, number>();
  const softC = new Map<string, number>();
  const add = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + Math.max(0, v));
  for (const b of beams) {
    for (const id of [b.id1, b.id2]) {
      add(b.fixed ? fixedK : softK, id, b.spring);
      add(b.fixed ? fixedC : softC, id, b.damp);
    }
  }
  const weightsOut = new Map<string, number>();
  const kScale = new Map<string, number>();
  const cScale = new Map<string, number>();
  let addedKg = 0;
  for (const [id, w0] of weights) {
    const fk = fixedK.get(id) ?? 0;
    const fc = fixedC.get(id) ?? 0;
    const sk = softK.get(id) ?? 0;
    const sc = softC.get(id) ?? 0;
    // Fixed beams can't soften, and ours soften only so far: whatever is left over needs weight.
    const w = Math.max(w0, weightFor(fk + sk * MIN_SCALE, fc + sc * MIN_SCALE));
    if (w > w0 + 1e-9) {
      const rounded = Math.ceil(w * 1000) / 1000;
      weightsOut.set(id, rounded);
      addedKg += rounded - w0;
    }
    const roomK = maxSpring(w) - fk;
    const roomC = maxDamp(w) - fc;
    kScale.set(id, sk > 0 ? Math.min(1, Math.max(MIN_SCALE, roomK / sk)) : 1);
    cScale.set(id, sc > 0 ? Math.min(1, Math.max(MIN_SCALE, roomC / sc)) : 1);
  }
  const springScale = new Float64Array(beams.length).fill(1);
  const dampScale = new Float64Array(beams.length).fill(1);
  let softened = 0;
  beams.forEach((b, i) => {
    if (b.fixed) return;
    const k = Math.min(kScale.get(b.id1) ?? 1, kScale.get(b.id2) ?? 1);
    const c = Math.min(cScale.get(b.id1) ?? 1, cScale.get(b.id2) ?? 1);
    // Stepped down to a few fixed levels, so rows share values and the file stays readable.
    springScale[i] = k < 1 ? level(k) : 1;
    dampScale[i] = c < 1 ? level(c) : 1;
    if (k < 1 || c < 1) softened++;
  });
  return { springScale, dampScale, weights: weightsOut, softened, addedKg: Math.round(addedKg * 10) / 10 };
}

/** Easing levels: each about 0.84× the last (four to a halving). */
const LEVELS = Array.from({ length: 12 }, (_, i) => Math.round(2 ** (-(i + 1) / 4) * 100) / 100);

/** The first level at or below x. */
function level(x: number): number {
  return LEVELS.find((l) => l <= x) ?? MIN_SCALE;
}

/** A value scaled and rounded to two significant figures (800000 × 0.43 → 340000). */
export function softenedValue(value: number, scale: number): number {
  if (scale >= 1 || value <= 0) return value;
  const v = value * scale;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
  return Math.max(p, Math.floor(v / p) * p);
}
