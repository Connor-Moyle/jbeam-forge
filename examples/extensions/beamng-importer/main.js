/* global forge */
// BeamNG vehicle importer: an example JBeam Forge extension.
//
// "Import a BeamNG vehicle" (Command Palette, Ctrl+K) asks for a vehicle's zip
// (BeamNG.drive/content/vehicles/<car>.zip, or a mod's zip) or its info.json
// in an unpacked folder, then:
//   1. makes a new mod ("<car>_edit", so it never clashes with the original);
//   2. asks you to declare you own the game and the mod will be free;
//   3. imports every .dae model of the vehicle (BeamNG space, 1:1: no scaling);
//   4. reads the jbeam, picks the parts of the default configuration, and adds
//      their nodes, beams and collision triangles with their values (spring,
//      damping, weight, collision…), tied to the mod's parts by the meshes
//      each jbeam part draws (its flexbodies);
//   5. keeps every .jbeam, .pc and info file with the project (Reference car
//      panel) so nothing is lost: hydros, slidenodes, powertrain, controllers
//      and the like are there to copy from.
// Nodes come in as hand-placed, so Generate keeps them.

const NODE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// Columns and settings the app writes itself.
const NODE_SKIP = new Set(['id', 'posX', 'posY', 'posZ', 'nodeWeight', 'group']);
const BEAM_SKIP = new Set(['id1', 'id2']);
const TRI_SKIP = new Set(['id1', 'id2', 'id3', 'group']);
const DEFAULT_NODE_WEIGHT = 25;

forge.commands.register({
  id: 'import-vehicle',
  label: 'Import a BeamNG vehicle',
  run: () =>
    importVehicle().catch((err) => {
      forge.ui.notify(`Import stopped: ${err && err.message ? err.message : String(err)}`, 'danger');
    }),
});

