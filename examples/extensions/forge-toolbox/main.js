/* global forge */
// Forge toolbox: an example JBeam Forge extension.
// Two commands in the Command Palette (Ctrl+K):
//   "Import every model in a folder"  (uses the "files" and "import" permissions)
//   "Weight report"                   (needs no permissions: it only reads the project)
// See docs/extensions.md for everything `forge` offers.

const MODEL = /\.(dae|fbx|obj|gltf|glb|stl)$/i;

forge.commands.register({
  id: 'import-folder',
  label: 'Import every model in a folder',
  run: async () => {
    const project = await forge.project.get();
    if (!project) {
      forge.ui.notify('Open or create a mod first, then run this again.', 'warning');
      return;
    }
    // The user picks the folder; the extension can read nothing else.
    const folder = await forge.files.pickFolder('Pick a folder of 3D models');
    if (!folder) return;
    const models = (await forge.files.list(folder)).filter((e) => !e.dir && MODEL.test(e.name));
    if (!models.length) {
      forge.ui.notify('No DAE, FBX, OBJ, glTF or STL files in that folder.', 'warning');
      return;
    }
    let meshes = 0;
    for (const m of models) {
      const result = await forge.import.file(m.path);
      meshes += result.meshes.length;
      forge.log(`imported ${m.name}: ${result.meshes.length} meshes`);
    }
    forge.ui.notify(`Imported ${models.length} model${models.length === 1 ? '' : 's'} (${meshes} meshes).`, 'success');
  },
});

forge.commands.register({
  id: 'weight-report',
  label: 'Weight report',
  run: async () => {
    const project = await forge.project.get();
    if (!project || !project.nodes.length) {
      forge.ui.notify('Generate the structure first: weights come from the nodes.', 'warning');
      return;
    }
    const byPart = new Map();
    for (const n of project.nodes) byPart.set(n.partId, (byPart.get(n.partId) || 0) + n.weight);
    const total = [...byPart.values()].reduce((a, b) => a + b, 0);
    const rows = [...byPart.entries()]
      .map(([id, kg]) => ({ name: (project.parts.find((p) => p.id === id) || {}).displayName || id, kg }))
      .sort((a, b) => b.kg - a.kg);
    for (const r of rows) forge.log(`${r.name}: ${r.kg.toFixed(1)} kg (${((r.kg / total) * 100).toFixed(1)}%)`);
    const top = rows.slice(0, 3).map((r) => `${r.name} ${r.kg.toFixed(0)} kg`).join(', ');
    forge.ui.notify(`${total.toFixed(0)} kg in all; heaviest: ${top}. The full list is in the log.`, 'info');
  },
});
