#!/usr/bin/env node
/**
 * Save a project fixture with the BUILT app (`npm run build` first), for the format-upgrade
 * tests: the practice car sorted into parts and generated, and (with a game install) an
 * engine designed from a preset and fitted. Run it BEFORE changing the project format, so
 * the fixture is what the version before saved.
 *
 *   node scripts/dev/save-fixture.mjs --out=tests/fixtures/jbforge/v21-engine-design.jbforge --beamng-install="C:/…/BeamNG.drive"
 */
import { _electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = resolve(ROOT, arg('out') ?? 'fixture.jbforge');
const install = arg('beamng-install');
const userData = mkdtempSync(join(tmpdir(), 'jbforge-fixture-'));
const fakeLocalAppData = join(userData, 'fake-localappdata');
mkdirSync(join(fakeLocalAppData, 'BeamNG', 'BeamNG.drive', 'current'), { recursive: true });
writeFileSync(join(fakeLocalAppData, 'BeamNG', 'BeamNG.drive.ini'), `version = 0.39.1.0\ninstallPath = ${install ?? userData}\\\n`);

const app = await _electron.launch({
  args: ['.'],
  cwd: ROOT,
  env: { ...process.env, JBFORGE_USER_DATA: userData, JBFORGE_HARNESS: '1', ELECTRON_RENDERER_URL: '', JBFORGE_LOCALAPPDATA: fakeLocalAppData, JBFORGE_STEAM_ROOTS: '', JBFORGE_GITHUB_API: 'http://127.0.0.1:9/api', JBFORGE_GITHUB_RAW: 'http://127.0.0.1:9/raw', JBFORGE_CONTENT_DIR: join(userData, 'content') },
  timeout: 30_000,
});
const page = await app.firstWindow();
const hook = (fn, ...args) => page.evaluate(([f, a]) => window.__jbforgeTest[f](...a), [fn, args]);
const invoke = (channel, req) => page.evaluate(async ([c, r]) => (await window.forge.invoke(c, r)).value, [channel, req]);
await page.waitForSelector('[data-view=home][data-testid=app-ready]', { timeout: 30_000 });
if (install) {
  await invoke('settings:update', { beamngInstallDir: install });
  for (let i = 0; i < 1800 && (await invoke('library:status')).scanning; i++) await page.waitForTimeout(100);
  for (let i = 0; i < 600 && !(await invoke('powertrain:catalogue')).length; i++) await page.waitForTimeout(100);
}
await page.getByTestId('home-tour').click();
await page.waitForSelector('[data-testid=tour-card]');
await page.getByRole('button', { name: 'Skip the tutorial' }).click();
for (let i = 0; i < 300 && (await hook('sceneStats')).meshes < 30; i++) await page.waitForTimeout(100);
await hook('applyPreset', 'modelling');
await page.getByTestId('scene-classify').click();
await page.getByTestId('classify-apply').click();
await page.getByTestId('toolbar-generate').click();
for (let i = 0; i < 1800 && !(await hook('projectDoc')).nodes.length; i++) await page.waitForTimeout(100);
if (install) {
  await page.getByTestId('workspace-engine').click();
  await page.getByTestId('engine-design').click();
  await page.getByTestId('engine-designer').waitFor();
  await page.getByTestId('engine-preset-i6').click();
  await page.waitForTimeout(500);
  await page.getByTestId('engine-design-fit').click();
  for (let i = 0; i < 600 && !(await hook('projectDoc')).powertrain.engine?.edits?.design; i++) await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
}
await hook('queueDialog', [out]);
await hook('runCommand', 'saveAs');
for (let i = 0; i < 100 && !(await hook('projectState')).filePath; i++) await page.waitForTimeout(100);
const st = await hook('projectState');
const doc = await hook('projectDoc');
console.log(`saved ${st.filePath}: ${doc.parts.length} parts, ${doc.nodes.length} nodes, engine ${doc.powertrain.engine ? doc.powertrain.engine.name : 'none'}${doc.powertrain.engine?.edits?.design ? ' (designed)' : ''}`);
await app.close();
