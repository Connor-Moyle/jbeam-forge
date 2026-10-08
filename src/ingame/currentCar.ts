import { projectStore } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';
import { confirmImport } from '@renderer/import/importFlow';
import { defaultSettings, stageImport } from '@renderer/import/pipeline';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { newProject } from '@renderer/project/actions';
import { createPart } from '@shared/parts/ops';
import type { Project } from '@shared/project/schema';
import { call } from '@renderer/diagnostics/ipc';
import { finalBundle, openExport, prepareExport } from '@renderer/export/exportFlow';
import { configFileName } from '@shared/export/configs';
import { loadFittedSets } from '@renderer/suspension/commands';
import type { GameVehicle } from './platform';

/**
 * In the game: open the car being driven as a project. The game has already built it from its
 * configuration, so the structure comes as the game has it (every node and beam with its values,
 * the refNodes); the models are the car's own, and each mesh goes to the part that draws it.
 */

type GameForge = typeof window.forge & { ingame?: boolean; game?: { vehicle: () => Promise<GameVehicle | null> } };

const NODE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e30 ? v : undefined);

/**
 * The part a mesh goes to: the one owning most of the nodes it's bound to in the game. A mesh is
 * often drawn by one part and held by another's nodes (a door's skin on the door panel's nodes),
 * and here a part's meshes ride on its own nodes.
 */
export function meshOwner(car: GameVehicle, flexbody: GameVehicle['flexbodies'][number]): string {
  const bound = new Set(flexbody.nodes ?? []);
  if (!bound.size) return flexbody.part ?? '';
  const count = new Map<string, number>();
  for (const n of car.nodes) if (n.part && n.pos && NODE_ID.test(n.id) && bound.has(n.id)) count.set(n.part, (count.get(n.part) ?? 0) + 1);
  const own = count.get(flexbody.part ?? '') ?? 0;
  const [best, most] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  // Its own part keeps it unless another holds more of those nodes.
  return !best || most <= own ? (flexbody.part ?? '') : best;
}

export function isInGame(): boolean {
  return !!(window.forge as GameForge).ingame;
}

