#!/usr/bin/env node
/**
 * run-desktop harness (SPEC §2, §3.7): launches the BUILT app (`out/`) with an
 * isolated temp userData, drives it through scripted scenarios, captures
 * screenshots to artifacts/run-desktop/<timestamp>/, and fails on any
 * unexpected renderer console error or main-process `[error]` log line.
 *
 * Usage: npm run run-desktop            (build + run)
 *        node scripts/run-desktop.mjs   (run against existing out/)
 *        node scripts/run-desktop.mjs --only=crash,gl
 */
import { _electron } from 'playwright-core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const MARKER = '[harness-triggered]';
const TIMEOUT = 15_000;

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(ROOT, 'artifacts', 'run-desktop', stamp);
const userData = mkdtempSync(join(tmpdir(), 'jbforge-harness-'));

// A fake BeamNG install + %LOCALAPPDATA% so detection is deterministic and
// never touches (or depends on) the machine's real game install.
const fakeLocalAppData = join(userData, 'fake-localappdata');
const fakeInstall = join(userData, 'fake-beamng');
const fakeUserDir = join(fakeLocalAppData, 'BeamNG', 'BeamNG.drive', 'current');
mkdirSync(join(fakeInstall, 'content', 'vehicles'), { recursive: true });
mkdirSync(fakeUserDir, { recursive: true });
writeFileSync(join(fakeInstall, 'BeamNG.drive.exe'), '');
writeFileSync(join(fakeInstall, 'content', 'vehicles', 'fakecar.zip'), '');
writeFileSync(join(fakeInstall, 'integrity.json'), '{"buildinfo": "harness build 1", "format": 1}');
writeFileSync(join(fakeLocalAppData, 'BeamNG', 'BeamNG.drive.ini'), `version = 0.39.1.0\ninstallPath = ${fakeInstall}\\\n`);
mkdirSync(outDir, { recursive: true });

if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
  console.error('run-desktop: out/ missing — run `npm run build` first (or use `npm run run-desktop`).');
  process.exit(1);
}

const consoleErrors = [];
const consoleWarnings = [];
let shotIndex = 0;

async function launch() {
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
    },
    timeout: TIMEOUT,
  });
  const page = await app.firstWindow();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    else if (m.type() === 'warning') consoleWarnings.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.waitForSelector('[data-testid=app-ready]', { timeout: TIMEOUT });
  return { app, page };
}

