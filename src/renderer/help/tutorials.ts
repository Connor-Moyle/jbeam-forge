import { BUILT_IN_TEMPLATES } from '@shared/lua/library';
import { TEMPLATE_CATEGORIES } from '@shared/lua/templates';
import { projectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { addFromTemplate } from '@renderer/scripts/commands';
import { switchWorkspace } from '@renderer/shell/workspaceBridge';
import type { Guide, GuideGroup } from './guides';
import { useGuide } from './guide';
import { scriptLesson } from './lessons/scriptLesson';
import { jbeamLesson, movingLesson, triggersLesson } from './lessons/workspaceLessons';
import { startTutorial, tourSteps } from './tutorial';

/**
 * Help → Tutorials: every tutorial in the app as numbered steps, in the order a mod comes
 * together. The interactive ones (the tour, the workspace lessons, one per vehicle script) list
 * the steps they walk through and can be started from here; the rest are written walkthroughs.
 */

export const TUTORIAL_GROUPS: GuideGroup[] = [
  'Tutorials: getting started',
  'Tutorials: building the car',
  'Tutorials: moving parts and controls',
  'Tutorials: engine, gearbox and wheels',
  'Tutorials: vehicle scripts',
  'Tutorials: finishing and sharing',
  'Tutorials: part mods',
  'Tutorials: going further',
];

const plain = (t: string) => t.replace(/\s+/g, ' ').trim();

/** An interactive lesson as a Help entry: its steps written out, and a Start button. */
function lessonEntry(id: string, group: GuideGroup, title: string, summary: string, steps: { title: string; body: string }[], start: Guide['start']): Guide {
  return { id, group, title, summary, sections: [{ heading: 'The steps', steps: steps.map((s) => `${s.title}: ${plain(s.body)}`) }], start };
}

function needsProject(): boolean {
  if (projectStore.getState().doc) return true;
  useUiStore.getState().pushStatus('Open or make a mod first: this tutorial works on your car.', 'warning', 6000);
  return false;
}

function interactive(): Guide[] {
  const tour = tourSteps();
  const workspace = (id: 'triggers' | 'moving' | 'jbeam', preset: 'triggers' | 'moving' | 'jbeam', build: () => ReturnType<typeof triggersLesson>, title: string, summary: string): Guide => {
    const g = build();
    return lessonEntry(`tutorial-${id}`, 'Tutorials: moving parts and controls', title, summary, g.steps, {
      label: 'Start this tutorial',
      needsProject: true,
      run: () => {
        if (!needsProject()) return;
        switchWorkspace(preset);
        useGuide.getState().start(build());
      },
    });
  };
  const jbeam = jbeamLesson();
  return [
    lessonEntry('tutorial-tour', 'Tutorials: getting started', 'The tour: a practice car, start to finish', 'Five minutes on a ready-made practice car: sort it into parts, set materials, generate the structure and look at it. The best first step.', tour, {
      label: 'Start the tour',
      run: () => void startTutorial(),
    }),
    lessonEntry('tutorial-jbeam', 'Tutorials: building the car', 'The JBeam workspace', 'Nodes, beams and triangles in tables: picking, editing values exactly, renaming and the checks.', jbeam.steps, {
      label: 'Start this tutorial',
      needsProject: true,
      run: () => {
        if (!needsProject()) return;
        switchWorkspace('jbeam');
        useGuide.getState().start(jbeamLesson());
      },
    }),
    workspace('moving', 'moving', movingLesson, 'Doors, hood and trunk (moving parts)', 'Hinges for everything that opens, animated parts (steering wheel, needles, pedals) and scripted movement.'),
    workspace('triggers', 'triggers', triggersLesson, 'Triggers: clickable handles and switches', 'Add a trigger, put it on the car, choose what it does, and mirror it to the other side.'),
  ];
}

/**
 * A script lesson as written steps: the intro repeats the summary, so it goes, and the code
 * walk-through (one step per part in the lesson) becomes one step naming its parts.
 */
function scriptSteps(steps: { id: string; title: string; body: string }[]): string[] {
  const parts = steps.filter((s) => s.id.startsWith('code-'));
  const fns = parts.map((s) => /The (\S+) function/.exec(s.title)?.[1]).filter(Boolean);
  return steps
    .filter((s) => s.id !== 'intro' && !s.id.startsWith('code-'))
    .map((s) =>
      s.id === 'code'
        ? `${s.title}: the Lua the game runs, a vehicle controller loaded once for each car. BeamNG calls its init when the car spawns and its updateGFX every frame; the keys call its other functions. The tutorial explains every line, in ${parts.length} parts${fns.length ? `, with each function (${fns.join(', ')})` : ''}.`
        : `${s.title}: ${plain(s.body)}`,
    );
}

/** One entry per vehicle script template, grouped by its category, each with its lesson's steps. */
function scripts(): Guide[] {
  const order = new Map(TEMPLATE_CATEGORIES.map((c, i) => [c, i]));
  return [...BUILT_IN_TEMPLATES]
    .sort((a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0))
    .map((t) => {
      const lesson = scriptLesson(t, '');
      return {
        id: `tutorial-script-${t.id}`,
        group: 'Tutorials: vehicle scripts',
        title: `${t.category}: ${t.name}`,
        summary: t.description,
        sections: [
          ...(t.needs ? [{ text: `It needs: ${t.needs}` }] : []),
          { heading: 'The steps', steps: scriptSteps(lesson.steps) },
        ],
        start: {
          label: 'Add it to my car and start',
          needsProject: true,
          run: () => {
            if (!needsProject()) return;
            switchWorkspace('scripts');
            const id = addFromTemplate(t.id);
            if (id) useGuide.getState().start(scriptLesson(t, id));
          },
        },
      };
    });
}

/** Written step-by-step tutorials for everything that has no interactive lesson. */
const WRITTEN: Guide[] = [
  {
    id: 'tutorial-first-car',
    group: 'Tutorials: getting started',
    title: 'Your own car, from a 3D model to the game',
    summary: 'The whole way, with your own model: what to do in Blender first, then every step in JBeam Forge.',
    sections: [
      { heading: 'In Blender (or your modelling app)', steps: ['Model in metres with the car on the ground, facing forward.', 'Keep every separate piece a separate object: body, hood, each door, bumpers, lights, glass, seats, wheels and tyres.', 'Name them the usual way: hood, trunk, door_FL, bumper_F, wheel_FL, tire_FL, headlight_L (Help → Naming meshes).', 'Apply transforms (Ctrl+A → All Transforms) and export FBX, glTF/GLB, DAE or OBJ.'] },
      { heading: 'In JBeam Forge', steps: ['New mod ({key:new}): choose Vehicle, give it a name and your name as author.', 'Import the model ({key:import}). Check the size (a car is 3.5–5.5 m) and that it stands on its wheels; fix the unit or up axis in the window if not.', 'Let Auto-classify sort the meshes into parts. Drag anything left under Unassigned onto its part.', 'Materials workspace: give every material a look (or drag presets from the library onto the car).', 'Press Generate. Look at the structure with {key:viewStructure}.', 'Moving parts → Hinge all, so the doors, hood and trunk open.', 'Suspension → Set up axles, and fit a suspension from one of the game’s cars.', 'Engine → Choose an engine (or design your own) and a gearbox.', 'Press Test: the car drops into the sandbox. Check it stands and nothing shakes.', 'Export. In the game, find it in the vehicle selector.'] },
      { tip: 'Stuck on a step? Every button explains itself when you hover it, and {key:undo} undoes anything.' },
    ],
    actions: ['newMod', 'import'],
  },
  {
    id: 'tutorial-parts',
    group: 'Tutorials: building the car',
    title: 'Sorting meshes into parts, and variants',
    summary: 'Parts are what players swap in the game. Get them right before anything else.',
    sections: [
      { steps: ['Parts workspace. Press the wand (Auto-classify) in the Scene panel.', 'Check the tree: each part with its meshes, under the part it attaches to.', 'Unassigned meshes: select them in the viewport or the Scene and right-click → Assign, or drag them onto a part.', 'Wrong part kind? Pick the part and change its kind in the Inspector.', 'Something attached to the wrong part? Drag it onto the right parent in the Scene tree.', 'Pick each part and fill in the Inspector: parts-menu name, what it’s made of, weight and price (or leave them automatic).', 'A second version of a part (a vented hood): right-click the part → Duplicate as variant, and assign the variant’s meshes to it.'] },
      { tip: 'Merged model? Right-click a mesh → Split into connected pieces, or split by selecting faces.' },
    ],
  },
  {
    id: 'tutorial-materials',
    group: 'Tutorials: building the car',
    title: 'Materials, paints and the game’s own materials',
    summary: 'Make the car look right: textures, metal and glass, the paint players choose, and the game’s materials.',
    sections: [
      { heading: 'Materials', steps: ['Materials workspace. The list shows every material on the car; picking one shows its meshes.', 'Set colour, metallic, roughness and clear coat, or drag a preset (chrome, rubber, glass, carbon…) from the library onto the meshes.', 'Add textures: base colour, normal, roughness, metallic, ambient occlusion, emissive for lights.', 'Glass: lower the opacity. Lights: give them an emissive colour and brightness.', 'Use one of the game’s materials instead: fill in “Use a BeamNG material instead” with its name.'] },
      { heading: 'Paints players pick', steps: ['Properties → Paints. Add paints from the presets, or a scheme for all three paint slots at once.', 'Mark which materials are body paint (Paint slot 1, 2 or 3).', 'Turn on “Paint on the car” to see it.'] },
      { tip: 'Downloads → Textures has hundreds of ready materials with their textures.' },
    ],
  },
  {
    id: 'tutorial-skin',
    group: 'Tutorials: building the car',
    title: 'Making a skin (livery)',
    summary: 'Lay the body out like a colouring sheet, paint it in any image editor, and bring it back as a paint design.',
    sections: [{ steps: ['Materials workspace → Skin studio. The body panels are picked; tick or untick parts.', 'Check the preview: Parts shows each panel, Stretch shows where it pulls (red).', 'Lay out for skins.', 'Save PNG (or the layered SVG) and paint over it in any image editor, keeping its size.', 'Show the template on the car to check where things land.', 'New skin from a painted template…: pick your image. It shows on the car and exports as a design players pick in the game.'] }],
  },
  {
    id: 'tutorial-structure',
    group: 'Tutorials: building the car',
    title: 'Generating and tuning the structure',
    summary: 'Nodes and beams from each part, and how to get a car that is neither jelly nor brick.',
    sections: [
      { steps: ['Press Generate. Every part gets nodes and beams.', 'Look: {key:viewStructure} shows the structure, X-ray ({key:viewXray}) the inside.', 'Pick a part → Properties → Structure: proxy mode (hull for most panels, box for engines and batteries), detail, bracing and how it attaches.', 'Generate again: only the changed parts change; hand-moved nodes stay.', 'Press Test and watch: shaking means beams too stiff for the weights (lower the detail or raise light parts’ weight); sagging means too soft.', 'Fine-tune single nodes and beams in the JBeam workspace.'] },
    ],
  },
  {
    id: 'tutorial-suspension',
    group: 'Tutorials: engine, gearbox and wheels',
    title: 'Suspension, wheels and brakes',
    summary: 'A working suspension from one of the game’s cars, fitted to yours.',
    sections: [
      { steps: ['Suspension workspace → Set up axles. Front and rear axles are placed from your wheels.', 'Pick the front axle: choose a type (strut, double wishbone, solid axle…), a brand, then a car. The preview shows it on yours.', 'Fit. Nudge it with the arrows if it needs moving.', 'Do the same for the rear.', 'Suspension check: ride height and whether the wheels sit in the arches.', 'Brakes & diff: brake torque, handbrake, tyre pressure, ABS and the differential.', 'Tuning: the suspension’s springs, dampers and ride height.'] },
    ],
  },
  {
    id: 'tutorial-engine-game',
    group: 'Tutorials: engine, gearbox and wheels',
    title: 'An engine from the game, made your own',
    summary: 'Pick an engine from one of the game’s cars and change anything about it.',
    sections: [
      { steps: ['Engine panel → Choose engine: type, brand, car. Fit.', 'Build: the engine builder opens.', 'Drag the torque curve, or scale or stretch it to a new rev limit. Power is drawn with it.', 'Change idle, rev limit, inertia, cooling (radiator, coolant, oil), damage limits, turbo and sound in the list.', 'Press the game-pad button next to any setting to let players change it in the game’s tuning menu, and set its range.', 'Make a version of a part (a race radiator): the copy button next to its name, then change its numbers. It shows next to the original in the parts menu.', 'Choose a gearbox the same way.'] },
      { tip: 'Settings → General → Advanced mode lists every number the game has, not just the usual ones.' },
    ],
  },
  {
    id: 'tutorial-engine-design',
    group: 'Tutorials: engine, gearbox and wheels',
    title: 'Designing your own engine',
    summary: 'Cylinders, layout, displacement and induction, with its own 3D model.',
    sections: [{ steps: ['Engine workspace → Designer.', 'Start from a preset (kei three to W16, diesels, rotary, electric) or the default.', 'Change layout and cylinders, bore and stroke, valvetrain, cams, compression, induction and boost, fuel, intake and exhaust, redline.', 'Watch the power, torque and weight update.', 'Fit it with my design: it takes a matching game engine’s physics and your design’s curve and weight.', 'Build its own 3D model: an engine made from your design, one cylinder repeated per cylinder.'] }],
  },
  {
    id: 'tutorial-gearbox',
    group: 'Tutorials: engine, gearbox and wheels',
    title: 'Gearbox and driveline',
    summary: 'Gear ratios, shift points and which wheels are driven.',
    sections: [{ steps: ['Engine panel → Choose gearbox (manual, automatic, DCT, CVT, sequential).', 'Build: set each ratio, or spread them from first to top gear. Road speed per gear is shown.', 'Automatics: set the shift points.', 'Driveline: rear, front or all-wheel drive, and the centre differential.'] }],
  },
  {
    id: 'tutorial-race-version',
    group: 'Tutorials: finishing and sharing',
    title: 'A race version of the car',
    summary: 'Lighter panels, a stiffer setup, more power, and players able to tune it.',
    sections: [{ steps: ['Add variants of the parts that change (a carbon hood, a race bumper): right-click → Duplicate as variant, made of carbon.', 'Engine builder: make a race version of the radiator and intake with bigger numbers.', 'Make the turbo boost adjustable in the game (the game-pad button).', 'Configurations → New: “Race”, type Race, with the carbon parts and race versions chosen.', 'Export, and pick the Race configuration in the game.'] }],
  },
  {
    id: 'tutorial-configs',
    group: 'Tutorials: finishing and sharing',
    title: 'Configurations and vehicle details',
    summary: 'The versions of the car players spawn, with their pictures and info.',
    sections: [{ steps: ['Configurations (toolbar) → New, or copy one.', 'Choose the part for every slot that differs, and its paint.', 'Set its type (Factory, Custom, Race, Police…), years, how common it is and its value.', 'Make one the default.', 'Body style, country and years for the whole car: Inspector with nothing picked.', 'Export draws a picture for each configuration.'] }],
  },
  {
    id: 'tutorial-test',
    group: 'Tutorials: finishing and sharing',
    title: 'Testing: here and in the game',
    summary: 'The quick sandbox check, then the real thing.',
    sections: [{ steps: ['Press Test: the car drops into the sandbox and settles.', 'Read the Test results: weight, balance, anything sagging, shaking or coming loose.', 'Swing the doors and drop it from a height.', 'Stop Test, fix what it found, test again.', 'Export, start BeamNG and spawn it (Ctrl+R in the game reloads it after another export).', 'Or press F10 in the game with JBeam Forge in the game installed, and use Drive it.'] }],
  },
  {
    id: 'tutorial-export',
    group: 'Tutorials: finishing and sharing',
    title: 'Exporting and sharing a mod',
    summary: 'From the finished project to a zip people can download.',
    sections: [{ steps: ['Export (toolbar). Fix every error it lists; read the warnings.', 'Install to try it in the game, or Zip to share it.', 'For the BeamNG repository: Prepare for the repository writes the zip and a listing (title, description, pictures).', 'Test the zip itself in the game before uploading.', 'Credits for anything you used are written into the mod.'] }],
  },
  {
    id: 'tutorial-ingame',
    group: 'Tutorials: finishing and sharing',
    title: 'JBeam Forge inside the game (F10)',
    summary: 'Edit the car you’re driving, and drive your edit in the game’s physics.',
    sections: [{ steps: ['Settings → BeamNG.drive → JBeam Forge in the game → Install (or Downloads → Application).', 'Start BeamNG and get in a car.', 'Press F10: JBeam Forge opens over the game.', 'The car I’m driving: opens it with its configuration.', 'Change what you like. On the car draws your structure on the car you’re in.', 'Drive it: installs your mod and spawns it.', 'Press F10 to get back to driving.'] }],
  },
  {
    id: 'tutorial-ai',
    group: 'Tutorials: finishing and sharing',
    title: 'Using AI mode with the AI you already use',
    summary: 'Names, prices, weights, configurations and more, filled in by any AI and checked before anything changes.',
    sections: [{ steps: ['Toolbar → AI mode (the sparkle button).', 'Tick the jobs, and describe the car in a sentence or two.', 'Copy the request, paste it into your AI chat (ChatGPT, Copilot, Gemini, Claude…).', 'Copy its whole answer back in and press Check it.', 'Untick anything you don’t want, then Apply. {key:undo} takes the whole round back.', 'Not right? Iterate, say what to change, and ask again.'] }],
  },
  {
    id: 'tutorial-downloads',
    group: 'Tutorials: going further',
    title: 'Downloading materials, meshes and scripts',
    summary: 'The content library, and adding your own to it.',
    sections: [
      { heading: 'Downloading', steps: ['Downloads (the cloud button, Ctrl+Shift+D).', 'Textures, Meshes or Scripts: download single items, or all.', 'They appear in the Materials library, Add object and Scripts → Library.'] },
      { heading: 'Adding your own (for whoever looks after the library)', steps: ['Settings → Downloads → Publishing → Get a copy.', 'Add materials and scripts with “Add to the download library”, or a finished folder.', 'Publish.'] },
    ],
  },
  {
    id: 'tutorial-tyres',
    group: 'Tutorials: part mods',
    title: 'A tyre mod',
    summary: 'Tyres in any size for every car whose rims take them.',
    sections: [{ steps: ['New mod → Tyres.', 'Add the sizes (width, profile, rim).', 'Pick a tread kind, then fine-tune grip, sliding grip, tread and pressure (Advanced for the construction).', 'Import the tyre model centred on the origin, turning about X.', 'Export: it goes in vehicles/common, so every car with that rim size can use it.'] }],
  },
  {
    id: 'tutorial-wheels',
    group: 'Tutorials: part mods',
    title: 'A wheel (rim) mod',
    summary: 'Rims that fit every car with hubs for their lug count.',
    sections: [{ steps: ['New mod → Wheels.', 'Set diameter, width, lug count and offset.', 'Import the rim model centred on the origin, turning about X.', 'Export, and pick it in the wheels slot of any car with that many lugs.'] }],
  },
  {
    id: 'tutorial-engine-mod',
    group: 'Tutorials: part mods',
    title: 'An engine mod for the game’s cars',
    summary: 'A new engine in a game car’s engine slot.',
    sections: [{ steps: ['New mod → Engine.', 'Pick an engine from the car you want it in.', 'Change power, revs, curve, turbo, sound, or design your own.', 'Add the same engine to more cars if you like.', 'Export: it shows in that car’s parts menu; the game’s files are never replaced.'] }],
  },
  {
    id: 'tutorial-panel',
    group: 'Tutorials: part mods',
    title: 'A body panel mod (hood, bumper, spoiler…)',
    summary: 'A new panel for one of the game’s cars, on its stock physics.',
    sections: [{ steps: ['New mod → Body panel.', 'Pick the car and the panel; bring the stock panel in as a guide.', 'Import your model in its place, lined up with the guide.', 'Materials and skins as usual.', 'Export: it shows next to the original in the parts menu and bends and breaks the same way.'] }],
  },
  {
    id: 'tutorial-extension',
    group: 'Tutorials: going further',
    title: 'Your first extension',
    summary: 'Add your own command to JBeam Forge in a few lines of JavaScript.',
    sections: [
      { steps: ['Settings → Extensions → New extension: a working one to start from.', 'Open its folder and edit main.js.', 'Register a command with forge.commands.register({ id, label, run }).', 'In run, read the project (await forge.project.get()) and tell the user something (forge.ui.notify).', 'Settings → Extensions → Reload. Your command is in the Command Palette ({key:palette}).', 'Look at the examples (Mod checklist, Quick adjust, Warning lights pack) for changing the project and adding script templates.'] },
      { tip: 'docs/extensions.md has the whole API.' },
    ],
    actions: ['settings', 'extensionsFolder'],
  },
  {
    id: 'tutorial-port',
    group: 'Tutorials: going further',
    title: 'Bringing in a car from another game you own',
    summary: 'With the importer extensions, and the rules for ported content.',
    sections: [{ steps: ['Settings → Extensions → install an importer (BeamNG vehicle importer, CMS 2021 importer).', 'Run it from the Command Palette ({key:palette}) and pick the car’s files.', 'Confirm you own the game: the mod will credit it and must be free.', 'Generate the structure (or keep the imported one), then carry on as with any car.'] }],
    actions: ['settings'],
  },
];

/** Every tutorial for the Help centre. Built when Help opens (the lessons read the current project). */
export function tutorialGuides(): Guide[] {
  return [...interactive(), ...WRITTEN, ...scripts()];
}
