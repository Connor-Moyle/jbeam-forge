/**
 * A generated part compared with the game's own cars (docs/proxy-generation.md: the official
 * Sunburst, every part measured): node weight, how braced it is, how fine its beams are, how much of
 * it can collide. Outliers say why they matter, in plain words.
 */

import type { BEAM_PRESETS } from '../taxonomy/schema';

export type Preset = (typeof BEAM_PRESETS)[number];

export interface CardLine {
  measure: string;
  value: string;
  reference: string;
  verdict: 'ok' | 'low' | 'high';
  /** What it means when it's out of range. */
  hint: string;
}

/** Median nodeWeight of each preset's official parts (kg). */
const WEIGHT: Record<Preset, number> = { structure_stiff: 2, panel_metal: 0.75, panel_plastic: 0.3, trim_light: 0.3, glass_brittle: 1.6, mechanical: 4.5, mechanical_light: 2, mechanical_block: 15, tyre_rubber: 0.5 };

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const round = (v: number, d = 2) => (Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : '—');

export function partReportCard(
  nodes: readonly { id: string; pos: readonly [number, number, number]; weight: number }[],
  beams: readonly { id1: string; id2: string }[],
  triangles: number,
  preset: Preset,
): CardLine[] {
  if (!nodes.length) return [];
  const pos = new Map(nodes.map((n) => [n.id, n.pos]));
  const lengths = beams.flatMap((b) => {
    const p = pos.get(b.id1);
    const q = pos.get(b.id2);
    return p && q ? [Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])] : [];
  });
  const glass = preset === 'glass_brittle';
  const out: CardLine[] = [];

  const w = median(nodes.map((n) => n.weight));
  const ref = WEIGHT[preset];
  out.push({
    measure: 'Node weight (median)',
    value: `${round(w)} kg`,
    reference: `${ref} kg`,
    verdict: w < ref / 3 ? 'low' : w > ref * 3 ? 'high' : 'ok',
    hint: w < ref / 3 ? 'Light nodes on stiff beams shake or explode in the game: raise the part’s mass or lower its detail.' : 'Heavy nodes make the part sluggish and the car heavy: lower its mass or raise its detail.',
  });

  // Each beam has two ends: beams per node counts both.
  const perNode = (beams.length * 2) / nodes.length;
  const [lo, hi] = glass ? [1.5, 5] : [4, 13];
  out.push({
    measure: 'Beams per node',
    value: round(perNode, 1),
    reference: glass ? '2' : '6–10',
    verdict: perNode < lo ? 'low' : perNode > hi ? 'high' : 'ok',
    hint: perNode < lo ? 'Too few beams: the part folds like paper. Raise its bracing.' : 'More beams than the game’s parts use: heavier to simulate and stiffer than it looks. Lower its bracing.',
  });

  const len = median(lengths);
  out.push({
    measure: 'Beam length (median)',
    value: `${round(len)} m`,
    reference: '0.32 m',
    verdict: len < 0.12 ? 'low' : len > 0.6 ? 'high' : 'ok',
    hint: len < 0.12 ? 'Very fine: many nodes for its size, slow in the game. Lower its detail.' : 'Coarse: it bends in big pieces and dents look blocky. Raise its detail or lower Max beam.',
  });

  const tpn = triangles / nodes.length;
  const [tlo, thi] = glass ? [0.15, 1] : preset.startsWith('mechanical') ? [0, 3] : [0.5, 2.5];
  out.push({
    measure: 'Collision triangles per node',
    value: round(tpn, 2),
    reference: glass ? '0.3' : preset.startsWith('mechanical') ? 'any' : '0.75–1.5',
    verdict: tpn < tlo ? 'low' : tpn > thi ? 'high' : 'ok',
    hint: tpn < tlo ? 'Little of it can collide: things pass through it. Generate it as a hull or surface.' : 'Many collision triangles for its nodes: heavier to simulate.',
  });
  return out;
}
