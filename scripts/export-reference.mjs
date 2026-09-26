#!/usr/bin/env node
/**
 * Build the reference test mod end to end through the real app UI and install it into the REAL
 * BeamNG user folder (mods/unpacked/<slug>) — the Phase 5 in-game gate artifact.
 *
 *   npm run build && node scripts/export-reference.mjs --model=scratch/test-models/sunburst2/sunburst2.dae --name=Test
 *
 * New mod → import → auto-classify (apply) → generate all → export (validate) → install unpacked.
 * Uses a throwaway app-data folder (your app settings are untouched) but the real BeamNG detection,
 * so the mod lands where the game loads it. The project is saved to scratch/reference-project/.
 * Everything it reads/writes under scratch/ is local-only (never committed).
 */
import { _electron } from 'playwright-core';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const model = arg('model') ?? 'scratch/test-models/sunburst2/sunburst2.dae';
const name = arg('name') ?? 'Test';
const projectDir = join(ROOT, 'scratch', 'reference-project');
mkdirSync(projectDir, { recursive: true });
const projectFile = join(projectDir, `${name.toLowerCase()}.jbforge`);
if (!existsSync(join(ROOT, model))) {
  console.error(`model not found: ${model} (run npm run extract-reference -- sunburst2 first)`);
  process.exit(1);
}

const hook = (page, n, ...a) => page.evaluate(([hn, args]) => window.__jbforgeTest[hn](...args), [n, a]);

const app = await _electron.launch({
  args: ['.'],
  cwd: ROOT,
  env: { ...process.env, JBFORGE_USER_DATA: mkdtempSync(join(tmpdir(), 'jbforge-reference-')), JBFORGE_HARNESS: '1', ELECTRON_RENDERER_URL: '' },
  timeout: 30_000,
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-view=home][data-testid=app-ready]', { timeout: 60_000 });
  await page.getByTestId('home-new').click();
  await page.getByTestId('newmod-name').fill(name);
  await hook(page, 'queueDialog', [join(ROOT, model)]);
  await page.getByTestId('newmod-create').click();
  await page.getByTestId('import-dialog').waitFor({ timeout: 180_000 });
  await page.getByTestId('import-confirm').click();
  await page.getByTestId('classify-summary').waitFor({ timeout: 600_000 });
  await page.getByTestId('classify-apply').click();
  console.log('classified:', JSON.stringify((await hook(page, 'partsState')).parts.length), 'parts');

  await page.getByTestId('toolbar-generate').click();
  let st;
  for (let i = 0; i < 1200; i++) {
    st = await hook(page, 'structureState');
    if (st?.generatedParts > 0) break;
    await page.waitForTimeout(100);
  }
  console.log('structure:', JSON.stringify({ nodes: st.nodes, beams: st.beams, tris: st.tris, massKg: st.massKg, stability: st.stability }));

  await hook(page, 'queueDialog', [projectFile]);
  await page.getByTestId('toolbar-save').click();
  for (let i = 0; i < 100 && !existsSync(projectFile); i++) await page.waitForTimeout(100);
  console.log('project saved:', projectFile);

  await page.getByTestId('toolbar-export').click();
  await page.getByTestId('export-dialog').waitFor();
  const errors = await page.getByTestId('export-errors').count();
  if (errors) {
    console.error('EXPORT BLOCKED:\n' + (await page.getByTestId('export-errors').textContent()));
    process.exitCode = 2;
  } else {
    const warnings = (await page.getByTestId('export-warnings').count()) ? await page.getByTestId('export-warnings').innerText() : '(none)';
    console.log('warnings:\n' + warnings);
    await page.getByTestId('export-install').click();
    await page.waitForSelector('[data-testid=export-result], [data-testid=export-dialog] [class*=danger]', { timeout: 300_000 });
    console.log((await page.getByTestId('export-dialog').innerText()).split('\n').slice(0, 3).join('\n'));
  }
} finally {
  await app.close();
}