async function importVehicle() {
  const picked = await forge.files.pickFile('Pick a BeamNG vehicle: its .zip, or info.json in an unpacked vehicle folder', ['zip', 'json', 'jbeam']);
  if (!picked) return;

  // ---- find the vehicle folder (unpacking the zip's vehicles/<car>/ if needed)
  let folder;
  let carId;
  if (/\.zip$/i.test(picked)) {
    const entries = await forge.files.zipList(picked);
    const counts = {};
    for (const e of entries) {
      const m = /^vehicles\/([^/]+)\/[^/]+\.jbeam$/i.exec(e.name) || /^vehicles\/([^/]+)\/.+\.jbeam$/i.exec(e.name);
      if (m && m[1] !== 'common') counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    carId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!carId) throw new Error('No vehicles/<name>/ folder with jbeam files in that zip.');
    forge.ui.notify(`Unpacking ${carId}…`);
    const root = await forge.files.zipExtract(picked, [`vehicles/${carId}/`]);
    folder = join(join(root, 'vehicles'), carId);
  } else {
    folder = dirname(picked);
    carId = basename(folder);
  }

  // ---- read every file of the vehicle
  const files = await walk(folder, 4);
  const texts = {};
  let textBytes = 0;
  for (const f of files) {
    if (!/\.(jbeam|pc|json)$/i.test(f.name) || f.size > 4 * 1024 * 1024 || textBytes + f.size > 30 * 1024 * 1024) continue;
    texts[f.rel] = await forge.files.readText(f.path);
    textBytes += f.size;
  }
  const info = parseJson(texts['info.json']) || {};
  const parts = {};
  for (const [rel, text] of Object.entries(texts)) {
    if (!/\.jbeam$/i.test(rel)) continue;
    try {
      const doc = await forge.jbeam.parse(text);
      for (const [name, body] of Object.entries(doc || {})) if (body && typeof body === 'object' && !Array.isArray(body)) parts[name] = body;
    } catch (err) {
      forge.log(`skipped ${rel}: ${err.message}`);
    }
  }
  const main = Object.keys(parts).find((n) => parts[n].slotType === 'main');
  if (!main) throw new Error('No main part (slotType "main") in the jbeam files.');

  // ---- the default configuration's parts
  const pcName = typeof info.default_pc === 'string' ? info.default_pc : Object.keys(texts).find((r) => /\.pc$/i.test(r) && !r.includes('/'))?.replace(/\.pc$/i, '');
  const pc = (pcName && parseJson(texts[`${pcName}.pc`])) || { parts: {} };
  const chosen = pc.parts || {};
  const included = [];
  const parentOf = {};
  const visit = (name, parent) => {
    if (!name || !parts[name] || included.includes(name)) return;
    included.push(name);
    parentOf[name] = parent;
    for (const s of slotsOf(parts[name])) visit(Object.prototype.hasOwnProperty.call(chosen, s.name) ? chosen[s.name] : s.default, name);
  };
  visit(main, null);
  const variables = variableDefaults(included.map((n) => parts[n]));

  // ---- the new mod, and the porting declaration
  const niceName = await displayName(info, carId);
  // false when the user kept the open mod (cancelled "Save changes?"): stop, never touch that one.
  const made = await forge.project.create({ name: `${niceName} (edit)`, slug: `${slug(carId)}_edit`, brand: String(info.Brand || ''), description: `${niceName}, changed with JBeam Forge.` });
  if (!made) return;
  await forge.project.declarePort({ game: 'BeamNG.drive', credit: String(info.Author || 'BeamNG') });

  // ---- models
  const models = files.filter((f) => /\.dae$/i.test(f.name));
  if (!models.length) forge.ui.notify('The vehicle has no .dae models in its folder (they may be in vehicles/common).', 'warning');
  const meshes = [];
  for (const m of models) {
    forge.ui.notify(`Importing ${m.name}…`);
    const r = await forge.import.file(m.path);
    meshes.push(...r.meshes);
  }

  // Which jbeam part draws which mesh.
  const meshPart = {};
  for (const name of included) for (const row of tableRows(parts[name].flexbodies)) if (typeof row.mesh === 'string' && !(row.mesh in meshPart)) meshPart[row.mesh] = name;

  await forge.parts.autoClassify();
  let doc = await forge.project.get();
  // Meshes no included part draws (other configurations' parts, LODs) are set aside.
  const ignore = meshes.filter((m) => !(baseName(m.name) in meshPart)).map((m) => m.key);
  // A body part to fall back on.
  let body = doc.parts.find((p) => p.taxonomyId === 'body') || doc.parts.find((p) => !p.parentPartId);
  if (!body) {
    const bodyPart = await forge.parts.create('body', meshes.filter((m) => !ignore.includes(m.key)).map((m) => m.key));
    doc = await forge.project.get();
    body = doc.parts.find((p) => p.id === bodyPart.id);
  }

  // jbeam part → mod part: the part most of its meshes went to, else its parent's, else the body.
  const votes = {};
  for (const m of meshes) {
    const jp = meshPart[baseName(m.name)];
    const pp = doc.assignments[m.key];
    if (!jp || !pp) continue;
    votes[jp] = votes[jp] || {};
    votes[jp][pp] = (votes[jp][pp] || 0) + 1;
  }
  const partFor = {};
  const resolve = (name) => {
    if (partFor[name]) return partFor[name];
    const v = votes[name];
    const best = v && Object.keys(v).sort((a, b) => v[b] - v[a])[0];
    partFor[name] = best || (parentOf[name] ? resolve(parentOf[name]) : body.id);
    return partFor[name];
  };
  const assignments = { ...doc.assignments };
  for (const m of meshes) if (!assignments[m.key] && !ignore.includes(m.key) && meshPart[baseName(m.name)]) assignments[m.key] = resolve(meshPart[baseName(m.name)]);

  // ---- structure
  const nodes = [];
  const beams = [];
  const tris = [];
  const seen = new Set();
  const skipped = { nodes: 0, beams: 0, tris: 0, options: 0 };
  for (const name of included) {
    const partId = resolve(name);
    for (const row of tableRows(parts[name].nodes, variables)) {
      const id = row.id;
      if (typeof id !== 'string' || !NODE_ID.test(id) || seen.has(id) || ![row.posX, row.posY, row.posZ].every(Number.isFinite)) {
        skipped.nodes++;
        continue;
      }
      seen.add(id);
      const weight = Number.isFinite(row.nodeWeight) && row.nodeWeight > 0 ? row.nodeWeight : DEFAULT_NODE_WEIGHT;
      nodes.push(clean({ id, partId, pos: [row.posX, row.posY, row.posZ], weight, manual: true, options: options(row, NODE_SKIP, skipped) }));
    }
  }
  for (const name of included) {
    const partId = resolve(name);
    for (const row of tableRows(parts[name].beams, variables)) {
      if (!seen.has(row.id1) || !seen.has(row.id2) || row.id1 === row.id2) {
        skipped.beams++;
        continue;
      }
      const kind = row.beamType === '|SUPPORT' ? 'support' : 'edge';
      beams.push(clean({ id1: row.id1, id2: row.id2, partId, kind, options: options(row, BEAM_SKIP, skipped) }));
    }
    for (const row of tableRows(parts[name].triangles, variables)) {
      if (![row.id1, row.id2, row.id3].every((id) => seen.has(id))) {
        skipped.tris++;
        continue;
      }
      tris.push(clean({ ids: [row.id1, row.id2, row.id3], partId, options: options(row, TRI_SKIP, skipped) }));
    }
  }
  const ignored = [...new Set([...doc.ignoredMeshes, ...ignore])];
  for (const k of ignore) delete assignments[k];
  // Parts sorted out for meshes that were then set aside are left empty: drop them.
  const used = new Set([...Object.values(assignments), ...nodes.map((n) => n.partId)]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of doc.parts)
      if (used.has(p.id))
        for (const up of [p.parentPartId, p.variantOf])
          if (up && !used.has(up)) {
            used.add(up);
            grew = true;
          }
  }
  let keep = doc.parts.filter((p) => used.has(p.id)).map((p) => ({ ...p }));
  const hasMeshes = (id) => Object.values(assignments).includes(id);
  const hasNodes = (id) => nodes.some((n) => n.partId === id);
  // Auto-classify can split one body into a "variant" (3-wheel / 4-wheel): when the base was left with no
  // meshes, the variant's meshes are the body, so they go back onto the base and the variant goes.
  for (const v of keep.filter((p) => p.variantOf)) {
    const base = keep.find((p) => p.id === v.variantOf);
    if (!base || hasMeshes(base.id) || !hasMeshes(v.id) || hasNodes(v.id)) continue;
    for (const [k, id] of Object.entries(assignments)) if (id === v.id) assignments[k] = base.id;
    base.displayName = v.displayName;
    keep = keep.filter((p) => p.id !== v.id);
  }
  // A part the game draws on other parts' nodes (lights, glass, grille…) has none of its own: it rides on its parent's.
  // One that came with nodes keeps them, even if its kind usually rides (the Pigeon's gauges have their own).
  const proxyParts = { ...doc.proxy.parts };
  const settings = (role) => ({ mode: 'hull', detail: 0.5, symmetry: true, maxEdge: 0, minEdge: 0, inset: 0, bracing: 'none', attachment: 'bolted', massKg: null, role });
  for (const p of keep) {
    if (hasNodes(p.id)) proxyParts[p.id] = { ...(proxyParts[p.id] || settings('own')), role: 'own' };
    else if (p.parentPartId && hasMeshes(p.id)) proxyParts[p.id] = settings('rides');
  }
  await forge.project.update(`Bring over ${niceName}'s structure`, [
    { op: 'replace', path: '/parts', value: keep },
    { op: 'replace', path: '/nodes', value: nodes },
    { op: 'replace', path: '/beams', value: beams },
    { op: 'replace', path: '/tris', value: tris },
    { op: 'replace', path: '/assignments', value: assignments },
    { op: 'replace', path: '/ignoredMeshes', value: ignored },
    { op: 'replace', path: '/proxy/parts', value: proxyParts },
    { op: 'replace', path: '/proxy/refNodes', value: refNodesOf(included.map((n) => parts[n]), nodes) },
  ]);

  // ---- keep the files and the spec sheet
  const specs = {};
  for (const k of ['Name', 'Brand', 'Author', 'Body Style', 'Country', 'Type', 'Derby Class', 'Region']) if (typeof info[k] === 'string' && info[k]) specs[k] = info[k];
  if (info.Years && Number.isFinite(info.Years.min)) specs.Years = `${info.Years.min}–${info.Years.max}`;
  const pcInfo = parseJson(texts[`info_${pcName}.json`]) || {};
  for (const k of ['Configuration', 'Weight', 'Power', 'Torque', 'Top Speed', '0-100 km/h', 'Drivetrain', 'Transmission', 'Fuel Type']) if (pcInfo[k] !== undefined && typeof pcInfo[k] !== 'object') specs[k] = String(pcInfo[k]);
  specs['Imported parts'] = `${included.length} of ${Object.keys(parts).length} (configuration ${pcName || 'default'})`;
  await forge.project.setReference({ game: 'BeamNG.drive', carId, folder, files: texts, specs });

  const extra = [];
  for (const name of included) for (const section of ['hydros', 'slidenodes', 'rails', 'pressureWheels', 'powertrain', 'controller']) if (parts[name][section]) extra.push(section);
  forge.ui.notify(
    `${niceName}: ${meshes.length - ignore.length} meshes, ${nodes.length} nodes, ${beams.length} beams, ${tris.length} triangles.` +
      (extra.length ? ` Also in its jbeam (see Reference car → Files): ${[...new Set(extra)].join(', ')}.` : '') +
      (skipped.options ? ` ${skipped.options} values that used expressions were left at the part's defaults.` : ''),
    'success',
  );
}

