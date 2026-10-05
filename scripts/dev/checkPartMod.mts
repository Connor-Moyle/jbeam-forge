/**
 * Check a part mod (a body panel, engine, tyre or wheel for the game's cars) against the
 * game itself: the parts it adds must fit a slot some car or the common parts offer, every
 * node its beams and triangles use must exist in the part or the car, its meshes must be
 * in the mod's DAE files, and its node groups must exist.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/checkPartMod.mts <mod folder> <BeamNG install>
 *
 * The mod folder holds vehicles/<car>/…jbeam (and vehicles/common/… for meshes and universal
 * parts), as Export → Install writes it. Exits 1 when something won't load in the game.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { isJbeamObject, parseJbeam, type JbeamObject, type JbeamValue } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';

const [modDir, install] = process.argv.slice(2);
if (!modDir || !install) {
  console.error('usage: checkPartMod.mts <mod folder> <BeamNG install>');
  process.exit(1);
}

const s = (v: JbeamValue | undefined) => (typeof v === 'string' ? v : JSON.stringify(v));
const errors: string[] = [];
const notes: string[] = [];

function addParts(into: Map<string, JbeamObject>, text: string): void {
  try {
    const v = parseJbeam(text).value;
    if (isJbeamObject(v)) for (const [name, part] of Object.entries(v)) if (isJbeamObject(part)) into.set(name, part);
  } catch {
    /* unreadable game file: skipped */
  }
}

/** Every .jbeam text in a zip under a folder prefix (vehicles/etk800/ …). */
function zipJbeams(zipPath: string, prefix: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const out: string[] = [];
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(`${zipPath} could not be opened`));
      zip.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.startsWith(prefix) || !e.fileName.endsWith('.jbeam')) return zip.readEntry();
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
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const vehicles = join(install, 'content', 'vehicles');
const common = new Map<string, JbeamObject>();
for (const t of await zipJbeams(join(vehicles, 'common.zip'), 'vehicles/common/')) addParts(common, t);

const modFiles = walk(join(modDir, 'vehicles'));
const daeNodes = new Set<string>();
for (const f of modFiles.filter((x) => x.endsWith('.dae'))) for (const m of readFileSync(f, 'utf8').matchAll(/<node [^>]*name="([^"]+)"/g)) daeNodes.add(m[1]!);

/** Slot types the parts offer, from both slot tables. */
function offeredSlots(p: JbeamObject): string[] {
  if (p.slots2) return readTable(p.slots2).records.flatMap((r) => (Array.isArray(r.values.allowTypes) ? r.values.allowTypes.map(s) : [s(r.values.name)]));
  if (p.slots) return readTable(p.slots).records.map((r) => s(r.values.type));
  return [];
}
function nodeIds(p: JbeamObject, into: Set<string>, groups?: Set<string>): void {
  if (!p.nodes) return;
  for (const r of readTable(p.nodes).records) {
    into.add(s(r.values.id));
    const g = r.options.group;
    if (groups && typeof g === 'string' && g) groups.add(g);
    else if (groups && Array.isArray(g)) g.forEach((x) => groups.add(s(x)));
  }
}

let checked = 0;
for (const car of readdirSync(join(modDir, 'vehicles'))) {
  const carDir = join(modDir, 'vehicles', car);
  const mine = new Map<string, JbeamObject>();
  for (const f of walk(carDir).filter((x) => x.endsWith('.jbeam'))) addParts(mine, readFileSync(f, 'utf8'));
  if (!mine.size) continue;
  // The car the parts are for: its own parts from the install (none for vehicles/common).
  const stock = new Map<string, JbeamObject>();
  const zip = join(vehicles, `${car}.zip`);
  if (car !== 'common') {
    if (!existsSync(zip)) {
      errors.push(`vehicles/${car}: no such car in the install`);
      continue;
    }
    for (const t of await zipJbeams(zip, `vehicles/${car}/`)) addParts(stock, t);
  }
  const all = [...stock.values(), ...common.values(), ...mine.values()];
  const slots = new Set(all.flatMap(offeredSlots));
  const carNodes = new Set<string>();
  const carGroups = new Set<string>();
  for (const p of [...stock.values(), ...common.values()]) nodeIds(p, carNodes, carGroups);
  // Meshes the game's own parts already show (an engine mod reuses the stock engine's), with the groups they ride on there.
  const gameMeshes = new Map<string, Set<string>>();
  for (const p of [...stock.values(), ...common.values()])
    if (p.flexbodies)
      for (const r of readTable(p.flexbodies).records) {
        const gs = r.values['[group]:'];
        const set = gameMeshes.get(s(r.values.mesh)) ?? new Set<string>();
        for (const g of Array.isArray(gs) ? gs.map(s) : []) set.add(g);
        gameMeshes.set(s(r.values.mesh), set);
      }
  for (const p of [...stock.values(), ...common.values()])
    for (const section of ['pressureWheels', 'hubWheels', 'wheels'])
      if (p[section]) for (const r of readTable(p[section]).records) for (const k of ['group', 'hubGroup']) if (typeof r.values[k] === 'string') carGroups.add(r.values[k] as string);

  for (const [name, p] of mine) {
    checked++;
    if (stock.has(name)) errors.push(`${name}: has the same name as one of the car's own parts, so it replaces it`);
    const slotType = s(p.slotType);
    if (!p.information) errors.push(`${name}: no information`);
    if (!slots.has(slotType)) errors.push(`${name}: slotType ${slotType} isn't offered by any slot of ${car} or the common parts`);
    const own = new Set<string>();
    const ownGroups = new Set<string>();
    nodeIds(p, own, ownGroups);
    for (const id of own) if (carNodes.has(id) && !stock.has(name)) notes.push(`${name}: node ${id} also exists on the car (fine if it's the part it replaces)`);
    const known = (id: string) => own.has(id) || carNodes.has(id);
    if (p.beams) for (const r of readTable(p.beams).records) for (const k of ['id1:', 'id2:']) if (!known(s(r.values[k]))) errors.push(`${name}: beam uses node ${s(r.values[k])}, which neither the part nor ${car} has`);
    if (p.triangles) for (const r of readTable(p.triangles).records) for (const k of ['id1:', 'id2:', 'id3:']) if (!known(s(r.values[k]))) errors.push(`${name}: triangle uses node ${s(r.values[k])}, which neither the part nor ${car} has`);
    if (p.flexbodies)
      for (const r of readTable(p.flexbodies).records) {
        const mesh = s(r.values.mesh);
        const game = gameMeshes.get(mesh);
        if (!daeNodes.has(mesh) && !game) errors.push(`${name}: mesh ${mesh} is in none of the mod's DAE files, and no part of the game shows it`);
        const gs = r.values['[group]:'];
        // A game mesh on the same groups the game's own part puts it on behaves as it does in the game.
        for (const g of Array.isArray(gs) ? gs.map(s) : []) if (!ownGroups.has(g) && !carGroups.has(g) && !game?.has(g)) errors.push(`${name}: mesh ${mesh} rides on node group ${g}, which neither the part nor ${car} has`);
      }
  }
}

console.log(`${checked} parts checked against the install`);
for (const n of notes.slice(0, 10)) console.log(`  note: ${n}`);
if (errors.length) {
  console.log(`${errors.length} ERRORS:`);
  for (const e of errors.slice(0, 60)) console.log(`  ${e}`);
  process.exit(1);
}
console.log('OK: every part fits the game');
