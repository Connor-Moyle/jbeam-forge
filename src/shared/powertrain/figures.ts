/**
 * Set an engine by its figures: peak torque and power, each at its rpm, and the rev limit. The
 * game's curve keeps its character (where it builds, how it falls away): its rpm axis is warped so
 * the torque peak lands where asked and the curve ends at the limit, its torque scaled to the peak,
 * then the top end bent so power peaks exactly at the asked rpm and nowhere higher.
 */

export interface EngineFigures {
  torqueNm: number;
  torqueRpm: number;
  powerKw: number;
  powerRpm: number;
  limitRpm: number;
}

type Curve = readonly (readonly [number, number])[];

const KW_PER_NM_RPM = (2 * Math.PI) / 60000;
const kwAt = (rpm: number, nm: number) => nm * rpm * KW_PER_NM_RPM;
const nmFor = (kw: number, rpm: number) => (rpm > 0 ? kw / (rpm * KW_PER_NM_RPM) : Infinity);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Why these figures can't all be true at once (empty: they can). */
export function figureProblems(f: EngineFigures): string[] {
  const out: string[] = [];
  if (!(f.torqueNm > 0) || !(f.powerKw > 0)) out.push('Power and torque must be above zero.');
  if (!(f.torqueRpm > 0) || !(f.powerRpm > 0) || !(f.limitRpm > 0)) out.push('Each rpm must be above zero.');
  if (out.length) return out;
  if (f.powerRpm < f.torqueRpm) out.push('Peak power comes at or after peak torque: power is torque times rpm, so it keeps rising past the torque peak.');
  if (f.powerRpm > f.limitRpm) out.push('Peak power must come at or before the rev limit.');
  if (f.torqueRpm >= f.limitRpm) out.push('Peak torque must come before the rev limit.');
  const atTorquePeak = kwAt(f.torqueRpm, f.torqueNm);
  if (atTorquePeak > f.powerKw * 1.0001) out.push(`At its torque peak the engine already makes ${Math.round(atTorquePeak)} kW: peak power must be at least that, or the torque lower or earlier.`);
  if (nmFor(f.powerKw, f.powerRpm) > f.torqueNm * 1.0001) out.push(`That much power at that rpm needs ${Math.round(nmFor(f.powerKw, f.powerRpm))} Nm, more than the peak torque: raise the torque or the power rpm.`);
  return out;
}

/** Torque at `rpm` on a curve (straight lines between points; flat past the ends). */
function torqueAt(curve: Curve, rpm: number): number {
  if (!curve.length) return 0;
  if (rpm <= curve[0]![0]) return curve[0]![1];
  for (let i = 1; i < curve.length; i++) {
    const [ra, ta] = curve[i - 1]!;
    const [rb, tb] = curve[i]!;
    if (rpm <= rb) return rb === ra ? tb : ta + ((tb - ta) * (rpm - ra)) / (rb - ra);
  }
  return curve[curve.length - 1]![1];
}

/**
 * The curve reshaped to the figures. `oldLimit` is where the game's curve was meant to end (its
 * rev limit). Throws when the figures contradict each other (see figureProblems).
 */
export function shapeToFigures(curve: Curve, oldLimit: number, f: EngineFigures): [number, number][] {
  const problems = figureProblems(f);
  if (problems.length) throw new Error(problems[0]);
  // The game's torque peak, up to its limit.
  let peakRpm = curve[0]?.[0] ?? 0;
  let peakNm = 0;
  for (const [r, t] of curve) if (r <= oldLimit && t > peakNm) [peakRpm, peakNm] = [r, t];
  if (!(peakNm > 0) || !(peakRpm > 0) || oldLimit <= peakRpm) {
    // No usable shape: a plain curve that rises to the peak and eases off to the limit.
    peakRpm = oldLimit * 0.55;
    peakNm = 1;
    curve = [
      [0, 0.45],
      [peakRpm, 1],
      [oldLimit, 0.8],
    ];
  }
  // New rpm → the game's rpm (inverse of the warp: peak to peak, limit to limit).
  const back = (r: number) => (r <= f.torqueRpm ? (r / f.torqueRpm) * peakRpm : peakRpm + ((r - f.torqueRpm) / (f.limitRpm - f.torqueRpm)) * (oldLimit - peakRpm));
  const k = f.torqueNm / peakNm;
  const shaped = (r: number) => torqueAt(curve, back(r)) * k;

  // Bend the top end so torque at the power rpm is what that power needs.
  const want = nmFor(f.powerKw, f.powerRpm);
  const has = shaped(f.powerRpm);
  const bend = has > 0 ? want / has : 1;
  const span = Math.max(1, f.powerRpm - f.torqueRpm);
  const bent = (r: number) => {
    if (r <= f.torqueRpm) return shaped(r);
    const w = Math.min(1, (r - f.torqueRpm) / span);
    return shaped(r) * (1 + (bend - 1) * w);
  };
  // Power never above the asked peak, and a touch below it away from its rpm, so the peak is
  // exactly there; torque never above its peak.
  const cap = (r: number) => nmFor(f.powerKw * (1 - (0.03 * Math.abs(r - f.powerRpm)) / f.powerRpm), r);
  const torque = (r: number) => (r === f.torqueRpm ? f.torqueNm : r === f.powerRpm ? want : Math.max(0, Math.min(f.torqueNm, bent(r), cap(r))));

  // Points every 500 rpm (1000 for very high revving engines) to a step past the limit, plus the
  // two peaks themselves.
  const step = f.limitRpm > 12000 ? 1000 : 500;
  const rpms = new Set<number>();
  for (let r = 0; r <= f.limitRpm + step; r += step) rpms.add(r);
  rpms.add(Math.round(f.torqueRpm));
  rpms.add(Math.round(f.powerRpm));
  // Tenths of a newton-metre: the power point rounded up and the others down, so rounding can't
  // move the peak to a neighbour.
  const tR = Math.round(f.torqueRpm);
  const pR = Math.round(f.powerRpm);
  return [...rpms]
    .sort((a, b) => a - b)
    .map((r): [number, number] => {
      if (r === tR) return [r, r1(f.torqueNm)];
      if (r === pR) return [r, Math.ceil(torque(f.powerRpm) * 10) / 10];
      return [r, Math.floor(torque(r) * 10) / 10];
    });
}