/**
 * The car's name: info.json's, or for the game's own cars (whose Name is a translation key such as
 * "vehiclesData.pigeon.Name", and whose translations an extension can't read) the folder's name.
 */
async function displayName(info, carId) {
  const name = typeof info.Name === 'string' ? info.Name : '';
  if (name && !/^vehiclesData\./.test(name)) return name;
  return carId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The car's refNodes (the game needs them to know front, left and up), from whichever imported part has
 * them (often the body, not the main part), with corners found when it leaves them out.
 */
function refNodesOf(list, nodes) {
  const known = new Set(nodes.map((n) => n.id));
  const row = list.map((p) => tableRows(p.refNodes)[0]).find((r) => r && ['ref', 'back', 'left', 'up'].every((k) => known.has(r[k])));
  if (!row) return null;
  // Front is -Y: the front-left and front-right extremes.
  const pick = (score) => nodes.reduce((best, n) => (score(n) > score(best) ? n : best)).id;
  const leftCorner = known.has(row.leftCorner) ? row.leftCorner : pick((n) => n.pos[0] - n.pos[1]);
  const rightCorner = known.has(row.rightCorner) ? row.rightCorner : pick((n) => -n.pos[0] - n.pos[1]);
  return { ref: row.ref, back: row.back, left: row.left, up: row.up, leftCorner, rightCorner };
}

// ---------------------------------------------------------------- jbeam helpers

/** A part's slots as { name, default } (slots and slots2 layouts). */
function slotsOf(part) {
  const out = [];
  for (const row of tableRows(part.slots)) if (typeof row.type === 'string') out.push({ name: row.type, default: typeof row.default === 'string' ? row.default : '' });
  for (const row of tableRows(part.slots2)) if (typeof row.name === 'string') out.push({ name: row.name, default: typeof row.default === 'string' ? row.default : '' });
  return out;
}

/** The default value of every tuning variable ($name → number). */
function variableDefaults(list) {
  const out = {};
  for (const part of list) for (const row of tableRows(part.variables)) if (typeof row.name === 'string' && Number.isFinite(row.default)) out[row.name.replace(/^\$/, '')] = row.default;
  return out;
}

/**
 * A jbeam table as objects: the header row names the columns, option rows
 * ({...}) carry on to every row after them, and a row may end with its own
 * options. "$variable" values become the variable's default.
 */
function tableRows(table, variables) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) return [];
  const header = table[0].map((h) => String(h).replace(/:$/, '').replace(/^\[|\]$/g, ''));
  const running = {};
  const out = [];
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      Object.assign(running, row);
      continue;
    }
    if (!Array.isArray(row)) continue;
    const obj = { ...running };
    header.forEach((h, k) => {
      if (k < row.length) obj[h] = row[k];
    });
    const last = row[row.length - 1];
    if (row.length > header.length && last && typeof last === 'object' && !Array.isArray(last)) Object.assign(obj, last);
    if (variables) for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v[0] === '$' && v.slice(1) in variables) obj[k] = variables[v.slice(1)];
    out.push(obj);
  }
  return out;
}

/** The values the app can keep on a row: plain numbers, words and switches. */
function options(row, skip, skipped) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k) || !KEY.test(k)) continue;
    if (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= 200) {
      if (v[0] === '$' || v[0] === '=') skipped.options++;
      else out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

// ---------------------------------------------------------------- small helpers

async function walk(dir, depth, prefix = '') {
  const out = [];
  for (const e of await forge.files.list(dir)) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.dir) {
      if (depth > 0) out.push(...(await walk(e.path, depth - 1, rel)));
    } else out.push({ ...e, rel });
  }
  return out;
}

function parseJson(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    // BeamNG's files allow comments and trailing commas: strip them and try again.
    try {
      return JSON.parse(text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/,(\s*[}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

const sep = (p) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
const join = (a, b) => (a.endsWith('/') || a.endsWith('\\') ? a + b : a + sep(a) + b);
const dirname = (p) => p.replace(/[\\/][^\\/]*$/, '');
const basename = (p) => p.split(/[\\/]/).pop();
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'vehicle';
/** A mesh's name without the suffix the importer adds to repeats ("door_FR.001" → "door_FR"). */
const baseName = (n) => String(n).replace(/\.\d{3}$/, '');
