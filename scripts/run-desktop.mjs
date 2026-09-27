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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const MARKER = '[harness-triggered]';
const TIMEOUT = 15_000;

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
// Optional local smoke model (never committed), e.g. --model=scratch/test-models/sunburst2/sunburst2.dae
const smokeModel = process.argv.find((a) => a.startsWith('--model='))?.slice(8);
// Optional local project someone assigned by hand (opened read-only: never saved), e.g. --project="Template Car/hirochi_sunburst_6.jbforge"
const userProject = process.argv.find((a) => a.startsWith('--project='))?.slice(10);
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
      // "Import a 3D model right after creating" is on by default: answer its file dialog with Cancel.
      await hook(page, 'queueDialog', [null]);
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
      assert(saved.formatVersion === 7 && saved.meta.slug === 'harness_test_car', `saved at the current format (v${saved.formatVersion})`);
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
    id: 'import',
    name: 'import Z-up DAE fixture · dialog · viewport · undo/redo',
    async run({ page }) {
      const fixture = join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae');
      await hook(page, 'queueDialog', [fixture]);
      await page.getByTestId('toolbar-import').click();
      await page.getByTestId('import-dialog').waitFor();
      const dims = await page.getByTestId('import-dims').textContent();
      // Fixture extents in BeamNG space: Y −1.2…1, X −1…1, Z 0…0.5 (checks the app's orientation mapping end to end).
      assert(/Length\s*2\.20 m.*Width\s*2\.00 m.*Height\s*0\.50 m/.test(dims ?? ''), `size readout matches the fixture's BeamNG extents (${dims})`);
      await shot(page, 'import-dialog');
      await page.getByTestId('import-confirm').click();
      const waitMeshes = async (n) => {
        for (let i = 0; i < 100; i++) {
          const st = await hook(page, 'sceneStats');
          if (st.meshes === n && st.sources.every((x) => x.status === 'ready')) return st;
          await page.waitForTimeout(100);
        }
        throw new Error(`expected ${n} meshes, got ${JSON.stringify(await hook(page, 'sceneStats'))}`);
      };
      await waitMeshes(5);
      // Auto-classify summary: body, wheel FL and mirror are recognised; the two "dup" meshes aren't.
      await page.getByTestId('classify-summary').waitFor();
      const unassigned = await page.getByTestId('classify-unassigned').textContent();
      assert(unassigned === '2', `classify summary: 2 unrecognised meshes (got ${unassigned})`);
      await shot(page, 'classify-summary');
      await page.getByTestId('classify-skip').click();
      await page.getByTestId('scene-tree').getByText('fixture_wheel_FL').click();
      assert(JSON.stringify((await hook(page, 'sceneStats')).selection).includes('fixture_wheel_FL'), 'clicking a row selects the mesh');
      await page.waitForTimeout(200);
      await shot(page, 'import-fixture');
      await hook(page, 'runCommand', 'undo');
      await waitMeshes(0);
      await hook(page, 'runCommand', 'redo'); // re-adds the source → reloaded from disk by source sync
      await waitMeshes(5);
      await page.getByTestId('toolbar-save').click();
      for (let i = 0; i < 50 && !JSON.parse(readFileSync(projectFile, 'utf8')).sources.length; i++) await page.waitForTimeout(100);
      const saved = JSON.parse(readFileSync(projectFile, 'utf8'));
      assert(saved.formatVersion === 7 && saved.sources.length === 1 && saved.sources[0].format === 'dae', 'source saved in the project');
    },
  },
  {
    id: 'parts',
    name: 'auto-classify · assign · inspector · drag-reparent · undo',
    async run({ page }) {
      const parts = () => hook(page, 'partsState');
      await hook(page, 'offerAutoClassify');
      await page.getByTestId('classify-apply').click();
      let st = await parts();
      const kinds = st.parts.map((p) => `${p.taxonomyId}${p.position ? `_${p.position}` : ''}`).sort();
      assert(JSON.stringify(kinds) === JSON.stringify(['body', 'mirror', 'wheel_FL']), `auto-classify created body, mirror, wheel_FL (got ${kinds})`);
      const body = st.parts.find((p) => p.taxonomyId === 'body');
      assert(st.parts.every((p) => p === body || p.parentPartId), 'every part below the body has a parent');
      const tree = page.getByTestId('scene-tree');
      await tree.getByText('Body shell').click();
      await shot(page, 'scene-tree-parts');

      // Assign the unrecognised meshes through the search-first dialog.
      await tree.getByText('dup', { exact: true }).click();
      await tree.getByText('dup (2)', { exact: true }).click({ modifiers: ['Shift'] }); // duplicate names get " (2)"
      await page.getByTestId('scene-assign').click();
      await page.getByTestId('assign-search').fill('spoiler');
      await shot(page, 'assign-dialog');
      await page.getByTestId('assign-search').press('Enter');
      await page.getByTestId('assign-confirm').click();
      st = await parts();
      const spoiler = st.parts.find((p) => p.taxonomyId === 'spoiler');
      assert(spoiler && st.assigned === 5, `both dup meshes assigned to a new spoiler part (${JSON.stringify(st)})`);

      // Inspector edits are undoable document commands.
      await tree.getByText('Body shell').click();
      await page.getByTestId('inspector-display-name').fill('Main body');
      await page.getByTestId('inspector-display-name').press('Enter');
      st = await parts();
      assert(st.parts.find((p) => p.id === body.id).displayName === 'Main body', 'inspector renamed the part');
      await shot(page, 'inspector-part');

      // Drag-reparent: mirror under the wheel works; body under the wheel would loop and is refused.
      const mirror = st.parts.find((p) => p.taxonomyId === 'mirror');
      const wheel = st.parts.find((p) => p.taxonomyId === 'wheel');
      await page.locator(`[data-part-id="${mirror.id}"]`).dragTo(page.locator(`[data-part-id="${wheel.id}"]`));
      st = await parts();
      assert(st.parts.find((p) => p.id === mirror.id).parentPartId === wheel.id, 'drag-reparented the mirror under the wheel');
      await page.locator(`[data-part-id="${body.id}"]`).dragTo(page.locator(`[data-part-id="${wheel.id}"]`)); // wheel is below the body
      st = await parts();
      assert(st.parts.find((p) => p.id === body.id).parentPartId === null, 'cycle-creating drop refused');
      await hook(page, 'runCommand', 'undo'); // un-reparent the mirror
      st = await parts();
      assert(st.parts.find((p) => p.id === mirror.id).parentPartId !== wheel.id, 'undo restores the old parent');

      // Focus mode: double-click a part in the tree, everything else ghosts, Esc leaves.
      await page.locator(`[data-part-id="${wheel.id}"]`).getByText(wheel.displayName, { exact: true }).dblclick();
      st = await parts();
      assert(st.focus?.partId === wheel.id && st.activePart === wheel.id && st.focus.meshKeys.length > 0, `double-click focuses the wheel (${JSON.stringify(st.focus)})`);
      assert(await page.getByTestId('focus-pill').isVisible(), 'focus pill shows');
      await page.waitForTimeout(600); // camera glide
      await shot(page, 'focus-mode');
      await page.getByTestId('viewport').focus();
      await page.keyboard.press('Escape');
      st = await parts();
      assert(st.focus === null && !(await page.getByTestId('focus-pill').isVisible()), 'Esc leaves focus mode');
      // The body shell stands alone (it would otherwise bring the whole car); F focuses the selection.
      await tree.getByText('Main body').click();
      await page.getByTestId('viewport').focus();
      await page.keyboard.press('f');
      st = await parts();
      assert(st.focus?.partId === body.id && st.focus.parts.length === 1, `F focuses the selected root part on its own (${JSON.stringify(st.focus)})`);
      await page.getByTestId('focus-exit').click();
      st = await parts();
      assert(st.focus === null, 'pill button leaves focus mode');

      // Command palette: type a part name, Enter focuses it.
      await hook(page, 'runCommand', 'palette');
      await page.getByTestId('palette-input').fill('side mirror');
      await shot(page, 'command-palette');
      await page.getByTestId('palette-input').press('Enter');
      st = await parts();
      assert(st.focus?.partId === mirror.id, `palette focused the mirror (${JSON.stringify(st.focus)})`);
      await page.getByTestId('focus-exit').click();
      await hook(page, 'runCommand', 'shortcuts');
      assert(await page.getByTestId('shortcuts').isVisible(), 'shortcut sheet opens');
      await page.keyboard.press('Escape');
      await page.getByTestId('toolbar-save').click();
      for (let i = 0; i < 50 && !JSON.parse(readFileSync(projectFile, 'utf8')).parts.length; i++) await page.waitForTimeout(100);
      const saved = JSON.parse(readFileSync(projectFile, 'utf8'));
      assert(saved.parts.length === 4 && Object.keys(saved.assignments).length === 5, `parts + assignments saved (${saved.parts.length} parts)`);
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
      let reopened = await hook(ctx.page, 'projectState');
      for (let i = 0; i < 30 && reopened.undo === 0; i++) {
        await ctx.page.waitForTimeout(100);
        reopened = await hook(ctx.page, 'projectState');
      }
      assert(reopened.undo > 0 && !reopened.dirty, `undo history came back with the project (${reopened.undo} steps, dirty ${reopened.dirty})`);
      assert(existsSync(`${projectFile}.history`), 'history saved next to the project');
      // The fixture model lives outside the project folder: reading it needs consent first.
      await ctx.page.getByTestId('folders-allow').waitFor();
      await shot(ctx.page, 'folder-consent');
      assert((await hook(ctx.page, 'sceneStats')).meshes === 0, 'nothing outside the project folder is read before consent');
      await ctx.page.getByTestId('folders-allow').click();
      for (let i = 0; i < 100 && (await hook(ctx.page, 'sceneStats')).meshes !== 5; i++) await ctx.page.waitForTimeout(100);
      assert((await hook(ctx.page, 'sceneStats')).meshes === 5, 'imported meshes reloaded from disk after relaunch + consent');
      assert((await hook(ctx.page, 'partsState')).parts.length === 4, 'parts restored from the saved project');
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
  {
    id: 'split',
    name: 'split: connected pieces · undo/redo · plane-cut tool · re-applied after reopen',
    async run({ page }) {
      const model = join(ROOT, 'tests', 'fixtures', 'models', 'merged_boxes.obj');
      const splitProject = join(userData, 'projects', 'split-test.jbforge');
      const stats = () => hook(page, 'sceneStats');
      const waitMeshes = async (n) => {
        for (let i = 0; i < 100; i++) {
          const st = await stats();
          if (st.meshes === n && st.sources.every((x) => x.status === 'ready')) return st;
          await page.waitForTimeout(100);
        }
        throw new Error(`expected ${n} meshes, got ${JSON.stringify(await stats())}`);
      };
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Split Test');
      await hook(page, 'queueDialog', [model]);
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-confirm').click();
      await waitMeshes(1);
      const tree = page.getByTestId('scene-tree');

      // One click: three boxes in one object → three meshes.
      await tree.getByText('merged', { exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Split into connected pieces' }).click();
      let st = await waitMeshes(3);
      assert(JSON.stringify(st.meshNames.sort()) === JSON.stringify(['merged', 'merged_piece2', 'merged_piece3']), `pieces named after the mesh (${st.meshNames})`);
      await hook(page, 'runCommand', 'undo');
      await waitMeshes(1);
      await hook(page, 'runCommand', 'redo');
      await waitMeshes(3);
      await shot(page, 'split-connected');

      // Face-selection tool, plane-cut mode: half of one box.
      await tree.getByText('merged_piece2', { exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Split by selecting faces…' }).click();
      await page.getByTestId('split-toolbar').waitFor();
      await page.getByTestId('split-mode-plane').click();
      const count = await page.getByTestId('split-count').textContent();
      const picked = Number((count ?? '').split('/')[0].replace(/[^0-9]/g, ''));
      assert(picked > 0 && picked < 12, `plane selects part of the box (${count})`);
      await shot(page, 'split-plane-tool');
      await page.getByTestId('split-apply').click();
      await page.getByTestId('assign-search').waitFor(); // split results flow straight into assignment
      await page.keyboard.press('Escape');
      st = await waitMeshes(4);
      assert(st.meshNames.includes('merged_piece2_split'), `split result present (${st.meshNames})`);

      // Saved splits are re-applied when the project is reopened.
      await hook(page, 'queueDialog', [splitProject]);
      await page.getByTestId('toolbar-save').click();
      for (let i = 0; i < 50 && !existsSync(splitProject); i++) await page.waitForTimeout(100);
      const saved = JSON.parse(readFileSync(splitProject, 'utf8'));
      assert(saved.splits.length === 3, `3 splits saved (${saved.splits.length})`);
      await hook(page, 'runCommand', 'close');
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('recent-row').filter({ hasText: 'Split Test' }).locator('button').first().click();
      await page.getByTestId('folders-allow').click();
      st = await waitMeshes(4);
      assert(st.meshNames.includes('merged_piece2_split'), 'splits re-applied after reopening');
      const reopenedState = await hook(page, 'projectState');
      assert(!reopenedState.dirty, `reopened project is clean (${JSON.stringify(reopenedState)})`);
      await shot(page, 'split-reopened');
      await hook(page, 'runCommand', 'close'); // leave on the home screen for the next scenario
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
    },
  },
  {
    id: 'generate',
    name: 'generate structure: body/engine/bumper · overlay · view toggles · undo/redo',
    async run({ page }) {
      const model = join(ROOT, 'tests', 'fixtures', 'models', 'merged_boxes.obj');
      const stats = () => hook(page, 'sceneStats');
      const waitMeshes = async (n) => {
        for (let i = 0; i < 100; i++) {
          const st = await stats();
          if (st.meshes === n && st.sources.every((x) => x.status === 'ready')) return st;
          await page.waitForTimeout(100);
        }
        throw new Error(`expected ${n} meshes, got ${JSON.stringify(await stats())}`);
      };
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Generate Test');
      await hook(page, 'queueDialog', [model]);
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-confirm').click();
      await waitMeshes(1);
      const tree = page.getByTestId('scene-tree');
      await tree.getByText('merged', { exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Split into connected pieces' }).click();
      await waitMeshes(3);
      const assign = async (mesh, query, position) => {
        await tree.getByText(mesh, { exact: true }).click();
        await page.getByTestId('scene-assign').click();
        await page.getByTestId('assign-search').fill(query);
        await page.getByTestId('assign-search').press('Enter');
        if (position) await page.getByTestId(`assign-pos-${position}`).click();
        await page.getByTestId('assign-confirm').click();
      };
      await assign('merged', 'body shell');
      await assign('merged_piece2', 'engine');
      await assign('merged_piece3', 'bumper', 'F');
      await page.getByTestId('toolbar-generate').click();
      let st;
      for (let i = 0; i < 100; i++) {
        st = await hook(page, 'structureState');
        if (st?.nodes > 0) break;
        await page.waitForTimeout(100);
      }
      assert(st.nodes > 0 && st.generatedParts === 3, `3 parts generated (${JSON.stringify(st)})`);
      assert(st.uniqueIds && st.dangling === 0, 'node ids unique, every beam/triangle references a node');
      assert(st.byKind.attach > 0 && st.byKind.edge > 0, `edges and attachments present (${JSON.stringify(st.byKind)})`);
      assert(st.refNodes && Object.values(st.refNodes).every(Boolean), 'refNodes placed on the body');
      const bar = await page.getByTestId('status-bar').textContent();
      assert(bar.includes(`${st.nodes} nodes`), `status bar shows node count (${bar})`);
      await tree.getByText('Body shell').click();
      await page.getByTestId('structure-summary').waitFor();
      await shot(page, 'generate-structure');
      await page.getByTestId('toolbar-view-mesh').click();
      await page.waitForTimeout(150);
      await shot(page, 'generate-structure-only');
      await page.getByTestId('toolbar-view-mesh').click();
      assert(/F\/R \d+\/\d+ · L\/R \d+\/\d+/.test(await page.locator('[data-stat=balance]').textContent()), 'status bar shows the weight split');
      // jbeam preview shows the selected part's exported text.
      await page.getByTestId('toggle-jbeam-preview').click();
      await page.getByTestId('jbeam-preview').waitFor();
      const jbeamText = await page.getByTestId('jbeam-preview').textContent();
      assert(jbeamText.includes('generate_test_body.jbeam') && jbeamText.includes('"nodes"') && jbeamText.includes('"slotType"'), 'jbeam preview shows the body part');
      await shot(page, 'jbeam-preview');
      await page.getByTestId('toggle-jbeam-preview').click();
      await hook(page, 'runCommand', 'undo');
      assert((await hook(page, 'structureState')).nodes === 0, 'undo removes the generated structure');
      await hook(page, 'runCommand', 'redo');
      assert((await hook(page, 'structureState')).nodes === st.nodes, 'redo restores it');

      // Edit mode: pick, type an exact coordinate, nudge, symmetry, box select, delete, all undoable.
      await page.getByTestId('toolbar-edit').click();
      assert((await hook(page, 'editState')).active && (await page.getByTestId('edit-toolbar').isVisible()), 'edit mode on');
      const pair = await hook(page, 'mirrorPair');
      assert(pair, 'a node to edit');
      const [nl, nr] = pair; // nr is null when the test car has no mirrored pair
      const [before] = await hook(page, 'nodeInfo', [nl]);
      const [twinBefore] = nr ? await hook(page, 'nodeInfo', [nr]) : [null];
      await hook(page, 'editSelect', [nl]);
      await page.getByTestId('inspector-nodes').waitFor();
      const zField = page.getByLabel('Z position');
      await zField.fill(String((before.pos[2] + 0.05).toFixed(3)));
      await zField.press('Enter');
      let [moved] = await hook(page, 'nodeInfo', [nl]);
      assert(Math.abs(moved.pos[2] - (before.pos[2] + 0.05)) < 0.002 && moved.manual, `typed Z moved the node (${JSON.stringify(moved)})`);
      await page.getByTestId('viewport').focus();
      await page.keyboard.press('ArrowUp'); // screen-up snaps to +Z from the default camera
      [moved] = await hook(page, 'nodeInfo', [nl]);
      assert(Math.abs(moved.pos[2] - (before.pos[2] + 0.055)) < 0.002, `arrow key nudged 5 mm up (${moved.pos[2]})`);
      if (nr) {
        const [twin] = await hook(page, 'nodeInfo', [nr]);
        assert(Math.abs(twin.pos[2] - moved.pos[2]) < 1e-6 && Math.abs(twin.pos[0] + moved.pos[0]) < 1e-6, `symmetry moved the mirror partner (${JSON.stringify(twin)})`);
      }
      await shot(page, 'edit-mode');
      await hook(page, 'runCommand', 'undo');
      await hook(page, 'runCommand', 'undo');
      [moved] = await hook(page, 'nodeInfo', [nl]);
      const [twinAfter] = nr ? await hook(page, 'nodeInfo', [nr]) : [null];
      assert(JSON.stringify(moved.pos) === JSON.stringify(before.pos) && JSON.stringify(twinAfter) === JSON.stringify(twinBefore), 'undo puts the nodes back');
      // Box select across the whole viewport grabs nodes; an empty click clears.
      const vp = await page.getByTestId('viewport').boundingBox();
      await page.mouse.move(vp.x + 5, vp.y + 5);
      await page.mouse.down();
      await page.mouse.move(vp.x + vp.width - 5, vp.y + vp.height - 5, { steps: 5 });
      await page.mouse.up();
      const boxed = (await hook(page, 'editState')).nodes.length;
      assert(boxed > 10, `box select picked nodes (${boxed})`);
      await page.getByTestId('viewport').focus();
      await page.keyboard.press('Delete');
      assert((await hook(page, 'structureState')).nodes === st.nodes - boxed, 'Delete removes the selected nodes');
      await hook(page, 'runCommand', 'undo');
      assert((await hook(page, 'structureState')).nodes === st.nodes, 'undo restores them');
      // Topology: B connects two picked nodes, M merges them, both undo.
      const someNodes = (await hook(page, 'firstNodes', 2)) ?? [];
      assert(someNodes.length === 2, 'two nodes to connect');
      await hook(page, 'editSelect', someNodes);
      await page.getByTestId('viewport').focus();
      const beamsBefore = (await hook(page, 'structureState')).beams;
      await page.keyboard.press('b');
      const beamsAfter = (await hook(page, 'structureState')).beams;
      assert(beamsAfter === beamsBefore + 1 || beamsAfter === beamsBefore, `B connects the nodes (${beamsBefore} → ${beamsAfter})`);
      await page.keyboard.press('m');
      assert((await hook(page, 'structureState')).nodes === st.nodes - 1, 'M merges two nodes into one');
      await hook(page, 'runCommand', 'undo');
      if (beamsAfter !== beamsBefore) await hook(page, 'runCommand', 'undo');
      const restored = await hook(page, 'structureState');
      assert(restored.nodes === st.nodes && restored.beams === beamsBefore, 'undo restores nodes and beams');
      await page.getByTestId('edit-exit').click();
      assert(!(await hook(page, 'editState')).active, 'edit mode off');

      // Materials came in with the import; edit one and check the export carries it.
      await hook(page, 'applyPreset', 'materials');
      await page.getByTestId('materials-panel').waitFor();
      assert((await page.getByTestId('material-row').count()) >= 1, 'imported materials listed');
      await page.getByTestId('material-row').first().click();
      await page.getByTestId('material-editor').waitFor();
      const rough = page.getByLabel('Roughness value').first();
      await rough.fill('0.27');
      await rough.press('Enter');
      await page.waitForTimeout(200);
      await shot(page, 'materials-panel');
      // Library: put the Chrome preset on the selected body mesh.
      await page.getByTestId('scene-tree').getByText('Front bumper').click();
      await page.getByTestId('material-library').click();
      // The bundled materials pack (built locally into packs/materials; shipped inside the installer).
      if (existsSync(join(ROOT, 'packs', 'materials'))) {
        const packTab = page.getByRole('tab', { name: /Materials pack/ });
        let packCount = 0;
        for (let i = 0; i < 100 && packCount < 50; i++) {
          packCount = Number((await packTab.textContent())?.match(/\((\d+)\)/)?.[1] ?? 0);
          await page.waitForTimeout(100);
        }
        assert(packCount >= 50, `bundled material pack listed (${packCount})`);
        await page.getByLabel('Search the library').fill('carbon fiber 03');
        await page.waitForTimeout(800); // thumbnails load as rows appear
        await shot(page, 'material-pack');
        await page.getByLabel('Search the library').fill('');
      }
      await page.getByRole('tab', { name: /Presets/ }).click();
      await page.getByLabel('Search the library').fill('chrome');
      await shot(page, 'material-library');
      await page.getByTestId('library-apply').first().click();
      assert((await page.getByTestId('material-row').count()) >= 2, 'preset added as a project material');
      // Drag a material from the list onto a part in the tree: all its meshes take it.
      await page.getByTestId('material-row').filter({ hasText: 'chrome' }).dragTo(page.getByTestId('scene-tree').getByText('Engine', { exact: true }));
      const mm = await hook(page, 'meshMaterials');
      const engineKeys = Object.keys(mm).filter((k) => /engine/i.test(k) || mm[k].includes('chrome'));
      assert(Object.values(mm).filter((names) => names.includes('chrome')).length >= 2, `dropped material applied to the engine too (${JSON.stringify(mm)} ${engineKeys})`);
      await hook(page, 'applyPreset', 'modelling');

      // Export: validation passes, install writes an unpacked mod into the (fake) BeamNG user folder.
      await page.getByTestId('toolbar-export').click();
      await page.getByTestId('export-dialog').waitFor();
      assert((await page.getByTestId('export-errors').count()) === 0, `no export errors (${await page.getByTestId('export-dialog').textContent()})`);
      await shot(page, 'export-dialog');
      await page.getByTestId('export-install').click();
      await page.getByTestId('export-result').waitFor({ timeout: 30_000 });
      const vdir = join(fakeUserDir, 'mods', 'unpacked', 'generate_test', 'vehicles', 'generate_test');
      const files = readdirSync(vdir).sort();
      for (const f of ['generate_test.dae', 'generate_test.jbeam', 'generate_test_body.jbeam', 'generate_test_engine.jbeam', 'generate_test_bumper_F.jbeam', 'info.json', 'default.pc', 'info_default.json', 'main.materials.json', 'default.jpg']) {
        assert(files.includes(f), `exported ${f} (got ${files.join(', ')})`);
      }
      const pc = JSON.parse(readFileSync(join(vdir, 'default.pc'), 'utf8'));
      assert(pc.format === 2 && pc.model === 'generate_test' && pc.parts.generate_test_body === 'generate_test_body', `default.pc (${JSON.stringify(pc)})`);
      const dae = readFileSync(join(vdir, 'generate_test.dae'), 'utf8');
      const body = readFileSync(join(vdir, 'generate_test_body.jbeam'), 'utf8');
      const flexMesh = body.match(/\["(generate_test_[a-z0-9_]+)",\s*\["generate_test_body"\]\]/)?.[1];
      assert(flexMesh && dae.includes(`<node id="${flexMesh}" name="${flexMesh}"`), `body flexbody mesh ${flexMesh} is a DAE node`);
      assert(existsSync(join(fakeUserDir, 'mods', 'unpacked', 'generate_test', 'jbforge-export.json')), 'export marker written');
      const matsJson = JSON.parse(readFileSync(join(vdir, 'main.materials.json'), 'utf8'));
      assert(Object.values(matsJson).some((m) => m.Stages?.[0]?.roughnessFactor === 0.27 && m.version === 1.5), `edited material exported (${JSON.stringify(matsJson).slice(0, 300)})`);
      assert(matsJson.generate_test_chrome?.Stages?.[0]?.metallicFactor === 1, `library preset exported (${Object.keys(matsJson)})`);
      await shot(page, 'export-done');
      await page.getByRole('button', { name: 'Done' }).click();

      // Test Mode: live sim runs, scenarios report, exit restores the normal view.
      await page.getByTestId('toolbar-test').click();
      await page.getByTestId('test-panel').waitFor();
      await page.getByTestId('sim-run').click();
      await page.waitForTimeout(1200);
      const statsText = await page.getByTestId('sim-stats').textContent();
      const simulated = Number(statsText.match(/([\d.]+) s simulated/)?.[1] ?? 0);
      assert(simulated > 0.3, `live sim advanced (${statsText})`);
      await shot(page, 'test-mode-live');
      await page.getByTestId('sim-pause').click();
      await page.getByTestId('scenario-drop').click();
      await page.getByTestId('sim-result').waitFor({ timeout: 60_000 });
      const dropText = await page.getByTestId('sim-result').textContent();
      assert(/Dropped 1 m/.test(dropText), `drop scenario reported (${dropText})`);
      await page.getByTestId('scenario-pole').click();
      await page.waitForFunction(() => /km\/h into a pole/.test(document.querySelector('[data-testid=sim-result]')?.textContent ?? ''), null, { timeout: 60_000 });
      await shot(page, 'test-mode-crash');
      await page.getByTestId('sim-exit').click();
      await page.getByTestId('test-panel').waitFor({ state: 'detached' });
      await hook(page, 'runCommand', 'close');
      await page.getByTestId('unsaved-discard').click();
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
    },
  },
  {
    id: 'user-project',
    name: 'local hand-assigned project: rename from parts · export model (--project)',
    skip: () => !userProject,
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      const original = readFileSync(join(ROOT, userProject), 'utf8');
      await hook(page, 'queueDialog', [join(ROOT, userProject)]);
      await hook(page, 'runCommand', 'open');
      if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      let st;
      for (let i = 0; i < 1200; i++) {
        // The folder permission prompt can come up any time during loading.
        if (await page.getByTestId('folders-allow').isVisible().catch(() => false)) await page.getByTestId('folders-allow').click();
        st = await hook(page, 'sceneStats');
        if (st.meshes > 0 && st.sources.every((x) => x.status === 'ready')) break;
        await page.waitForTimeout(100);
      }
      assert(st.meshes > 100, `project's model loaded (${st.meshes} meshes)`);
      await hook(page, 'renameFromParts');
      const names = await hook(page, 'meshNameList');
      const parts = await hook(page, 'partNames');
      assert(names.includes('rear_left_halfshaft') && names.includes('rear_left_halfshaft_2'), `meshes named after parts (${names.slice(0, 12).join(', ')}…)`);
      assert(!parts.some((n) => /\(\d+\)$/.test(n)), `display names tidied (${parts.filter((n) => /\(\d+\)$/.test(n)).join(', ')})`);
      await page.getByTestId('scene-filter').fill('halfshaft');
      await page.waitForTimeout(200);
      await shot(page, 'user-project-renamed');
      await page.getByTestId('scene-filter').fill('');
      // Export the model both ways and check the files carry the new names.
      const glbPath = join(outDir, 'user-project.glb');
      const daePath = join(outDir, 'user-project.dae');
      await hook(page, 'queueDialog', [glbPath]);
      await hook(page, 'runCommand', 'exportModelGlb');
      for (let i = 0; i < 300 && !existsSync(glbPath); i++) await page.waitForTimeout(100);
      const glb = readFileSync(glbPath);
      assert(glb.toString('latin1', 0, 4) === 'glTF', 'wrote a binary glTF');
      const gltfJson = glb.toString('utf8', 20, 20 + glb.readUInt32LE(12));
      assert(gltfJson.includes('"rear_left_halfshaft_2"') && gltfJson.includes('"rear_left_halfshaft"'), 'glb meshes carry the new names');
      await hook(page, 'queueDialog', [daePath]);
      await hook(page, 'runCommand', 'exportModelDae');
      for (let i = 0; i < 300 && !existsSync(daePath); i++) await page.waitForTimeout(100);
      const dae = readFileSync(daePath, 'utf8');
      assert(dae.includes('name="rear_left_halfshaft_2"'), 'dae nodes carry the new names');
      assert(readFileSync(join(ROOT, userProject), 'utf8') === original, 'the project file itself was not touched');
      await hook(page, 'applyPreset', 'materials');
      await page.getByTestId('materials-panel').waitFor();
      const materialRows = await page.getByTestId('material-row').count();
      // Real-world duplicates (Aluminum-1, Aluminum-1.001…): merge them.
      await page.getByTestId('material-merge').click();
      const groups = await page.getByTestId('duplicate-groups').locator('li').count();
      await shot(page, 'user-project-duplicates');
      const beforeMerge = await hook(page, 'materialCount');
      if (groups) await page.getByTestId('merge-materials').click();
      else await page.keyboard.press('Escape');
      const afterMerge = await hook(page, 'materialCount');
      await page.waitForTimeout(1500); // textures load in the background
      await shot(page, 'user-project-materials');
      // The downloadable material pack, when built locally: import it and put a few of its materials on the car.
      const pack = readdirSync(join(ROOT, 'release')).find((f) => /^JBeam-Forge-Materials-.*\.zip$/.test(f));
      let packReport = null;
      if (pack) {
        await page.getByTestId('material-library').click();
        await hook(page, 'queueDialog', [join(ROOT, 'release', pack)]);
        await page.getByTestId('library-import').click();
        const mineTab = page.getByRole('tab', { name: /My library/ });
        let imported = 0;
        for (let i = 0; i < 1200 && imported < 40; i++) {
          imported = Number((await mineTab.textContent())?.match(/\((\d+)\)/)?.[1] ?? 0);
          await page.waitForTimeout(100);
        }
        assert(imported >= 40, `material pack imported (${imported} in the library)`);
        await shot(page, 'user-project-pack-library');
        await page.keyboard.press('Escape');
        const tree = page.getByTestId('scene-tree');
        for (const [partName, material] of [['Sunburst 6 Chassis', 'Gold Parametric'], ['Hood', 'Carbon Fiber 01'], ['Interior trim', 'Leather 01']]) {
          await page.getByTestId('scene-filter').fill(partName.split(' ')[0]);
          await tree.getByText(partName, { exact: true }).first().click();
          await page.getByTestId('material-library').click();
          await page.getByRole('tab', { name: /My library/ }).click();
          await page.getByLabel('Search the library').fill(material);
          await page.getByTestId('library-apply').first().click();
        }
        await page.getByTestId('scene-filter').fill('');
        await page.waitForTimeout(3000); // textures decode in the background
        await shot(page, 'user-project-pack-applied');
        const mm = await hook(page, 'meshMaterials');
        packReport = { imported, chassis: Object.entries(mm).find(([k]) => /Body_Main$/.test(k))?.[1] };
        assert(packReport.chassis?.every((n) => n.startsWith('gold')), `pack material on the chassis (${JSON.stringify(packReport.chassis)})`);
      }
      userReport = { pack: packReport, meshes: st.meshes, named: names.length, materials: materialRows, duplicateGroups: groups, materialsAfterMerge: afterMerge, beforeMerge, glbBytes: glb.length, daeBytes: dae.length };
    },
  },
  {
    id: 'smoke-model',
    name: 'local smoke model import (--model)',
    skip: () => !smokeModel,
    async run({ page }) {
      const model = join(ROOT, smokeModel);
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Smoke Model');
      await hook(page, 'queueDialog', [model]);
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-dialog').waitFor({ timeout: 180_000 });
      await shot(page, 'smoke-import-dialog');
      const started = Date.now();
      await page.getByTestId('import-confirm').click();
      let st;
      await page.getByTestId('classify-summary').waitFor({ timeout: 600_000 });
      for (let i = 0; i < 1800; i++) {
        st = await hook(page, 'sceneStats');
        if (st.meshes > 0 && st.sources.every((x) => x.status === 'ready')) break;
        await page.waitForTimeout(100);
      }
      assert(st.meshes > 0, `smoke model imported (${JSON.stringify(st)})`);
      const src = st.sources[0];
      const fps = await hook(page, 'measureFps', 2000);
      smokeReport = { meshes: st.meshes, triangles: src.stats?.triangles, importMs: src.stats?.totalMs, finishWallMs: Date.now() - started, fps: Math.round(fps), textures: src.textures && { loaded: src.textures.loaded, missing: src.textures.missing.length, unsupported: src.textures.unsupported } };
      await page.waitForTimeout(500);
      await shot(page, 'smoke-model');
      await shot(page, 'smoke-classify-summary');
      const summary = { detected: await page.getByTestId('classify-detected').textContent(), low: await page.getByTestId('classify-low').textContent(), unassigned: await page.getByTestId('classify-unassigned').textContent() };
      await page.getByTestId('classify-apply').click();
      const ps = await hook(page, 'partsState');
      smokeReport.classify = { ...summary, parts: ps.parts.length, assigned: ps.assigned };
      await page.waitForTimeout(300);
      await shot(page, 'smoke-model-parts');
      const bounds = await hook(page, 'meshBounds');
      writeFileSync(join(outDir, 'smoke-mesh-bounds.json'), JSON.stringify(bounds, null, 1));
      // Meshes straddling the centre line (both lower arms in one object) split into left and right.
      const straddling = bounds.filter((m) => m.min[0] < -0.2 && m.max[0] > 0.2 && !/body/i.test(m.name)).map((m) => m.key);
      if (straddling.length) {
        const halves = await hook(page, 'splitCentreLine', straddling);
        smokeReport.centreLine = { candidates: straddling.length, split: halves.length };
        assert(halves.length > 0, 'centre-line split produced right halves');
        await hook(page, 'runCommand', 'undo');
      }
      const genStarted = Date.now();
      await page.getByTestId('toolbar-generate').click();
      let gs;
      for (let i = 0; i < 1200; i++) {
        gs = await hook(page, 'structureState');
        if (gs?.generatedParts > 0) break;
        await page.waitForTimeout(100);
      }
      smokeReport.structure = { ...gs, wallMs: Date.now() - genStarted, refNodes: undefined };
      assert(gs.uniqueIds && gs.dangling === 0, `smoke structure consistent (${JSON.stringify(gs)})`);
      await page.waitForTimeout(300);
      await shot(page, 'smoke-model-structure');
      await page.getByTestId('scene-filter').fill('door');
      await page.waitForTimeout(200);
      await shot(page, 'smoke-model-filtered');
      // Focus mode on a real door: its glass, card and handles stay solid, the car ghosts.
      const door = (await hook(page, 'partsState')).parts.find((p) => p.taxonomyId === 'door' && p.position === 'FL' && !p.variantOf);
      if (door) {
        await page.locator(`[data-part-id="${door.id}"]`).getByText(door.displayName, { exact: true }).dblclick();
        await page.waitForTimeout(700);
        await shot(page, 'smoke-focus-door');
        const f = (await hook(page, 'partsState')).focus;
        smokeReport.focus = { part: door.displayName, parts: f?.parts.length, meshes: f?.meshKeys.length };
      }
    },
  },
];
let smokeReport = null;
let userReport = null;

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
    if (s.skip?.()) continue;
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
if (userReport) console.log(`
user project: ${JSON.stringify(userReport)}`);
if (smokeReport) console.log(`
smoke model: ${JSON.stringify(smokeReport, null, 2)}`);
if (badConsole.length) console.log(`FAIL  renderer console errors:\n      ${badConsole.join('\n      ')}`);
if (badLog.length) console.log(`FAIL  main.log error lines:\n      ${badLog.join('\n      ')}`);

const failed = results.some((r) => !r.ok) || badConsole.length > 0 || badLog.length > 0;
if (!failed) rmSync(userData, { recursive: true, force: true });
else console.log(`\nuserData kept for inspection: ${userData}`);
process.exit(failed ? 1 : 0);
