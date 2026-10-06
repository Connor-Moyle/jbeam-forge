import type { JbeamObject } from '../jbeam/parse';
import { readTable } from '../jbeam/tables';

/**
 * Following the powertrain the way the game wires it: every device takes its input from another by
 * name, from the engine (or motors) down to the shafts that turn wheels. A gearbox and a suspension
 * from different cars can leave the chain hanging: a front-engined car's driveshaft with a
 * rear-engined buggy's axle, which has no differential of its own, turned no wheel at all.
 */
export interface ChainReport {
  /** Wheels the engine reaches. */
  wheels: string[];
  /** The last device the chain gets to when it reaches none (for the message). */
  endsAt: string | null;
}

interface Device {
  type: string;
  name: string;
  input: string;
  wheel: string | null;
}

export function powertrainChain(parts: readonly JbeamObject[]): ChainReport {
  const devices: Device[] = [];
  for (const p of parts) {
    if (!Array.isArray(p.powertrain)) continue;
    try {
      for (const r of readTable(p.powertrain).records) {
        const wheel = r.options.connectedWheel ?? r.values.connectedWheel;
        const text = (v: unknown) => (typeof v === 'string' ? v : '');
        devices.push({ type: text(r.values.type), name: text(r.values.name), input: text(r.values.inputName), wheel: typeof wheel === 'string' ? wheel : null });
      }
    } catch {
      // not a table: skip
    }
  }
  const sources = devices.filter((d) => d.type === 'combustionEngine' || d.type === 'electricMotor');
  const reached = new Set(sources.map((d) => d.name));
  let last: string | null = sources[0]?.name ?? null;
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of devices)
      if (!reached.has(d.name) && reached.has(d.input)) {
        reached.add(d.name);
        last = d.name;
        grew = true;
      }
  }
  const wheels = [...new Set(devices.filter((d) => reached.has(d.name) && d.wheel).map((d) => d.wheel!))];
  return { wheels, endsAt: wheels.length ? null : last };
}
