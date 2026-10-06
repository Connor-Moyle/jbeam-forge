// Prints each engine preset's displacement, peak power and torque (to check them against real engines).
import { DEFAULT_DESIGN, DESIGN_PRESETS, designEngine } from '../../src/shared/powertrain/design';

for (const p of DESIGN_PRESETS) {
  const r = designEngine({ ...DEFAULT_DESIGN, ...p.design });
  const peakNm = Math.max(...r.curve.map(([, nm]) => nm));
  console.log(`${p.id.padEnd(22)} ${r.displacementL.toFixed(2)} L  ${Math.round(r.peakPower.kw)} kW (${Math.round(r.peakPower.kw * 1.341)} hp) @ ${r.peakPower.rpm}  ${Math.round(peakNm)} Nm  ${Math.round(r.massKg)} kg`);
}