export async function openCurrentCar(): Promise<void> {
  const forge = window.forge as GameForge;
  const ui = useUiStore.getState();
  if (!forge.game) return;
  const car = await forge.game.vehicle();
  if (!car) {
    ui.pushStatus('Get in a car first: this opens the car you are driving.', 'warning', 7000);
    return;
  }
  const slug = `${car.model}_edit`.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 60);
  const made = await newProject({ name: `${car.model} (edit)`, slug, brand: '', description: `${car.model}, changed with JBeam Forge.`, author: useSettingsStore.getState().settings?.author ?? '' });
  if (!made) return;
  // It's the game's own car: the mod has to say so, and be free.
  const yes = await useDialogStore
    .getState()
    .askConfirm('Editing a car from the game', `This car comes with BeamNG.drive. A mod made from it is fine as long as it credits the game and is free: never sold or put behind a paywall. The mod will say “Ported from BeamNG.drive”.`, 'The mod will be free', 'primary');
  if (!yes) return;
  projectStore.getState().execute({ label: 'Ported from BeamNG.drive', apply: (d) => void (d.meta.portedFrom = { game: 'BeamNG.drive', credit: 'BeamNG', owned: true, free: true }) });

  // ---- the car's models; what the configuration doesn't draw is set aside
  ui.pushStatus(`Bringing in ${car.model}'s models…`, 'info', 20000);
  const drawn = new Map(car.flexbodies.map((f) => [f.mesh, meshOwner(car, f)]));
  const keysByMesh = new Map<string, string[]>();
  for (const path of car.models) {
    try {
      const staged = await stageImport(path, 'dae');
      const sourceId = await confirmImport(staged, defaultSettings('dae'), { classify: false, gameMaterials: true });
      if (!sourceId) continue;
      for (const m of useSceneStore.getState().sources[sourceId]?.meshes ?? []) {
        const name = m.name.replace(/\.\d{3}$/, '');
        keysByMesh.set(name, [...(keysByMesh.get(name) ?? []), m.key]);
      }
    } catch (err) {
      ui.pushStatus(`Couldn't read ${path.split('/').pop()}: ${err instanceof Error ? err.message : String(err)}`, 'warning', 8000);
    }
  }

  // ---- parts: one per jbeam part that draws meshes or has nodes, named for what it is
  const tax = currentTaxonomy();
  // Only nodes that come over count: the game numbers the nodes it makes for pressure wheels, and
  // those are made again from the wheel's settings.
  const nodeCount = new Map<string, number>();
  for (const n of car.nodes) if (n.pos && NODE_ID.test(n.id)) nodeCount.set(n.part ?? '', (nodeCount.get(n.part ?? '') ?? 0) + 1);
  const jbeamParts = [...new Set([...drawn.values(), ...nodeCount.keys()])].filter(Boolean);
  const main = [...nodeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? jbeamParts[0];

  projectStore.getState().execute({
    label: `Bring over ${car.model}`,
    apply: (d: Project) => {
      const partFor = new Map<string, string>();
      const body = createPart(d, tax, { taxonomyId: 'body' });
      body.displayName = main ?? 'Body';
      partFor.set(main ?? '', body.id);
      for (const jp of jbeamParts) {
        if (partFor.has(jp)) continue;
        const guess = tax.classifier.classify(jp.replace(new RegExp(`^${car.model}_`), ''));
        const kind = guess.taxonomyId && tax.entry(guess.taxonomyId) ? guess.taxonomyId : 'trim';
        const part = createPart(d, tax, { taxonomyId: kind, position: guess.position, parentPartId: body.id });
        part.displayName = jp;
        partFor.set(jp, part.id);
        // Parts with nodes keep them; the rest ride on the body, as the game draws them.
        d.proxy.parts[part.id] = { mode: 'hull', detail: 0.5, symmetry: true, maxEdge: 0, minEdge: 0, inset: 0, bracing: 'none', attachment: 'bolted', massKg: null, role: nodeCount.get(jp) ? 'own' : 'rides' };
      }
      d.proxy.parts[body.id] = { mode: 'hull', detail: 0.5, symmetry: true, maxEdge: 0, minEdge: 0, inset: 0, bracing: 'none', attachment: 'bolted', massKg: null, role: 'own' };

      for (const [mesh, keys] of keysByMesh) {
        const jp = drawn.get(mesh);
        for (const k of keys) {
          if (jp === undefined) d.ignoredMeshes.push(k);
          else d.assignments[k] = partFor.get(jp) ?? body.id;
        }
      }
      const seen = new Set<string>();
      d.nodes = car.nodes
        .filter((n) => n.pos && NODE_ID.test(n.id) && !seen.has(n.id) && seen.add(n.id))
        .map((n) => ({ id: n.id, partId: partFor.get(n.part ?? '') ?? body.id, pos: n.pos!, weight: finite(n.weight) && n.weight! > 0 ? n.weight! : 25, manual: true, ...(n.collision === false ? { options: { collision: false } } : {}) }));
      d.beams = car.beams
        .filter(([a, b]) => seen.has(a) && seen.has(b) && a !== b)
        .map(([id1, id2, spring, damp, strength, deform, part]) => {
          const options = Object.fromEntries(Object.entries({ beamSpring: finite(spring), beamDamp: finite(damp), beamStrength: finite(strength), beamDeform: finite(deform) }).filter(([, v]) => v !== undefined)) as Record<string, number>;
          return { id1, id2, partId: partFor.get(part ?? '') ?? body.id, kind: 'edge' as const, ...(Object.keys(options).length ? { options } : {}) };
        });
      const r = car.refNodes;
      if (r?.ref && r.back && r.left && r.up && seen.has(r.ref)) d.proxy.refNodes = { ref: r.ref, back: r.back, left: r.left, up: r.up, leftCorner: r.leftCorner ?? r.left, rightCorner: r.rightCorner ?? r.ref };
    },
  });
  const doc = projectStore.getState().doc;
  ui.pushStatus(`${car.model}: ${doc?.parts.length ?? 0} parts, ${doc?.nodes.length ?? 0} nodes, ${doc?.beams.length ?? 0} beams, as the game has it.`, 'success', 9000);
}

