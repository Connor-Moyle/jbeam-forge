import { explainLua } from '@shared/lua/explain';
import { outputName, scriptActions, type ParamDef, type ScriptTemplate } from '@shared/lua/templates';
import { projectStore } from '@renderer/app/stores/project';
import { useScriptUi } from '@renderer/scripts/commands';
import { templateById } from '@renderer/scripts/registry';
import { offerGuide, type Guide, type GuideStep } from '../guide';

/**
 * A script template's tutorial: what it does and needs, each setting and how
 * to set it (picking meshes for real), its keys, what it outputs, a test run,
 * then its code block by block with what every line does.
 */

const script = (id: string) => projectStore.getState().doc?.scripts?.find((s) => s.id === id);

function settingText(p: ParamDef): string {
  const def = Array.isArray(p.default) ? '' : p.default === '' ? '' : ` Starts at ${String(p.default)}${p.unit ? ` ${p.unit}` : ''}.`;
  const kind = p.kind === 'meshes' ? 'Meshes from your car: select them in the viewport or the Scene, then add them here.' : p.kind === 'mesh' ? 'One mesh from your car.' : p.kind === 'boolean' ? 'On or off.' : p.kind === 'choice' ? `Pick one: ${(p.options ?? []).map((o) => o.label).join(', ')}.` : p.kind === 'electrics' ? 'The name of an electrics value it reads.' : '';
  return [p.hint, kind, def.trim(), p.advanced ? 'Under “More settings”.' : ''].filter(Boolean).join(' ');
}

export function scriptLesson(template: ScriptTemplate, scriptId: string): Guide {
  const s = script(scriptId);
  const name = s?.name ?? template.name0;
  const actions = scriptActions(template, s ?? { actions: undefined });
  const steps: GuideStep[] = [];
  const show = (mode: 'easy' | 'code') => () => useScriptUi.getState().set({ selected: scriptId, view: 'list', mode });

  steps.push({
    id: 'intro',
    title: template.name,
    body: `${template.description}${template.needs ? ` It needs: ${template.needs.charAt(0).toLowerCase()}${template.needs.slice(1)}.` : ''} This tutorial shows how to set it up for your car, then what every line of its code does. Your car stays as it is unless you change something.`,
    enter: show('easy'),
  });
  steps.push({
    id: 'settings',
    title: 'Its settings',
    target: '[data-testid="script-easy"]',
    body: 'Everything is set from this form: no code needed. Each setting reaches the script in the game as its jbeam data, so you can also change it in the exported jbeam later.',
    list: template.params.map((p) => ({ label: `${p.label}${p.unit ? ` (${p.unit})` : ''}`, text: settingText(p) })),
    enter: show('easy'),
  });
  for (const p of template.params.filter((x) => x.kind === 'meshes' || x.kind === 'mesh')) {
    steps.push({
      id: `pick-${p.id}`,
      title: `Pick the ${p.label.toLowerCase()}`,
      target: '[data-testid="script-use-selection"]',
      body: `${p.hint ?? ''} ${p.animate ? `Each one becomes an animated part that ${p.animate.motion === 'rotate' ? 'turns' : 'slides'} with the script; fine-tune its pivot and axis in the Moving parts workspace.` : ''}`.trim(),
      action: `Click the ${p.kind === 'mesh' ? 'mesh' : 'meshes'} on the car (Shift+click for more), then press “${p.kind === 'mesh' ? 'Use the selected mesh' : 'Add the selected meshes'}”. Or skip this step and do it later.`,
      done: () => {
        const v = script(scriptId)?.params[p.id];
        return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v !== '';
      },
      enter: show('easy'),
    });
  }
  if (actions.length)
    steps.push({
      id: 'keys',
      title: 'Its keys',
      target: '[data-testid="script-keys"]',
      body: 'What the player presses in the game. Click a key box, then press the key you want. Players can change them in the game under Options → Controls → Vehicle specific.',
      list: actions.map((a) => ({ label: `${a.label} (${a.key || 'no key'})`, text: template.actions.find((t) => t.id === a.id)?.desc ?? `Calls ${a.call}.` })),
      enter: show('easy'),
    });
  if (template.outputs.length)
    steps.push({
      id: 'outputs',
      title: 'What it outputs',
      target: '[data-testid="script-outputs"]',
      body: 'The script writes these electrics values every frame. Animated parts, glowing light materials and gauges can follow them by name, which is how a script moves and lights things.',
      list: template.outputs.map((o) => ({ label: outputName(name, o.suffix), text: `${o.label} (${o.min} to ${o.max}).` })),
      enter: show('easy'),
    });
  steps.push({
    id: 'test',
    title: 'Try it without the game',
    target: '[data-testid="script-run"]',
    body: `The test runner plays a short drive (${template.test.seconds} s) and presses its keys at set moments, running the real Lua. You see every value it writes and can play its animations on the car.`,
    action: 'Press Run test, or skip this step.',
    done: () => useScriptUi.getState().result !== null,
    enter: show('easy'),
  });

  const chunks = explainLua(s?.code ?? template.lua, { name, params: template.params, outputs: template.outputs, actions: template.actions });
  steps.push({
    id: 'code',
    title: 'How the code works',
    target: '[data-testid="script-code"]',
    body: `This is the Lua the game runs: a vehicle controller, loaded once for each car. BeamNG calls its init when the car spawns and its updateGFX every frame; the keys call its other functions. Next: the code in ${chunks.length} parts, every line explained.`,
    enter: show('code'),
  });
  chunks.forEach((c, i) =>
    steps.push({
      id: `code-${i + 1}`,
      title: `${i + 1}. ${c.title}`,
      target: '[data-testid="script-code"]',
      body: `Lines ${c.lines[0]!.n}–${c.lines[c.lines.length - 1]!.n}.`,
      code: c.lines,
      enter: show('code'),
    }),
  );
  steps.push({
    id: 'customise',
    title: 'Make it your own',
    target: s?.code === null ? '[data-testid="script-customise"]' : '[data-testid="script-code"]',
    body: 'The template’s code stays read-only so it can be updated for you. “Customise the code” gives this car its own copy to change; the checker underneath explains mistakes as you type, and the reference lists everything vehicle Lua can use. “Back to the template’s code” undoes it.',
    enter: show('code'),
  });
  steps.push({
    id: 'done',
    title: 'That’s it',
    target: '[data-testid="script-easy"]',
    body: 'Set it up, try it, export the mod. Replay this tutorial any time with the cap button next to the script’s name, or from the template list. Help → Guides → Vehicle scripts has more.',
    enter: show('easy'),
  });
  return { id: `script:${template.id}`, title: template.name, steps };
}

/** After adding a template script: offer its tutorial once. */
export function offerScriptLesson(scriptId: string): void {
  const s = script(scriptId);
  const t = s?.templateId ? templateById(s.templateId) : undefined;
  if (!t) return;
  offerGuide({ id: `script:${t.id}`, title: t.name, summary: 'How to set it up for your car, then what every line of its code does. A few minutes; stop any time.', build: () => scriptLesson(t, scriptId) });
}
