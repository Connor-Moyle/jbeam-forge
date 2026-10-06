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
 *
 * With BEAMNG_INSTALL set to the game folder, the parts every car can use (vehicles/common in
 * the install: wheels, tyres, hubcaps…) count as available, the way the game resolves slots.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import yauzl from 'yauzl';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject, type JbeamValue } from '../src/shared/jbeam/parse';
import { readTable } from '../src/shared/jbeam/tables';
import { scanGameMaterials } from '../src/main/beamng/gameMaterials';

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

// The game's shared parts (vehicles/common), which every car can use.
const gameParts = new Map<string, JbeamObject>();
const install = process.env.BEAMNG_INSTALL;
if (install && existsSync(join(install, 'content', 'vehicles', 'common.zip'))) {
  const texts = await new Promise<string[]>((resolve, reject) => {
    const out: string[] = [];
    yauzl.open(join(install, 'content', 'vehicles', 'common.zip'), { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('common.zip could not be opened'));
      zip.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.endsWith('.jbeam')) return zip.readEntry();
        zip.openReadStream(e, (err2, stream) => {
          if (err2 || !stream) return reject(err2 ?? new Error(`${e.fileName} could not be read`));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            out.push(Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(out));
      zip.readEntry();
    });
  });
  for (const text of texts) {
    try {
      const v = parseJbeam(text).value;
      if (isJbeamObject(v)) for (const [name, part] of Object.entries(v)) if (isJbeamObject(part) && !parts.has(name)) gameParts.set(name, part);
    } catch {
      /* a game file the lenient parser can't read: its parts just aren't counted */
    }
  }
}
// Every file the game ships in its vehicle zips (lower case, without the image extension: the
// game takes x.color.dds for x.color.png), for materials that point at the game's own textures.
const gameFiles = new Set<string>();
const stem = (path: string) => path.toLowerCase().replace(/^\//, '').replace(/\.(png|dds|jpg|jpeg|tga)$/, '');
if (install && existsSync(join(install, 'content', 'vehicles'))) {
  for (const z of readdirSync(join(install, 'content', 'vehicles')).filter((f) => f.endsWith('.zip')))
    await new Promise<void>((resolve) => {
      yauzl.open(join(install, 'content', 'vehicles', z), { lazyEntries: true, autoClose: true }, (err, zip) => {
        if (err || !zip) return resolve();
        zip.on('entry', (e: yauzl.Entry) => {
          gameFiles.add(stem(e.fileName));
          zip.readEntry();
        });
        zip.on('end', () => resolve());
        zip.on('error', () => resolve());
        zip.readEntry();
      });
    });
}

const partOf = (name: string) => parts.get(name) ?? gameParts.get(name);

/** A part's slots, from either table the game reads: slots2 (name, allowTypes, default) or the older slots (type, default). */
function slotRows(p: JbeamObject): { name: string; allow: string[]; def: string }[] {
  if (p.slots2) return readTable(p.slots2).records.map((r) => ({ name: s(r.values.name), allow: Array.isArray(r.values.allowTypes) ? r.values.allowTypes.map(s) : [s(r.values.name)], def: typeof r.values.default === 'string' ? r.values.default : '' }));
  if (p.slots) return readTable(p.slots).records.map((r) => ({ name: s(r.values.type), allow: [s(r.values.type)], def: typeof r.values.default === 'string' ? r.values.default : '' }));
  return [];
}

// Slots: every slot's allowTypes must name a slotType some part has.
const slotTypes = new Set([...parts.values(), ...gameParts.values()].map((p) => s(p.slotType)));
const partsBySlot = new Map<string, string[]>();
for (const [name, p] of parts) partsBySlot.set(s(p.slotType), [...(partsBySlot.get(s(p.slotType)) ?? []), name]);
// Filled by the game's own common parts (every stock car declares them), and meshes from vehicles/common.
const GAME_SLOT_TYPES = new Set(['paint_design', 'skin_glass', 'licenseplate_design_2_1']);
const GAME_MESHES = new Set(['licenseplate', 'towhitch', 'n2o_bottle_10lb', 'n2o_bottle_20lb']);
for (const [name, p] of parts) {
  for (const r of slotRows(p)) {
    // An optional slot with nothing to fit stays empty in the game (an ETK-only power steering slot on a borrowed suspension): worth knowing, not broken.
    for (const t of r.allow) if (!slotTypes.has(t) && !GAME_SLOT_TYPES.has(t)) (r.def ? errors : warnings).push(`${name}: slot ${r.name} allows "${t}" but no part has that slotType${r.def ? '' : ', so it stays empty'}`);
    if (r.def && !partOf(r.def)) errors.push(`${name}: slot ${r.name} defaults to missing part ${r.def}`);
  }
}

// Default config
const pc = JSON.parse(readFileSync(join(dir, 'default.pc'), 'utf8')) as { format: number; model: string; parts: Record<string, string> };
if (pc.format !== 2 || pc.model !== slug) errors.push(`default.pc: format ${pc.format}, model ${pc.model}`);
const installed = new Set<string>([slug]);
// Walk the slot tree from the main part with the .pc choices.
const queue = [slug];
while (queue.length) {
  const p = partOf(queue.shift()!);
  if (!p) continue;
  for (const r of slotRows(p)) {
    const slot = r.name;
    const choice = pc.parts[slot] ?? r.def;
    if (!choice) continue;
    if (!partOf(choice)) {
      errors.push(`default.pc: slot ${slot} → missing part ${choice}`);
      continue;
    }
    // A part fits a slot by the slot's allowTypes (slots2), or by its name (the older slots table).
    if (!r.allow.includes(s(partOf(choice)!.slotType))) errors.push(`default.pc: part ${choice} does not fit slot ${slot}`);
    if (!installed.has(choice)) {
      installed.add(choice);
      queue.push(choice);
    }
  }
}

// Nodes, groups, flexbodies, beams in the installed config
const nodeOwner = new Map<string, string>();
const nodeAt = new Map<string, string>();
const groups = new Set<string>();
for (const name of installed) {
  const p = partOf(name)!;
  if (!p.nodes) continue;
  for (const r of readTable(p.nodes).records) {
    const id = s(r.values.id);
    // Restated at the same place (the game's own parts do this; it merges them) is fine.
    const at = ['posX', 'posY', 'posZ'].map((k) => (typeof r.values[k] === 'number' ? Math.round(r.values[k] * 200) / 200 : JSON.stringify(r.values[k]))).join(',');
    // A part placing it by a tuning formula over a fixed one is the game's way of making it adjustable
    // (the Sunburst rally coilovers move the strut tops for camber and caster): the later one wins.
    if (nodeOwner.has(id) && nodeAt.get(id) !== at) (/\$=/.test(at + nodeAt.get(id)) ? warnings : errors).push(`node ${id} defined by both ${nodeOwner.get(id)} and ${name}`);
    nodeOwner.set(id, name);
    nodeAt.set(id, at);
    const g = r.options.group;
    if (typeof g === 'string' && g) groups.add(g);
    else if (Array.isArray(g)) g.forEach((x) => groups.add(s(x)));
    // The game doesn't need a group on every node, but a node of ours without one usually means a generator slip.
    else if (parts.has(name)) warnings.push(`${name}: node ${id} has no group`);
  }
}
// Wheels make node groups of their own at spawn (group and hubGroup of pressureWheels, hubWheels and wheels).
for (const name of installed) {
  const p = partOf(name)!;
  for (const section of ['pressureWheels', 'hubWheels', 'wheels'] as const)
    if (p[section]) for (const r of readTable(p[section]).records) for (const k of ['group', 'hubGroup']) if (typeof r.values[k] === 'string' && r.values[k]) groups.add(r.values[k]);
}
let flexCount = 0;
for (const name of installed) {
  const p = partOf(name)!;
  const game = !parts.has(name);
  if (p.flexbodies)
    for (const r of readTable(p.flexbodies).records) {
      flexCount++;
      const mesh = s(r.values.mesh);
      if (!game && !daeNodes.has(mesh) && !GAME_MESHES.has(mesh)) errors.push(`${name}: flexbody mesh ${mesh} is not in the DAE`);
      const gs = r.values['[group]:'];
      for (const g of Array.isArray(gs) ? gs : []) if (!groups.has(s(g))) errors.push(`${name}: flexbody ${mesh} binds to node group ${s(g)}, which no installed part has`);
    }
  // A borrowed part (slug_F_…, slug_E_…) naming a node its own car doesn't have either is the game's
  // leftover (the Barstow's exhaust and rs1l): the game drops that beam on the stock car too.
  const borrowed = new RegExp(`^${slug}_[A-Z]\\d?_`).test(name);
  if (p.beams) for (const r of readTable(p.beams).records) for (const k of ['id1:', 'id2:']) if (!nodeOwner.has(s(r.values[k]))) (borrowed ? warnings : errors).push(`${name}: beam references missing node ${s(r.values[k])}`);
  if (p.triangles) for (const r of readTable(p.triangles).records) for (const k of ['id1:', 'id2:', 'id3:']) if (!nodeOwner.has(s(r.values[k]))) errors.push(`${name}: triangle references missing node ${s(r.values[k])}`);
  if (p.refNodes) for (const r of readTable(p.refNodes).records) for (const v of Object.values(r.values)) if (!nodeOwner.has(s(v))) errors.push(`${name}: refNode ${s(v)} missing`);
  if (!game && name !== slug && !p.flexbodies && !p.nodes) warnings.push(`${name}: no flexbodies and no nodes (empty part)`);
}
if (![...installed].some((n) => partOf(n)!.refNodes)) errors.push('no installed part has refNodes');

// Materials
const mats = JSON.parse(readFileSync(join(dir, 'main.materials.json'), 'utf8')) as Record<string, { mapTo: string; Stages: Record<string, unknown>[] }>;
// The game matches material names without regard to case (a model's "Generic_racing_interior" finds "generic_racing_interior").
const mapped = new Set(Object.values(mats).map((m) => m.mapTo.toLowerCase()));
// Materials the game itself defines (a game part's own, used by name) need no entry of the mod's.
const gameMaterials = install ? new Set((await scanGameMaterials(install)).map((m) => m.name.toLowerCase())) : new Set<string>();
for (const m of daeMaterials) if (!mapped.has(m.toLowerCase()) && !gameMaterials.has(m.toLowerCase())) errors.push(`DAE material ${m} has no main.materials.json entry${install ? ' and isn’t one of the game’s' : ''}`);
for (const [name, m] of Object.entries(mats)) {
  for (const stage of m.Stages)
    for (const [k, v] of Object.entries(stage)) {
      if (!k.endsWith('Map') || typeof v !== 'string') continue;
      const file = join(root, ...v.replace(/^\//, '').split('/'));
      if (!existsSync(file) && !gameFiles.has(stem(v))) errors.push(`material ${name}: ${k} ${v} does not exist`);
    }
}

let nodeCount = 0;
let beamCount = 0;
for (const name of installed) {
  const p = partOf(name)!;
  if (p.nodes) nodeCount += readTable(p.nodes).records.length;
  if (p.beams) beamCount += readTable(p.beams).records.length;
}
console.log(`${slug}: ${parts.size} parts in ${readdirSync(dir).filter((x) => x.endsWith('.jbeam')).length} jbeam files · default config installs ${installed.size} parts (${[...installed].filter((n) => !parts.has(n)).length} from the game's common parts), ${nodeCount} nodes, ${beamCount} beams, ${flexCount} flexbodies · DAE ${daeNodes.size} meshes / ${daeMaterials.size} materials`);
for (const w of warnings.slice(0, 20)) console.log(`  warn: ${w}`);
if (errors.length) {
  console.log(`${errors.length} ERRORS:`);
  for (const e of errors.slice(0, 60)) console.log(`  ${e}`);
  process.exit(1);
}
console.log('OK: no errors');
