# Extensions

Extensions add your own tools to JBeam Forge: commands, vehicle script templates, and project edits. Settings → Extensions → **New extension** makes a working one to start from.

## What an extension is

A folder in the extensions folder (Settings → Extensions → Open the folder):

```
my-tools/
  extension.json
  main.js
```

`extension.json`:

```json
{ "id": "my-tools", "name": "My tools", "version": "1.0.0", "description": "What it does", "author": "You", "main": "main.js" }
```

`id` is lower-case letters, digits and dashes. `main` is the script (inside the folder).

An extension that needs more than the project asks for it with `"permissions"`:

```json
{ "id": "my-importer", "name": "My importer", "version": "1.0.0", "main": "main.js", "permissions": ["files", "import"] }
```

- `files`: read inside folders **the user picks** for it (`forge.files.pickFolder`). Each folder is remembered for that extension only; Settings → Extensions → *Forget its folders* takes them back. Nothing outside them can be read, links included.
- `import`: hand the app models to import and start new mods.

Settings → Extensions lists what each one may do.

## Where it runs

Each extension runs in a worker of its own. It has no access to your files, the internet, the window or the app's internals. It can only use `forge` (below). Every project edit is checked against the project format first, and it's one step you can undo (Ctrl+Z). Switch an extension off, or all of them, in Settings → Extensions. After changing its files, press **Reload** there.

## `forge`

| | |
|---|---|
| `forge.commands.register({ id, label, run })` | Adds a command to the Command Palette (Ctrl+K), grouped under Extensions. `run` can be async. |
| `forge.scripts.registerTemplate(template)` | Adds a vehicle script template to Scripts → Templates (see below). |
| `await forge.project.get()` | The open project (the same data as a `.jbforge` file), or `null`. |
| `await forge.project.update(label, ops)` | Changes the project with [JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902) operations (`add`, `remove`, `replace`), as one undoable step named `label`. Refused, with the reason, if the result isn't a valid project. |
| `await forge.settings.get()` | The app's settings (read only). |
| `await forge.jbeam.parse(text)` | Reads jbeam text (comments, missing and trailing commas allowed) into plain objects. |
| `forge.ui.notify(message, tone)` | A message in the status bar; `tone` is `info`, `success`, `warning` or `danger`. |
| `forge.on('projectChanged' \| 'projectOpened', fn)` | Called when the project changes (at most twice a second) or another opens. |
| `forge.log(...)` | Writes to the app's log (Help → Open log folder). |

With `"files"`:

| | |
|---|---|
| `await forge.files.pickFolder(title)` | Asks the user for a folder; returns its path (or `null`). The extension may read inside it from then on. |
| `await forge.files.pickFile(title, ['zip', 'json'])` | Asks for one file (its folder becomes readable); returns its path or `null`. |
| `await forge.files.folders()` | The folders it was given before. |
| `await forge.files.list(path)` | `[{ name, path, dir, size }]`, folders first. |
| `await forge.files.read(path)` | The file's bytes (`Uint8Array`, up to 512 MB). |
| `await forge.files.readText(path)` | The file as text (UTF-8). |
| `await forge.files.zipList(zip)` | The files in a zip, `[{ name, size }]`, without unpacking it (game content often comes zipped). |
| `await forge.files.zipRead(zip, entry)` / `zipReadText(zip, entry)` | One file from a zip, as bytes or text. |
| `await forge.files.zipExtract(zip, ['vehicles/car/'])` | Unpacks the files under those folders (all, with `[]`) into the app's own folder for this extension, and returns that folder, which it may then read and import from. |

With `"import"`:

