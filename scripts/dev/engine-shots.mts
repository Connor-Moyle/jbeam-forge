/**
 * Write the engine designer's model for several designs as OBJ files, open each in the BUILT
 * app (`npm run build` first) and screenshot it, to look the shapes over.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/dev/engine-shots.mts [--out=artifacts/engine-shots]
 */
import { _electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_DESIGN, DESIGN_PRESETS, type EngineDesign } from '../../src/shared/powertrain/design';
import { engineModel, engineModelObj } from '../../src/shared/powertrain/engineModel';

const ROOT = resolve(import.meta.dirname, '..', '..');
const outDir = resolve(ROOT, process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? join('artifacts', 'engine-shots'));
mkdirSync(outDir, { recursive: true });

const extra: { id: string; design: Partial<EngineDesign> }[] = [
  { id: 'v8-twin-turbo', design: { layout: 'v', cylinders: 8, aspiration: 'twin-turbo', boost: 14 } },
  { id: 'i5', design: { layout: 'inline', cylinders: 5, bore: 81, stroke: 93 } },
  { id: 'v12', design: { layout: 'v', cylinders: 12, bore: 89, stroke: 79 } },
  { id: 'i4-supercharged', design: { aspiration: 'supercharger', boost: 9 } },
  { id: 'i4-carb', design: { fuelSystem: 'carburettor', valvetrain: 'ohv', valves: 2 } },
];
const designs = [...DESIGN_PRESETS.map((p) => ({ id: p.id, design: p.design })), ...extra];
const files: { id: string; path: string }[] = [];
for (const d of designs) {
  const { obj, mtl } = engineModelObj(engineModel({ ...DEFAULT_DESIGN, ...d.design }), `${d.id}.mtl`);
  writeFileSync(join(outDir, `${d.id}.obj`), obj);
  writeFileSync(join(outDir, `${d.id}.mtl`), mtl);
  files.push({ id: d.id, path: join(outDir, `${d.id}.obj`) });
}

const userData = mkdtempSync(join(tmpdir(), 'jbforge-engines-'));
const app = await _electron.launch({ args: ['.'], cwd: ROOT, env: { ...process.env, JBFORGE_USER_DATA: userData, JBFORGE_HARNESS: '1', ELECTRON_RENDERER_URL: '', JBFORGE_STEAM_ROOTS: '', JBFORGE_GITHUB_API: 'http://127.0.0.1:9/api', JBFORGE_GITHUB_RAW: 'http://127.0.0.1:9/raw' }, timeout: 30_000 });
const page = await app.firstWindow();
const win = await app.browserWindow(page);
await win.evaluate((w) => w.setContentSize(1280, 800));
const hook = (fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as unknown as { __jbforgeTest: Record<string, (...x: unknown[]) => unknown> }).__jbforgeTest[f as string]!(...(a as unknown[])), [fn, args] as const);
await page.waitForSelector('[data-view=home][data-testid=app-ready]', { timeout: 30_000 });
for (const f of files) {
  if (await page.locator('[data-view=editor]').count()) {
    await hook('runCommand', 'close');
    if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
  }
  await page.waitForSelector('[data-view=home][data-testid=app-ready]');
  await page.getByTestId('home-new').click();
  await page.getByTestId('newmod-name').fill(f.id);
  await hook('queueDialog', [f.path]);
  await page.getByTestId('newmod-create').click();
  await page.getByTestId('import-confirm').click();
  if (await page.getByTestId('classify-skip').isVisible({ timeout: 3000 }).catch(() => false)) await page.getByTestId('classify-skip').click();
  await page.waitForTimeout(1500);
  await hook('frameMeshes', '.');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, `${f.id}.png`) });
  console.log('shot', f.id);
}
await app.close();
