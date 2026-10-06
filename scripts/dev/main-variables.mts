/**
 * The tuning variables the game's parts define (brake strength, brake bias,
 * force feedback…): parts borrowed from a car use them, so a mod that brings those parts must
 * define them too. Writes each variable's most common definition across the install to
 * src/shared/export/gameVariables.json (run again after a game update).
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/main-variables.mts "<BeamNG install>"
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { isJbeamObject, parseJbeam } from '../../src/shared/jbeam/parse';

const install = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/BeamNG.drive';
const dir = join(install, 'content', 'vehicles');

function readJbeams(zip: string): Promise<string[]> {
  return new Promise((done) => {
    const out: string[] = [];
    yauzl.open(zip, { lazyEntries: true, autoClose: true }, (err, z) => {
      if (err || !z) return done(out);
      z.on('entry', (e: yauzl.Entry) => {
        if (!/\.jbeam$/i.test(e.fileName)) return z.readEntry();
        z.openReadStream(e, (e2, s) => {
          if (e2 || !s) return z.readEntry();
          const chunks: Buffer[] = [];
          s.on('data', (c: Buffer) => chunks.push(c));
          s.on('end', () => {
            out.push(Buffer.concat(chunks).toString('utf8'));
            z.readEntry();
          });
        });
      });
      z.on('end', () => done(out));
      z.readEntry();
    });
  });
}

const defs = new Map<string, Map<string, number>>();
let cars = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.zip'))) {
  for (const text of await readJbeams(join(dir, f))) {
    let v;
    try {
      v = parseJbeam(text).value;
    } catch {
      continue;
    }
    if (!isJbeamObject(v)) continue;
    for (const part of Object.values(v)) {
      if (!isJbeamObject(part) || !Array.isArray(part.variables)) continue;
      cars++;
      for (const row of part.variables.slice(1)) {
        if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
        const key = JSON.stringify(row.slice(1, 9));
        const m = defs.get(row[0]) ?? new Map<string, number>();
        m.set(key, (m.get(key) ?? 0) + 1);
        defs.set(row[0], m);
      }
    }
  }
}
// Every variable's most common definition (the row after its name), as JSON.
const table: Record<string, unknown[]> = {};
for (const [name, m] of [...defs].sort((a, b) => a[0].localeCompare(b[0]))) table[name] = JSON.parse([...m].sort((a, b) => b[1] - a[1])[0]![0]);
const outFile = join(import.meta.dirname, '..', '..', 'src', 'shared', 'export', 'gameVariables.json');
writeFileSync(outFile, `${JSON.stringify(table)}\n`);
console.log(`${cars} parts with variables, ${Object.keys(table).length} variables → ${outFile}`);
