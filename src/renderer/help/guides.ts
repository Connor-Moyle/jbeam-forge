/**
 * The Help centre's guides (fork): plain words, short steps, and real
 * examples. `{key:<action>}` in text is replaced by that action's key from
 * Settings → Keymap.
 */

export type GuideGroup = 'Start here' | 'Building a car' | 'Making it work' | 'Going further' | 'Examples';

export interface GuideSection {
  heading?: string;
  text?: string;
  steps?: string[];
  tip?: string;
  /** A code or file example, shown as written. */
  example?: string;
}

export interface Guide {
  id: string;
  group: GuideGroup;
  title: string;
  summary: string;
  sections: GuideSection[];
  /** Buttons under the guide. */
  actions?: ('tutorial' | 'newMod' | 'import' | 'shortcuts' | 'settings' | 'extensionsFolder')[];
}

export const GUIDE_GROUPS: GuideGroup[] = ['Start here', 'Building a car', 'Making it work', 'Going further', 'Examples'];

export const GUIDES: Guide[] = [
  {
    id: 'welcome',
    group: 'Start here',
    title: 'Welcome',
    summary: 'What JBeam Forge does, and where to begin.',
    sections: [
      {
        text: 'JBeam Forge turns a 3D model into a BeamNG.drive vehicle mod. It sorts your meshes into parts, builds the soft-body structure (nodes and beams), sets up materials, doors, wheels, suspension, the engine and gearbox, and writes everything the game needs.',
      },
      {
        heading: 'Three ways to start',
        steps: [
          'Take the tour: a practice car and a highlighted button at every step (five minutes).',
          'Read "Your first mod, step by step" and follow along with your own model.',
          'Just start: New mod ({key:new}), then Import ({key:import}). Every button explains itself when you hover it.',
        ],
      },
      { tip: 'Nothing is permanent: {key:undo} undoes any step, and every save keeps backups beside the project (Settings → Files & backups).' },
    ],
    actions: ['tutorial', 'newMod'],
  },
  {
    id: 'first-mod',
    group: 'Start here',
    title: 'Your first mod, step by step',
    summary: 'From a model in Blender to a car you can drive in BeamNG.',
    sections: [
      {
        heading: '1. Get the model ready',
        steps: [
          'Model in metres, the car on the ground (wheels touching zero height), facing forward.',
          'Keep every separate piece a separate object: body, hood, each door, each wheel and tyre, bumpers, lights, seats.',
          'Name them the usual way: hood, trunk, door_FL, door_RR, bumper_F, wheel_FL, tire_FL, headlight_L… (see "Naming meshes").',
          'Apply transforms (Ctrl+A → All Transforms in Blender) and export as FBX, glTF/GLB, DAE or OBJ.',
        ],
      },
      {
        heading: '2. Start the mod',
        steps: ['New mod ({key:new}): pick what you are making (a car, wheels, tyres, an engine, body panels…), give it a name and your name as author.', 'Import the model ({key:import}). The import window checks the size and which way is up; the preview shows the car on the ground.'],
      },
      {
        heading: '3. Parts',
        steps: [
          'When asked, let Auto-classify sort the meshes into parts (or click the wand in the Scene panel later).',
          'Anything left under "Unassigned" can be dragged onto a part, or right-clicked → Assign.',
          'Pick a part to see it in the Inspector: its slot name, what it attaches to, and its weight.',
        ],
      },
      {
        heading: '4. Materials',
        steps: ['Open the Materials workspace ({key:layout2}).', 'Each material from the model is listed. Set colour, shine, metal and textures, or use one of the game’s materials.', 'Paints (the colours players pick in the game) are in the Paints tab.'],
      },
      {
        heading: '5. Nodes and beams',
        steps: [
          'Click Generate structure (the wand on the toolbar). Every part gets nodes and beams from its shape and weight.',
          'Look at them with {key:viewStructure} and X-ray ({key:viewXray}).',
          'Fine-tune in the JBeam workspace ({key:layout3}): move nodes, change beam stiffness, rename, mirror.',
        ],
      },
      {
        heading: '6. Doors, wheels and the engine',
        steps: [
          'Doors, hood and trunk get hinges from the hinge wizard (Moving parts workspace).',
          'Wheels and suspension: the Suspension panel sets up the axles, or borrows a suspension from a game car.',
          'Engine and gearbox: the Engine builder picks one from the game or makes your own.',
        ],
      },
      {
        heading: '7. Test and export',
        steps: [
          'Test Mode (the play button) drops the car in a physics sandbox: check it stands, doors swing and nothing explodes.',
          'Export writes the mod into BeamNG’s mods folder, pictures for the vehicle selector included.',
          'In the game, the car is in the vehicle selector under your mod’s brand and name. Ctrl+R in the game reloads it after you export again.',
        ],
      },
    ],
    actions: ['newMod', 'tutorial'],
  },
  {
    id: 'naming',
    group: 'Start here',
    title: 'Naming meshes',
    summary: 'Names that Auto-classify understands.',
    sections: [
      { text: 'Auto-classify reads the words in a mesh’s name. Sides and corners come from the end of the name; where a name has none, the mesh’s position decides.' },
      {
        heading: 'Examples',
        example: [
          'body            → the body (everything attaches to it)',
          'hood, bonnet    → hood',
          'trunk, boot     → trunk (tailgate works too)',
          'door_FL, door_RR, door_front_left → doors at each corner',
          'fender_L, wing_R  → fenders',
          'bumper_F, bumper_rear → bumpers',
          'wheel_FL, rim_FL  → wheels     tire_FL, tyre_FL → tyres',
          'headlight_L, taillight_R, mirror_L',
          'windshield, rear_window, door_glass_FL',
          'seat_FL, steering_wheel, dashboard',
          'engine, radiator, exhaust',
        ].join('\n'),
      },
      { tip: 'Suffixes: L/R for left and right, F/R for front and rear, FL/FR/RL/RR for corners. "left", "right", "front", "rear" work too.' },
    ],
  },
  {
    id: 'workspaces',
    group: 'Start here',
    title: 'Workspaces, panels and keys',
    summary: 'Finding your way around the window.',
    sections: [
      { text: 'The tabs at the top are workspaces: each arranges the panels for one job (Modelling, Materials, JBeam, Moving parts, Triggers, Scripts, Testing). Change a layout by dragging panel tabs; View → Reset Layout puts it back.' },
      {
        heading: 'Keys worth knowing',
        steps: ['{key:palette}: the command palette, which finds any part, panel or action by name.', '{key:focus}: focus the selection. {key:frameAll}: frame everything.', '{key:editMode}: edit nodes and beams.', '{key:shortcuts}: every key. Change any of them in Settings → Keymap.'],
      },
      { tip: 'Settings has themes, accent colours, text size and camera controls; search it with the box at the top left.' },
    ],
    actions: ['shortcuts', 'settings'],
  },
  {
    id: 'mod-kinds',
    group: 'Start here',
    title: 'Engines, tyres and wheels',
    summary: 'Mods that add parts to the game’s cars instead of a whole vehicle.',
    sections: [
      { text: 'New mod asks what you are making. Besides a whole vehicle there are three kinds of part mod, each with its own workspace.' },
      {
        heading: 'Engine',
        steps: ['Pick an engine from one of the game’s cars in the engine builder, then change power, revs, torque curve, turbo or sound.', 'Add more engines (from other cars) to make the same idea for them too.', 'Export writes each as a new part in that car’s engine slot, beside the car, so it shows in its parts menu. Game files are never replaced.'],
      },
      {
        heading: 'Tyres',
        steps: ['Add the sizes you want (width, profile, rim). Each becomes a part for every car whose rims take that size.', 'Pick a kind of tread, then fine-tune grip, sliding grip, tread depth and pressure; Advanced has the construction values.', 'Import the tyre’s model centred on the origin, turning about X. The mod goes in vehicles/common so every car can use it.'],
      },
      {
        heading: 'Wheels',
        steps: ['Set diameter, width, lug count and offset. The wheel fits every car with hubs for that many lugs, and takes the game’s tyres of its size.', 'Import the rim’s model the same way as a tyre’s.'],
      },
      { tip: 'Part mods follow the layout of the game’s own common wheels and engines; try a new one in the game before you share it.' },
    ],
    actions: ['newMod'],
  },
  {
    id: 'parts',
    group: 'Building a car',
    title: 'Parts and slots',
    summary: 'How BeamNG builds a car from parts.',
    sections: [
      { text: 'A BeamNG vehicle is a tree of parts. The body has slots (places a part can go); each part fills one slot and can have slots of its own. Players swap parts in the game’s parts menu, and configurations remember which parts fill which slots.' },
      {
        heading: 'In JBeam Forge',
        steps: ['The Scene tree shows the parts under the body. Drag a part onto another to attach it there.', 'Variants are other parts for the same slot (a different bumper, a wing). Right-click a part → Add a variant.', 'Each part is one .jbeam entry in the export; its meshes become the part’s flexbodies.'],
      },
    ],
  },
  {
    id: 'materials',
    group: 'Building a car',
    title: 'Materials and textures',
    summary: 'Colours, textures and paints.',
    sections: [
      { text: 'Materials come in with the model and its textures. Each has colour, roughness, metal, normal, ambient occlusion and more. The export writes them as a main.materials.json the game reads.' },
      { steps: ['Any texture you add can be turned into DDS on export (Settings → Export), which the game loads fastest.', 'Paint slots decide which materials take the player’s car colour.', 'The library has ready-made materials (chrome, rubber, glass, carbon…); drag one onto the car.'] },
    ],
  },
  {
    id: 'structure',
    group: 'Building a car',
    title: 'Nodes, beams and triangles',
    summary: 'The soft body that makes BeamNG cars crumple.',
    sections: [
      {
        text: 'Nodes are points with weight. Beams are springs between two nodes, with a stiffness (beamSpring), damping (beamDamp) and a strength before they deform (beamDeform) or break (beamStrength). Triangles between three nodes give the car its surface for air and collisions.',
      },
      {
        heading: 'Good structure',
        steps: [
          'Heavier cars need stiffer beams; the generator scales them from each part’s weight and material.',
          'Every node needs at least three beams to other nodes, or it flops about.',
          'Name nodes the BeamNG way: a short prefix per part (f for the body, h for hood, d for doors), then left/right: f1l, f1r, f1 (centre).',
          'The JBeam workspace checks for loose nodes, doubled beams and very long or short beams.',
        ],
      },
    ],
  },
  {
    id: 'moving',
    group: 'Making it work',
    title: 'Doors, hoods and moving parts',
    summary: 'Hinges, latches and animated parts.',
    sections: [
      { text: 'Opening panels are parts joined to the body by a hinge axis (two nodes they share) and held shut by a latch. The Moving parts workspace sets them up with a wizard, and Test Mode swings them to check.' },
      { steps: ['Open the Moving parts workspace ({key:layout4}). Hinge all sets up every door, hood and trunk at once.', 'Pick one to change its hinge line, how far it opens, the latch and its handles; the swing preview shows it moving.', 'Animated parts: the steering wheel, needles and pedals are suggested by their names; one click makes them follow the game’s values.', 'Scripted movement adds wipers, windows, folding mirrors, moving seats and roofs from templates.'] },
    ],
  },
  {
    id: 'triggers',
    group: 'Making it work',
    title: 'Triggers',
    summary: 'Clickable spots on the car.',
    sections: [
      { text: 'Triggers are boxes on the car players can click in the game (a door handle, the hood release, a light switch). Each runs an action: toggle a door latch, the lights, or one of your scripts.' },
      { steps: ['Open the Triggers workspace ({key:layout5}), pick a kind (door handle, button, switch…) and click Add.', 'Click on the car where it goes. Dropped on a door, hood or trunk, it opens it.', 'Pick what it does: lights, indicators, the horn, a door, or one of your scripts’ keys. Size and turn it to fit.', 'Copy to the other side makes the matching one, with left and right swapped.'] },
    ],
  },
  {
    id: 'powertrain',
    group: 'Making it work',
    title: 'Engine, gearbox and driveline',
    summary: 'What makes it go.',
    sections: [
      { text: 'Pick an engine from the game’s cars, or make your own with the engine builder: torque curve, rev limit, weight, sound. The gearbox builder sets the ratios; the driveline sends power to the axles you choose.' },
      { tip: 'Standalone engine mods: New mod → Engine makes an engine that fits any car with a matching engine slot.' },
    ],
  },
  {
    id: 'scripts',
    group: 'Going further',
    title: 'Vehicle scripts',
    summary: 'Wipers, windows, head units and your own Lua.',
    sections: [
      { text: 'The Scripts workspace adds working features from templates (easy mode) or lets you write Lua (advanced mode). The checker marks mistakes as you type, and Test runs the script here against a simulated car.' },
      {
        heading: 'A tiny controller',
        example: ['local M = {}', '', 'local function updateGFX(dt)', '  -- turn on the fog lights above 80 km/h', '  local kmh = electrics.values.wheelspeed * 3.6', '  electrics.values.fog = kmh > 80 and 1 or 0', 'end', '', 'M.updateGFX = updateGFX', 'return M'].join('\n'),
      },
    ],
  },
  {
    id: 'extensions',
    group: 'Going further',
    title: 'Extensions',
    summary: 'Add your own tools and importers to JBeam Forge.',
    sections: [
      { text: 'Extensions are small JavaScript add-ons in the extensions folder. They add commands to the palette, script templates, and model importers, and can change the project with checked, undoable steps. They only reach files in folders you pick for them.' },
      { steps: ['Settings → Extensions → New extension makes a working one to start from; the examples there (a toolbox, game importers) install with one click.', 'Edit its main.js, then Reload. Commands appear in the Command Palette ({key:palette}).', 'An extension that reads files or imports models says so in extension.json ("permissions"); it can only read folders you pick for it.', 'docs/extensions.md has the full API and a step-by-step first extension.'] },
    ],
    actions: ['settings'],
  },
  {
    id: 'export',
    group: 'Going further',
    title: 'Exporting and testing in the game',
    summary: 'Where the mod goes and how to check it.',
    sections: [
      {
        steps: [
          'Export checks the mod first: missing slots, loose nodes, materials without textures. Errors must be fixed; warnings can wait.',
          'The mod is written as a folder or zip into your BeamNG mods folder (set in Settings → BeamNG.drive).',
          'In the game, open the vehicle selector. After another export, Ctrl+R reloads the car.',
        ],
      },
      { tip: 'Ported content: if a model came from another game, say so in the mod’s description, only use games you own, and never sell it.' },
    ],
  },
  {
    id: 'trouble',
    group: 'Going further',
    title: 'When something goes wrong',
    summary: 'Common problems and their fixes.',
    sections: [
      {
        steps: [
          'The car explodes or shakes: beams too stiff for the node weights. Lower the stiffness in the JBeam workspace or raise part weights.',
          'It falls through the ground: no collision triangles. Generate structure again with triangles on.',
          'Textures are missing: use "Locate folder" on the model in the Scene panel.',
          'It isn’t in the vehicle selector: check the mods folder in Settings, and the game’s console (~) for errors.',
          'Anything else: Help → Copy Diagnostic Info, and include the log (Help → Open Log Folder) when you report it.',
        ],
      },
    ],
  },
  {
    id: 'jbeam-example',
    group: 'Examples',
    title: 'What a JBeam part looks like',
    summary: 'The file JBeam Forge writes, explained.',
    sections: [
      { text: 'Every part is an entry in a .jbeam file (JSON with comments allowed). This is a small hood, shortened:' },
      {
        example: [
          '"mycar_hood": {',
          '  "information": { "authors": "You", "name": "Hood", "value": 250 },',
          '  "slotType": "mycar_hood",',
          '  "flexbodies": [',
          '    ["mesh", "[group]:", "nonFlexMaterials"],',
          '    ["mycar_hood", ["mycar_hood"]]',
          '  ],',
          '  "nodes": [',
          '    ["id", "posX", "posY", "posZ"],',
          '    {"nodeWeight": 1.2}, {"group": "mycar_hood"},',
          '    ["h1l", 0.62, -1.9, 0.92],',
          '    ["h1r", -0.62, -1.9, 0.92]',
          '  ],',
          '  "beams": [',
          '    ["id1:", "id2:"],',
          '    {"beamSpring": 400000, "beamDamp": 40},',
          '    ["h1l", "h1r"]',
          '  ]',
          '}',
        ].join('\n'),
      },
      { text: 'Rows starting with a header (["id", "posX", …]) are data; objects in between ({"nodeWeight": 1.2}) set values for the rows after them. BeamNG’s +Y points to the back of the car and +X to its left.' },
    ],
  },
  {
    id: 'config-example',
    group: 'Examples',
    title: 'A configuration (.pc)',
    summary: 'Which parts a version of the car uses.',
    sections: [
      {
        example: ['{', '  "format": 2,', '  "model": "mycar",', '  "parts": {', '    "mycar_hood": "mycar_hood_vented",', '    "mycar_engine": "mycar_engine_v8"', '  },', '  "paints": [ { "baseColor": [0.7, 0.05, 0.05, 1.2], "metallic": 0.5, "roughness": 0.3 } ]', '}'].join('\n'),
      },
      { text: 'The Configurations manager writes these for you: each is a list of slot → part choices and paints, with its own picture and info (price, power, weight).' },
    ],
  },
];
