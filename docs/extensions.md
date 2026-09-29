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
| `forge.ui.notify(message, tone)` | A message in the status bar; `tone` is `info`, `success`, `warning` or `danger`. |
| `forge.on('projectChanged' \| 'projectOpened', fn)` | Called when the project changes (at most twice a second) or another opens. |
| `forge.log(...)` | Writes to the app's log (Help → Open log folder). |

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
