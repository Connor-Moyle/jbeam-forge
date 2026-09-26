#!/usr/bin/env tsx
/**
 * Ground-truth check for the jbeam parser, serializer and table model against
 * EVERY .jbeam in every official vehicle zip of the local BeamNG install
 * (SPEC §3.1/§3.4). Nothing from the game is copied into the repo; only the
 * generated catalogue (names/headers/counts) is written when asked.
 *
 * Usage: npm run jbeam:corpus [-- --dir=<install>] [--zip=a,b] [--catalogue=docs/beamng-section-catalogue.md]
 *
 * Per file:  parse (lenient) → serialize → parse (STRICT) → deep-equal,
 *            serialize again → byte-identical (idempotent),
 *            readTable on every table-shaped section.
 * Exits non-zero on any failure.
 */
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isJbeamObject, parseJbeam, type DiagnosticCode, type JbeamValue } from '../src/shared/jbeam/parse';
import { serializeJbeam } from '../src/shared/jbeam/serialize';
import { readTable } from '../src/shared/jbeam/tables';
import { withZip } from '../src/main/beamng/zip';
import { describeInstall, resolveInstallDir } from './lib/installDir';

const argv = process.argv.slice(2);
const onlyZips = argv.find((a) => a.startsWith('--zip='))?.slice(6).split(',');
const cataloguePath = argv.find((a) => a.startsWith('--catalogue='))?.slice(12);

const install = await resolveInstallDir(argv);
console.log(`BeamNG install: ${describeInstall(install)}`);

const vehiclesDir = join(install.dir, 'content', 'vehicles');
const zips = (await readdir(vehiclesDir))
  .filter((f) => f.toLowerCase().endsWith('.zip'))
  .filter((f) => !onlyZips || onlyZips.includes(f.replace(/\.zip$/i, '')))
  .sort();

const stats = { files: 0, parsed: 0, roundTrip: 0, idempotent: 0, tables: 0, parts: 0, bytes: 0 };
const failures: string[] = [];
const diagCounts = new Map<DiagnosticCode, number>();
const diagExamples = new Map<DiagnosticCode, string>();

/** section → { parts using it, vehicles using it, header variants } */
interface SectionInfo {
  parts: number;
  vehicles: Set<string>;
  headers: Map<string, number>;
  shape: Map<string, number>;
}
const sections = new Map<string, SectionInfo>();

function isTableShaped(v: JbeamValue): boolean {
  if (!Array.isArray(v)) return false;
  const firstRow = v.find(Array.isArray);
  return firstRow !== undefined && firstRow.length > 0 && firstRow.every((c) => typeof c === 'string') && v.every((el) => Array.isArray(el) || isJbeamObject(el));
}

function shapeOf(v: JbeamValue): string {
  if (isTableShaped(v)) return 'table';
  if (Array.isArray(v)) return 'array';
  if (isJbeamObject(v)) return 'object';
  return typeof v;
}