type Game = { spawn: (model: string, config?: string) => Promise<void>; measure: (model: string, config?: string) => Promise<unknown>; checks?: (wait?: number) => Promise<unknown>; close: () => Promise<void>; draw: (s: { nodes: [number, number, number][]; beams: [number, number][] } | null) => Promise<void> };
const game = () => (window.forge as GameForge & { game?: Game }).game as Game | undefined;

/**
 * In the game: install the mod as it is now and put it through the game's own performance tests
 * (0-100, top speed, braking, off-road) on the flat test map. The figures go in the vehicle selector
 * at once, and into the mod's files on the next export.
 */
export async function measureInGame(): Promise<void> {
  const ui = useUiStore.getState();
  const g = game();
  const doc = projectStore.getState().doc;
  if (!g || !doc) return;
  if ((doc.meta.modKind ?? 'vehicle') !== 'vehicle') {
    ui.pushStatus('Only a whole car can be measured.', 'warning', 6000);
    return;
  }
  if (!(await testInGame({ spawn: false }))) return;
  const pc = doc.configs.find((c) => c.id === doc.defaultConfigId);
  await g.measure(doc.meta.slug, `vehicles/${doc.meta.slug}/${pc ? configFileName(pc) : 'default'}.pc`);
  ui.pushStatus('Measuring on the test map: the figures show on screen when it’s done (a minute or two).', 'info', 9000);
  await g.close();
}

/**
 * In the game: install the mod as it is now, put it on the map and run the checks the game's own
 * tester doesn't make: every door and lid is unlatched and shut again, the car is driven round a
 * skidpad, and it is run into a bollard at 50 km/h. Each says pass or fail on screen.
 */
export async function checkInGame(): Promise<void> {
  const ui = useUiStore.getState();
  const g = game();
  if (!g?.checks) return;
  if (!(await testInGame())) return;
  // The car is on its way to the map: the checks start once it has had time to arrive and settle.
  await g.checks(10);
  ui.pushStatus('Checking doors, skidpad and a 50 km/h pole: the results show on screen in about a minute.', 'info', 9000);
}

/** In the game: install the mod as it is now and drive it, in the game's own physics. */
export async function testInGame(opts: { spawn?: boolean } = {}): Promise<boolean> {
  const ui = useUiStore.getState();
  const g = game();
  const doc = projectStore.getState().doc;
  if (!g || !doc) return false;
  await loadFittedSets();
  const prepared = prepareExport();
  if (!prepared) return false;
  if (prepared.report.errors.length) {
    ui.pushStatus(`${prepared.report.errors.length} thing${prepared.report.errors.length === 1 ? '' : 's'} to fix before it can be driven: Export lists them.`, 'warning', 8000);
    void openExport();
    return false;
  }
  const bundle = await finalBundle(prepared.bundle, (text) => ui.pushStatus(text, 'info', 4000));
  const r = await call('export:install', bundle);
  if ((doc.meta.modKind ?? 'vehicle') !== 'vehicle') {
    ui.pushStatus(`Installed to ${r.path}. Spawn the car it's for and pick it in the parts menu.`, 'success', 9000);
    return true;
  }
  if (opts.spawn === false) return true;
  await g.spawn(doc.meta.slug);
  await g.close();
  return true;
}

let drawn = false;

/** In the game: draw the project's nodes and beams on the car being driven (again to stop). */
export async function toggleShowOnCar(): Promise<boolean> {
  const g = game();
  const doc = projectStore.getState().doc;
  if (!g || !doc) return false;
  drawn = !drawn;
  if (!drawn) {
    await g.draw(null);
    return false;
  }
  const index = new Map(doc.nodes.map((n, i) => [n.id, i]));
  await g.draw({ nodes: doc.nodes.map((n) => n.pos), beams: doc.beams.flatMap((b) => (index.has(b.id1) && index.has(b.id2) ? [[index.get(b.id1)!, index.get(b.id2)!] as [number, number]] : [])) });
  return true;
}

/** In the game: back to driving (F10 does the same). */
export function backToDriving(): void {
  void game()?.close();
}
