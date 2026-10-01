import { TRIGGER_PRESETS } from '@shared/triggers/schema';
import { projectStore } from '@renderer/app/stores/project';
import { triggerActions, triggersOf, useTriggerUi } from '@renderer/triggers/commands';
import { offerGuide, type Guide, type GuideStep } from '../guide';

/**
 * Tutorials for the Triggers, Moving parts and JBeam workspaces: each control
 * in turn, what it is and how to set it up, following along on your own car.
 */

const doc = () => projectStore.getState().doc;

export type WorkspaceLesson = 'triggers' | 'moving' | 'jbeam';

export function triggersLesson(): Guide {
  const d = doc();
  const groups = [...new Set(triggerActions(d).map((a) => a.group))];
  const count = () => triggersOf(doc()).length;
  const start = count();
  const steps: GuideStep[] = [
    {
      id: 'intro',
      title: 'Triggers',
      body: 'Triggers are the spots players click in the game: door handles, the hood release, a horn button, a light switch. Each is a small box tied to a part’s nodes (so a handle moves with its door) that runs an action when clicked. In the jbeam they are the triggers and triggerEventLinks sections; this workspace writes both for you.',
    },
    {
      id: 'list',
      title: 'Every trigger on the car',
      target: '[data-panel="triggers"]',
      body: 'The list of the car’s triggers: its name, what it does and the part it moves with. Click one to pick it; the boxes show in the 3D view.',
    },
    {
      id: 'add',
      title: 'Add one',
      target: '[data-testid="trigger-add"]',
      body: 'Choose the kind first (it sets a sensible size), then Add.',
      list: TRIGGER_PRESETS.map((p) => ({ label: p.label, text: `${Math.round(p.size[0] * 1000)} × ${Math.round(p.size[1] * 1000)} × ${Math.round(p.size[2] * 1000)} mm to start with.` })),
      action: 'Pick a kind and click Add (or skip this step).',
      done: () => count() > start,
    },
    {
      id: 'handles',
      title: 'Door handles in one click',
      target: '[data-testid="trigger-handles"]',
      body: 'With hinges set up (Moving parts), this adds a handle trigger for every door, hood and trunk, wired to open it.',
      skipIf: () => !doc()?.hinges.length,
    },
    {
      id: 'place',
      title: 'Put it where it belongs',
      target: '[data-testid="trigger-place"]',
      body: 'Press it, then click on the car: the trigger moves to that spot and turns to sit flat on the surface.',
      skipIf: () => !useTriggerUi.getState().selected,
    },
    {
      id: 'action',
      title: 'What it does',
      target: '[data-testid="trigger-action"]',
      body: 'The action runs when the trigger is clicked in the game, the same as pressing its key. The list has:',
      list: groups.map((g) => ({ label: g, text: triggerActions(d).filter((a) => a.group === g).slice(0, 6).map((a) => a.label).join(', ') + (triggerActions(d).filter((a) => a.group === g).length > 6 ? '…' : '') })),
      skipIf: () => !useTriggerUi.getState().selected,
    },
    {
      id: 'editor',
      title: 'Its other settings',
      target: '[data-testid="trigger-editor"]',
      body: 'Everything about the picked trigger:',
      list: [
        { label: 'Name', text: 'Its id in the jbeam (letters, digits and _).' },
        { label: 'Moves with', text: 'The part whose nodes carry it. A handle on a door should move with the door.' },
        { label: 'Position', text: 'Where its centre is, in metres (X left, Y rear, Z up). Fine-tune after placing it.' },
        { label: 'Size', text: 'Width, depth and height in mm. Big enough to click easily, small enough not to cover other triggers.' },
        { label: 'Turn', text: 'Its angle about each axis, in degrees.' },
      ],
      skipIf: () => !useTriggerUi.getState().selected,
    },
    {
      id: 'mirror',
      title: 'The other side',
      target: '[data-testid="trigger-mirror"]',
      body: 'Mirror makes the same trigger on the other side of the car (left door handle → right). Duplicate copies it in place.',
      skipIf: () => !useTriggerUi.getState().selected,
    },
    {
      id: 'done',
      title: 'In the game',
      body: 'After export, point at a trigger with the mouse in the game and click it. If a click does nothing, check the trigger isn’t inside the body, and that it moves with the right part.',
    },
  ];
  return { id: 'workspace:triggers', title: 'Triggers', steps };
}

