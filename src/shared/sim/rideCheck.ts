/**
 * The quick suspension check (fork): how far the body comes down onto its
 * wheels when the car is dropped, as one spring and damper per car (heave
 * only), with a bump stop at the end of the travel. Not the game's physics:
 * enough to see whether the tyres clear the arches and the sump clears the
 * ground at full compression.
 */

export interface RideOptions {
  /** Drop height above the tyres touching (m). */
  height: number;
  /** Suspension travel from ride height to the bump stop (m). */
  travel: number;
  /** Sag at rest as a share of the travel (0.25–0.4 on a road car). */
  sagShare?: number;
  /** Damping ratio (0.2 bouncy … 0.7 stiff). */
  damping?: number;
  seconds?: number;
  fps?: number;
}

export interface RideFrame {
  t: number;
  /** Wheels' height above the ground (m): above 0 while still falling. */
  wheels: number;
  /** How far the body sits below where it's modelled, relative to its wheels (m, + compressed, − extended). */
  compression: number;
}

const G = 9.81;

/**
 * The drop: car and wheels fall together, the tyres land, the body keeps
 * going and compresses the suspension (never past the bump stop), then
 * settles. The model is drawn at ride height (sag included), so compression
 * 0 is the modelled pose and that's where it settles.
 */
export function dropCurve(o: RideOptions): RideFrame[] {
  const fps = o.fps ?? 60;
  const seconds = o.seconds ?? 3;
  const travel = Math.max(0.01, o.travel);
  const sag = travel * (o.sagShare ?? 0.3);
  // Spring so the car's weight compresses it by the sag: ω² = g / sag.
  const w2 = G / sag;
  const zeta = o.damping ?? 0.35;
  const c = 2 * zeta * Math.sqrt(w2);
  const frames: RideFrame[] = [];
  let wheels = Math.max(0, o.height);
  let vFall = 0;
  // Body position relative to its unloaded (fully extended, sag above ride height) length.
  let x = 0; // compression from unloaded, m
  let v = 0;
  let landed = wheels <= 0;
  const dt = 1 / 240;
  let next = 0;
  for (let t = 0; t <= seconds + 1e-9; t += dt) {
    if (!landed) {
      vFall += G * dt;
      wheels -= vFall * dt;
      if (wheels <= 0) {
        wheels = 0;
        landed = true;
        v = vFall; // the body carries on down at the landing speed
      }
    } else {
      const a = G - w2 * x - c * v;
      v += a * dt;
      x += v * dt;
      // Bump stop at full travel (from ride height, so sag + travel from unloaded); droop limit at unloaded.
      if (x > sag + travel) {
        x = sag + travel;
        v = Math.min(0, v) * -0.2;
      }
      if (x < 0) {
        x = 0;
        v = Math.max(0, v);
      }
    }
    if (t >= next - 1e-9) {
      frames.push({ t: Math.round(t * 1000) / 1000, wheels, compression: landed ? x - sag : -sag });
      next += 1 / fps;
    }
  }
  return frames;
}
