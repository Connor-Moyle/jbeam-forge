#!/usr/bin/env node
/**
 * Screenshots of the home screen and every workspace with the practice car loaded,
 * for looking over the interface. Runs the BUILT app (`npm run build` first) with a
 * throwaway userData folder.
 *
 * Usage: node scripts/dev/ui-shots.mjs [--out=artifacts/ui-shots/name] [--size=1600x900]
 */
import { _electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const outDir = join(ROOT, arg('out') ?? join('artifacts', 'ui-shots', new Date().toISOString().replace(/[:.]/g, '-')));
const [width, height] = (arg('size') ?? '1600x900').split('x').map(Number);
const userData = mkdtempSync(join(tmpdir(), 'jbforge-shots-'));
mkdirSync(outDir, { recursive: true });

// A fake install so the app doesn't go looking for the real game.
const fakeLocalAppData = join(userData, 'fake-localappdata');
const fakeInstall = join(userData, 'fake-beamng');
mkdirSync(join(fakeInstall, 'content', 'vehicles'), { recursive: true });
mkdirSync(join(fakeLocalAppData, 'BeamNG', 'BeamNG.drive', 'current'), { recursive: true });
writeFileSync(join(fakeInstall, 'BeamNG.drive.exe'), '');
writeFileSync(join(fakeInstall, 'integrity.json'), '{"buildinfo": "shots", "format": 1}');
writeFileSync(join(fakeLocalAppData, 'BeamNG', 'BeamNG.drive.ini'), `version = 0.39.1.0\ninstallPath = ${fakeInstall}\\\n`);

const app = await _electron.launch({
  args: ['.'],
  cwd: ROOT,
  env: {
    ...process.env,
    JBFORGE_USER_DATA: userData,
    JBFORGE_HARNESS: '1',
    ELECTRON_RENDERER_URL: '',
    JBFORGE_LOCALAPPDATA: fakeLocalAppData,
    JBFORGE_STEAM_ROOTS: '',
    JBFORGE_GITHUB_API: 'http://127.0.0.1:9/api',
    JBFORGE_GITHUB_RAW: 'http://127.0.0.1:9/raw',
    JBFORGE_CONTENT_DIR: join(userData, 'content'),
  },
  timeout: 30_000,
});
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const win = await app.browserWindow(page);
await win.evaluate((w, [cw, ch]) => w.setContentSize(cw, ch), [width, height]);

const hook = (fn, ...args) => page.evaluate(([f, a]) => window.__jbforgeTest[f](...a), [fn, args]);
let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`) });
  console.log('shot', name);
};
const attempt = async (name, fn) => {
  try {
    await fn();
  } catch (err) {
    console.log(`skipped ${name}: ${String(err.message).split('\n')[0]}`);
  }
};

await page.waitForSelector('[data-view=home][data-testid=app-ready]', { timeout: 30_000 });
// --settings='{"toolbarLabels":true,"propertiesSide":"left"}': shots with other interface settings.
const extra = arg('settings');
if (extra) await page.evaluate((patch) => window.forge.invoke('settings:update', JSON.parse(patch)), extra);
await shot('home');

await page.getByTestId('home-tour').click();
await page.waitForSelector('[data-testid=tour-card]');
await shot('tour-welcome');
await page.getByRole('button', { name: 'Skip the tutorial' }).click();
for (let i = 0; i < 300 && (await hook('sceneStats')).meshes < 30; i++) await page.waitForTimeout(100);
await hook('applyPreset', 'modelling');
await page.getByTestId('scene-classify').click();
await shot('classify-dialog');
await page.getByTestId('classify-apply').click();
await page.getByTestId('toolbar-generate').click();
for (let i = 0; i < 1800 && !(await hook('projectDoc')).nodes.length; i++) await page.waitForTimeout(100);
await page.waitForTimeout(1500);

for (const id of ['modelling', 'model', 'materials', 'jbeam', 'suspension', 'engine', 'moving', 'triggers', 'scripts', 'testing']) {
  await attempt(`workspace ${id}`, async () => {
    await page.getByTestId(`workspace-${id}`).click();
    await page.waitForTimeout(900);
    // A workspace's own tutorial offer gets in the way of the picture.
    const skip = page.getByRole('button', { name: /^Skip/ });
    if (await skip.count()) await skip.first().click();
    await shot(`workspace-${id}`);
    if (id === 'materials') {
      await page.getByTestId('material-row').first().click();
      await shot('materials-picked');
    }
  });
}

await page.getByTestId('workspace-modelling').click();
for (const id of ['toggle-skins', 'toggle-configs', 'toggle-features', 'toggle-paints', 'toggle-objects', 'toggle-reference', 'toggle-inspector', 'toggle-jbeam-preview']) {
  await attempt(id, async () => {
    await page.getByTestId(id).click();
    await shot(`panel-${id.replace('toggle-', '')}`);
  });
}
for (const [id, name] of [['open-settings', 'settings'], ['open-downloads', 'downloads'], ['open-help', 'help'], ['toolbar-export', 'export'], ['open-configs', 'configs-manager']]) {
  await attempt(name, async () => {
    await page.getByTestId(id).click();
    await shot(`dialog-${name}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });
}

writeFileSync(join(outDir, 'console-errors.txt'), errors.join('\n'));
console.log(`${n} screenshots in ${outDir}; ${errors.length} console errors`);
await app.close();
