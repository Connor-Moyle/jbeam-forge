#!/usr/bin/env node
/**
 * Visual check of generated structure on the reference model, through the real app (local only).
 *
 *   npm run build && node scripts/visual-structure.mjs [--kinds=body,hood,door,...] [--tag=v2]
 *
 * Imports the model, auto-classifies, keeps only the chosen base parts (default: the body shell and
 * its main panels), generates, and screenshots each view with the mesh on and off into
 * artifacts/visual-structure/<tag>/.
 */
import { _electron } from 'playwright-core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const model = arg('model') ?? 'scratch/test-models/sunburst2/sunburst2.dae';
const kinds = (arg('kinds') ?? 'body,hood,door,fender,bumper,trunk,windshield,rear_window,door_glass,quarter_glass,quarter_panel,side_skirt').split(',');
const tag = arg('tag') ?? new Date().toISOString().replace(/[:.]/g, '-');
const out = join(ROOT, 'artifacts', 'visual-structure', tag);
mkdirSync(out, { recursive: true });
const hook = (page, n, ...a) => page.evaluate(([hn, args]) => window.__jbforgeTest[hn](...args), [n, a]);

const VIEWS = {
  threeQuarter: [5, 2.5, -6],
  side: [8, 0.5, 0],
  top: [0.01, 9, 0.01],
  front: [0.01, 1, -8],
};

const app = await _electron.launch({
  args: ['.'],
  cwd: ROOT,
  env: { ...process.env, JBFORGE_USER_DATA: mkdtempSync(join(tmpdir(), 'jbforge-visual-')), JBFORGE_HARNESS: '1', ELECTRON_RENDERER_URL: '' },
  timeout: 30_000,
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForSelector('[data-view=home][data-testid=app-ready]', { timeout: 60_000 });
  await page.getByTestId('home-new').click();
  await page.getByTestId('newmod-name').fill('Visual');
  await hook(page, 'queueDialog', [join(ROOT, model)]);
  await page.getByTestId('newmod-create').click();
  await page.getByTestId('import-dialog').waitFor({ timeout: 180_000 });
  await page.getByTestId('import-confirm').click();
  await page.getByTestId('classify-summary').waitFor({ timeout: 600_000 });
  await page.getByTestId('classify-apply').click();
  await hook(page, 'keepOnlyKinds', kinds);
  await hook(page, 'hideUnassigned');
  await page.getByTestId('toolbar-generate').click();
  let st;
  for (let i = 0; i < 600; i++) {
    st = await hook(page, 'structureState');
    if (st?.generatedParts > 0) break;
    await page.waitForTimeout(100);
  }
  console.log(JSON.stringify({ nodes: st.nodes, beams: st.beams, tris: st.tris, byKind: st.byKind, stability: st.stability }));
  const refFile = join(ROOT, 'scratch', 'vehicle-study', 'sunburst2', 'reference-structure.json');
  const reference = existsSync(refFile) ? JSON.parse(readFileSync(refFile, 'utf8')) : null;
  for (const [name, dir] of Object.entries(VIEWS)) {
    await hook(page, 'viewFrom', dir);
    await page.waitForTimeout(400);
    await page.getByTestId('viewport').screenshot({ path: join(out, `${name}-mesh.png`) });
    await page.getByTestId('toolbar-view-mesh').click();
    await page.waitForTimeout(250);
    await page.getByTestId('viewport').screenshot({ path: join(out, `${name}-structure.png`) });
    if (reference) {
      // Official structure alone (ours hidden), same camera.
      await page.getByTestId('toolbar-view-structure').click();
      await hook(page, 'setReferenceStructure', reference);
      await page.waitForTimeout(250);
      await page.getByTestId('viewport').screenshot({ path: join(out, `${name}-official.png`) });
      await hook(page, 'setReferenceStructure', null);
      await page.getByTestId('toolbar-view-structure').click();
    }
    await page.getByTestId('toolbar-view-mesh').click();
  }
  if (process.argv.includes('--dump-sim')) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(ROOT, 'scratch', 'sim-model.json'), JSON.stringify(await hook(page, 'dumpSimModel')));
    console.log('sim model → scratch/sim-model.json');
  }
  if (process.argv.includes('--sim')) {
    await page.getByTestId('toolbar-test').click();
    await page.getByTestId('test-panel').waitFor();
    const issues = (await page.getByTestId('sim-issues').count()) ? await page.getByTestId('sim-issues').innerText() : 'none';
    console.log('pre-checks:', issues.replaceAll(String.fromCharCode(10), ' | '));
    for (const [id, label] of [
      ['scenario-settle', 'settle'],
      ['scenario-drop', 'drop'],
      ['scenario-pole', 'pole'],
    ]) {
      await page.getByTestId(id).click();
      // The buttons are disabled while a scenario runs; wait for them to come back.
      await page.waitForFunction((tid) => !document.querySelector(`[data-testid=${tid}]`)?.hasAttribute('disabled'), id, { timeout: 180_000, polling: 100 });
      await page.waitForTimeout(100);
      console.log(`${label}:`, (await page.getByTestId('sim-result').innerText()).replaceAll(String.fromCharCode(10), ' | '));
      if (await page.getByTestId('sim-broken').count()) console.log('   broken:', (await page.getByTestId('sim-broken').innerText()).replaceAll(String.fromCharCode(10), ' | '));
      await page.getByTestId('viewport').screenshot({ path: join(out, `sim-${label}.png`) });
    }
    await page.getByTestId('sim-run').click();
    await page.waitForTimeout(2000);
    console.log('live:', await page.getByTestId('sim-stats').innerText());
  }
  console.log(`screenshots → ${out}`);
} finally {
  await app.close();
}
