/* global forge */
// Mod checklist: an example JBeam Forge extension that only reads the project.
// One command in the Command Palette (Ctrl+K): "Mod checklist". The summary shows in the status
// bar; every item is written to the log (Help → Open log folder).

const OPENS = /door|hood|bonnet|trunk|boot|hatch|tailgate|liftgate|flap|glovebox/i;

forge.commands.register({
  id: 'run',
  label: 'Mod checklist',
  run: async () => {
    const p = await forge.project.get();
    if (!p) {
      forge.ui.notify('Open a mod first.', 'warning');
      return;
    }
    const todo = [];
    const add = (text) => todo.push(text);

    if (!p.meta.description || p.meta.description.length < 20) add('The mod has no real description (Inspector with nothing picked).');
    if (!p.meta.author) add('No author set (Settings → General).');

    const meshesOf = new Map();
    for (const [mesh, partId] of Object.entries(p.assignments)) if (!p.ignoredMeshes.includes(mesh)) meshesOf.set(partId, (meshesOf.get(partId) || 0) + 1);
    const nodesOf = new Map();
    for (const n of p.nodes) nodesOf.set(n.partId, (nodesOf.get(n.partId) || 0) + 1);

    for (const part of p.parts) {
      const name = part.displayName || part.name;
      if (!meshesOf.get(part.id) && !nodesOf.get(part.id)) add(`${name}: no meshes and no structure (an empty part in the parts menu).`);
      if (!part.description) add(`${name}: no description.`);
      if (/_\d+$|\(\d+\)$/.test(name)) add(`${name}: a leftover number in its parts-menu name.`);
      if (OPENS.test(part.name) && !p.hinges.some((h) => h.partId === part.id)) add(`${name}: looks like it opens but has no hinge (Moving parts → Hinge all).`);
    }
    const unassigned = (p.sources || []).length && Object.keys(p.assignments).length === 0;
    if (unassigned) add('No meshes are in a part yet.');
    if (!p.nodes.length) add('No structure yet: press Generate.');
    if (!p.configs.length) add('Only the default configuration: add a base, a sport and a race version (Configurations).');
    if (!p.paints || !p.paints.list.length) add('No factory paints: players will only get the default colour (Properties → Paints).');
    const kg = p.nodes.reduce((sum, n) => sum + n.weight, 0);
    if (p.nodes.length && (kg < 500 || kg > 4000)) add(`The structure weighs ${kg.toFixed(0)} kg: check part weights (most cars are 900–2,500 kg with engine and suspension).`);
    if (!p.powertrain || !p.powertrain.engine) add('No engine fitted (Engine workspace).');

    for (const t of todo) forge.log(`checklist: ${t}`);
    forge.ui.notify(todo.length ? `${todo.length} thing${todo.length === 1 ? '' : 's'} to look at before sharing; the list is in the log (Help → Open log folder). First: ${todo[0]}` : 'Nothing missing: ready to share.', todo.length ? 'warning' : 'success');
  },
});
