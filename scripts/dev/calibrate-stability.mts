/**
 * The stability predictor against the game's own cars: ω·Δt for every node of every official
 * vehicle (ω = √(Σ incident beamSpring / nodeWeight), Δt = 1/2000 s), by vehicle type. The game's
 * cars are stable, so where their nodes sit says where "ok" and "unstable" really are.
 * Prints aggregates only; nothing from the game files is kept.
 *
 *   npx tsx scripts/dev/calibrate-stability.mts "C:/Program Files (x86)/Steam/steamapps/common/BeamNG.drive"
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { isJbeamObject, parseJbeam, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';
import { coordinate, variableDefaults } from '../../src/shared/suspension/transplant';
import { STABILITY_DT, STABILITY_OK, STABILITY_UNSTABLE } from '../../src/shared/proxy/derive';

const install = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/BeamNG.drive';
const DEFAULT_SPRING = 4_300_000;
const DEFAULT_WEIGHT = 25;

function readZip(file: string): Promise<Map<string, string>> {
  return new Promise((done, fail) => {
    const out = new Map<string, string>();
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, z) => {
      if (err || !z) return fail(err ?? new Error('no zip'));
      z.on('entry', (e: yauzl.Entry) => {
        if (!/\.(jbeam|json)$/i.test(e.fileName) || /\/(art|ui)\//.test(e.fileName)) return z.readEntry();
        z.openReadStream(e, (err2, s) => {
          if (err2 || !s) return z.readEntry();
          const chunks: Buffer[] = [];
          s.on('data', (c: Buffer) => chunks.push(c));
          s.on('end', () => {
            out.set(e.fileName, Buffer.concat(chunks).toString('utf8'));
            z.readEntry();
          });
        });
      });
      z.on('end', () => done(out));
      z.on('error', fail);
      z.readEntry();
    });
  });
}

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? NaN;

const zips = readdirSync(join(install, 'content', 'vehicles')).filter((f) => f.endsWith('.zip') && f !== 'common.zip');
const byType = new Map<string, number[]>();
for (const zipName of zips) {
  const files = await readZip(join(install, 'content', 'vehicles', zipName)).catch(() => new Map<string, string>());
  const model = zipName.replace(/\.zip$/, '');
  let type = 'Unknown';
  const info = files.get(`vehicles/${model}/info.json`);
  if (info) {
    try {
      const v = parseJbeam(info).value;
      if (isJbeamObject(v) && typeof v.Type === 'string') type = v.Type;
    } catch {
      // keep Unknown
    }
  }
  const parts: JbeamObject[] = [];
  for (const [name, text] of files) {
    if (!name.endsWith('.jbeam')) continue;
    try {
      const doc = parseJbeam(text).value;
      if (isJbeamObject(doc)) for (const p of Object.values(doc)) if (isJbeamObject(p)) parts.push(p);
    } catch {
      // unreadable: skip
    }
  }
  if (!parts.length) continue;
  const vars = variableDefaults(parts);
  const num = (v: unknown, d: number) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.startsWith('$')) {
      const n = coordinate(v, vars);
      return Number.isFinite(n) ? n : d;
    }
    return d;
  };
  // Per part, so a node and the beams on it come from the same version of the part.
  const ratios: number[] = [];
  for (const p of parts) {
    if (!Array.isArray(p.nodes) || !Array.isArray(p.beams)) continue;
    const weight = new Map<string, number>();
    try {
      for (const r of readTable(p.nodes).records) if (typeof r.values.id === 'string') weight.set(r.values.id, num(r.options.nodeWeight, DEFAULT_WEIGHT));
      const springs = new Map<string, number>();
      for (const r of readTable(p.beams).records) {
        const a = r.values['id1:'];
        const b = r.values['id2:'];
        if (typeof a !== 'string' || typeof b !== 'string') continue;
        const k = num(r.options.beamSpring, DEFAULT_SPRING);
        if (!(k > 0)) continue;
        springs.set(a, (springs.get(a) ?? 0) + k);
        springs.set(b, (springs.get(b) ?? 0) + k);
      }
      for (const [id, w] of weight) if (w > 0 && springs.has(id)) ratios.push(Math.sqrt(springs.get(id)! / w) * STABILITY_DT);
    } catch {
      // a table the reader can't take: skip the part
    }
  }
  if (!ratios.length) continue;
  ratios.sort((a, b) => a - b);
  const list = byType.get(type) ?? [];
  list.push(...ratios);
  byType.set(type, list);
  const over = (t: number) => ((100 * ratios.filter((r) => r > t).length) / ratios.length).toFixed(1);
  console.log(`${model.padEnd(22)} ${type.padEnd(10)} nodes ${String(ratios.length).padStart(5)}  p50 ${pct(ratios, 0.5).toFixed(2)}  p90 ${pct(ratios, 0.9).toFixed(2)}  p99 ${pct(ratios, 0.99).toFixed(2)}  max ${ratios.at(-1)!.toFixed(2)}  >${STABILITY_OK} ${over(STABILITY_OK)}%  >${STABILITY_UNSTABLE} ${over(STABILITY_UNSTABLE)}%`);
}
console.log('\nby type');
for (const [type, list] of byType) {
  list.sort((a, b) => a - b);
  console.log(`${type.padEnd(10)} nodes ${String(list.length).padStart(6)}  p50 ${pct(list, 0.5).toFixed(2)}  p90 ${pct(list, 0.9).toFixed(2)}  p99 ${pct(list, 0.99).toFixed(2)}  p99.9 ${pct(list, 0.999).toFixed(2)}`);
}