| | |
|---|---|
| `await forge.project.create({ name, slug?, brand?, description? })` | Starts a new mod (asking to save the open one first). `true` when it was made. |
| `await forge.project.declarePort({ game, credit? })` | For content from another game: asks **the user** to declare they own `game` and that the mod will be free, and records it (the mod's description and a `ported_from.txt` credit the game). Throws if they decline: stop there. |
| `await forge.project.setReference({ game, carId, folder?, files, specs })` | Keeps the original's text files (`{ 'car.jbeam': text, … }`, 32 MB at most) and a spec sheet (`{ Weight: '1180 kg', … }`) with the project, shown in the Reference car panel. |
| `await forge.import.file(path, { scale?, upAxis?, forwardAxis? })` | Imports a model file from its folders (DAE, FBX, OBJ, glTF, GLB, STL, KN5) into the open mod. Returns `{ sourceId, meshes: [{ key, name }], bounds: { min, max, size } }` (metres, BeamNG space: check the size to catch centimetre files). |
| `await forge.import.model(model)` | Imports a model the extension built (from a game's own format, say). Returns the same as `import.file`. |
| `await forge.parts.autoClassify()` | Sorts the meshes not in a part yet into parts by their names and places (as the app offers after an import), without asking. Returns `{ parts, assigned, unassigned }`. |
| `await forge.parts.create(kind, meshKeys, position?)` | Adds a part of a kind (`'body'`, `'hood'`, `'door'`…, as in Parts → Add part) holding those meshes. Returns `{ id, name }`. |

`model` is:

```js
{
  name: 'My car',
  meshes: [{ name: 'body', positions: [x, y, z, …], indices: [a, b, c, …], uvs: [u, v, …], normals: [x, y, z, …], material: 'paint' }],
  materials: [{ name: 'paint', color: [r, g, b], opacity: 1, texture: { path: '…/paint.dds' } /* or { name: 'paint.png', bytes } */ }],
  scale: 1,          // metres per unit
  upAxis: '+y',      // which way is up in these numbers
  forwardAxis: '+z', // which way the car faces
}
```

The app writes it as an OBJ (with its textures) in its own folder and imports that, so the mod keeps working when the extension is gone. After importing, `forge.project.update` can add parts, assign meshes (`/assignments/<meshKey>`), and add nodes, beams and triangles with their jbeam properties (`options` on each).

## Script templates

A template is data: the same fields as the built-in ones (`src/shared/lua/library/`), without functions.

```js
forge.scripts.registerTemplate({
  id: "speed_warning",            // lower-case, digits, _
  name: "Speed warning light",
  category: "Driving aids",
  description: "A warning light value that flashes above a set speed.",
  name0: "speedwarn",             // the script's default controller name
  params: [{ id: "limit", label: "Flash above", kind: "number", default: 120, min: 20, max: 300, step: 5, unit: "km/h" }],
  outputs: [{ suffix: "", label: "Warning light (0/1)", min: 0, max: 1 }],
  actions: [],                    // keys: { id, label, key: "lctrl x", call: "toggle()", desc }
  lua: "...",                     // the controller; settings arrive as jbeamData.<param id>, outputs as jbeamData.out, jbeamData.out_<suffix>
  test: { seconds: 10, tracks: [{ name: "wheelspeed", points: [[0, 0], [10, 45]] }], presses: [] },
});
```

Parameter kinds are `number`, `boolean`, `choice` (with `options`), `text`, `electrics`, `mesh` and `meshes`. `meshes` can carry `animate: { output, motion: "rotate" | "slide", from, to, axis: [x, y, z], pivot: "centre" | "top" | "bottom" | "front" | "rear" | "left" | "right" | "inner", mirror }`, so the meshes picked for it move with the script's output.

A project that uses an extension's template needs that extension to export.

## Making your first extension, step by step

1. **Settings → Extensions → New extension.** It makes `hello-extension` in the extensions folder and starts it: Ctrl+K and type *Count parts* to see it work.
2. **Open the folder** (the button next to it) and open `main.js` in any text editor.
3. **Change something small**: the label of a command, or the message it shows. Save, then press **Reload** in Settings → Extensions. Your change is live.
4. **Add a command of your own:**

   ```js
   forge.commands.register({
     id: 'heaviest-part',
     label: 'Show the heaviest part',
     run: async () => {
       const p = await forge.project.get();
       const kg = {};
       for (const n of p.nodes) kg[n.partId] = (kg[n.partId] || 0) + n.weight;
       const [id, w] = Object.entries(kg).sort((a, b) => b[1] - a[1])[0] || [];
       forge.ui.notify(id ? `${p.parts.find((x) => x.id === id).displayName}: ${w.toFixed(1)} kg` : 'No structure yet');
     },
   });
   ```

5. **Change the project**: every change is JSON Patch, checked, and one Ctrl+Z:

   ```js
   await forge.project.update('Rename to My Car', [{ op: 'replace', path: '/meta/name', value: 'My Car' }]);
   ```

6. **Read files or import models**: add `"permissions": ["files", "import"]` to extension.json, Reload, and use `forge.files` and `forge.import` (above).
7. **Share it**: zip the folder. Others use Settings → Extensions → *Install from a folder…*.

When something goes wrong, the error shows under the extension in Settings, and `forge.log` writes to the log (Help → Open log folder).

## Examples

Settings → Extensions → *Examples that come with JBeam Forge* installs them; their code is in `examples/extensions/` of the source, and in the extensions folder once installed:

- **Forge toolbox**: import every model in a folder; a weight report by part. A short read that uses `files`, `import` and the project.
- **Mod checklist**: before sharing, lists what's missing or looks off (descriptions, prices, empty parts, doors without hinges, configurations, paints, weight). Only reads the project: the simplest place to start.
- **Quick adjust**: every set price or weight up or down 10%, and tidy parts-menu names, each as one undoable step. Shows `forge.project.update` with JSON Patch.
- **Warning lights pack**: adds two vehicle script templates (an overheat light and a speed warning with a pit-lane limit). Shows `forge.scripts.registerTemplate`.
- **BeamNG vehicle importer**: brings a car from the game (its zip in `content/vehicles`, a mod's zip, or an unpacked folder) into a new mod to change. It picks the parts of the default configuration, imports the models 1:1, and adds every node, beam and collision triangle with its values (weights, springs, damping, collision; tuning variables at their defaults), tied to the mod's parts through the meshes each jbeam part draws. All the `.jbeam`, `.pc` and info files are kept with the project for what it can't bring over as structure (hydros, slidenodes, powertrain, controllers). The best read for `zipExtract`, `jbeam.parse`, `parts.autoClassify` and bulk structure edits.
- **Car Mechanic Simulator 2021 importer** (proof of concept): the game's cars live in Unity bundles, which the app doesn't read, so export the car first with AssetStudio or AssetRipper; the extension imports every exported model, scales it to metres (Unity exports come in metres or centimetres), sorts it into parts and keeps any text data (with a spec sheet) for reference. CMS cars have no soft-body physics: generate the structure afterwards.

Not included yet: importers for **Street Legal Racing: Redline** (`.scx` models) and **Project CARS 1 and 2** (packed, encrypted game files). Their formats need real game files to get right one to one; `forge.files.read` and `forge.import.model` are all an importer needs once the format is known.

Game importers are for games you own. A mod made from another game's content must say where it came from, and must not be sold: importers call `forge.project.declarePort`, and the export stops until the declaration (Inspector with nothing picked → *Ported from*) is complete. The built-in Assetto Corsa importer asks the same.
