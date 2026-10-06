import type { Guide } from './guides';

/**
 * The Help centre's reference: how each part of JBeam Forge works and how to change it, one
 * topic per page. Each starts with what a beginner needs ("The basics", "Step by step") and ends
 * with what experienced modders look for ("Advanced"). `{key:<action>}` shows that action's key.
 */
export const REFERENCE: Guide[] = [
  {
    id: 'ref-import',
    group: 'Reference',
    title: 'Importing models',
    summary: 'Formats, size, which way is up, and bringing a model in again after you change it.',
    sections: [
      { heading: 'The basics', text: 'Import ({key:import}) reads FBX, glTF/GLB, DAE (Collada), OBJ and Assetto Corsa KN5 files, with their materials and textures. A car is best as one file holding every piece as a separate object.' },
      {
        heading: 'Step by step',
        steps: [
          'Pick the file. The import window shows the model, its size in metres and which way is up.',
          'Check the size: a car is 3.5–5.5 m long. If it reads 100 times too big, pick the right unit (centimetres) in the window.',
          'Check the axis: the car should stand on its wheels. Turn it with "Up axis" until it does.',
          'Import. The model lands centred on the ground, facing forward.',
        ],
      },
      {
        heading: 'Advanced',
        steps: [
          'Reload when the file changes: the mod’s own settings (Properties with nothing picked, or the New mod window) → "Reload the model when its file changes". Fix it in Blender, save, and it updates with your parts, materials and edits kept.',
          'Placement: right-click the model → Placement… to move, turn or scale it after import (the structure follows).',
          'Missing textures: right-click the model → Locate folder…, or add texture folders in Settings → Library folders.',
          'Several files: import each; each becomes its own model in the Scene panel, all in the same project.',
        ],
      },
      { tip: 'Apply transforms before exporting from Blender (Ctrl+A → All Transforms), or pieces can come in rotated or scaled.' },
    ],
    actions: ['import'],
  },
  {
    id: 'ref-parts',
    group: 'Reference',
    title: 'Parts, slots and variants in depth',
    summary: 'Sorting meshes into parts, what each part sets, and alternatives for the same slot.',
    sections: [
      { heading: 'The basics', text: 'Every mesh belongs to a part (body, hood, door…). Parts are what players swap in the game; each fills a slot on its parent. Auto-classify sorts meshes by their names; anything it misses waits under Unassigned.' },
      {
        heading: 'What a part sets (Inspector)',
        steps: [
          'Display name: the name in the game’s parts menu.',
          'Jbeam name: the part’s identity in the files (changes rename its slot too).',
          'Made of: steel, aluminium, carbon, fibreglass or plastic. This sets its default strength, weight and price.',
          'Price: automatic from its kind and material, or your own.',
          'Parent: what it attaches to. Drag it onto another part in the Scene tree to change it.',
          'Adjustable in game: let players scale its weight, stiffness, strength (or a wing’s downforce) in the tuning menu.',
        ],
      },
      {
        heading: 'Variants',
        steps: ['Right-click a part → Add a variant: another part for the same slot (a vented hood, a race bumper).', 'Assign the variant’s own meshes to it. Configurations pick which one a version of the car uses.', 'A variant without nodes of its own rides on its parent’s nodes.'],
      },
      { heading: 'Advanced', steps: ['Settings → Naming: name meshes after their part automatically, and tidy numbered names in the parts menu.', 'Mesh names are written to the DAE with the mod’s prefix; the export window lists the final names.'] },
    ],
  },
  {
    id: 'ref-structure',
    group: 'Reference',
    title: 'Generating the structure',
    summary: 'How nodes and beams are made from each part, and every setting that shapes them.',
    sections: [
      { heading: 'The basics', text: 'Generate (toolbar) gives every part nodes and beams from its shape, size and weight. Run it again any time: hand edits to nodes are kept.' },
      {
        heading: 'Settings per part (Properties → Structure)',
        steps: [
          'Proxy mode: how the shape is simplified. Hull wraps the part (most panels), Surface follows it closely (curved skins), Decimate thins the mesh, Box and Cylinder are simple shapes (engine, battery, tanks).',
          'Detail: 0–1, how many nodes. More detail bends more realistically but costs simulation time. 0.3–0.5 suits most parts.',
          'Bracing: none, light, standard or heavy beams across the part. Heavier bracing makes it stiffer.',
          'Attachment: bolted, clipped, riveted or welded to its parent (how strong the join is and how it breaks).',
          'Weight: automatic from the kind and material, or set in kg.',
          'Symmetry: makes left and right match (on by default for symmetric parts).',
        ],
      },
      {
        heading: 'Advanced',
        steps: [
          'Role: a part can have its own structure, ride on its parent’s nodes (trim, badges), or come from a fitted suspension.',
          'Edge limits and inset control beam lengths and how far nodes sit inside the skin.',
          'Generate → for the picked part only, or with other proxy modes, from the arrow next to Generate.',
          'Fine-tune in the JBeam workspace (next page).',
        ],
      },
      { tip: 'If the car shakes in Test Mode, the beams are too stiff for the weights: lower the detail or raise the weight of light parts.' },
    ],
  },
  {
    id: 'ref-jbeam',
    group: 'Reference',
    title: 'The JBeam workspace',
    summary: 'Editing nodes, beams and triangles by hand, with every jbeam property.',
    sections: [
      { heading: 'The basics', text: 'The JBeam workspace ({key:layout3}) shows the structure over the model. {key:editMode} switches to editing: click nodes and beams to pick them, drag to move.' },
      {
        heading: 'Step by step',
        steps: ['Pick a node: its id, part, position and weight show in Properties.', 'Pick a beam: stiffness (beamSpring), damping (beamDamp), deform and break strength.', 'Add beams between two picked nodes; delete with Delete.', 'Mirror copies a change to the other side.', 'The checks list loose nodes, doubled beams and odd lengths; click one to go to it.'],
      },
      { heading: 'Advanced', steps: ['Any jbeam property can be set on a node, beam or triangle (Row options): collision, selfCollision, nodeMaterial, frictionCoef, beamType, breakGroup…', 'The JBeam file panel shows exactly what the picked part exports.', 'Hand-moved nodes are marked and kept when you generate again.'] },
    ],
  },
  {
    id: 'ref-materials',
    group: 'Reference',
    title: 'Materials, paints and textures in depth',
    summary: 'Every material setting, the game’s own materials, paints players pick, and sharing materials.',
    sections: [
      { heading: 'The basics', text: 'The Materials workspace lists every material on the car. Pick meshes, pick a material, and Apply; or drag one from the library onto the car.' },
      {
        heading: 'Settings',
        steps: [
          'Colour, metallic, roughness, clear coat (and its roughness), opacity for glass.',
          'Textures: base colour, normal, roughness, metallic, ambient occlusion, emissive (lights that glow), each with its own scale.',
          'Layers: up to four layered on top of each other (paint with dirt over it, decals).',
          'Paint slots: which of the three paint colours a material takes when the player picks a paint.',
          'The game’s own materials: use one of BeamNG’s by name (the export writes nothing for it).',
        ],
      },
      {
        heading: 'Paints, skins and vinyls',
        steps: ['Paints tab: the factory colours of the car, with their metallic and clear coat, as players see them in the paint menu.', 'Skin studio: lay the body out like a template, paint it in any image editor, bring it back as a paint design.', 'Vinyls: stickers and stripes placed on the car.'],
      },
      {
        heading: 'Sharing and libraries',
        steps: ['Save to your library: keep a material for other projects.', 'Share as a .jbmat file: one file with the material and its textures.', 'Downloads → Textures: hundreds of ready materials (paint, carbon, leather, metals…).'],
      },
      { tip: '“Convert textures to DDS when exporting” (the mod’s own settings) makes the game load them faster.' },
    ],
  },
  {
    id: 'ref-moving',
    group: 'Reference',
    title: 'Hinges, latches and handles in depth',
    summary: 'Doors, hood and trunk that open in the game, and how to tune them.',
    sections: [
      { heading: 'The basics', text: 'A hinged part swings on two nodes it shares with the body, and a latch holds it shut until it’s opened (by a key, a handle trigger, or a crash).' },
      {
        heading: 'Step by step',
        steps: ['Moving parts workspace ({key:layout4}) → Hinge all: every door, hood, trunk and hatch gets a hinge guessed from the model.', 'Pick one: the hinge line, how far it opens, and the latch show on the car. Drag the swing preview to watch it open.', 'Change the axis or latch by picking nodes or meshes and pressing the matching button.', 'Handles: Add handles puts a clickable trigger on each, where the latch is.'],
      },
      { heading: 'Advanced', steps: ['Opening angle, latch strength, seal stiffness and how it pops open are on each hinge.', 'Pop-up headlights, flaps and gloveboxes hinge the same way.', 'Scripts can open and close hinged parts (sunroofs, convertible roofs).'] },
    ],
  },
  {
    id: 'ref-suspension',
    group: 'Reference',
    title: 'Axles, suspension, wheels and brakes',
    summary: 'Fitting a suspension from the game, wheels and tyres, and the brake and diff settings.',
    sections: [
      { heading: 'The basics', text: 'BeamNG suspensions are made of many parts working together, so JBeam Forge borrows complete ones from the game’s cars and fits them to yours. You choose the axles, the suspension type and the car it comes from.' },
      {
        heading: 'Step by step',
        steps: ['Suspension panel → Set up axles. The front and rear axle are placed from your wheels.', 'For each axle pick a type (MacPherson strut, double wishbone, solid axle…), a brand and a car. The preview shows it fitted.', 'Fit. Its wheels, hubs, brakes and steering come with it; move it with the arrows if it needs nudging.', 'Ride check shows ride height and whether the wheels sit in the arches.'],
      },
      {
        heading: 'Settings',
        steps: [
          'Tuning: springs, dampers, ride height, camber, toe: the suspension’s own settings, as players see them in the tuning menu.',
          'Brakes & diff: brake torque, handbrake, brake response and cooling, tyre pressure, ABS, and each differential’s type, final drive and locking.',
          'Parts: which of the game’s other parts (coilovers, sway bars, brakes) ship as choices in the parts menu.',
        ],
      },
      { heading: 'Advanced', steps: ['Your own meshes can ride on the fitted suspension (custom control arms, calipers): assign them to it and they move with it.'] },
    ],
  },
  {
    id: 'ref-engine',
    group: 'Reference',
    title: 'Engine builder and designer in depth',
    summary: 'Power, revs, cooling, oil, damage, sound: every engine setting, adjustable in game if you want.',
    sections: [
      { heading: 'The basics', text: 'Pick an engine from one of the game’s cars (Engine panel → Choose) and change it in the engine builder, or design your own in the Engine workspace: cylinders, layout, displacement, induction. A designed engine gets its own 3D model, one cylinder repeated per cylinder.' },
      {
        heading: 'The engine builder',
        steps: [
          'Torque curve: drag the points, scale it, or stretch it to a new rev limit. Power is drawn with it.',
          'Rev limit, idle, inertia (how fast it revs), friction, engine braking.',
          'Cooling: radiator area and effectiveness, coolant volume, thermostat, fan; oil volume and oil cooler.',
          'Damage: the torque rating (above it, it breaks), block and cylinder wall temperatures, head gasket and piston rings.',
          'Turbo and supercharger: boost, wastegate, spool. Sound: volume, muffling, bass and treble.',
          'Weight of the whole engine.',
        ],
      },
      {
        heading: 'Adjustable in game',
        text: 'Every setting has a game-pad button. Press it to let players change that value in BeamNG’s tuning menu: pick the lowest and highest they may set; it starts at the value you gave it.',
      },
      {
        heading: 'Versions of a part (standard, sport, race…)',
        steps: [
          'Next to each part of the engine (radiator, oil pan, intake, turbo…) is “Make a version”: a copy with its own values.',
          'Name it and price it, then pick it in the part’s menu and change its numbers: a race radiator with a bigger core and more coolant, a sport intake with more boost.',
          'In the game it shows in the parts menu next to the original, and configurations can choose it.',
        ],
      },
      { heading: 'Advanced', steps: ['Settings → General → Advanced mode lists every number the game’s engine parts have, not just the usual ones.', 'Several engines can share the engine slot (Add another engine); each configuration picks one.', 'Automation exports can be brought in as engines (Engine workspace → Import from Automation).'] },
      { tip: 'Keep the torque rating above the engine’s peak torque, or it breaks on the first full-throttle pull.' },
    ],
  },
  {
    id: 'ref-gearbox',
    group: 'Reference',
    title: 'Gearbox, shifting and driveline',
    summary: 'Ratios, automatic shift points and which wheels are driven.',
    sections: [
      { heading: 'The basics', text: 'Pick a gearbox from the game (manual, automatic, DCT, CVT, sequential). The gearbox builder sets the ratios; the driveline sends power to the front, rear or all wheels.' },
      { heading: 'Settings', steps: ['Gear ratios: each one, or spread evenly from first to top gear. Road speed in each gear is shown.', 'Shift points (automatics): up and down shifts at light and full throttle.', 'Clutch, torque converter and lock torque.', 'Driveline: rear, front or all-wheel drive; the front share and the centre differential for all-wheel drive.'] },
      { heading: 'Advanced', text: 'The same game-pad buttons and versions as the engine builder: let players change the final drive or shift points in game, or ship a short-ratio race gearbox next to the standard one.' },
    ],
  },
  {
    id: 'ref-tuning',
    group: 'Reference',
    title: 'Settings players can adjust in the game',
    summary: 'The tuning menu: what you can open up to players, and how.',
    sections: [
      { heading: 'The basics', text: 'BeamNG’s tuning menu (in the parts screen) changes “variables”: numbers a mod lets players set between a lowest and highest value. You decide which.' },
      {
        heading: 'Where to turn them on',
        steps: ['Parts: Inspector → Adjustable in game: weight, stiffness and strength of a part as a scale (1 = as built), and downforce on wings.', 'Engine and gearbox: the game-pad button next to any setting.', 'Suspension: the suspension’s own settings are already tuning variables (springs, dampers, ride height…).'],
      },
      { heading: 'Advanced', steps: ['Configurations save their own values for each variable (a race configuration with stiffer springs).', 'The variables are written into each part’s jbeam ("variables" table), named $jbf_… so they never clash with the game’s.'] },
    ],
  },
  {
    id: 'ref-configs',
    group: 'Reference',
    title: 'Configurations, paints and vehicle details',
    summary: 'The versions of the car players spawn, and how they appear in the vehicle selector.',
    sections: [
      { heading: 'The basics', text: 'A configuration is a version of the car: which part goes in each slot, its paint and tuning values. The game lists each one in the vehicle selector with a picture.' },
      { heading: 'Step by step', steps: ['Configurations (toolbar) → New, or copy one.', 'Choose a part for each slot that differs from the default, and the paint.', 'Type (Factory, Custom, Race, Police…), years, how common it is, and its value show in the selector.', 'Make one the default: it’s what spawns when the car is picked.'] },
      { heading: 'Advanced', steps: ['Import and export .pc files to move configurations between mods.', 'A picture is drawn for every configuration on export (Settings → Export → picture size, angle, backdrop).'] },
    ],
  },
  {
    id: 'ref-testing',
    group: 'Reference',
    title: 'Testing',
    summary: 'The physics sandbox here, and testing in the game itself.',
    sections: [
      { heading: 'Test Mode', text: 'Test (toolbar) drops the car in a physics sandbox: it settles on its suspension, and the Test results panel reports weight, balance, sagging, loose or exploding parts. Swing doors and drop it from a height to see how it holds.' },
      { heading: 'In the game', steps: ['Export installs the mod in BeamNG’s mods folder. Start the game (or Ctrl+R in it to reload the car) and spawn it.', 'With JBeam Forge in the game (F10), “Drive it” installs and spawns it straight from the editor.', 'The game’s console (~) and beamng.log list anything the game didn’t like.'] },
      { tip: 'Test Mode is a fast check; the game is the final word. Test there before you share a mod.' },
    ],
  },
  {
    id: 'ref-export',
    group: 'Reference',
    title: 'Exporting and sharing in depth',
    summary: 'What the export writes, the checks it runs, and preparing a mod for the BeamNG repository.',
    sections: [
      { heading: 'The basics', text: 'Export checks the mod and writes it: the jbeam files, one DAE with every mesh, main.materials.json, textures, info.json and a picture and info file per configuration. Errors must be fixed first; warnings explain what may look wrong.' },
      { heading: 'Ways to export', steps: ['Install: straight into BeamNG’s mods folder as an unpacked mod (ready to test).', 'Zip: one file to share.', 'Prepare for the repository: the zip plus a listing (title, description, pictures) ready for the official mod repository.'] },
      { heading: 'Advanced', steps: ['Settings → Export: zip compression, pictures for every configuration and opening the folder after export; the mod’s own settings: DDS textures.', 'Part mods (engines, tyres, wheels, panels) are written for the game’s own cars, never replacing game files.', 'Credits for anything you used (models, textures, a ported car) are written into the mod.'] },
    ],
  },
  {
    id: 'ref-ingame',
    group: 'Reference',
    title: 'JBeam Forge inside BeamNG.drive',
    summary: 'Press F10 in the game to open JBeam Forge on the car you’re driving.',
    sections: [
      { heading: 'The basics', text: 'JBeam Forge also runs inside the game, like the World Editor does on F11. Press F10 while driving: JBeam Forge opens over the game. Press F10 again to drive on.' },
      { heading: 'Setting it up', steps: ['Settings → BeamNG.drive → JBeam Forge in the game → Install. It goes in the game’s mods folder as jbeam_forge.zip.', 'It updates by itself when JBeam Forge does (at the next start).', 'Start the game, get in a car, press F10.'] },
      {
        heading: 'What it does in the game',
        steps: [
          'The car I’m driving: opens that car as a project, with its current configuration: every part, node and beam as the game built it, its models and materials.',
          'On the car: draws your project’s nodes and beams on the car you’re driving.',
          'Drive it: installs the mod as it is now and spawns it, in the game’s own physics.',
          'Everything else works as on the desktop: parts, materials, the builders, configurations, export.',
        ],
      },
      { tip: 'A car from the game can be changed and shared as long as the mod says it’s from BeamNG.drive and is free.' },
    ],
  },
  {
    id: 'ref-ai',
    group: 'Reference',
    title: 'AI mode',
    summary: 'Hand finishing work to the AI you already use. No account, any AI, nothing changes until you say so.',
    sections: [
      {
        heading: 'The basics',
        text: 'AI mode (toolbar, the sparkle button) gives jobs to an AI: names and descriptions, prices, weights, structure settings, material looks, hinges and handles, scripts (electric windows, moving seats…), configurations, vehicle details, engine and gearbox tune, and tuning options. Its answer is checked and shown to you; you keep what you like and apply it in one step, which one {key:undo} takes back.',
      },
      {
        heading: 'Using it with any AI (no account here)',
        steps: [
          'Tick the jobs and describe the car in your words (“1990s Japanese sports coupe, light and cheap; trims base, SE, Turbo”).',
          'Copy the request. Paste it into the AI chat you use: ChatGPT, Microsoft Copilot, Gemini, Claude, DeepSeek, Mistral… Free accounts work.',
          'Copy the AI’s whole answer back into the box and press Check it.',
          'Every change is listed with what it does. Changes that name a part that doesn’t exist, go outside sensible ranges, or belong to a job you didn’t tick are refused, with the reason. Untick anything you don’t want, then Apply.',
        ],
      },
      {
        heading: 'Connected (optional)',
        steps: [
          'Settings → AI mode → Connected: the request is sent for you and the answer comes back by itself.',
          'Pick a service and paste your own key: OpenAI, Anthropic, Google Gemini, OpenRouter (many models with one key), or any OpenAI-compatible service. The key is encrypted on this computer and only sent to that service; you pay it for what you use, usually cents.',
          'Free and offline: install Ollama or LM Studio, download a model, and pick “On this computer”. Nothing leaves your PC.',
        ],
      },
      {
        heading: 'How an AI that has never seen JBeam Forge gets it right',
        steps: [
          'Every request starts with a rule book: how BeamNG cars are built, units, realistic weights and prices, and the rules (only use names listed, stay in the ranges, answer in the given format).',
          'Each job adds its own instructions and only the parts of the project it needs, by name, with current values.',
          'The answer is a list of changes in a strict format, never files. The app checks each one and applies it through the same commands as its own buttons, so the result is always a valid project.',
        ],
      },
      {
        heading: 'Iterate',
        steps: ['Not right? Press Iterate, say what to change (“prices are too high”, “the race configuration should have the carbon hood”), and ask again.', 'The new request tells the AI what was applied, what was refused and why, and how the project looks now, so it fixes rather than repeats. It works in the same chat or a new one.'],
      },
      { tip: 'Bigger, newer models do best. If an answer has nothing usable, the window says why: usually the AI didn’t use the answer format, and Iterate asks it to.' },
    ],
    actions: ['settings'],
  },
  {
    id: 'ref-downloads',
    group: 'Reference',
    title: 'Downloads and the content library',
    summary: 'Materials, meshes and scripts to download, versions, and adding your own.',
    sections: [
      { heading: 'The basics', text: 'Downloads (the cloud button, Ctrl+Shift+D) lists the content library: materials, ready-made meshes (calipers, discs, gauges, seats…) and vehicle scripts. Download single items or everything; the app only fetches what changed.' },
      { heading: 'Versions', steps: ['Latest follows the library as it’s updated. Pick an older version to get exactly what it had.', 'New content is announced at startup (Settings → Downloads → check at startup).'] },
      {
        heading: 'Adding to the library (for whoever looks after it)',
        steps: [
          'Settings → Downloads → Publishing → Get a copy (or Choose an existing copy).',
          'Materials and scripts then have “Add to the download library”. “Add a finished folder” takes a mesh or anything made elsewhere.',
          'Publish. The library rebuilds by itself and everyone sees the new content within minutes.',
        ],
      },
      { heading: 'Advanced', text: 'Settings → Downloads → Repositories points the app at another library laid out the same way (a mirror, or your own). The content folder can be moved anywhere.' },
    ],
  },
  {
    id: 'ref-updates',
    group: 'Reference',
    title: 'Updating JBeam Forge',
    summary: 'Getting new versions of the app and of JBeam Forge in the game.',
    sections: [
      { steps: ['At startup JBeam Forge says when a new version is out (Settings → Downloads).', 'Downloads → Application lists every version: download and install the newest, or go back to an older one.', 'The portable version is replaced by the new exe; the installed version runs its installer and keeps your settings, projects and downloads.', 'JBeam Forge in the game updates itself to match the app at the next start.'] },
    ],
  },
  {
    id: 'ref-settings',
    group: 'Reference',
    title: 'Settings at a glance',
    summary: 'Where everything is in Settings.',
    sections: [
      {
        example: [
          'BeamNG.drive      install and user folders, JBeam Forge in the game',
          'General           author, advanced mode, start-up, tutorials',
          'Interface         theme, accent colour, density, text size, tooltips',
          'Window, Viewport  window size, frame rate, graphics, camera and navigation',
          'Editing, Keymap   editing behaviour and every key',
          'JBeam, Units      jbeam defaults; metric or imperial, power and torque units',
          'Files & backups   autosave and backups beside each project',
          'Export            zip, DDS, pictures for the vehicle selector',
          'Downloads         content folder, updates, repositories, publishing',
          'AI mode           copy and paste, or connected with your own key',
          'Scripts           script editor and checks',
          'Extensions        add-ons and their permissions',
          'Library, Naming   your own texture and model folders; part names',
        ].join('\n'),
      },
      { tip: 'The search box at the top of Settings finds any setting by name.' },
    ],
    actions: ['settings'],
  },
];