const started = performance.now();
for (const zipName of zips) {
  const vehicle = zipName.replace(/\.zip$/i, '');
  await withZip(join(vehiclesDir, zipName), async (zip) => {
    const names = (await zip.entries()).map((e) => e.name).filter((n) => n.toLowerCase().endsWith('.jbeam'));
    for (const name of names) {
      stats.files++;
      const where = `${zipName}:${name}`;
      const text = await zip.readText(name);
      stats.bytes += text.length;

      let value: JbeamValue;
      try {
        const res = parseJbeam(text, { collectInfo: true });
        value = res.value;
        stats.parsed++;
        for (const d of res.diagnostics) {
          diagCounts.set(d.code, (diagCounts.get(d.code) ?? 0) + 1);
          if (!diagExamples.has(d.code) && d.level === 'warning') diagExamples.set(d.code, `${where}:${d.line}:${d.col} ${d.message}`);
        }
      } catch (err) {
        failures.push(`${where}: parse: ${(err as Error).message}`);
        continue;
      }
      if (!isJbeamObject(value)) {
        failures.push(`${where}: root is not an object`);
        continue;
      }

      try {
        const out = serializeJbeam(value);
        const back = parseJbeam(out, { strict: true }).value;
        if (isDeepStrictEqual(back, value)) stats.roundTrip++;
        else failures.push(`${where}: round-trip changed the value`);
        if (isJbeamObject(back) && serializeJbeam(back) === out) stats.idempotent++;
        else failures.push(`${where}: serializer not idempotent`);
      } catch (err) {
        failures.push(`${where}: round-trip: ${(err as Error).message}`);
      }

      for (const [partName, part] of Object.entries(value)) {
        if (!isJbeamObject(part)) continue;
        stats.parts++;
        for (const [section, content] of Object.entries(part)) {
          let info = sections.get(section);
          if (!info) sections.set(section, (info = { parts: 0, vehicles: new Set(), headers: new Map(), shape: new Map() }));
          info.parts++;
          info.vehicles.add(vehicle);
          const shape = shapeOf(content);
          info.shape.set(shape, (info.shape.get(shape) ?? 0) + 1);
          if (shape === 'table') {
            try {
              const t = readTable(content);
              stats.tables++;
              const key = JSON.stringify(t.header);
              info.headers.set(key, (info.headers.get(key) ?? 0) + 1);
            } catch (err) {
              failures.push(`${where}: ${partName}.${section}: readTable: ${(err as Error).message}`);
            }
          }
        }
      }
    }
  });
  process.stdout.write('.');
}

const secs = ((performance.now() - started) / 1000).toFixed(1);
console.log(`\n
files       ${stats.parsed}/${stats.files} parsed (${(stats.bytes / 1e6).toFixed(1)} MB, ${zips.length} zips, ${secs}s)
round-trip  ${stats.roundTrip}/${stats.parsed} (lenient parse → serialize → strict parse → deep-equal)
idempotent  ${stats.idempotent}/${stats.parsed}
parts       ${stats.parts}, table sections read: ${stats.tables}, distinct sections: ${sections.size}`);
console.log('\nDiagnostics:');
for (const [code, n] of [...diagCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code.padEnd(22)} ${String(n).padStart(8)}${diagExamples.has(code) ? `   e.g. ${diagExamples.get(code)}` : ''}`);
}

if (cataloguePath) {
  await writeFile(cataloguePath, renderCatalogue());
  console.log(`\nCatalogue written to ${cataloguePath}`);
}

if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures.slice(0, 50)) console.log(`  ${f}`);
  process.exit(1);
}

function renderCatalogue(): string {
  const rows = [...sections].sort((a, b) => b[1].parts - a[1].parts);
  const lines = [
    '# BeamNG jbeam section catalogue',
    '',
    `Generated by \`npm run jbeam:corpus -- --catalogue=docs/beamng-section-catalogue.md\` from **BeamNG.drive ${install.version ?? install.build ?? '(unknown version)'}**:`,
    `${stats.files} jbeam files, ${stats.parts} parts, ${zips.length} vehicle zips. Counts are parts using the section. No game content is reproduced — only section names and table headers.`,
    '',
    'Use this as the lookup table for "what does the official format actually look like" before writing any exporter (SPEC §3.1).',
    '',
    '| Section | Parts | Vehicles | Shape |',
    '|---|---:|---:|---|',
    ...rows.map(([name, i]) => `| \`${name}\` | ${i.parts} | ${i.vehicles.size} | ${[...i.shape].map(([s, n]) => (i.shape.size > 1 ? `${s} (${n})` : s)).join(', ')} |`),
    '',
    '## Table headers',
    '',
    'Every header variant seen for table-shaped sections, most common first (sections used by ≥ 3 parts).',
    '',
  ];
  for (const [name, i] of rows) {
    if (i.headers.size === 0 || i.parts < 3) continue;
    lines.push(`### \`${name}\``, '');
    for (const [h, n] of [...i.headers].sort((a, b) => b[1] - a[1]).slice(0, 8)) lines.push(`- ${n}× \`${h}\``);
    if (i.headers.size > 8) lines.push(`- … ${i.headers.size - 8} rarer variants`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
