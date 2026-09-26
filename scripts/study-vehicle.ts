#!/usr/bin/env tsx
/**
 * Extract an official vehicle's text content for format study (SPEC §3.1).
 *
 * Usage: npm run study-vehicle -- <vehicle> [--dir=<install>] [--common]
 *
 * --common also indexes every DAE node name in content/vehicles/common.zip
 * (cached in scratch/vehicle-study/_common-dae-nodes.json) so flexbody meshes
 * that live in shared content are resolved too.
 *
 * Streams from content/vehicles/<vehicle>.zip (never loads the zip) into
 * scratch/vehicle-study/<vehicle>/ (gitignored — game content stays local):
 *   - every .jbeam / .json / .pc / *.materials.json file, as-is
 *   - dae-nodes.json: <node> names/ids from each .dae (the DAE itself is skipped)
 *   - summary.json: parts, slotTypes, slots2, sections, table headers, configs,
 *     and the flexbody-mesh ↔ DAE-node cross-check
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject, type JbeamValue } from '../src/shared/jbeam/parse';
import { readTable } from '../src/shared/jbeam/tables';
import { withZip, type ZipReader } from '../src/main/beamng/zip';
import { describeInstall, resolveInstallDir } from './lib/installDir';

const argv = process.argv.slice(2);
const vehicle = argv.find((a) => !a.startsWith('--'));
if (!vehicle) {
  console.error('Usage: npm run study-vehicle -- <vehicle> [--dir=<install>]   (e.g. covet, pickup, etk800)');
  process.exit(1);
}

const install = await resolveInstallDir(argv);
const zipPath = join(install.dir, 'content', 'vehicles', `${vehicle}.zip`);
const outDir = join(process.cwd(), 'scratch', 'vehicle-study', vehicle);
const prefix = `vehicles/${vehicle}/`;
const isText = (n: string) => /\.(jbeam|json|pc)$/i.test(n);
const withCommon = argv.includes('--common');
const commonCache = join(process.cwd(), 'scratch', 'vehicle-study', '_common-dae-nodes.json');

console.log(`BeamNG install: ${describeInstall(install)}`);
console.log(`Studying ${zipPath}`);

/** Stream a (possibly 100+ MB) DAE and collect <node> name/id attributes. */
async function daeNodeNames(zip: ZipReader, entry: string): Promise<string[]> {
  const names = new Set<string>();
  let tail = '';
  for await (const chunk of await zip.stream(entry)) {
    const text = tail + (chunk as Buffer).toString('utf8');
    for (const m of text.matchAll(/<node\b[^>]*>/g)) {
      const tag = m[0];
      const name = tag.match(/\sname="([^"]*)"/)?.[1];
      const id = tag.match(/\sid="([^"]*)"/)?.[1];
      if (name) names.add(name);
      else if (id) names.add(id);
    }
    const lastOpen = text.lastIndexOf('<');
    tail = lastOpen >= 0 && text.indexOf('>', lastOpen) === -1 ? text.slice(lastOpen) : '';
  }
  return [...names].sort();
}

interface PartSummary {
  name: string;
  file: string;
  slotType: JbeamValue | undefined;
  displayName: JbeamValue | undefined;
  sections: string[];
  slots: { name: JbeamValue; allowTypes: JbeamValue; default: JbeamValue; options: JbeamObject }[];
  flexbodyMeshes: string[];
}

