/**
 * The in-game checks (JBeam Forge in the game → Check): what each found, as the car's side reports
 * it, and how it is put to the modder.
 */
export interface CheckResult {
  pass?: boolean;
  error?: string;
  /** doors */
  latches?: number;
  list?: { name: string; opened: boolean; shutAgain: boolean; moved: number }[];
  /** skidpad: sideways pull held round the circle, g. */
  g?: number;
  broke?: number;
  /** pole */
  hit?: boolean;
  kmh?: number;
  peakG?: number;
  stillShut?: number;
}

const plain = (name: string) => name.replace(/_?coupler$/i, '').replace(/Latch$/i, '').replace(/_/g, ' ').trim();

/** One line for each check, pass or fail first. */
export function checkLines(checks: Readonly<Record<string, CheckResult>>): { name: string; pass: boolean; text: string }[] {
  const out: { name: string; pass: boolean; text: string }[] = [];
  const d = checks.doors;
  if (d) {
    const stuck = (d.list ?? []).filter((l) => !l.opened).map((l) => plain(l.name));
    const ajar = (d.list ?? []).filter((l) => l.opened && !l.shutAgain).map((l) => plain(l.name));
    const text = d.error
      ? `could not run (${d.error})`
      : !d.latches
        ? 'the car has no doors or lids with a latch'
        : stuck.length
          ? `${stuck.join(', ')} did not move when unlatched${ajar.length ? `; ${ajar.join(', ')} did not shut again` : ''}`
          : ajar.length
            ? `all ${d.latches} opened; ${ajar.join(', ')} did not shut again`
            : `all ${d.latches} opened and shut again`;
    out.push({ name: 'Doors and lids', pass: !d.error && !stuck.length && !ajar.length, text });
  }
  const s = checks.skidpad;
  if (s) out.push({ name: 'Skidpad', pass: !!s.pass, text: s.error ? `could not run (${s.error})` : `held ${(s.g ?? 0).toFixed(2)} g${s.broke ? `, and ${s.broke} beam${s.broke === 1 ? '' : 's'} broke on the way` : ''}${(s.g ?? 0) < 0.35 ? ' (under 0.35 g: it slides or tips before it grips)' : ''}` });
  const p = checks.pole;
  if (p)
    out.push({
      name: '50 km/h pole',
      pass: !!p.pass,
      text: p.error ? `could not run (${p.error})` : !p.hit ? `the car never reached the pole (${p.kmh ?? 0} km/h at best)` : `hit at ${p.kmh} km/h, ${(p.peakG ?? 0).toFixed(1)} g at the worst, ${p.broke ?? 0} beams broke${p.latches ? `, ${p.stillShut} of ${p.latches} doors and lids still shut` : ''}`,
    });
  return out;
}

/**
 * The same 50 km/h pole in the sandbox and in the game, side by side. The sandbox has the car's own
 * structure only (no suspension, engine or wheels, and no tyres to take the first of the blow), so
 * it breaks fewer beams than the game counts; what should agree is whether the structure gives at
 * all, and roughly how much of it.
 */
export function poleComparison(sandbox: { kmh: number; broke: number; beams: number }, game: CheckResult | undefined): string | null {
  if (!game || game.error || !game.hit) return null;
  const share = sandbox.beams ? (sandbox.broke / sandbox.beams) * 100 : 0;
  const verdict = sandbox.broke === 0 && (game.broke ?? 0) > 20 ? ' The sandbox broke nothing where the game broke a good deal: the structure is stiffer or stronger here than it proves in the game, so trust the game.' : sandbox.broke > 0 && (game.broke ?? 0) === 0 ? ' The sandbox broke beams the game did not: the suspension and tyres took the blow in the game.' : '';
  return `In the game the car hit the pole at ${game.kmh} km/h: ${(game.peakG ?? 0).toFixed(1)} g at the worst and ${game.broke ?? 0} beams broke, counting its suspension and engine. Here, at ${sandbox.kmh} km/h, ${sandbox.broke} of the structure's own ${sandbox.beams} beams broke (${share.toFixed(1)}%).${verdict}`;
}

/** The checks as one status message. */
export function checksMessage(checks: Readonly<Record<string, CheckResult>>): { text: string; tone: 'success' | 'warning' } {
  const lines = checkLines(checks);
  const failed = lines.filter((l) => !l.pass);
  return { text: `Checks: ${lines.map((l) => `${l.name} ${l.pass ? 'passed' : 'FAILED'} (${l.text})`).join('; ')}.`, tone: failed.length ? 'warning' : 'success' };
}
