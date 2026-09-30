/* global forge */
// Car Mechanic Simulator 2021 importer: a proof-of-concept JBeam Forge extension.
//
// The game keeps its cars in Unity asset bundles, which JBeam Forge doesn't
// read. Export the car first with a Unity asset tool you trust (AssetStudio:
// Export → "All assets" or the car's models as FBX with their textures;
// AssetRipper: export the bundle as a Unity project), into a folder of its own.
// Then run "Import a Car Mechanic Simulator 2021 car" and pick that folder:
//   1. makes a new mod named after the folder (or the car's config);
//   2. asks you to declare you own the game and the mod will be free (the
//      developers are happy to see their old models used, credited, for free);
//   3. imports every model (FBX, OBJ, glTF, DAE) and fixes the size: Unity
//      exports come in metres or centimetres, so the car is scaled to metres;
//   4. sorts the meshes into parts;
//   5. keeps any text data found beside the models (config.txt, .json, .ini)
//      with the project (Reference car panel), and reads names, weights and
//      sizes from it into the spec sheet.
// CMS cars carry no soft-body physics: generate the structure afterwards
// (Modelling → Generate) and set the weight from the spec sheet.

const MODEL = /\.(fbx|obj|gltf|glb|dae)$/i;
const TEXT = /\.(txt|json|ini|cfg|xml)$/i;
const SPEC_KEY = /name|brand|make|model|year|mass|weight|engine|power|torque|hp|drive|gear|wheel|tire|tyre|rim|length|width|height|base/i;

forge.commands.register({
  id: 'import-car',
  label: 'Import a Car Mechanic Simulator 2021 car',
  run: () =>
    importCar().catch((err) => {
      forge.ui.notify(`Import stopped: ${err && err.message ? err.message : String(err)}`, 'danger');
    }),
});

async function importCar() {
  const folder = await forge.files.pickFolder('Pick the folder you exported the CMS 2021 car to (its models and textures)');
  if (!folder) return;
  const files = await walk(folder, 5);
  const models = files.filter((f) => MODEL.test(f.name));
  if (!models.length) throw new Error('No models (FBX, OBJ, glTF, DAE) in that folder. Export the car with AssetStudio or AssetRipper first.');

  // Text data kept for reference, and what it says about the car.
  const texts = {};
  let total = 0;
  for (const f of files) {
    if (!TEXT.test(f.name) || f.size > 1024 * 1024 || total + f.size > 16 * 1024 * 1024) continue;
    texts[f.rel] = await forge.files.readText(f.path);
    total += f.size;
  }
  const specs = {};
  for (const [rel, text] of Object.entries(texts)) readSpecs(text, specs, rel);
  const carName = specs.Name || specs.name || prettify(basename(folder));

  await forge.project.create({ name: carName, description: `${carName}, brought over from Car Mechanic Simulator 2021 with JBeam Forge.` });
  await forge.project.declarePort({ game: 'Car Mechanic Simulator 2021', credit: 'Red Dot Games' });

  // Models, each at scale 1 first; then one scale for all so the car is car-sized.
  const results = [];
  for (const m of models) {
    forge.ui.notify(`Importing ${m.name}…`);
    // Unity is Y up and faces +Z, as the app expects: no axis change.
    results.push(await forge.import.file(m.path, { scale: 1 }));
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const r of results)
    if (r.bounds)
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], r.bounds.min[i]);
        hi[i] = Math.max(hi[i], r.bounds.max[i]);
      }
  const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const scale = carScale(longest);
  if (scale !== 1) {
    const doc = await forge.project.get();
    const ops = [];
    doc.sources.forEach((s, i) => {
      if (results.some((r) => r.sourceId === s.id)) ops.push({ op: 'replace', path: `/sources/${i}/placement/scale`, value: s.placement.scale * scale });
    });
    await forge.project.update(`Scale ${carName} to metres`, ops);
  }
  const sorted = await forge.parts.autoClassify();

  specs['Models'] = `${models.length} (${results.reduce((n, r) => n + r.meshes.length, 0)} meshes)`;
  if (Number.isFinite(longest)) specs['Length as imported'] = `${(longest * scale).toFixed(2)} m${scale !== 1 ? ` (scaled ×${scale})` : ''}`;
  await forge.project.setReference({ game: 'Car Mechanic Simulator 2021', carId: basename(folder), folder, files: texts, specs });
  forge.ui.notify(`${carName}: ${models.length} models, ${sorted.parts} parts sorted. Next: check the parts, then Modelling → Generate for the structure.`, 'success');
}

/** The factor that makes a car of this length (in file units) 2–12 m long. */
function carScale(longest) {
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  for (const s of [1, 0.01, 0.001, 0.1, 100]) if (longest * s >= 2 && longest * s <= 12) return s;
  return 1;
}

/** "key = value", "key: value" and flat JSON: the entries that describe the car. */
function readSpecs(text, specs, rel) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object')
      for (const [k, v] of Object.entries(obj)) if (SPEC_KEY.test(k) && (typeof v === 'string' || typeof v === 'number')) add(specs, k, v);
    return;
  } catch {
    // not JSON
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][\w .-]{0,40}?)\s*[=:]\s*(.{1,200}?)\s*$/.exec(line);
    if (m && SPEC_KEY.test(m[1])) add(specs, m[1], m[2]);
  }
  if (!Object.keys(specs).length) forge.log(`nothing recognised in ${rel}`);
}

function add(specs, key, value) {
  if (Object.keys(specs).length >= 40 || key in specs) return;
  specs[key.trim()] = String(value).trim();
}

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

const basename = (p) => p.split(/[\\/]/).filter(Boolean).pop();
const prettify = (s) => String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || 'CMS car';