await withZip(zipPath, async (zip) => {
  const entries = (await zip.entries()).filter((e) => e.name.startsWith(prefix));
  const written = await zip.extract((n) => n.startsWith(prefix) && isText(n), outDir, (n) => n.slice(prefix.length));
  console.log(`Extracted ${written.length} text files → ${outDir}`);

  const daeNodes: Record<string, string[]> = {};
  for (const e of entries.filter((x) => /\.dae$/i.test(x.name))) {
    daeNodes[e.name.slice(prefix.length)] = await daeNodeNames(zip, e.name);
  }
  await mkdir(outDir, { recursive: true }); // extract() creates nothing if no text files matched
  await writeFile(join(outDir, 'dae-nodes.json'), `${JSON.stringify(daeNodes, null, 2)}\n`);

  const parts: PartSummary[] = [];
  const headers = new Map<string, Map<string, number>>();
  const parseProblems: string[] = [];
  for (const e of entries.filter((x) => /\.jbeam$/i.test(x.name))) {
    const file = e.name.slice(prefix.length);
    let doc: JbeamValue;
    try {
      doc = parseJbeam(await zip.readText(e.name)).value;
    } catch (err) {
      parseProblems.push(`${file}: ${(err as Error).message}`);
      continue;
    }
    if (!isJbeamObject(doc)) continue;
    for (const [name, part] of Object.entries(doc)) {
      if (!isJbeamObject(part)) continue;
      const info = isJbeamObject(part.information) ? part.information : undefined;
      const slots: PartSummary['slots'] = [];
      const slotSection = part.slots2 ?? part.slots;
      if (Array.isArray(slotSection)) {
        try {
          for (const r of readTable(slotSection).records) {
            slots.push({ name: r.values.name ?? r.values.type ?? null, allowTypes: r.values.allowTypes ?? null, default: r.values.default ?? null, options: r.inlineOptions });
          }
        } catch {
          /* non-table slots: recorded via sections list */
        }
      }
      const flexbodyMeshes: string[] = [];
      if (Array.isArray(part.flexbodies)) {
        try {
          for (const r of readTable(part.flexbodies).records) if (typeof r.values.mesh === 'string') flexbodyMeshes.push(r.values.mesh);
        } catch {
          /* ignore */
        }
      }
      for (const [section, content] of Object.entries(part)) {
        if (!Array.isArray(content)) continue;
        try {
          const h = JSON.stringify(readTable(content).header);
          const m = headers.get(section) ?? new Map<string, number>();
          m.set(h, (m.get(h) ?? 0) + 1);
          headers.set(section, m);
        } catch {
          /* not a table */
        }
      }
      parts.push({ name, file, slotType: part.slotType, displayName: info?.name, sections: Object.keys(part), slots, flexbodyMeshes });
    }
  }

  const allDaeNodes = new Set(Object.values(daeNodes).flat());
  const meshRefs = [...new Set(parts.flatMap((p) => p.flexbodyMeshes))].sort();
  const missingMeshes = meshRefs.filter((m) => !allDaeNodes.has(m));
  const commonNodes = withCommon ? await loadCommonDaeNodes() : null;
  const missingEverywhere = commonNodes ? missingMeshes.filter((m) => !commonNodes.has(m)) : null;

  const configs: { file: string; format: JbeamValue; model: JbeamValue; partCount: number; vars: number }[] = [];
  for (const e of entries.filter((x) => /\.pc$/i.test(x.name))) {
    try {
      const pc = parseJbeam(await zip.readText(e.name)).value;
      if (isJbeamObject(pc)) {
        configs.push({
          file: e.name.slice(prefix.length),
          format: pc.format ?? null,
          model: pc.model ?? null,
          partCount: isJbeamObject(pc.parts) ? Object.keys(pc.parts).length : 0,
          vars: isJbeamObject(pc.vars) ? Object.keys(pc.vars).length : 0,
        });
      }
    } catch (err) {
      parseProblems.push(`${e.name}: ${(err as Error).message}`);
    }
  }

  const summary = {
    vehicle,
    install: { version: install.version, build: install.build },
    fileTypes: Object.fromEntries(
      [...entries.reduce((m, e) => m.set(e.name.split('.').pop()!.toLowerCase(), (m.get(e.name.split('.').pop()!.toLowerCase()) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]),
    ),
    mainParts: parts.filter((p) => p.slotType === 'main').map((p) => p.name),
    partCount: parts.length,
    flexbodies: {
      meshReferences: meshRefs.length,
      daeNodes: allDaeNodes.size,
      missingFromOwnDae: missingMeshes,
      commonDaeNodes: commonNodes?.size ?? null,
      missingFromOwnAndCommon: missingEverywhere,
    },
    tableHeaders: Object.fromEntries([...headers].sort().map(([s, m]) => [s, Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))])),
    configs,
    parts,
    parseProblems,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`Parts: ${parts.length} (main: ${summary.mainParts.join(', ') || 'none'}), configs: ${configs.length}`);
  console.log(`Flexbody meshes: ${meshRefs.length} referenced, ${missingMeshes.length} not in this vehicle's DAEs (${allDaeNodes.size} nodes)`);
  if (missingEverywhere && commonNodes) {
    const sample = missingEverywhere.length ? `: ${missingEverywhere.slice(0, 10).join(', ')}` : '';
    console.log(`  …of those, ${missingEverywhere.length} not in common.zip DAEs either (${commonNodes.size} nodes)${sample}`);
  }
  if (parseProblems.length) console.log(`Parse problems:\n  ${parseProblems.join('\n  ')}`);
  console.log(`Summary → ${join(outDir, 'summary.json')}`);
});

async function loadCommonDaeNodes(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse(await readFile(commonCache, 'utf8')) as string[]);
  } catch {
    /* no cache yet */
  }
  console.log('Indexing DAE node names in common.zip (one-time, cached)…');
  const names = new Set<string>();
  await withZip(join(install.dir, 'content', 'vehicles', 'common.zip'), async (zip) => {
    for (const e of (await zip.entries()).filter((x) => x.name.toLowerCase().endsWith('.dae'))) {
      for (const n of await daeNodeNames(zip, e.name)) names.add(n);
    }
  });
  await mkdir(join(commonCache, '..'), { recursive: true });
  await writeFile(commonCache, JSON.stringify([...names].sort()));
  return names;
}
