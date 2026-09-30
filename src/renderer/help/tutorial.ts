import { create } from 'zustand';
import type { PresetId } from '@shared/layout-schema';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { projectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { newProject } from '@renderer/project/actions';
import { confirmImport } from '@renderer/import/importFlow';
import { defaultSettings, stageImport } from '@renderer/import/pipeline';
import { useClassifyUi } from '@renderer/parts/commands';
import { useSceneStore } from '@renderer/app/stores/scene';
import { keyFor } from '@renderer/app/keys';

/**
 * The guided tour (fork): the first time JBeam Forge opens (and from Help →
 * Start the Tutorial) it loads a practice car and walks through the real
 * workflow, one highlighted button at a time. Every step can be skipped.
 */

const logger = rlog('tutorial');

export interface TourContext {
  preset: PresetId;
  applyPreset: (p: PresetId) => void;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** What to highlight (a CSS selector); none centres the card. */
  target?: string;
  /** Said under the text when the step waits for the user to do something. */
  action?: string;
  /** Done: the tour moves on by itself (checked a few times a second). */
  done?: (ctx: TourContext) => boolean;
  /** Skipped when already true (e.g. parts already made). */
  skipIf?: (ctx: TourContext) => boolean;
  /** Run when the step opens. */
  enter?: (ctx: TourContext) => void;
}

const doc = () => projectStore.getState().doc;

/** The steps (a function: the keys named follow Settings → Keymap). */
export function tourSteps(): TourStep[] {
  return [
    {
      id: 'welcome',
      title: 'Welcome to JBeam Forge',
      body: 'This practice car was made for the tour: a body, doors, a hood, wheels, seats and an engine, just like a model you would bring in from Blender. In a few steps you will turn it into a BeamNG mod. It takes about five minutes and you can skip at any time.',
    },
    {
      id: 'viewport',
      title: 'The 3D view',
      target: '[data-panel="viewport"]',
      body: `Drag with the left mouse button to orbit, the right button to pan, and scroll to zoom. ${keyFor('focus')} focuses what you picked and ${keyFor('frameAll')} frames the whole car. Click a piece of the car to select it.`,
      enter: (ctx) => ctx.applyPreset('modelling'),
    },
    {
      id: 'scene',
      title: 'The Scene',
      target: '[data-panel="scene"]',
      body: 'Every mesh of the model is listed here. They are not parts yet: BeamNG builds a car from parts (body, hood, doors…) that each get their own slot, nodes and beams.',
    },
    {
      id: 'classify',
      title: 'Sort the meshes into parts',
      target: '[data-tour="auto-classify"]',
      body: 'Auto-classify reads names like door_FL, hood and tire_RR and sorts the meshes into parts, left and right included.',
      action: 'Click the highlighted wand button at the top of the Scene panel (Auto-classify).',
      done: () => useClassifyUi.getState().pending !== null || (doc()?.parts.length ?? 0) > 0,
      skipIf: () => (doc()?.parts.length ?? 0) > 0,
    },
    {
      id: 'classify-apply',
      title: 'Check and create',
      target: '[data-testid="classify-apply"]',
      body: 'This is what it found. Anything it wasn’t sure about stays unassigned for you to drag onto a part later.',
      action: 'Check the list, then click Create parts at the bottom of the window.',
      done: () => (doc()?.parts.length ?? 0) > 0,
      skipIf: () => (doc()?.parts.length ?? 0) > 0,
    },
    {
      id: 'inspector',
      title: 'Parts and the Inspector',
      target: '[data-panel="inspector"]',
      body: 'Pick a part in the Scene or on the car and its details show here: name, slot, what it attaches to, weight and materials. Drag parts in the Scene to change what attaches to what.',
      enter: () => {
        const hood = doc()?.parts.find((p) => p.taxonomyId === 'hood');
        if (!hood) return;
        const keys = Object.entries(doc()?.assignments ?? {})
          .filter(([, partId]) => partId === hood.id)
          .map(([k]) => k);
        useSceneStore.getState().select(keys);
      },
    },
    {
      id: 'materials-tab',
      title: 'Workspaces',
      target: '[data-testid="workspace-materials"]',
      body: 'Workspaces arrange the panels for one job at a time, like Blender’s. Your own layout is kept for each.',
      action: 'Click the Materials tab at the top of the window.',
      done: (ctx) => ctx.preset === 'materials',
    },
    {
      id: 'materials',
      title: 'Materials',
      target: '[data-panel="materials"]',
      body: 'Every material from the model is here. Pick one to change its colour, shine and textures, or drag one from the library onto the car. Paints (the colours players pick) live in the tab next to it.',
    },
    {
      id: 'modelling-tab',
      title: 'Back to modelling',
      target: '[data-testid="workspace-modelling"]',
      body: 'Now the physics.',
      action: 'Click Modelling.',
      done: (ctx) => ctx.preset === 'modelling',
    },
    {
      id: 'generate',
      title: 'Nodes and beams',
      target: '[data-testid="toolbar-generate"]',
      body: 'A BeamNG car is a soft body: points (nodes) joined by springs (beams). Generate builds them for every part from its shape, weight and material.',
      action: 'Click the highlighted wand button in the toolbar at the top (Generate structure).',
      done: () => (doc()?.nodes.length ?? 0) > 0,
      skipIf: () => (doc()?.nodes.length ?? 0) > 0,
    },
    {
      id: 'views',
      title: 'Seeing the structure',
      target: '[data-testid="toolbar-view-structure"]',
      body: `Show or hide the nodes and beams here (${keyFor('viewStructure')}); X-ray next to it lets you see through the body (${keyFor('viewXray')}).`,
    },
    {
      id: 'edit',
      title: 'Editing nodes and beams',
      target: '[data-testid="toolbar-edit"]',
      body: `Edit mode (${keyFor('editMode')}) lets you move, add, mirror, connect and delete nodes by hand. The JBeam workspace has precise tools for every node and beam value.`,
    },
    {
      id: 'jbeam-tab',
      title: 'The JBeam workspace',
      target: '[data-testid="workspace-jbeam"]',
      body: 'Every node, beam and triangle in tables with its exact values: rename nodes logically, set any jbeam property, add triangles, and let the checks find loose nodes and doubled beams.',
    },
    {
      id: 'test',
      title: 'Test it',
      target: '[data-testid="toolbar-test"]',
      body: 'Test Mode runs the physics right here: drop the car, swing the doors, and see whether it holds together before you open the game.',
    },
    {
      id: 'moving-tab',
      title: 'Moving parts',
      target: '[data-testid="workspace-moving"]',
      body: 'Everything that moves in one list: doors, hood and trunk on hinges, needles and pedals that follow the game, and wipers, windows or mirrors from templates.',
    },
    {
      id: 'triggers-tab',
      title: 'Triggers',
      target: '[data-testid="workspace-triggers"]',
      body: 'The spots players click in the game: door handles, a horn button, light switches. Add one, click on the car where it goes, and pick what it does.',
    },
    {
      id: 'panels',
      title: 'Engine, suspension, paints and more',
      target: '[data-testid="toggle-powertrain"]',
      body: 'These buttons open the engine and gearbox builder, suspension, configurations, paints, extras and the objects library.',
    },
    {
      id: 'scripts',
      title: 'Working features',
      target: '[data-testid="workspace-scripts"]',
      body: 'The Scripts workspace adds wipers, electric windows, a head unit, folding mirrors and more from templates, with no code needed (or write your own Lua).',
    },
    {
      id: 'export',
      title: 'Export the mod',
      target: '[data-testid="toolbar-export"]',
      body: 'When your car is ready, Export checks it and writes the mod into BeamNG’s mods folder, pictures for the vehicle selector included.',
    },
    {
      id: 'done',
      title: 'That’s the tour',
      target: '[data-testid="open-help"]',
      body: `The Help centre (${keyFor('help')}) has step-by-step guides and examples, and can replay this tour. Keep the practice car to play with, or start your own mod.`,
    },
  ];
}

interface TourState {
  step: number | null;
  /** The practice project's creation stamp: only that project is closed when the tour ends. */
  practice: string | null;
  set: (patch: Partial<Pick<TourState, 'step' | 'practice'>>) => void;
}

export const useTour = create<TourState>()((set) => ({
  step: null,
  practice: null,
  set: (patch) => set(patch),
}));

function markSeen(): void {
  if (useSettingsStore.getState().settings?.tutorialSeen) return;
  call('settings:update', { tutorialSeen: true }).catch(() => undefined);
}

/** Open the practice car and start at the first step. */
export async function startTutorial(): Promise<void> {
  useDialogStore.getState().setHelpOpen(false);
  if (
    !(await newProject({
      name: 'Practice car',
      slug: 'practice_car',
      description: 'The tutorial’s practice car.',
    }))
  )
    return;
  const created = projectStore.getState().doc?.meta.createdAt ?? null;
  useTour.getState().set({ step: 0, practice: created });
  try {
    const { path } = await call('tutorial:demoModel');
    const staged = await stageImport(path, 'obj');
    await confirmImport(staged, defaultSettings('obj'), { classify: false });
  } catch (err) {
    logger.error('practice car failed:', err instanceof Error ? err.message : String(err));
  }
}

/** End the tour. `closePractice` also closes the practice car (back to the home screen). */
export function endTutorial(closePractice: boolean): void {
  const { practice } = useTour.getState();
  useTour.getState().set({ step: null, practice: null });
  markSeen();
  const d = projectStore.getState().doc;
  if (closePractice && d && practice && d.meta.createdAt === practice) projectStore.getState().close();
}

/** The first start: the tour opens by itself once. */
export function maybeStartFirstRun(): void {
  const s = useSettingsStore.getState().settings;
  if (!s || s.tutorialSeen || projectStore.getState().doc || useTour.getState().step !== null) return;
  void startTutorial();
}