async function shot(page, name) {
  const file = join(outDir, `${String(++shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

const hook = (page, fn, ...args) => page.evaluate(([f, a]) => window.__jbforgeTest[f](...a), [fn, args]);

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function openPanels(page) {
  return (await hook(page, 'openPanels')).sort();
}

const projectFile = join(userData, 'projects', 'harness_test_car.jbforge');

const scenarios = [
  {
    id: 'home',
    name: 'home screen → New Mod wizard → editor',
    async run({ page }) {
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.evaluate(() => document.fonts.ready);
      await shot(page, 'home-empty');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-wizard').waitFor();
      await page.getByTestId('newmod-name').fill('Harness Test Car');
      assert((await page.getByTestId('newmod-slug').inputValue()) === 'harness_test_car', 'slug derived from the name');
      await page.getByTestId('newmod-author').fill('Fatkiwi');
      await shot(page, 'newmod-wizard');
      await page.getByTestId('newmod-create').click();
      await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      const state = await hook(page, 'projectState');
      assert(state.name === 'Harness Test Car' && state.dirty === true && state.filePath === null, `new project is open and unsaved (${JSON.stringify(state)})`);
      const settingsJson = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
      assert(settingsJson.author === 'Fatkiwi', 'author remembered in settings');
    },
  },
  {
    id: 'shell',
    name: 'default shell renders',
    async run({ page }) {
      for (const p of ['viewport', 'scene', 'inspector']) await page.waitForSelector(`[data-panel=${p}]`);
      await page.waitForSelector('[data-testid=viewport][data-gl-state=running]');
      assert((await page.locator('[role=toolbar]').count()) === 1, 'toolbar present');
      assert((await page.locator('[data-testid=status-bar]').count()) === 1, 'status bar present');
      const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      assert(bodyFont.includes('Inter'), `body font is Inter (got ${bodyFont})`);
      await page.evaluate(() => document.fonts.ready);
      await shot(page, 'shell-modelling');
    },
  },
  {
    id: 'settings',
    name: 'BeamNG auto-detect + Settings modal',
    async run({ page }) {
      const settingsFile = join(userData, 'settings.json');
      const saved = () => {
        try {
          return JSON.parse(readFileSync(settingsFile, 'utf8'));
        } catch {
          return {};
        }
      };
      // First run: exactly one valid install → configured without asking.
      for (let i = 0; i < 50 && !saved().beamngInstallDir; i++) await page.waitForTimeout(100);
      assert(saved().beamngInstallDir === fakeInstall, `auto-detected install saved (got ${saved().beamngInstallDir})`);
      assert(saved().beamngUserDir === fakeUserDir, 'auto-detected user folder saved');

      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await page.getByTestId('beamng-status').filter({ hasText: '0.39.1 · 1 vehicle' }).waitFor();
      assert((await page.getByTestId('beamng-user-dir').textContent()) === fakeUserDir, 'user folder shown');
      await shot(page, 'settings-valid');

      await page.getByTestId('beamng-dir').fill(join(userData, 'not-a-game'));
      await page.getByTestId('beamng-status').filter({ hasText: 'Folder does not exist' }).waitFor();
      assert(await page.getByTestId('settings-save').isDisabled(), 'Save disabled for an invalid folder');
      await shot(page, 'settings-invalid');

      await page.getByTestId('beamng-dir').fill(fakeInstall);
      await page.getByTestId('beamng-status').filter({ hasText: '1 vehicle' }).waitFor();
      await page.getByRole('switch', { name: 'Debug logging' }).click();
      await page.getByTestId('settings-save').click();
      await page.getByTestId('settings-modal').waitFor({ state: 'detached' });
      for (let i = 0; i < 30 && saved().debugLogging !== true; i++) await page.waitForTimeout(100);
      assert(saved().debugLogging === true, 'debug logging saved');
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      assert(await page.getByRole('switch', { name: 'Debug logging' }).isChecked(), 'modal reflects saved settings');
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-modal').waitFor({ state: 'detached' });
    },
  },
  {
    id: 'kit',
    name: 'component kit gallery',
    async run({ page }) {
      await hook(page, 'togglePanel', 'kit-gallery');
      await page.waitForSelector('[data-testid=kit-gallery]');
      await hook(page, 'maximizePanel', 'kit-gallery');
      await page.waitForTimeout(300);
      await shot(page, 'kit-gallery');
      await page.getByRole('button', { name: 'Open modal' }).click();
      await page.waitForSelector('[role=dialog]');
      await page.waitForTimeout(300);
      await shot(page, 'kit-modal');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[role=dialog]', { state: 'detached' });
      await hook(page, 'exitMaximized');
      await hook(page, 'resetLayout');
      await page.waitForSelector('[data-panel=kit-gallery]', { state: 'detached' });
    },
  },
  {
    id: 'presets',
    name: 'layout presets',
    async run({ page }) {
      const expected = {
        materials: ['inspector', 'materials', 'scene', 'viewport'],
        testing: ['scene', 'test-results', 'viewport'],
        modelling: ['inspector', 'scene', 'viewport'],
      };
      for (const [preset, panels] of Object.entries(expected)) {
        await hook(page, 'applyPreset', preset);
        await page.waitForTimeout(200);
        const open = await openPanels(page);
        assert(JSON.stringify(open) === JSON.stringify(panels), `${preset} panels ${open} ≠ ${panels}`);
        await shot(page, `preset-${preset}`);
      }
    },
  },
  {
    id: 'crash',
    name: 'panel crash isolation + recovery',
    async run({ page }) {
      await hook(page, 'crashPanel', 'inspector');
      const card = page.locator('[data-panel=inspector] [data-testid=error-card]');
      await card.waitFor();
      assert((await page.locator('[data-testid=error-card]').count()) === 1, 'only the crashed panel shows an error card');
      await page.waitForSelector('[data-testid=viewport][data-gl-state=running]');
      assert((await page.locator('[data-panel=scene] [data-testid=empty-state]').count()) === 1, 'scene panel still alive');
      await shot(page, 'panel-crash');
      await card.getByRole('button', { name: 'Reload panel' }).click();
      await card.waitFor({ state: 'detached' });

      await hook(page, 'applyPreset', 'testing');
      await page.waitForTimeout(200);
      await hook(page, 'crashPanel', 'scene');
      const card2 = page.locator('[data-panel=scene] [data-testid=error-card]');
      await card2.waitFor();
      await card2.getByRole('button', { name: 'Reset layout' }).click();
      await page.waitForSelector('[data-testid=error-card]', { state: 'detached' });
      assert((await hook(page, 'preset')) === 'modelling', 'reset layout returns to modelling');
    },
  },
  {
    id: 'gl',
    name: 'WebGL context loss + guarded loop',
    async run({ page }) {
      await hook(page, 'loseGlContext');
      await page.waitForSelector('[data-testid=viewport][data-gl-state=lost]');
      await shot(page, 'gl-context-lost');
      await hook(page, 'restoreGlContext');
      await page.waitForSelector('[data-testid=viewport][data-gl-state=running]');

      await hook(page, 'injectFrameErrors', 2);
      await page.waitForTimeout(300);
      assert((await page.locator('[data-panel=viewport] [data-testid=error-card]').count()) === 0, '2 transient frame errors are survived');

      await hook(page, 'injectFrameErrors', 3);
      const card = page.locator('[data-panel=viewport] [data-testid=error-card]');
      await card.waitFor();
      await shot(page, 'gl-loop-fatal');
      await card.getByRole('button', { name: 'Reload panel' }).click();
      await page.waitForSelector('[data-testid=viewport][data-gl-state=running]');
    },
  },
  {
    id: 'gl-churn',
    name: 'viewport remounts release WebGL contexts',
    async run({ page }) {
      // Each preset switch remounts the viewport. Chromium caps live contexts at ~16
      // and evicts the oldest, so leaked contexts would eventually kill the live one.
      const presets = ['materials', 'testing', 'modelling'];
      for (let i = 0; i < 24; i++) {
        await hook(page, 'applyPreset', presets[i % presets.length]);
        await page.waitForSelector('[data-testid=viewport][data-gl-state=running]');
      }
      await page.waitForTimeout(500);
      await page.waitForSelector('[data-testid=viewport][data-gl-state=running]');
      const tooMany = consoleWarnings.filter((w) => /too many active webgl contexts/i.test(w));
      assert(tooMany.length === 0, `Chromium evicted WebGL contexts: ${tooMany[0]}`);
    },
  },
  {
    id: 'worker',
    name: 'worker logs + errors reach main.log',
    async run({ page }) {
      await hook(page, 'spawnSmokeWorker');
      const log = join(userData, 'logs', 'main.log');
      const has = (t) => existsSync(log) && readFileSync(log, 'utf8').includes(t);
      for (let i = 0; i < 30 && !has('smoke worker rejection'); i++) await page.waitForTimeout(100);
      assert(has('(worker:smoke)') && has('smoke worker online'), 'worker info line with scope in main.log');
      assert(has('smoke worker rejection'), 'worker unhandled rejection in main.log');
    },
  },
  {
    id: 'project',
    name: 'save (dialog) · undo/redo · dirty tracking',
    async run({ page }) {
      await hook(page, 'queueDialog', [projectFile]);
      await page.getByTestId('toolbar-save').click();
      for (let i = 0; i < 50 && !existsSync(projectFile); i++) await page.waitForTimeout(100);
      assert(existsSync(projectFile), 'project written via Save As dialog');
      const saved = JSON.parse(readFileSync(projectFile, 'utf8'));
      assert(saved.formatVersion === 2 && saved.meta.slug === 'harness_test_car', 'saved as a v2 project');
      let state = await hook(page, 'projectState');
      assert(state.dirty === false && state.filePath === projectFile, `clean after save (${JSON.stringify(state)})`);
      assert(!(await page.title()).includes('•'), 'title has no unsaved marker');

      await hook(page, 'renameProject', 'Renamed Car');
      state = await hook(page, 'projectState');
      assert(state.dirty && state.undo === 1, 'edit makes the project dirty');
      assert((await page.title()).includes('•'), 'title shows the unsaved marker');
      await hook(page, 'runCommand', 'undo');
      state = await hook(page, 'projectState');
      assert(state.name === 'Harness Test Car' && !state.dirty && state.redo === 1, 'undo returns to the saved state (clean)');
      await hook(page, 'runCommand', 'redo');
      state = await hook(page, 'projectState');
      assert(state.name === 'Renamed Car' && state.dirty, 'redo re-applies the edit');
      await hook(page, 'runCommand', 'undo');
      await shot(page, 'editor-saved-project');
    },
  },
  {
    id: 'persist',
    name: 'layout + recent project persist across relaunch',
    async run(ctx) {
      await hook(ctx.page, 'applyPreset', 'materials');
      await hook(ctx.page, 'flushLayout');
      const file = join(userData, 'layouts', 'current.json');
      const storedPreset = () => {
        try {
          return JSON.parse(readFileSync(file, 'utf8')).preset;
        } catch {
          return null;
        }
      };
      for (let i = 0; i < 50 && storedPreset() !== 'materials'; i++) await ctx.page.waitForTimeout(100);
      assert(storedPreset() === 'materials', `stored preset = materials (got ${storedPreset()})`);
      await ctx.app.close();
      Object.assign(ctx, await launch());
      // Relaunch lands on home; the project is in Recent (with its thumbnail) and reopens from there.
      await ctx.page.waitForSelector('[data-view=home][data-testid=app-ready]');
      const row = ctx.page.getByTestId('recent-row').filter({ hasText: 'Harness Test Car' });
      await row.waitFor();
      assert((await row.locator('img').count()) === 1, 'recent entry has a viewport thumbnail');
      await shot(ctx.page, 'home-recent');
      await row.locator('button').first().click();
      await ctx.page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      assert((await hook(ctx.page, 'projectState')).filePath === projectFile, 'reopened the saved project');
      assert((await hook(ctx.page, 'preset')) === 'materials', 'preset restored after relaunch');
      const open = await openPanels(ctx.page);
      assert(open.includes('materials'), `materials panel restored (got ${open})`);
      await shot(ctx.page, 'relaunch-restored');
    },
  },
  {
    id: 'unsaved',
    name: 'unsaved-changes guard on close',
    async run({ page }) {
      await hook(page, 'renameProject', 'Unsaved Name');
      await hook(page, 'runCommand', 'close');
      await page.getByTestId('unsaved-discard').waitFor();
      await shot(page, 'unsaved-prompt');
      await page.getByTestId('unsaved-discard').click();
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      const saved = JSON.parse(readFileSync(projectFile, 'utf8'));
      assert(saved.meta.name === 'Harness Test Car', 'discarded edits were not written');
    },
  },
];

function unexpectedLogErrors() {
  const logFile = join(userData, 'logs', 'main.log');
  if (!existsSync(logFile)) return ['main.log was not created'];
  return readFileSync(logFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('[error]') && !l.includes(MARKER));
}

const results = [];
let ctx;
try {
  ctx = await launch();
  for (const s of scenarios) {
    if (only && !only.includes(s.id)) continue;
    const started = Date.now();
    try {
      await s.run(ctx);
      results.push({ id: s.id, name: s.name, ok: true, ms: Date.now() - started });
    } catch (err) {
      await shot(ctx.page, `FAILED-${s.id}`).catch(() => undefined);
      results.push({ id: s.id, name: s.name, ok: false, ms: Date.now() - started, error: err.message });
    }
  }
} catch (err) {
  results.push({ id: 'launch', name: 'launch', ok: false, error: err.message });
} finally {
  await ctx?.app.close().catch(() => undefined);
}

const badConsole = consoleErrors.filter((e) => !e.includes(MARKER));
const badLog = unexpectedLogErrors();

console.log(`\nrun-desktop — screenshots in ${outDir}\n`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ms !== undefined ? ` (${r.ms} ms)` : ''}${r.error ? `\n      ${r.error}` : ''}`);
if (badConsole.length) console.log(`FAIL  renderer console errors:\n      ${badConsole.join('\n      ')}`);
if (badLog.length) console.log(`FAIL  main.log error lines:\n      ${badLog.join('\n      ')}`);

const failed = results.some((r) => !r.ok) || badConsole.length > 0 || badLog.length > 0;
if (!failed) rmSync(userData, { recursive: true, force: true });
else console.log(`\nuserData kept for inspection: ${userData}`);
process.exit(failed ? 1 : 0);
