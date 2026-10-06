/* global forge */
// Quick adjust: an example JBeam Forge extension that changes the project.
// Every change goes through forge.project.update as JSON Patch operations, so each command is
// one undo step (Ctrl+Z takes it back) and the app refuses anything that would break the project.

const round = (n, step) => Math.max(step, Math.round(n / step) * step);

async function scalePrices(k) {
  const p = await forge.project.get();
  if (!p) return forge.ui.notify('Open a mod first.', 'warning');
  // Parts with an automatic price (null) follow their kind and material; only set prices change.
  const ops = p.parts.flatMap((part, i) => (part.price === null ? [] : [{ op: 'replace', path: `/parts/${i}/price`, value: round(part.price * k, 5) }]));
  if (!ops.length) return forge.ui.notify('No part has its own price yet (they all follow their kind). Set some in the Inspector, or use AI mode → Prices.', 'info');
  await forge.project.update(`Prices ${k > 1 ? '+' : '−'}10%`, ops);
  forge.ui.notify(`${ops.length} price${ops.length === 1 ? '' : 's'} changed. Ctrl+Z puts them back.`, 'success');
}

async function scaleWeights(k) {
  const p = await forge.project.get();
  if (!p) return forge.ui.notify('Open a mod first.', 'warning');
  const ops = [];
  for (const [partId, settings] of Object.entries(p.proxy.parts)) {
    if (settings.massKg === null || settings.massKg === undefined) continue;
    ops.push({ op: 'replace', path: `/proxy/parts/${partId}/massKg`, value: Math.round(settings.massKg * k * 100) / 100 });
  }
  if (!ops.length) return forge.ui.notify('No part has its own weight yet (they follow their kind). Set some in Properties → Structure, or use AI mode → Weights.', 'info');
  await forge.project.update(`Weights ${k > 1 ? '+' : '−'}10%`, ops);
  forge.ui.notify(`${ops.length} weight${ops.length === 1 ? '' : 's'} changed: generate again to update the structure. Ctrl+Z puts them back.`, 'success');
}

/** "door_FL (2)" → "Door FL", "front_bumper_001" → "Front Bumper". */
function tidy(name) {
  return name
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[_.]\d{1,3}$/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (/^(FL|FR|RL|RR|L|R|F|LED|GT|RS)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

forge.commands.register({ id: 'prices-up', label: 'Prices: up 10%', run: () => scalePrices(1.1) });
forge.commands.register({ id: 'prices-down', label: 'Prices: down 10%', run: () => scalePrices(1 / 1.1) });
forge.commands.register({ id: 'weights-up', label: 'Weights: heavier 10%', run: () => scaleWeights(1.1) });
forge.commands.register({ id: 'weights-down', label: 'Weights: lighter 10%', run: () => scaleWeights(1 / 1.1) });
forge.commands.register({
  id: 'tidy-names',
  label: 'Tidy parts-menu names',
  run: async () => {
    const p = await forge.project.get();
    if (!p) return forge.ui.notify('Open a mod first.', 'warning');
    const ops = p.parts.flatMap((part, i) => {
      const next = tidy(part.displayName || part.name);
      return next && next !== part.displayName ? [{ op: 'replace', path: `/parts/${i}/displayName`, value: next }] : [];
    });
    if (!ops.length) return forge.ui.notify('Every name is tidy already.', 'info');
    await forge.project.update('Tidy parts-menu names', ops);
    forge.ui.notify(`${ops.length} name${ops.length === 1 ? '' : 's'} tidied. Ctrl+Z puts them back.`, 'success');
  },
});
