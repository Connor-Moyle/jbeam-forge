/**
 * Lint an exported mod folder the way BeamNG will read it (SPEC §4.15, §5.14 "unzip-lint").
 *
 *   npm run lint-mod -- "<mods>/unpacked/test"          (folder containing vehicles/<slug>/)
 *
 * Checks, for the default config (default.pc) and for every part:
 *  - every .jbeam parses (lenient parser) and every part has information/slotType
 *  - the main part exists, slots reference existing slotTypes, .pc parts exist and fit their slots
 *  - every flexbody mesh is a <node name> in the vehicle's DAE, and its node groups exist in the config
 *  - every beam/triangle/refNode references a node present in the installed config
 *  - node ids are unique across the installed config
 *  - main.materials.json covers every DAE material, and every texture file it references exists
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject, type JbeamValue } from '../src/shared/jbeam/parse';
import { readTable } from '../src/shared/jbeam/tables';

const root = process.argv[2];
if (!root) {
  console.error('usage: npm run lint-mod -- <mod folder containing vehicles/<slug>/>');
  process.exit(1);
}
const vehiclesDir = join(root, 'vehicles');
const slug = readdirSync(vehiclesDir)[0]!;
const dir = join(vehiclesDir, slug);
const errors: string[] = [];
const warnings: string[] = [];
const s = (v: JbeamValue | undefined) => (typeof v === 'string' ? v : JSON.stringify(v));

const parts = new Map<string, JbeamObject>();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.jbeam'))) {
  try {
    const v = parseJbeam(readFileSync(join(dir, f), 'utf8')).value;
    if (!isJbeamObject(v)) throw new Error('not an object');
    for (const [name, part] of Object.entries(v)) {
      if (!isJbeamObject(part)) errors.push(`${f}: part ${name} is not an object`);
      else if (parts.has(name)) errors.push(`${f}: duplicate part name ${name}`);
      else parts.set(name, part);
    }
  } catch (err) {
    errors.push(`${f}: does not parse: ${err instanceof Error ? err.message : String(err)}`);
  }
}
const main = parts.get(slug);
if (!main || main.slotType !== 'main') errors.push(`main part "${slug}" missing or not slotType "main"`);
for (const [name, p] of parts) {
  if (!p.information) errors.push(`${name}: no information`);
  if (!p.slotType) errors.push(`${name}: no slotType`);
}

// DAE node + material names
const daeFiles = readdirSync(dir).filter((x) => x.endsWith('.dae'));
const daeNodes = new Set<string>();
const daeMaterials = new Set<string>();
for (const f of daeFiles) {
  const text = readFileSync(join(dir, f), 'utf8');
  for (const m of text.matchAll(/<node [^>]*name="([^"]+)"/g)) daeNodes.add(m[1]!);
  for (const m of text.matchAll(/<material id="([^"]+)"/g)) daeMaterials.add(m[1]!);
}

// Slots: every slot's allowTypes must name a slotType some part has.
const slotTypes = new Set([...parts.values()].map((p) => s(p.slotType)));
const partsBySlot = new Map<string, string[]>();
for (const [name, p] of parts) partsBySlot.set(s(p.slotType), [...(partsBySlot.get(s(p.slotType)) ?? []), name]);
for (const [name, p] of parts) {
  if (!p.slots2) continue;
  for (const r of readTable(p.slots2).records) {
    const allow = r.values.allowTypes;
    for (const t of Array.isArray(allow) ? allow : []) if (!slotTypes.has(s(t))) errors.push(`${name}: slot ${s(r.values.name)} allows "${s(t)}" but no part has that slotType`);
    const def = s(r.values.default);
    if (def && !parts.has(def)) errors.push(`${name}: slot ${s(r.values.name)} defaults to missing part ${def}`);
  }
}

// Default config
const pc = JSON.parse(readFileSync(join(dir, 'default.pc'), 'utf8')) as { format: number; model: string; parts: Record<string, string> };
if (pc.format !== 2 || pc.model !== slug) errors.push(`default.pc: format ${pc.format}, model ${pc.model}`);
const installed = new Set<string>([slug]);
// Walk the slot tree from the main part with the .pc choices.
const queue = [slug];
while (queue.length) {
  const p = parts.get(queue.shift()!);
  if (!p?.slots2) continue;
  for (const r of readTable(p.slots2).records) {
    const slot = s(r.values.name);
    const choice = pc.parts[slot] ?? s(r.values.default);
    if (!choice) continue;
    if (!parts.has(choice)) {
      errors.push(`default.pc: slot ${slot} → missing part ${choice}`);
      continue;
    }
    if (s(parts.get(choice)!.slotType) !== slot) errors.push(`default.pc: part ${choice} does not fit slot ${slot}`);
    if (!installed.has(choice)) {
      installed.add(choice);
      queue.push(choice);
    }
  }
}

// Nodes, groups, flexbodies, beams in the installed config
const nodeOwner = new Map<string, string>();
const groups = new Set<string>();
for (const name of installed) {
  const p = parts.get(name)!;
  if (!p.nodes) continue;
  for (const r of readTable(p.nodes).records) {
    const id = s(r.values.id);
    if (nodeOwner.has(id)) errors.push(`node ${id} defined by both ${nodeOwner.get(id)} and ${name}`);
    nodeOwner.set(id, name);
    const g = r.options.group;
    if (typeof g === 'string' && g) groups.add(g);
    else if (Array.isArray(g)) g.forEach((x) => groups.add(s(x)));
    else errors.push(`${name}: node ${id} has no group`);
  }
}
let flexCount = 0;
for (const name of installed) {
  const p = parts.get(name)!;
  if (p.flexbodies)
    for (const r of readTable(p.flexbodies).records) {
      flexCount++;
      const mesh = s(r.values.mesh);
      if (!daeNodes.has(mesh)) errors.push(`${name}: flexbody mesh ${mesh} is not in the DAE`);
      const gs = r.values['[group]:'];
      for (const g of Array.isArray(gs) ? gs : []) if (!groups.has(s(g))) errors.push(`${name}: flexbody ${mesh} binds to node group ${s(g)}, which no installed part has`);
    }
  if (p.beams) for (const r of readTable(p.beams).records) for (const k of ['id1:', 'id2:']) if (!nodeOwner.has(s(r.values[k]))) errors.push(`${name}: beam references missing node ${s(r.values[k])}`);
  if (p.triangles) for (const r of readTable(p.triangles).records) for (const k of ['id1:', 'id2:', 'id3:']) if (!nodeOwner.has(s(r.values[k]))) errors.push(`${name}: triangle references missing node ${s(r.values[k])}`);
  if (p.refNodes) for (const r of readTable(p.refNodes).records) for (const v of Object.values(r.values)) if (!nodeOwner.has(s(v))) errors.push(`${name}: refNode ${s(v)} missing`);
  if (name !== slug && !p.flexbodies && !p.nodes) warnings.push(`${name}: no flexbodies and no nodes (empty part)`);
}
if (![...installed].some((n) => parts.get(n)!.refNodes)) errors.push('no installed part has refNodes');

// Materials
const mats = JSON.parse(readFileSync(join(dir, 'main.materials.json'), 'utf8')) as Record<string, { mapTo: string; Stages: Record<string, unknown>[] }>;
const mapped = new Set(Object.values(mats).map((m) => m.mapTo));
for (const m of daeMaterials) if (!mapped.has(m)) errors.push(`DAE material ${m} has no main.materials.json entry`);
for (const [name, m] of Object.entries(mats)) {
  for (const stage of m.Stages)
    for (const [k, v] of Object.entries(stage)) {
      if (!k.endsWith('Map') || typeof v !== 'string') continue;
      const file = join(root, ...v.replace(/^\//, '').split('/'));
      if (!existsSync(file)) errors.push(`material ${name}: ${k} ${v} does not exist`);
    }
}

let nodeCount = 0;
let beamCount = 0;
for (const name of installed) {
  const p = parts.get(name)!;
  if (p.nodes) nodeCount += readTable(p.nodes).records.length;
  if (p.beams) beamCount += readTable(p.beams).records.length;
}
console.log(`${slug}: ${parts.size} parts in ${readdirSync(dir).filter((x) => x.endsWith('.jbeam')).length} jbeam files · default config installs ${installed.size} parts, ${nodeCount} nodes, ${beamCount} beams, ${flexCount} flexbodies · DAE ${daeNodes.size} meshes / ${daeMaterials.size} materials`);
for (const w of warnings.slice(0, 20)) console.log(`  warn: ${w}`);
if (errors.length) {
  console.log(`${errors.length} ERRORS:`);
  for (const e of errors.slice(0, 60)) console.log(`  ${e}`);
  process.exit(1);
}
console.log('OK: no errors');