export function movingLesson(): Guide {
  const steps: GuideStep[] = [
    {
      id: 'intro',
      title: 'Moving parts',
      body: 'Everything that moves on the car in one place: doors, hood and trunk on hinges; needles, pedals and the steering wheel that follow the game’s values; and wipers, windows or mirrors run by a script.',
    },
    {
      id: 'switch',
      title: 'See it move',
      target: '[data-panel="moving-parts"]',
      body: 'Previews swing the real part (put back afterwards). The switch at the top chooses the part itself or a see-through copy.',
    },
    {
      id: 'hinge-all',
      title: 'Hinge every door in one go',
      target: '[data-testid="moving-hinge-all"]',
      body: 'Finds the hinge line, how far it opens and the latch for every door, hood, trunk and tailgate from their shape. Check each one afterwards.',
      skipIf: () => !document.querySelector('[data-testid="moving-hinge-all"]'),
    },
    {
      id: 'opening',
      title: 'Opening panels',
      target: '[data-panel="moving-parts"]',
      body: 'Each door, hood or trunk is listed with Ready (hinged) or Set up. Pick one to set it up on the right:',
      list: [
        { label: 'Hinge line', text: 'Two points the panel turns about. Pick them on the car, or move them by number.' },
        { label: 'Opens to', text: 'How far it swings, in degrees. The ghost in the 3D view shows the swing.' },
        { label: 'Latch', text: 'Where it holds shut. It breaks free when hit hard enough.' },
        { label: 'Handles', text: 'Triggers that open it in the game (the Triggers workspace places more).' },
      ],
    },
    {
      id: 'props',
      title: 'Animated parts',
      target: '[data-testid="moving-add-prop"]',
      body: 'A mesh that turns or slides with one of the game’s values: the steering wheel with steering, needles with rpm or speed, pedals, a fan. Names like needle_rpm or steering_wheel are suggested above it.',
      list: [
        { label: 'Follows', text: 'The electrics value it follows (rpm, wheelspeed, steering, throttle, or a script’s output).' },
        { label: 'Motion', text: 'Turn or slide, the axis, and the pivot.' },
        { label: 'Range', text: 'The angle (or distance) at the value’s low and high end.' },
        { label: 'Try it', text: 'Drag to see it move before exporting.' },
      ],
    },
    {
      id: 'scripts',
      title: 'Scripted movement',
      target: '[data-testid="moving-add-script"]',
      body: 'Wipers, electric windows, folding mirrors, a sunroof and more, from templates with no code. Each has its own tutorial with every line of its code explained.',
    },
    {
      id: 'done',
      title: 'Test it',
      body: 'Test Mode (the play button in the toolbar) runs the physics with your hinges, so you can swing doors and see them stop at their limit.',
    },
  ];
  return { id: 'workspace:moving', title: 'Moving parts', steps };
}

export function jbeamLesson(): Guide {
  const steps: GuideStep[] = [
    {
      id: 'intro',
      title: 'The JBeam workspace',
      body: 'BeamNG cars are soft bodies: nodes (points with weight) joined by beams (springs that can bend and break), with triangles for aerodynamics and collisions. JBeam is the file format that lists them. Generate builds them for you; this workspace lets you see and change every one exactly.',
    },
    {
      id: 'tables',
      title: 'The tables',
      target: '[data-panel="jbeam-tables"]',
      body: 'Every node, beam and triangle, part by part. Pick rows to select them in the 3D view (Shift adds, Ctrl removes); pick in the 3D view and the rows follow.',
      list: [
        { label: 'Part', text: 'Show one part, or all of them.' },
        { label: 'Search', text: 'Find nodes and beams by name.' },
        { label: 'Nodes', text: 'Name, position (m) and weight (kg) of each point.' },
        { label: 'Beams', text: 'Which two nodes, its kind (normal, support, bounded…) and its stiffness and strength.' },
        { label: 'Triangles', text: 'Three nodes each; they catch air and other objects. Flip one if it faces the wrong way.' },
        { label: 'Checks', text: 'Loose nodes, beams too short or long, doubled beams, flipped triangles, nodes without a partner on the other side, each with a fix.' },
      ],
    },
    {
      id: 'tabs',
      title: 'Nodes, beams, triangles, checks',
      target: '[data-panel="jbeam-tables"] [role="tablist"]',
      body: 'Switch tables here. The Checks tab shows a warning sign when something needs a look.',
    },
    {
      id: 'add',
      title: 'Add nodes and triangles',
      target: '[data-testid="jbeam-add-node"]',
      body: 'Add a node next to the selection, or make a triangle from three selected nodes (the button beside it). Edit mode in the toolbar does the same with the mouse.',
      skipIf: () => !document.querySelector('[data-testid="jbeam-add-node"]'),
    },
    {
      id: 'properties',
      title: 'The picked ones’ values',
      target: '[data-panel="jbeam-props"]',
      body: 'Whatever you pick, its values are here: change one node, or many at once.',
      list: [
        { label: 'Name logically', text: 'Names nodes by part and side (dl1, dr1… for the left and right doors), the way the game’s cars do.' },
        { label: 'Move by', text: 'Shifts the picked nodes by an exact distance.' },
        { label: 'Weight', text: 'Spread a total weight over the picked nodes.' },
        { label: 'Any jbeam property', text: 'Set a key the game knows (beamSpring, beamDamp, deformLimit…) on the picked nodes or beams. Hand-set values win over the part’s preset on export.' },
      ],
    },
    {
      id: 'preview',
      title: 'The file itself',
      target: '[data-panel="jbeam-preview"]',
      body: 'The jbeam the export will write for the picked part, kept up to date as you edit.',
    },
    {
      id: 'done',
      title: 'Beginners and experts',
      body: 'The defaults are safe: you can make a working car without touching this workspace. Settings → JBeam turns on advanced mode (every property, the check limits and the naming style) when you want full control.',
    },
  ];
  return { id: 'workspace:jbeam', title: 'JBeam workspace', steps };
}

const LESSONS: Record<WorkspaceLesson, { build: () => Guide; summary: string; title: string }> = {
  triggers: { build: triggersLesson, title: 'Triggers', summary: 'What triggers are, how to add, place and wire one, and what every setting does.' },
  moving: { build: movingLesson, title: 'Moving parts', summary: 'Hinges, animated parts and scripted movement: what each control is and how to set it up.' },
  jbeam: { build: jbeamLesson, title: 'the JBeam workspace', summary: 'Nodes, beams and triangles: the tables, the checks and editing values exactly.' },
};

export function workspaceLesson(which: WorkspaceLesson): Guide {
  return LESSONS[which].build();
}

/** Opening the workspace the first time: offer its tutorial. */
export function offerWorkspaceLesson(which: WorkspaceLesson): void {
  const l = LESSONS[which];
  offerGuide({ id: `workspace:${which}`, title: l.title, summary: l.summary, build: l.build });
}
