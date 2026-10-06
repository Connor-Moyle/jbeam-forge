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
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import yazl from 'yazl';
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
// Optional local Assetto Corsa car folder, e.g. --ac-car="L:/…/assettocorsa/content/cars/ks_mazda_mx5_cup"
const acCar = process.argv.find((a) => a.startsWith('--ac-car='))?.slice(9);
// Optional real BeamNG install for the suspension-parts scenario, e.g. --beamng-install="I:/…/BeamNG.drive"
const realInstall = process.argv.find((a) => a.startsWith('--beamng-install='))?.slice(17);
/** --soak=<minutes>: leave the practice car open that long, moving the camera, and report how the app keeps up. */
const soakMinutes = Number(process.argv.find((a) => a.startsWith('--soak='))?.slice(7) ?? 0);
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

// A fake GitHub for the Downloads window: releases, tags, and the two content repositories,
// built with the real repository builder into the temp folder.
const fakeGh = join(userData, 'fake-github');
const appVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
/** The project format this build saves (read from the schema, so a new format needs no harness edit). */
const FORMAT_VERSION = Number(/CURRENT_PROJECT_VERSION = (\d+)/.exec(readFileSync(join(ROOT, 'src', 'shared', 'project', 'schema.ts'), 'utf8'))[1]);
execFileSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(ROOT, 'tsconfig.node.json'), join(ROOT, 'scripts', 'lib', 'fake-content.ts'), fakeGh, appVersion], { cwd: ROOT, stdio: 'ignore' });
const ghHits = [];
const ghServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  ghHits.push(url.pathname);
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  const base = `http://127.0.0.1:${ghServer.address().port}`;
  let m;
  if (/^\/api\/repos\/[^/]+\/jbeam-forge\/releases$/.test(url.pathname)) return send(200, readFileSync(join(fakeGh, 'releases.json'), 'utf8').replaceAll('ASSETS/', `${base}/assets/`));
  // One content repository, a folder per kind (Connor-Moyle/jbeam-forge-content/textures …).
  if (/^\/api\/repos\/[^/]+\/jbeam-forge-content\/tags$/.test(url.pathname)) return send(200, JSON.stringify([{ name: 'v2.0.0' }, { name: 'v1.0.0' }]));
  if ((m = /^\/raw\/[^/]+\/jbeam-forge-content\/[^/]+\/(textures|meshes)\/(.+)$/.exec(url.pathname))) {
    const file = join(fakeGh, 'repos', m[1], ...decodeURIComponent(m[2]).split('/'));
    return existsSync(file) ? send(200, readFileSync(file), 'application/octet-stream') : send(404, 'not found', 'text/plain');
  }
  if ((m = /^\/assets\/([\w.-]+)$/.exec(url.pathname)) && existsSync(join(fakeGh, 'assets', m[1]))) return send(200, readFileSync(join(fakeGh, 'assets', m[1])), 'application/octet-stream');
  send(404, 'not found', 'text/plain');
});
await new Promise((r) => ghServer.listen(0, '127.0.0.1', r));
const ghBase = `http://127.0.0.1:${ghServer.address().port}`;
let shotIndex = 0;

async function launch() {
  const app = await _electron.launch({
    // JBFORGE_SWIFTSHADER=1: software WebGL, for machines without a usable GPU (CI containers, VMs).
    // Linux CI has no root to set up Chromium's sandbox helper.
    args: ['.', ...(process.env.JBFORGE_SWIFTSHADER ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: ROOT,
    env: {
      ...process.env,
      JBFORGE_USER_DATA: userData,
      JBFORGE_HARNESS: '1',
      ELECTRON_RENDERER_URL: '',
      JBFORGE_LOCALAPPDATA: fakeLocalAppData,
      JBFORGE_STEAM_ROOTS: '',
      JBFORGE_GITHUB_API: `${ghBase}/api`,
      JBFORGE_GITHUB_RAW: `${ghBase}/raw`,
      JBFORGE_CONTENT_DIR: join(userData, 'content'),
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
/** A save's file lands before the renderer hears back from main: wait until it has recorded the save. */
async function waitSaved(page) {
  for (let i = 0; i < 50; i++) {
    const st = await hook(page, 'projectState');
    if (st.filePath && !st.dirty) return st;
    await page.waitForTimeout(100);
  }
  return hook(page, 'projectState');
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function openPanels(page) {
  return (await hook(page, 'openPanels')).sort();
}


/** A small RGBA PNG (a gradient), written without any image library. */
function writePng(path, w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = (x * 255) / (w - 1);
      raw[o + 1] = (y * 255) / (h - 1);
      raw[o + 2] = 90;
      raw[o + 3] = 255;
    }
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
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
      await page.waitForTimeout(200);
      // Opens at the top: the kinds of mod in view, the name field focused.
      const opened = await page.evaluate(() => {
        const card = document.querySelector('[data-testid=newmod-kind-vehicle]').getBoundingClientRect();
        const body = document.querySelector('[data-testid=newmod-wizard]').closest('[role=dialog]').getBoundingClientRect();
        return { cardTop: card.top, bodyTop: body.top, focused: document.activeElement?.getAttribute('data-testid') };
      });
      assert(opened.cardTop > opened.bodyTop && opened.focused === 'newmod-name', `wizard opens at the top with the name focused (${JSON.stringify(opened)})`);
      await shot(page, 'newmod-wizard-open');
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
      // Settings are written in the background: give the write a moment to land.
      let settingsJson = {};
      for (let i = 0; i < 30 && settingsJson.author !== 'Fatkiwi'; i++) {
        if (i) await page.waitForTimeout(100);
        settingsJson = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
      }
      assert(settingsJson.author === 'Fatkiwi', 'author remembered in settings');
    },
  },
  {
    id: 'downloads',
    name: 'downloads: app versions (update + roll back), textures and meshes (single, all, remove)',
    async run({ page }) {
      const invoke = (channel, req) => page.evaluate(async ([c, r]) => (await window.forge.invoke(c, r)).value, [channel, req]);
      await page.getByTestId('open-downloads').click();
      await page.getByTestId('downloads-window').waitFor();
      // JBeam Forge: a newer version is out; download its installer, checked against its size.
      await page.getByTestId('update-latest').waitFor();
      assert((await page.getByTestId('downloads-app').textContent()).includes('is out'), 'newer version offered');
      await shot(page, 'downloads-app');
      await page.getByTestId('update-download').first().click();
      await page.getByText(/is downloaded and checked/).waitFor();
      const updates = join(userData, 'updates');
      // This system's installer: the Setup exe on Windows, the .deb on Linux.
      const installerName = process.platform === 'linux' ? /_amd64\.deb$/ : /Setup-.*\.exe$/;
      assert(readdirSync(updates).some((f) => installerName.test(f)), `installer downloaded (${readdirSync(updates)})`);
      // Roll back: the older version's installer.
      await page.getByTestId('update-older-toggle').click();
      await page.getByTestId('update-older').waitFor();
      await shot(page, 'downloads-rollback');
      const older = page.getByTestId('update-older').locator('li').last();
      await older.getByTestId('update-rollback').first().click();
      await page.getByText(/is downloaded and checked/).waitFor();
      assert(readdirSync(updates).length >= 2, `older version downloaded too (${readdirSync(updates)})`);

      // Textures: one item, then all.
      await page.getByRole('tab', { name: /Textures/ }).click();
      await page.getByTestId('textures-items').waitFor();
      assert((await page.getByTestId('content-item').count()) === 3, 'three texture sets listed');
      await page.getByTestId('content-item').filter({ hasText: 'Harness Candy Red' }).getByTestId('content-item-download').click();
      for (let i = 0; i < 100; i++) {
        const info = await invoke('content:info');
        if (Object.keys(info.textures.installed.items).length === 1) break;
        await page.waitForTimeout(100);
      }
      const content = join(userData, 'content');
      assert(existsSync(join(content, 'textures', 'Paint', 'Harness Candy Red', 'material.json')), 'single item unpacked beside the others');
      await page.getByTestId('textures-download-all').click();
      for (let i = 0; i < 100 && Object.keys((await invoke('content:info')).textures.installed.items).length < 3; i++) await page.waitForTimeout(100);
      await page.getByText('All downloaded').waitFor();
      await shot(page, 'downloads-textures');
      const pack = await invoke('materials:pack');
      assert(['Harness Candy Red', 'Harness Pearl White', 'Harness Brushed Steel'].every((n) => pack.some((m) => m.name === n)), 'downloaded textures are in the material library');

      // Meshes: all at once, then they're in the objects list.
      await page.getByRole('tab', { name: /Meshes/ }).click();
      await page.getByTestId('meshes-items').waitFor();
      await page.getByTestId('meshes-download-all').click();
      for (let i = 0; i < 100 && Object.keys((await invoke('content:info')).meshes.installed.items).length < 2; i++) await page.waitForTimeout(100);
      await page.getByText('All downloaded').waitFor();
      const objects = await invoke('objects:list');
      assert(objects.some((o) => o.name === 'Harness Caliper') && objects.some((o) => o.name === 'Harness Gauge'), 'downloaded meshes are in the objects list');
      await shot(page, 'downloads-meshes');

      // Remove everything again (later scenarios count the library).
      await page.getByTestId('meshes-remove-all').click();
      await page.getByRole('tab', { name: /Textures/ }).click();
      await page.getByTestId('textures-remove-all').click();
      for (let i = 0; i < 50; i++) {
        const info = await invoke('content:info');
        if (!Object.keys(info.textures.installed.items).length && !Object.keys(info.meshes.installed.items).length) break;
        await page.waitForTimeout(100);
      }
      assert(!existsSync(join(content, 'textures', 'Paint')), 'removed from the content folder');
      assert(!(await invoke('materials:pack')).some((m) => m.name === 'Harness Candy Red'), 'removed from the library');
      await page.keyboard.press('Escape');
      await page.getByTestId('downloads-window').waitFor({ state: 'detached' });
      assert(ghHits.some((h) => h.includes('/releases')) && ghHits.some((h) => h.includes('/items/')), 'went through the (fake) GitHub');
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

      // Library folders: add one of each, save, and the scan adds them to the library.
      const libFixtures = join(ROOT, 'tests', 'fixtures', 'library');
      await hook(page, 'queueDialog', [join(libFixtures, 'materials')]);
      await page.getByTestId('library-folders-materials').getByRole('button', { name: 'Add folder' }).click();
      await hook(page, 'queueDialog', [join(libFixtures, 'objects')]);
      await page.getByTestId('library-folders-objects').getByRole('button', { name: 'Add folder' }).click();
      await page.getByTestId('settings-save').click();
      await page.getByTestId('settings-modal').waitFor({ state: 'detached' });
      const invoke = (channel) => page.evaluate(async (c) => (await window.forge.invoke(c)).value, channel);
      let lib;
      for (let i = 0; i < 300; i++) {
        lib = await invoke('library:status');
        if (!lib.scanning && lib.folders.filter((f) => f.kind !== 'beamng').length === 2) break;
        await page.waitForTimeout(100);
      }
      const own = lib.folders.filter((f) => f.kind !== 'beamng');
      assert(own.length === 2 && own.every((f) => f.count === 1 && !f.error), `library folders scanned (${JSON.stringify(lib)})`);
      assert((await invoke('materials:pack')).some((m) => m.name === 'Test Steel' && m.category === 'Metals'), 'scanned material in the library');
      assert((await invoke('objects:list')).some((o) => o.name === 'Test 01' && o.category === 'Brake Calipers'), 'scanned object in the objects list');
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await page.getByTestId('library-folders-objects').getByText('1 objects').waitFor();
      await page.waitForTimeout(300);
      await shot(page, 'settings-library-folders');

      // Dropdowns inside Settings open on top of it and change the setting (real clicks).
      const fps = page.getByRole('combobox', { name: 'Frame-rate limit' });
      await fps.scrollIntoViewIfNeeded();
      await fps.click();
      await page.getByRole('option', { name: '30 fps' }).click();
      const speed = page.getByRole('combobox', { name: 'Speed unit' });
      await speed.scrollIntoViewIfNeeded();
      await speed.click();
      await page.getByRole('option', { name: /mph/ }).click();
      await shot(page, 'settings-dropdowns');
      await page.getByTestId('settings-save').click();
      await page.getByTestId('settings-modal').waitFor({ state: 'detached' });
      for (let i = 0; i < 30 && saved().maxFps !== 30; i++) await page.waitForTimeout(100);
      assert(saved().maxFps === 30, `frame-rate limit picked from its dropdown and saved (${saved().maxFps})`);
      assert(saved().speedUnit === 'mph', `speed unit picked from its dropdown and saved (${saved().speedUnit})`);
      await page.evaluate(() => window.forge.invoke('settings:update', { maxFps: 0, speedUnit: 'kmh' }));
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
        materials: ['materials', 'scene', 'viewport'],
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
      assert(saved.formatVersion === FORMAT_VERSION && saved.meta.slug === 'harness_test_car', `saved at the current format (v${saved.formatVersion})`);
      let state = await waitSaved(page);
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
      await waitSaved(page);
      const saved = JSON.parse(readFileSync(projectFile, 'utf8'));
      assert(saved.formatVersion === FORMAT_VERSION && saved.sources.length === 1 && saved.sources[0].format === 'dae', 'source saved in the project');
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
      await waitSaved(page);
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
      await waitSaved(page);
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
      await hook(page, 'applyPreset', 'modelling'); // the Inspector (an earlier scenario leaves Materials open)
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
        await page.waitForTimeout(3000); // thumbnails render once their textures load
        await shot(page, 'material-pack');
        // Add a textured pack material to the project and look at it in the editor's live preview.
        await page.getByTestId('library-apply').first().click();
        await page.getByTestId('material-preview').waitFor();
        await page.waitForTimeout(2000);
        await shot(page, 'material-live-preview');
        await page.getByTestId('material-library').click();
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

      // Channel views: every material seen as base colour, roughness, metallic, AO, normals and a UV checker (shader errors fail the run).
      for (const label of ['Base colour', 'Roughness', 'Metallic', 'Ambient occlusion', 'Normals', 'UV checker', 'Shaded']) {
        await page.getByLabel('Material channel view').click();
        await page.getByRole('option', { name: label }).click();
        await page.waitForTimeout(250);
        if (label === 'Roughness' || label === 'Normals' || label === 'UV checker') await shot(page, `channel-${label.toLowerCase().replace(/ /g, '-')}`);
      }

      // Configurations: a second version of the car with the front bumper left off.
      await page.getByTestId('toggle-configs').click();
      await page.getByTestId('configs-panel').waitFor();
      await page.getByTestId('config-add').click();
      await page.getByTestId('config-name').fill('Stripped');
      await page.getByLabel('Front bumper part').click();
      await page.getByRole('option', { name: '(empty)' }).click();
      await page.getByTestId('config-preview').click();
      await page.waitForTimeout(400);
      await shot(page, 'config-stripped');
      await page.getByTestId('config-preview').click();
      await page.getByTestId('toggle-configs').click();

      // Extras: plates on the bumper and the back, a tow hitch, and a paint design recolouring a material.
      await page.getByTestId('toggle-features').click();
      await page.getByTestId('features-panel').waitFor();
      for (const kind of ['plateFront', 'plateRear', 'hitch']) await page.getByTestId(`feature-${kind}`).getByRole('switch').click();
      assert((await page.getByTestId('feature-plateFront').getByLabel('Front plate part').textContent()).includes('Front bumper'), 'front plate goes on the front bumper');
      await page.getByTestId('skin-add').click();
      await page.getByTestId('skin-name').fill('Race');
      await page.getByTestId('skin-materials').locator('input[type=color]').first().fill('#d02020');
      await shot(page, 'features-panel');
      await page.getByTestId('toggle-features').click();

      // Paints: a three-paint scheme, then the brush on the car (these boxes have no UVs or paint material, so it says why instead).
      await page.getByTestId('toggle-paints').click();
      await page.getByTestId('paints-panel').waitFor();
      await page.getByTestId('paint-scheme').filter({ hasText: 'Endurance blue and orange' }).click();
      assert((await page.getByTestId('paint-row').count()) === 3, 'scheme added three paints');
      await page.getByRole('switch', { name: 'Paint on the car' }).click();
      const vpBox = await page.locator('[data-panel=viewport] canvas').first().boundingBox();
      await page.mouse.click(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
      await page.waitForTimeout(300);
      await shot(page, 'paints-panel');
      await page.getByRole('switch', { name: 'Paint on the car' }).click();
      await page.getByTestId('toggle-paints').click();

      // Two-sided: chrome outside, another material on the back faces.
      await hook(page, 'applyPreset', 'materials');
      await hook(page, 'maximizePanel', 'materials'); // room for the whole editor
      await page.getByTestId('material-row').filter({ hasText: 'chrome' }).first().click();
      await page.getByLabel('Sides').click();
      const insideOption = page.getByRole('option', { name: /^Different inside: / }).first();
      const insideName = (await insideOption.textContent()).replace('Different inside: ', '').trim();
      await insideOption.click();
      await shot(page, 'material-two-sided');
      await hook(page, 'exitMaximized');
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
      for (const f of ['generate_test_licenseplate_F.jbeam', 'generate_test_licenseplate_R.jbeam', 'generate_test_towhitch.jbeam', 'generate_test_skin_race.jbeam']) assert(files.includes(f), `exported ${f}`);
      assert(readFileSync(join(vdir, 'generate_test_bumper_F.jbeam'), 'utf8').includes('"generate_test_licenseplate_F"'), 'front plate slot on the bumper');
      assert(Object.keys(JSON.parse(readFileSync(join(vdir, 'main.materials.json'), 'utf8'))).some((k) => k.endsWith('.skin.race')), 'paint design material exported');
      const stripped = JSON.parse(readFileSync(join(vdir, 'stripped.pc'), 'utf8'));
      assert(stripped.parts.generate_test_bumper_F === '' && existsSync(join(vdir, 'info_stripped.json')), `stripped.pc exported (${JSON.stringify(stripped)})`);
      const pc = JSON.parse(readFileSync(join(vdir, 'default.pc'), 'utf8'));
      assert(pc.format === 2 && pc.model === 'generate_test' && pc.parts.generate_test_body === 'generate_test_body', `default.pc (${JSON.stringify(pc)})`);
      const dae = readFileSync(join(vdir, 'generate_test.dae'), 'utf8');
      const info = JSON.parse(readFileSync(join(vdir, 'info.json'), 'utf8'));
      assert(Object.keys(info.paints ?? {}).length === 3 && info.defaultPaintName1 === 'Frozen Blue', `factory paints in info.json (${JSON.stringify(info).slice(0, 300)})`);
      assert(Array.isArray(pc.paints) && pc.paints.length === 3 && pc.paints[1].baseColor.length === 4, `paints in default.pc (${JSON.stringify(pc.paints)})`);
      const insideExport = `generate_test_${insideName.replace(/[^A-Za-z0-9_]+/g, '_')}`.toLowerCase();
      assert(new RegExp(`<triangles material="${insideExport}`, 'i').test(dae), `back faces written with the inside material ${insideExport}`);
      const body = readFileSync(join(vdir, 'generate_test_body.jbeam'), 'utf8');
      const flexMesh = body.match(/\["(generate_test_[a-z0-9_]+)",\s*\["generate_test_body"\]\]/)?.[1];
      assert(flexMesh && dae.includes(`<node id="${flexMesh}" name="${flexMesh}"`), `body flexbody mesh ${flexMesh} is a DAE node`);
      assert(existsSync(join(fakeUserDir, 'mods', 'unpacked', 'generate_test', 'jbforge-export.json')), 'export marker written');
      // Kept with the screenshots so `npm run regress` can lint it the way the game reads it.
      cpSync(join(fakeUserDir, 'mods', 'unpacked', 'generate_test'), join(outDir, 'exported-mod'), { recursive: true });
      const matsJson = JSON.parse(readFileSync(join(vdir, 'main.materials.json'), 'utf8'));
      assert(Object.values(matsJson).some((m) => m.Stages?.[0]?.roughnessFactor === 0.27 && m.version === 1.5), `edited material exported (${JSON.stringify(matsJson).slice(0, 300)})`);
      assert(matsJson.generate_test_chrome?.Stages?.[0]?.metallicFactor === 1, `library preset exported (${Object.keys(matsJson)})`);

      await shot(page, 'export-done');
      await page.getByRole('button', { name: 'Done' }).click();
      // Studio pictures at the chosen size (1280×720 by default), kept with the screenshots.
      const jpg = readFileSync(join(vdir, 'default.jpg'));
      const sof = jpg.indexOf(Buffer.from([0xff, 0xc0])) >= 0 ? jpg.indexOf(Buffer.from([0xff, 0xc0])) : jpg.indexOf(Buffer.from([0xff, 0xc2]));
      assert(sof > 0 && jpg.readUInt16BE(sof + 7) === 1280 && jpg.readUInt16BE(sof + 5) === 720, 'default.jpg is 1280×720');
      cpSync(join(vdir, 'default.jpg'), join(outDir, 'studio-default.jpg'));
      cpSync(join(vdir, 'stripped.jpg'), join(outDir, 'studio-stripped.jpg'));
      assert(JSON.parse(readFileSync(join(vdir, 'info_stripped.json'), 'utf8')).Configuration === 'Stripped', 'config info written');

      // Configurations manager: pictures, figures, default, compare.
      await page.getByTestId('open-configs').click();
      await page.getByTestId('configs-manager').waitFor();
      await page.getByTestId('cm-pictures').click();
      await page.getByTestId('cm-card').first().locator('img').waitFor({ timeout: 20_000 });
      await page.getByTestId('cm-card').nth(1).locator('img').waitFor({ timeout: 20_000 });
      assert((await page.getByTestId('cm-card').count()) === 2, 'base and stripped cards');
      await page.getByTestId('cm-card').nth(1).getByRole('button', { name: /^Select / }).click();
      await page.getByTestId('cm-details').waitFor();
      assert((await page.getByTestId('cm-figures').textContent()).includes('Weight'), 'figures show the weight');
      await page.getByTestId('cm-card').nth(1).getByRole('button', { name: 'Make the game spawn this one' }).click();
      await shot(page, 'configs-manager');
      await page.getByRole('tab', { name: 'Compare' }).click();
      await page.getByTestId('cm-compare').waitFor();
      assert((await page.getByTestId('cm-compare').textContent()).includes('(empty)'), 'compare lists the emptied slot');
      await shot(page, 'configs-compare');
      await page.keyboard.press('Escape');
      assert((await hook(page, 'projectDoc')).defaultConfigId, 'default configuration set');

      // Repository package: listing + checklist, then a folder with the zip, pictures and listing text.
      await page.getByTestId('toolbar-export').click();
      await page.getByTestId('export-publish').click();
      await page.getByTestId('publish-form').waitFor();
      await page.getByTestId('publish-description').fill('A test car made from scratch in JBeam Forge, with a stripped configuration.');
      const checks = await page.getByTestId('publish-checks').textContent();
      assert(checks.includes('Description written') && checks.includes('preview picture for every configuration'), `publish checklist (${checks})`);
      await shot(page, 'publish-form');
      const pubRoot = join(fakeUserDir, 'publish');
      await hook(page, 'queueDialog', [pubRoot]);
      await page.getByTestId('publish-save').click();
      await page.getByTestId('export-result').waitFor({ timeout: 30_000 });
      const pubDir = join(pubRoot, 'generate_test_1.0');
      const pub = readdirSync(pubDir).sort();
      assert(pub.includes('generate_test_1.0.zip') && pub.includes('README.md') && pub.includes('description.txt'), `publish package (${pub.join(', ')})`);
      const pics = readdirSync(join(pubDir, 'pictures'));
      assert(pics.includes('default.jpg') && pics.includes('stripped.jpg'), `publish pictures (${pics.join(', ')})`);
      assert(readFileSync(join(pubDir, 'README.md'), 'utf8').includes('- ✓ Validation passed'), 'README lists the checks');
      await page.getByRole('button', { name: 'Done' }).click();

      // Objects library (bundled locally in packs/objects): thumbnails render and an object comes in with its material.
      if (existsSync(join(ROOT, 'packs', 'objects'))) {
        await page.getByTestId('toggle-objects').click();
        await page.getByTestId('objects-panel').waitFor();
        let cards = 0;
        for (let i = 0; i < 100 && cards < 20; i++) {
          cards = await page.getByTestId('object-card').count();
          await page.waitForTimeout(100);
        }
        assert(cards >= 20, `objects pack listed (${cards})`);
        await page.getByLabel('Search objects').fill('brembo');
        await page.waitForTimeout(4000); // meshes and textures load for the thumbnails
        await shot(page, 'objects-panel');
        const before = await hook(page, 'sceneStats');
        const materialsBefore = await hook(page, 'materialCount');
        const keysBefore = new Set((await hook(page, 'meshBounds')).map((m) => m.key));
        await page.getByTestId('object-add').first().click();
        // Calipers ask which corner; "not sure" leaves it where it came in.
        await page.getByTestId('place-object').waitFor();
        await shot(page, 'object-where');
        await page.getByTestId('place-unsure').click();
        for (let i = 0; i < 100; i++) {
          if ((await hook(page, 'sceneStats')).meshes > before.meshes) break;
          await page.waitForTimeout(100);
        }
        if (await page.getByTestId('classify-skip').isVisible().catch(() => false)) await page.getByTestId('classify-skip').click();
        assert((await hook(page, 'sceneStats')).meshes > before.meshes && (await hook(page, 'materialCount')) === materialsBefore + 1, 'object added with its material');
        await shot(page, 'object-added');
        // Move it with the Placement dialog: the geometry follows at once, and undo puts it back.
        const centreX = async () => {
          const own = (await hook(page, 'meshBounds')).filter((m) => !keysBefore.has(m.key));
          return own.reduce((sum, m) => sum + (m.min[0] + m.max[0]) / 2, 0) / own.length;
        };
        const x0 = await centreX();
        await page.getByTestId('scene-source-row').last().click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Placement…' }).click();
        await page.getByLabel('Position X', { exact: true }).fill('1.5');
        await page.getByLabel('Position X', { exact: true }).press('Enter');
        await page.waitForTimeout(200);
        const x1 = await centreX();
        assert(Math.abs(x1 - x0 - 1.5) < 0.01, `object moved 1.5 m along X (${x0.toFixed(3)} → ${x1.toFixed(3)})`);
        await shot(page, 'object-placed');
        await page.getByTestId('placement-done').click();
        await hook(page, 'runCommand', 'undo');
        await page.waitForTimeout(200);
        assert(Math.abs((await centreX()) - x0) < 0.01, 'undo moves the object back');

        // Per-mesh editing: move the caliper in the Inspector, then mirror it to the other side.
        const objKeys = (await hook(page, 'meshBounds')).filter((m) => !keysBefore.has(m.key)).map((m) => m.key);
        await hook(page, 'selectMeshes', objKeys);
        await page.getByTestId('toggle-inspector').click(); // from the Objects tab back to the Inspector
        await page.getByLabel('Mesh position X').fill('0.7');
        await page.getByLabel('Mesh position X').press('Enter');
        await page.waitForTimeout(300);
        const movedX = await centreX();
        assert(Math.abs(movedX - x0 - 0.7) < 0.01, `mesh moved 0.7 m in the Inspector (${x0.toFixed(3)} → ${movedX.toFixed(3)})`);
        await page.getByTestId('mesh-mirror').click();
        await page.waitForTimeout(300);
        const mirrored = (await hook(page, 'meshBounds')).filter((m) => m.key.startsWith('copy:'));
        const mx = mirrored.reduce((n, m) => n + (m.min[0] + m.max[0]) / 2, 0) / Math.max(1, mirrored.length);
        assert(mirrored.length === objKeys.length && Math.abs(mx + movedX) < 0.01, `mirrored copy on the other side (${movedX.toFixed(3)} ↔ ${mx.toFixed(3)})`);
        await shot(page, 'mesh-mirrored');
        await hook(page, 'runCommand', 'undo');
        await hook(page, 'runCommand', 'undo');
        await page.waitForTimeout(200);


        // The gizmo: turn the caliper 90° about Z around its centre, then scale it ×2 (Blender's R and S).
        await hook(page, 'selectMeshes', objKeys);
        await page.getByTestId('mesh-rotate-toggle').click();
        await page.getByTestId('mesh-rotate-toggle').and(page.locator('[aria-pressed=true]')).waitFor();
        await shot(page, 'mesh-rotate-gizmo');
        const extent = async () => {
          const own = (await hook(page, 'meshBounds')).filter((m) => objKeys.includes(m.key));
          const lo = [0, 1, 2].map((i) => Math.min(...own.map((m) => m.min[i])));
          const hi = [0, 1, 2].map((i) => Math.max(...own.map((m) => m.max[i])));
          return { size: hi.map((h, i) => h - lo[i]), centre: hi.map((h, i) => (h + lo[i]) / 2) };
        };
        const e0 = await extent();
        const s = Math.SQRT1_2;
        await hook(page, 'gizmoTransform', { pivot: e0.centre, translate: [0, 0, 0], rotate: [0, 0, s, s], scale: [1, 1, 1] });
        await page.waitForTimeout(300);
        const e1 = await extent();
        assert(Math.abs(e1.size[0] - e0.size[1]) < 0.01 && Math.abs(e1.size[1] - e0.size[0]) < 0.01 && e1.centre.every((v, i) => Math.abs(v - e0.centre[i]) < 0.01), `rotated 90° in place (${JSON.stringify(e0)} → ${JSON.stringify(e1)})`);
        await hook(page, 'gizmoTransform', { pivot: e1.centre, translate: [0, 0, 0], rotate: [0, 0, 0, 1], scale: [2, 2, 2] });
        await page.waitForTimeout(300);
        const e2 = await extent();
        assert(e2.size.every((v, i) => Math.abs(v - e1.size[i] * 2) < 0.01), `scaled ×2 (${JSON.stringify(e2.size)})`);
        await page.getByTestId('mesh-rotate-toggle').click();
        await hook(page, 'runCommand', 'undo');
        await hook(page, 'runCommand', 'undo');
        await page.waitForTimeout(200);

        // "All four corners": the object and three copies, left/right mirrored, front/rear apart.
        const before4 = new Set((await hook(page, 'meshBounds')).map((m) => m.key));
        await page.getByTestId('toggle-objects').click();
        await page.getByTestId('object-add').nth(1).click();
        await page.getByTestId('place-all').click();
        let four = [];
        for (let i = 0; i < 100 && four.length < 4; i++) {
          four = (await hook(page, 'meshBounds')).filter((m) => !before4.has(m.key));
          await page.waitForTimeout(100);
        }
        const centres = four.map((m) => [(m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2]);
        const xs = centres.map((c) => c[0]);
        const ys = centres.map((c) => c[1]);
        assert(four.length === 4 && Math.min(...xs) < -0.2 && Math.max(...xs) > 0.2 && Math.max(...ys) - Math.min(...ys) > 0.5, `object at all four corners (${JSON.stringify(centres.map((c) => c.map((v) => +v.toFixed(2))))})`);
        await shot(page, 'object-four-corners');
        // Back to before the four were added (placement, copies and four parts are several steps).
        for (let i = 0; i < 20 && (await hook(page, 'meshBounds')).length > before4.size; i++) await hook(page, 'runCommand', 'undo');
        await page.waitForTimeout(200);
        await hook(page, 'runCommand', 'undo');
        // kn5 dashes bring their own materials and textures.
        await page.getByLabel('Search objects').fill('');
        await page.getByLabel('Object category').click();
        await page.getByRole('option', { name: /Digital Gauges/ }).click();
        await page.waitForTimeout(5000);
        assert((await page.getByTestId('object-card').count()) === 3, 'three kn5 dashes listed');
        await shot(page, 'objects-dashes');
        await page.getByTestId('toggle-objects').click();
      }

      // Test Mode: live sim runs, scenarios report, exit restores the normal view.
      await page.getByTestId('toolbar-test').click();
      await page.getByTestId('test-panel').waitFor();
      await page.getByTestId('sim-run').click();
      await page.waitForTimeout(1200);
      const statsText = await page.getByTestId('sim-stats').textContent();
      const simulated = Number(statsText.match(/([\d.]+) s simulated/)?.[1] ?? 0);
      assert(simulated > 0.3, `live sim advanced (${statsText})`);
      await shot(page, 'test-mode-live');
      // The car's meshes, bent by the physics (shown from the start); then just the selected part's.
      await page.waitForTimeout(600);
      await shot(page, 'test-mode-car-mesh');
      await page.getByRole('switch', { name: 'Only the selected part' }).click();
      await page.waitForTimeout(400);
      await shot(page, 'test-mode-isolated');
      await page.getByRole('switch', { name: 'Only the selected part' }).click();
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
    id: 'paint',
    name: 'paint studio: paint material · camo over the whole material · mirrored brush · stamp · eyedropper · export',
    async run({ page }) {
      const model = join(ROOT, 'tests', 'fixtures', 'models', 'uv_box.obj');
      const stats = () => hook(page, 'sceneStats');
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Paint Test');
      await hook(page, 'queueDialog', [model]);
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-confirm').click();
      for (let i = 0; i < 100 && (await stats()).meshes !== 1; i++) await page.waitForTimeout(100);
      if (await page.getByTestId('classify-skip').isVisible().catch(() => false)) await page.getByTestId('classify-skip').click();
      // A part for it, so it's exported.
      const tree = page.getByTestId('scene-tree');
      await tree.getByText('car_body', { exact: true }).click();
      await page.getByTestId('scene-assign').click();
      await page.getByTestId('assign-search').fill('body shell');
      await page.getByTestId('assign-search').press('Enter');
      await page.getByTestId('assign-confirm').click();

      // Its material becomes car paint.
      await hook(page, 'applyPreset', 'materials');
      await hook(page, 'maximizePanel', 'materials');
      await page.getByTestId('material-row').first().click();
      await page.getByRole('switch', { name: /Car paint/ }).click();
      await hook(page, 'exitMaximized');
      await hook(page, 'applyPreset', 'modelling');

      // UV tools: the body's UV layout, then fresh box-projected texture coordinates (undone after).
      await hook(page, 'selectMeshes', [(await hook(page, 'meshBounds'))[0].key]);
      const texSection = page.getByRole('button', { name: 'Texture mapping' });
      if ((await texSection.getAttribute('aria-expanded')) !== 'true') await texSection.click();
      await page.getByTestId('uv-layout').waitFor();
      await page.getByRole('combobox', { name: 'Texture coordinates' }).click();
      await page.getByRole('option', { name: /^Box/ }).click();
      await page.waitForTimeout(300);
      assert((await hook(page, 'projectState')).undoLabels.at(-1) === 'Project texture coordinates', 'box projection is an undoable step');
      await page.getByTestId('uv-layout').waitFor();
      await shot(page, 'uv-box-projection');
      await hook(page, 'runCommand', 'undo');
      await page.waitForTimeout(200);

      // Animated part: the same mesh as a steering wheel, tried at half a turn in the viewport (undone after).
      const animSection = page.getByRole('button', { name: 'Animation' });
      if ((await animSection.getAttribute('aria-expanded')) !== 'true') await animSection.click();
      await page.getByRole('combobox', { name: 'Animate as' }).click();
      await page.getByRole('option', { name: 'Steering wheel' }).click();
      await page.waitForTimeout(200);
      assert((await hook(page, 'projectState')).undoLabels.at(-1) === 'Animate as steering wheel', 'animating a mesh is an undoable step');
      await page.getByRole('slider', { name: 'Test value' }).focus();
      for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      await shot(page, 'prop-steering-preview');
      await hook(page, 'runCommand', 'undo');
      await page.waitForTimeout(200);

      // Paints: a three-paint scheme, then the studio.
      await page.getByTestId('toggle-paints').click();
      await page.getByTestId('paints-panel').waitFor();
      await page.getByTestId('paint-scheme').filter({ hasText: 'Rave' }).click();
      await page.getByRole('switch', { name: 'Paint on the car' }).click();
      await page.getByLabel('Material to paint').click();
      await page.getByRole('option').first().click();

      // Camo on the paint-slot mask, over the whole material: recolourable in game.
      await page.getByTestId('paint-tool-pattern').click();
      await page.getByTestId('pattern-preset').filter({ hasText: 'Woodland camo' }).click();
      await page.getByTestId('pattern-apply-all').click();
      await page.waitForTimeout(1500);
      await shot(page, 'paint-camo-mask');

      // Livery: a mirrored brush stroke across the car, a stamped number, then the eyedropper.
      await page.getByRole('radio', { name: 'Livery (any colours)' }).click();
      await page.getByTestId('paint-tool-brush').click();
      await page.getByRole('switch', { name: 'Mirror both sides' }).click();
      const vp = await page.locator('[data-panel=viewport] canvas').first().boundingBox();
      const cx = vp.x + vp.width / 2;
      const cy = vp.y + vp.height / 2;
      await page.mouse.move(cx - 60, cy);
      await page.mouse.down();
      for (let k = 0; k <= 12; k++) await page.mouse.move(cx - 60 + k * 10, cy + Math.sin(k / 2) * 20);
      await page.mouse.up();
      await page.getByTestId('paint-tool-stamp').click();
      await page.getByRole('textbox', { name: 'Stamp text' }).fill('77');
      await page.mouse.click(cx, cy - 30);
      await page.waitForTimeout(800);
      await page.getByTestId('paint-tool-picker').click();
      await page.mouse.click(cx - 60, cy);
      await page.waitForTimeout(300);
      assert((await hook(page, 'painterState')).tool === 'brush', 'the eyedropper hands back to the brush');
      await shot(page, 'paint-livery');

      // Vinyl layers, the livery-editor way: a shape, text and a ready-made group from the left, moved on the car, mirrored, grouped, undone.
      await page.getByTestId('vinyl-edit').click();
      await page.getByTestId('vinyl-view-left').click();
      await page.getByTestId('vinyl-add-shape').click();
      await page.getByTestId('vinyl-shape-star').click();
      await page.getByTestId('vinyl-add-text').click();
      await page.getByLabel('Add a ready-made vinyl group').click();
      await page.getByRole('option', { name: 'Race number roundel' }).click();
      let vs = await hook(page, 'vinylState');
      assert(vs.layers.length === 5 && vs.groups.length === 1 && vs.selected.length === 3, `star, text and a 3-layer group added (${JSON.stringify(vs)})`);
      await page.waitForTimeout(1500);
      await shot(page, 'vinyl-added');
      // Drag the group (on top, in the middle of the side) forward along the car.
      const vp2 = await page.locator('[data-panel=viewport] canvas').first().boundingBox();
      const [mx, my] = [vp2.x + vp2.width / 2, vp2.y + vp2.height / 2];
      const before = vs.layers.find((l) => l.name === 'Roundel');
      await page.mouse.move(mx, my);
      await page.mouse.down();
      for (let k = 1; k <= 10; k++) await page.mouse.move(mx - k * 12, my - k * 4);
      await page.mouse.up();
      await page.waitForTimeout(800);
      vs = await hook(page, 'vinylState');
      const after = vs.layers.find((l) => l.name === 'Roundel');
      assert(Math.abs(after.x - before.x) > 0.05, `dragging moved the group along the car (${before.x} → ${after.x})`);
      // Mirror the selection onto the right side, turn it with the keyboard, then undo the turn.
      await page.getByRole('switch', { name: 'Mirror on the other side' }).click();
      await page.getByTestId('viewport').focus();
      await page.keyboard.press('q');
      vs = await hook(page, 'vinylState');
      assert(vs.layers.filter((l) => l.groupId).every((l) => l.mirror && l.rotation > 0), `group mirrored and turned (${JSON.stringify(vs.layers)})`);
      await hook(page, 'runCommand', 'undo');
      vs = await hook(page, 'vinylState');
      assert(vs.layers.filter((l) => l.groupId).every((l) => l.rotation === 0), 'undo takes the turn back');
      await page.waitForTimeout(1500);
      await shot(page, 'vinyl-moved');
      await page.getByTestId('vinyl-view-right').click();
      await page.waitForTimeout(800);
      await shot(page, 'vinyl-mirrored-right');

      // Material brush: carbon fibre over a smooth area of the car (the real material, not a picture of it).
      await page.getByTestId('paint-tool-material').click();
      await page.getByTestId('material-weave-carbon').click();
      await page.getByTestId('material-mode-smooth').click();
      const vp3 = await page.locator('[data-panel=viewport] canvas').first().boundingBox();
      await page.mouse.click(vp3.x + vp3.width / 2, vp3.y + vp3.height / 2);
      await page.waitForTimeout(600);
      const fs = await hook(page, 'faceState');
      const carbonCount = Object.values(fs)[0];
      assert(carbonCount > 10, `carbon laid over a smooth area (${JSON.stringify(fs)})`);
      await shot(page, 'material-carbon');
      await page.getByTestId('material-mode-brush').click();

      // Both pictures are saved, and the material uses them.
      const painted = join(userData, 'painted-textures');
      let files = [];
      for (let i = 0; i < 50; i++) {
        files = existsSync(painted) ? readdirSync(painted) : [];
        if (files.some((f) => f.endsWith('_paintmask.png')) && files.some((f) => f.endsWith('_livery.png'))) break;
        await page.waitForTimeout(100);
      }
      assert(files.some((f) => f.endsWith('_paintmask.png')) && files.some((f) => f.endsWith('_livery.png')), `mask and livery saved (${files.join(', ')})`);
      const mask = files.find((f) => f.endsWith('_paintmask.png'));
      assert(statSync(join(painted, mask)).size > 20_000, `the camo mask has detail (${statSync(join(painted, mask)).size} bytes)`);
      await page.getByRole('switch', { name: 'Paint on the car' }).click();
      await page.getByTestId('toggle-paints').click();

      // Ambient occlusion baked from the car's shape into the body material's AO map.
      await hook(page, 'applyPreset', 'materials');
      await hook(page, 'maximizePanel', 'materials');
      await page.getByTestId('material-row').filter({ hasText: 'paint' }).click();
      await page.getByRole('button', { name: 'Bake ambient occlusion' }).click();
      await page.getByLabel('Occlusion texture size').click();
      await page.getByRole('option', { name: '256 px' }).click();
      await page.getByTestId('material-bake-ao').click();
      let aoFile;
      for (let i = 0; i < 600 && !aoFile; i++) {
        aoFile = (existsSync(painted) ? readdirSync(painted) : []).find((f) => f.endsWith('_ao.png'));
        if (!aoFile) await page.waitForTimeout(100);
      }
      assert(aoFile, 'ambient occlusion baked and saved');
      await page.getByTestId('material-bake-ao').and(page.locator(':not([disabled])')).waitFor();
      assert((await hook(page, 'projectState')).undoLabels.at(-1) === 'Set ambientOcclusionMap', 'the AO map is set on the material');
      await shot(page, 'material-ao-baked');
      await hook(page, 'exitMaximized');
      await hook(page, 'applyPreset', 'modelling');

      // Export: the painted textures go into the mod with the material pointing at them.
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 100 && !((await hook(page, 'structureState'))?.nodes > 0); i++) await page.waitForTimeout(100);

      // Interior camera: the driver's eyes, looked through in the viewport, then exported as camerasInternal.
      await page.getByTestId('toggle-features').click();
      await page.getByRole('combobox', { name: 'Add a camera' }).click();
      await page.getByRole('option', { name: 'Driver (left-hand drive)' }).click();
      await page.getByTestId('camera-look').click();
      await page.waitForTimeout(400);
      await shot(page, 'camera-driver-view');
      await page.getByTestId('camera-look').click();
      await page.getByTestId('toggle-features').click();

      // Vehicle scripts: folding mirrors from a template on the box, tested in the sandbox and played on the car.
      await hook(page, 'applyPreset', 'scripts');
      await page.getByTestId('scripts-panel').waitFor();
      await page.getByTestId('scripts-view-gallery').click();
      await page.getByTestId('template-gallery').waitFor();
      await page.getByRole('button', { name: 'Add Folding mirrors' }).click();
      await page.getByTestId('script-panel').waitFor();
      // Its tutorial may be offered (offers are off in the harness unless a scenario turns them on): not now.
      if (await page.getByTestId('guide-offer').isVisible({ timeout: 1000 }).catch(() => false)) await page.getByTestId('guide-skip').click();
      const boxKey = Object.keys((await hook(page, 'projectDoc')).assignments)[0];
      await hook(page, 'selectMeshes', [boxKey]);
      await page.getByTestId('script-use-selection').first().click();
      await page.waitForTimeout(200);
      const withMirror = await hook(page, 'projectDoc');
      assert(withMirror.scripts.length === 1 && withMirror.scripts[0].name === 'mirrors', `mirrors script added (${JSON.stringify(withMirror.scripts)})`);
      assert(withMirror.props.some((p) => p.meshKey === boxKey && p.func === 'jbf_mirrors'), `picking the mesh animates it (${JSON.stringify(withMirror.props)})`);
      await page.getByTestId('script-run').click();
      await page.getByTestId('script-results').waitFor({ timeout: 30_000 });
      assert((await page.getByTestId('script-results').textContent()).includes('jbf_mirrors'), 'the test recorded the mirrors value');
      await page.waitForTimeout(1500);
      // Its key: click, then press the one you want.
      await page.getByTestId('script-key').first().click();
      await page.keyboard.press('Control+Shift+KeyM');
      await page.waitForTimeout(200);
      const keyed = (await hook(page, 'projectDoc')).scripts[0].actions?.find((a) => a.id === 'toggle')?.key;
      assert(keyed === 'lctrl lshift m', `pressing a key sets it in BeamNG's naming (${keyed})`);
      assert((await page.getByTestId('script-key').first().textContent()).includes('Ctrl + Shift + M'), 'and it reads as Ctrl + Shift + M');
      await shot(page, 'script-mirrors-test');
      await page.getByTestId('script-mode-code').click();
      await page.getByTestId('lua-editor').waitFor();
      assert((await page.getByTestId('script-problems').textContent()).includes('No problems'), 'the template code checks clean');
      await shot(page, 'script-code');

      // A hand-written script with a mistake: the checker explains it.
      await page.getByTestId('scripts-view-list').click();
      await page.getByTestId('scripts-add-blank').click();
      await page.locator('[data-testid="lua-editor"] .cm-content').click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('local M = {}\nlocal x = 1\nx += 1\nreturn M\n');
      await page.waitForTimeout(600);
      const problems = await page.getByTestId('script-problems').textContent();
      assert(/no \+= or -=/.test(problems), `the checker explains += (${problems})`);
      await shot(page, 'script-problem');
      await page.getByTestId('script-remove').click();
      await page.getByTestId('confirm-yes').click();

      // Head unit on the box: its page previews with the test's values (then removed, the box keeps its paint).
      await page.getByTestId('scripts-view-gallery').click();
      await page.getByRole('button', { name: 'Add Head unit (phone projection)' }).click();
      await hook(page, 'selectMeshes', [boxKey]);
      await page.getByTestId('script-mode-easy').click();
      await page.getByTestId('script-use-selection').first().click();
      await page.getByTestId('script-run').click();
      await page.getByTestId('headunit-preview').waitFor();
      await page.getByTestId('script-results').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(2500);
      await shot(page, 'script-headunit');
      await page.getByTestId('headunit-preview').screenshot({ path: join(outDir, 'headunit-preview.png') });
      // The map app opens on the test's schedule, later on a loaded machine: poll rather than read once.
      let mapDrawn = 'no canvas';
      for (let i = 0; i < 60; i++) {
        mapDrawn = await page.evaluate(() => {
          const doc = document.querySelector('[data-testid="headunit-preview"]').contentDocument;
          const canvas = [doc.getElementById('map'), doc.getElementById('homeMap')].find((c) => c?.closest('.app.on'));
          const g = canvas?.getContext('2d');
          if (!g) return 'no canvas';
          const px = g.getImageData(Math.round(canvas.width / 2), Math.round(canvas.height * 0.45), 1, 1).data;
          return [...px].join(',');
        });
        const [r0, , b0] = mapDrawn.split(',').map(Number);
        if (b0 > 200 && r0 < 150) break;
        await page.waitForTimeout(250);
      }
      // The route runs up the middle of the map in the accent colour (blue).
      const [r, , b] = mapDrawn.split(',').map(Number);
      assert(b > 200 && r < 150, `the head unit's map is drawn (${mapDrawn})`);
      await page.getByTestId('script-remove').click();
      await page.getByTestId('confirm-yes').click();
      await hook(page, 'applyPreset', 'modelling');

      await page.getByTestId('toolbar-export').click();
      await page.getByTestId('export-dialog').waitFor();
      await page.getByTestId('export-install').click();
      await page.getByTestId('export-result').waitFor({ timeout: 30_000 });
      const vdir = join(fakeUserDir, 'mods', 'unpacked', 'paint_test', 'vehicles', 'paint_test');
      const luaFile = join(fakeUserDir, 'mods', 'unpacked', 'paint_test', 'lua', 'vehicle', 'controller', 'jbf_paint_test', 'mirrors.lua');
      assert(existsSync(luaFile) && readFileSync(luaFile, 'utf8').includes('return M'), 'the mirrors controller is exported');
      assert(JSON.parse(readFileSync(join(vdir, 'input_actions.json'), 'utf8')).jbf_paint_test_mirrors_toggle, 'its key is an input action');
      assert(readdirSync(vdir).filter((f) => f.endsWith('.jbeam')).some((f) => readFileSync(join(vdir, f), 'utf8').includes('"jbf_paint_test/mirrors"')), 'a part carries the controller');
      const out = readdirSync(vdir);
      const mats = JSON.parse(readFileSync(join(vdir, 'main.materials.json'), 'utf8'));
      const paint = Object.values(mats).find((m) => typeof m.Stages?.[0]?.colorPaletteMap === 'string');
      assert(paint, `a material with a paint mask (${JSON.stringify(mats).slice(0, 400)})`);
      const withCamera = out.filter((f) => f.endsWith('.jbeam')).find((f) => readFileSync(join(vdir, f), 'utf8').includes('camerasInternal'));
      assert(withCamera, `the driver camera is exported (${out.join(', ')})`);
      assert(typeof paint.Stages[0].ambientOcclusionMap === 'string' && out.includes(paint.Stages[0].ambientOcclusionMap.split('/').pop()), `baked AO exported (${paint.Stages[0].ambientOcclusionMap})`);
      const maskFile = paint.Stages[0].colorPaletteMap.split('/').pop();
      const liveryStage = paint.Stages.find((st) => typeof st.baseColorMap === 'string' && st.baseColorMap.includes('livery'));
      assert(out.includes(maskFile), `mask texture exported (${maskFile} in ${out.join(', ')})`);
      assert(liveryStage && out.includes(liveryStage.baseColorMap.split('/').pop()), `livery layer exported (${JSON.stringify(paint.Stages)})`);
      assert(readdirSync(painted).some((f) => f.endsWith('_livery_base.png')), 'the freehand painting is kept apart from the vinyls');
      const carbonMat = Object.entries(mats).find(([, m]) => typeof m.Stages?.[0]?.detailNormalMap === 'string');
      assert(carbonMat, `carbon fibre exported with its weave (${Object.keys(mats)})`);
      assert(out.includes(carbonMat[1].Stages[0].detailNormalMap.split('/').pop()), 'weave texture exported');
      const dae2 = readFileSync(join(vdir, 'paint_test.dae'), 'utf8');
      assert(new RegExp(`<triangles material="${carbonMat[0]}" count="\\d+"`).test(dae2), `carbon triangles are their own group in the DAE`);
      const info = JSON.parse(readFileSync(join(vdir, 'info.json'), 'utf8'));
      assert(info.defaultPaintName2 === 'Hot Pink', `scheme paints in info.json (${info.defaultPaintName1}, ${info.defaultPaintName2})`);
      await page.getByRole('button', { name: 'Done' }).click();
      await hook(page, 'runCommand', 'close');
      await page.getByTestId('unsaved-discard').click();
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
    },
  },
  {
    id: 'extensions',
    name: 'extensions: new sample · command from the palette · its script template',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Extension Test');
      await hook(page, 'queueDialog', [null]);
      await page.getByTestId('newmod-create').click();
      await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await page.getByRole('button', { name: 'Extensions' }).first().click();
      await page.getByTestId('extension-new').click();
      await page.getByTestId('extension-list').getByText('Running: 2 commands, 1 script template').waitFor({ timeout: 15_000 });
      await shot(page, 'extensions-settings');
      await page.keyboard.press('Escape');
      // Its command runs from the palette and reads the project.
      await hook(page, 'runCommand', 'palette');
      await page.getByTestId('palette-input').fill('Count parts');
      await page.getByTestId('palette-input').press('Enter');
      await page.getByTestId('status-bar').getByText(/Hello extension: \d+ parts/).waitFor({ timeout: 10_000 });
      // Its edit is one undoable step, checked against the project format.
      await hook(page, 'runCommand', 'palette');
      await page.getByTestId('palette-input').fill('Capitalise part names');
      await page.getByTestId('palette-input').press('Enter');
      await page.waitForTimeout(800);
      const st = await hook(page, 'projectState');
      assert(!st.undoLabels.length || st.undoLabels.at(-1) === 'Hello extension: Capitalise part names' || (await page.getByTestId('status-bar').textContent()).includes('already capitalised'), `the extension's edit is undoable (${st.undoLabels.at(-1)})`);
      // Its vehicle script template is in the gallery.
      await hook(page, 'applyPreset', 'scripts');
      await page.getByTestId('scripts-view-gallery').click();
      await page.getByTestId('template-gallery').getByText('Speed warning light').waitFor();
      await shot(page, 'extensions-template');
      await hook(page, 'applyPreset', 'modelling');
    },
  },
  {
    id: 'tutorial',
    name: 'tutorial: practice car · spotlight steps · auto-classify · generate · finish',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      // From wherever the last scenario left off: back to the home screen.
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      await page.waitForSelector('[data-testid=tour-card][data-step=welcome]');
      let st;
      for (let i = 0; i < 300; i++) {
        st = await hook(page, 'sceneStats');
        if (st.meshes > 0 && st.sources.every((x) => x.status === 'ready')) break;
        await page.waitForTimeout(100);
      }
      assert(st.meshes >= 30, `practice car loaded (${st.meshes} meshes)`);
      await shot(page, 'tour-welcome');
      const step = (id, timeout = 10_000) => page.waitForSelector(`[data-testid=tour-card][data-step="${id}"]`, { timeout });
      await page.getByTestId('tour-next').click();
      await step('viewport');
      await page.getByTestId('tour-next').click();
      await step('scene');
      await page.getByTestId('tour-next').click();
      await step('classify');
      await shot(page, 'tour-classify');
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await step('classify-apply');
      await page.getByTestId('classify-apply').click();
      await step('inspector');
      const parts = await hook(page, 'partNames');
      assert(parts.length >= 10, `practice car sorted into parts (${parts.join(', ')})`);
      await page.getByTestId('tour-next').click();
      await step('properties');
      await page.getByTestId('tour-next').click();
      await step('materials-tab');
      await page.getByTestId('workspace-materials').click();
      await step('materials');
      await page.getByTestId('tour-next').click();
      await step('modelling-tab');
      await page.getByTestId('workspace-modelling').click();
      await step('generate');
      await shot(page, 'tour-generate');
      await page.getByTestId('toolbar-generate').click();
      await step('views', 180_000);
      const doc = await hook(page, 'projectDoc');
      assert(doc.nodes.length > 50, `structure generated (${doc.nodes.length} nodes)`);
      for (let i = 0; i < 12; i++) {
        if (await page.locator('[data-testid=tour-card][data-step=done]').count()) break;
        await page.getByTestId('tour-next').click();
        await page.waitForTimeout(150);
      }
      await step('done');
      await shot(page, 'tour-done');
      await page.getByTestId('tour-finish').click();
      assert((await page.getByTestId('tour').count()) === 0, 'the tour closes');
      // Help centre: guides, search.
      await page.getByTestId('open-help').click();
      await page.getByTestId('help-centre').waitFor();
      await page.getByTestId('guide-first-mod').click();
      await page.getByTestId('help-article').getByText('Get the model ready').waitFor();
      await page.getByTestId('help-search').fill('hinge');
      await shot(page, 'help-centre');
      await page.keyboard.press('Escape');
    },
  },
  {
    id: 'ai-mode',
    name: 'AI mode: copy the request, check a pasted answer, apply as one undo step, iterate',
    async run({ app, page }) {
      // The practice car from the tutorial scenario is open with its parts.
      const before = await hook(page, 'projectDoc');
      assert(before.parts.length >= 3, 'a project with parts is open');
      await page.getByTestId('toolbar-ai').click();
      await page.getByTestId('ai-copy').waitFor();
      await page.getByTestId('ai-copy').click();
      let request = '';
      for (let i = 0; i < 50 && !request.includes('# Your jobs'); i++) {
        request = await app.evaluate(({ clipboard }) => clipboard.readText());
        await page.waitForTimeout(100);
      }
      assert(request.includes('Only use names that appear in this request'), 'the request carries the rule book');
      assert(request.includes(before.parts[0].name), 'the request lists the parts by name');
      const [a, b, c] = before.parts;
      const answer = `Here you go!\n\`\`\`json\n${JSON.stringify({
        summary: 'Priced, weighed and named.',
        changes: [
          { do: 'price', part: a.name, price: 1234 },
          { do: 'mass', part: b.name, kg: 7.5 },
          { do: 'rename', part: c.name, displayName: 'Harness Part' },
          { do: 'price', part: 'no_such_part', price: 10 },
        ],
        notes: ['Check the bumper weight.'],
      })}\n\`\`\``;
      await page.getByRole('textbox', { name: 'The AI’s answer' }).fill(answer);
      await page.getByTestId('ai-check').click();
      await page.getByTestId('ai-changes').waitFor();
      assert((await page.getByTestId('ai-changes').getByText(/Refused: there is no part called "no_such_part"/).count()) === 1, 'an unknown part is refused');
      await shot(page, 'ai-mode-check');
      await page.getByTestId('ai-apply').click();
      await page.getByText(/3 applied/).waitFor();
      const after = await hook(page, 'projectDoc');
      const byName = (d, n) => d.parts.find((p) => p.name === n);
      assert(byName(after, a.name).price === 1234, 'price applied');
      assert(after.proxy.parts[byName(after, b.name).id]?.massKg === 7.5, 'mass applied');
      assert(byName(after, c.name).displayName === 'Harness Part', 'name applied');
      // Iterate: the next request says what was applied and what was refused.
      await page.getByTestId('ai-iterate').click();
      await page.getByTestId('ai-copy').click();
      let again = '';
      for (let i = 0; i < 50 && !again.includes('# Applied'); i++) {
        again = await app.evaluate(({ clipboard }) => clipboard.readText());
        await page.waitForTimeout(100);
      }
      assert(again.includes('# Refused (fix these)') && again.includes('no_such_part'), 'iterate reports what was refused');
      await page.keyboard.press('Escape');
      // One Ctrl+Z takes the whole round back.
      await hook(page, 'runCommand', 'undo');
      const undone = await hook(page, 'projectDoc');
      assert(byName(undone, a.name).price === a.price && byName(undone, c.name).displayName === c.displayName, 'one undo reverts the whole round');
    },
  },
  {
    id: 'extension-examples',
    name: 'example extensions: mod checklist, quick adjust (undoable), warning lights pack (script templates)',
    async run({ page }) {
      // The practice car is open (tutorial scenario).
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await page.getByRole('button', { name: 'Extensions' }).first().click();
      for (const id of ['mod-checklist', 'quick-adjust', 'warning-lights']) await page.getByTestId(`extension-example-${id}`).click();
      await page.getByTestId('extension-list').getByText(/Running: 5 commands/).first().waitFor({ timeout: 15_000 });
      await page.getByTestId('extension-list').getByText('Warning lights pack').first().waitFor();
      await shot(page, 'extension-examples-more');
      await page.keyboard.press('Escape');
      const palette = async (text) => {
        await hook(page, 'runCommand', 'palette');
        await page.getByTestId('palette-input').fill(text);
        await page.getByTestId('palette-input').press('Enter');
      };
      await palette('Mod checklist');
      await page.getByTestId('status-bar').getByText(/to look at before sharing|ready to share/).waitFor({ timeout: 10_000 });
      // Quick adjust: one undo step.
      const before = (await hook(page, 'projectDoc')).parts.map((p) => p.displayName);
      await palette('Tidy parts-menu names');
      await page.getByTestId('status-bar').getByText(/tidied|tidy already/).waitFor({ timeout: 10_000 });
      const after = (await hook(page, 'projectDoc')).parts.map((p) => p.displayName);
      if (after.join() !== before.join()) {
        await hook(page, 'runCommand', 'undo');
        assert((await hook(page, 'projectDoc')).parts.map((p) => p.displayName).join() === before.join(), 'one undo puts every name back');
      }
      // The pack's templates are in the gallery.
      await hook(page, 'applyPreset', 'scripts');
      await page.getByTestId('scripts-panel').waitFor();
      await page.getByTestId('scripts-view-gallery').click();
      await page.getByTestId('template-gallery').waitFor();
      await page.getByRole('button', { name: 'Add Overheat warning light' }).waitFor();
      await page.getByRole('button', { name: 'Add Trip computer' }).waitFor();
      await shot(page, 'script-gallery');
    },
  },
  {
    id: 'jbeam',
    name: 'JBeam workspace: tables · pick · rename · property · triangle · logical names · checks',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      // The practice car, without the tour: parts and structure.
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && (await hook(page, 'sceneStats')).meshes < 30; i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !(await hook(page, 'projectDoc')).nodes.length; i++) await page.waitForTimeout(100);
      await page.getByTestId('workspace-jbeam').click();
      await page.getByTestId('jbeam-tables').waitFor();
      await page.getByTestId('jbeam-properties').waitFor();
      // Pick the hood's nodes in the tables.
      await page.getByTestId('jbeam-search').fill('');
      const hoodPart = (await hook(page, 'projectDoc')).parts.find((p) => p.taxonomyId === 'hood');
      await page.getByTestId('jbeam-part').click();
      await page.getByRole('option', { name: hoodPart.displayName, exact: true }).click();
      const firstRow = page.getByTestId('jbeam-nodes').locator('tbody tr').first();
      const firstId = await firstRow.getAttribute('data-node');
      await firstRow.click();
      await page.getByTestId('jbeam-node-name').waitFor();
      await shot(page, 'jbeam-node');
      // Rename it, then give it its own property.
      await page.getByTestId('jbeam-node-name').fill('hoodtest1');
      await page.getByTestId('jbeam-node-name').press('Enter');
      let doc = await hook(page, 'projectDoc');
      assert(doc.nodes.some((n) => n.id === 'hoodtest1') && !doc.nodes.some((n) => n.id === firstId), `renamed ${firstId} → hoodtest1`);
      assert(doc.beams.every((b) => b.id1 !== firstId && b.id2 !== firstId), 'its beams follow the new name');
      await page.getByTestId('jbeam-props-node').getByRole('textbox', { name: 'Friction' }).fill('0.9');
      await page.getByTestId('jbeam-props-node').getByRole('textbox', { name: 'Friction' }).press('Enter');
      doc = await hook(page, 'projectDoc');
      assert(doc.nodes.find((n) => n.id === 'hoodtest1').options?.frictionCoef === 0.9, 'friction set on the node');
      // Three nodes make a triangle; T is the key.
      const rows = page.getByTestId('jbeam-nodes').locator('tbody tr');
      await rows.nth(1).click();
      await rows.nth(2).click({ modifiers: ['Shift'] });
      await rows.nth(3).click({ modifiers: ['Shift'] });
      const tris0 = doc.tris.length;
      await page.getByTestId('jbeam-add-tri').click();
      doc = await hook(page, 'projectDoc');
      assert(doc.tris.length === tris0 + 1 || (await page.getByTestId('status-bar').textContent()).includes('already make a triangle'), 'a triangle from three nodes');
      // Nothing picked: logical names for the whole car.
      await page.keyboard.press('Escape');
      await page.getByTestId('jbeam-part').click();
      await page.getByRole('option', { name: 'All parts' }).click();
      await hook(page, 'clearEdit');
      await page.getByTestId('jbeam-apply-naming').waitFor({ timeout: 5000 }).catch(() => undefined);
      if (await page.getByTestId('jbeam-apply-naming').isVisible()) {
        await page.getByTestId('jbeam-apply-naming').click();
        doc = await hook(page, 'projectDoc');
        const hood = doc.nodes.filter((n) => n.partId === hoodPart.id);
        assert(hood.every((n) => /^[a-z]+\d+[lr]?$/.test(n.id)), `logical hood names (${hood.slice(0, 4).map((n) => n.id).join(', ')})`);
      }
      // Checks.
      await page.getByRole('tab', { name: /Checks/ }).click();
      await shot(page, 'jbeam-checks');
      // The export writes the property on the node's row.
      const files = await hook(page, 'preparedJbeams');
      assert(files && files.files.some((f) => /"frictionCoef"\s*:\s*0\.9/.test(f.text)), 'the node row carries frictionCoef 0.9');
      await hook(page, 'applyPreset', 'modelling');
    },
  },
  {
    id: 'moving-triggers',
    name: 'Moving parts and Triggers: hinge all · animate · add, place and wire a trigger · export',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && (await hook(page, 'sceneStats')).meshes < 30; i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !(await hook(page, 'projectDoc')).nodes.length; i++) await page.waitForTimeout(100);
      // Moving parts: every door, the hood and the trunk on hinges in one click.
      await page.getByTestId('workspace-moving').click();
      await page.getByTestId('moving-parts').waitFor();
      await page.getByTestId('moving-hinge-all').click();
      let doc = await hook(page, 'projectDoc');
      assert(doc.hinges.length >= 4, `opening parts hinged (${doc.hinges.length})`);
      await page.getByTestId('moving-parts').getByText('Hood', { exact: true }).click();
      await page.getByTestId('moving-part').waitFor();
      // Its swing: a see-through copy, or (switched on) the hood itself.
      const swingThumb = page.getByTestId('moving-part').getByRole('slider', { name: 'Swing preview' });
      await swingThumb.focus();
      await page.keyboard.press('End');
      await page.waitForTimeout(200);
      let gl = await hook(page, 'glStats');
      assert(gl.hingeMoved === 0 && gl.hingeGhosts > 3, `a see-through copy swings open (${JSON.stringify(gl)})`);
      await page.getByRole('switch', { name: /Move the part itself/ }).first().click();
      await page.waitForTimeout(200);
      gl = await hook(page, 'glStats');
      assert(gl.hingeMoved > 0, `switched on, the hood itself swings open (${JSON.stringify(gl)})`);
      await shot(page, 'moving-part-itself');
      await swingThumb.focus();
      await page.keyboard.press('Home');
      await page.getByRole('switch', { name: /Move the part itself/ }).first().click();
      await shot(page, 'moving-parts');
      // The steering wheel is suggested for animation.
      await page.getByTestId('moving-parts').getByText('Animate as steering wheel').click();
      doc = await hook(page, 'projectDoc');
      assert((doc.props ?? []).some((p) => p.func === 'steering'), 'steering wheel animated');
      // Triggers: add a button, click on the car, make it the horn.
      await page.getByTestId('workspace-triggers').click();
      await page.getByTestId('triggers-panel').waitFor();
      await page.getByTestId('trigger-add').click();
      await page.getByTestId('trigger-editor').waitFor();
      const before = (await hook(page, 'projectDoc')).triggers[0].pos;
      const canvas = page.locator('[data-panel=viewport] canvas').first();
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      doc = await hook(page, 'projectDoc');
      const t = doc.triggers[0];
      assert(t && JSON.stringify(t.pos) !== JSON.stringify(before), `trigger placed on the car (${JSON.stringify(t?.pos)})`);
      await page.getByTestId('trigger-mirror').click();
      doc = await hook(page, 'projectDoc');
      assert(doc.triggers.length === 2, 'trigger copied to the other side');
      await shot(page, 'triggers');
      const files = await hook(page, 'preparedJbeams');
      assert(files && files.files.some((f) => f.text.includes('"triggers2"') && f.text.includes(`"${t.id}"`)), 'the trigger is written as triggers2');
      await hook(page, 'applyPreset', 'modelling');
    },
  },
  {
    id: 'reimport-dds',
    name: 'auto-reimport: the model saved again reloads with parts kept · textures exported as DDS',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      const meshes = async () => (await hook(page, 'sceneStats')).meshes;
      for (let i = 0; i < 300 && (await meshes()) < 30; i++) await page.waitForTimeout(100);
      const before = await meshes();
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      const parts = (await hook(page, 'partNames')).length;
      // "Blender" saves the model again: a texture on the paint and a new spoiler.
      const dir = join(userData, 'tutorial');
      writePng(join(dir, 'paint.png'), 64, 32);
      writeFileSync(join(dir, 'demo_car.mtl'), readFileSync(join(dir, 'demo_car.mtl'), 'utf8').replace('newmtl demo_paint', 'newmtl demo_paint\nmap_Kd paint.png'));
      const obj = readFileSync(join(dir, 'demo_car.obj'), 'utf8');
      const nv = obj.split('\n').filter((l) => l.startsWith('v ')).length;
      const spoiler = ['o spoiler', 'usemtl demo_paint', 'v 0.7 1.0 -2.0', 'v -0.7 1.0 -2.0', 'v 0 1.1 -2.1', 'vt 0 0', 'vt 1 0', 'vt 0.5 1', `f ${nv + 1}/1 ${nv + 2}/2 ${nv + 3}/3`].join('\n');
      writeFileSync(join(dir, 'demo_car.obj'), `${obj}${spoiler}\n`);
      for (let i = 0; i < 100 && (await meshes()) === before; i++) await page.waitForTimeout(100);
      assert((await meshes()) === before + 1, `reloaded with the new mesh (${before} → ${await meshes()})`);
      assert((await hook(page, 'partNames')).length === parts, 'the parts are kept');
      if (await page.getByTestId('classify-skip').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('classify-skip').click();
      await shot(page, 'reimported');
      // This mod's textures as DDS (the Inspector with nothing picked).
      await hook(page, 'selectMeshes', []);
      await page.getByText('Convert textures to DDS when exporting').click();
      const out = await hook(page, 'finalExport');
      const dds = out.files.filter((f) => f.path.endsWith('.dds'));
      assert(dds.length >= 1 && dds.every((f) => f.head === 'DDS '), `textures written as DDS (${out.files.map((f) => f.path).join(', ')})`);
      assert(/paint\.dds/.test(out.materials) && !/paint\.png/.test(out.materials), 'materials point at the .dds');
    },
  },
  {
    id: 'workspace-widths',
    name: 'every workspace lays out with usable panel widths',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (!(await page.locator('[data-view=editor]').count())) {
        await page.getByTestId('home-new').click();
        await page.getByTestId('newmod-name').fill('Widths');
        await page.getByTestId('newmod-create').click();
        await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      }
      const narrow = [];
      for (const preset of ['modelling', 'model', 'materials', 'jbeam', 'suspension', 'moving', 'triggers', 'scripts', 'testing', 'engine', 'tyres', 'wheels', 'panel']) {
        await hook(page, 'applyPreset', preset);
        await page.waitForTimeout(150);
        const groups = await page.evaluate(() => [...document.querySelectorAll('.dv-groupview')].map((g) => ({ w: Math.round(g.getBoundingClientRect().width), h: Math.round(g.getBoundingClientRect().height), tabs: [...g.querySelectorAll('.dv-tab')].map((x) => x.textContent.trim()).join('+') })));
        for (const g of groups) if (g.w < 200 || g.h < 120) narrow.push(`${preset}: ${g.tabs} ${g.w}×${g.h}`);
      }
      await hook(page, 'applyPreset', 'modelling');
      assert(!narrow.length, `no squeezed panels (${narrow.join('; ')})`);
    },
  },
  {
    id: 'undo-steps',
    name: 'every action is its own undo step; Ctrl+Z takes them back one at a time; the undo limit setting',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        await page.waitForSelector('[data-view=home][data-testid=app-ready], [data-testid=unsaved-discard]');
        if (await page.getByTestId('unsaved-discard').isVisible()) await page.getByTestId('unsaved-discard').click();
        await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      }
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Undo Car');
      await page.getByTestId('newmod-create').click();
      await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      await hook(page, 'applyPreset', 'modelling');
      const doc = () => hook(page, 'projectDoc');
      const labels = async () => (await hook(page, 'projectState')).undoLabels;
      const base = (await hook(page, 'projectState')).undo;

      // Four quick clicks and some typing: five actions, five steps.
      await page.getByTestId('ported-add').click();
      await page.getByTestId('ported-fields').waitFor();
      await page.getByTestId('ported-game').click();
      await page.keyboard.type('Assetto Corsa', { delay: 10 });
      const owned = page.getByTestId('ported-fields').getByRole('checkbox').nth(0);
      const free = page.getByTestId('ported-fields').getByRole('checkbox').nth(1);
      await owned.click();
      await free.click();
      await owned.click(); // untick again straight away: still a step of its own
      let st = await hook(page, 'projectState');
      assert(st.undo - base === 5, `five actions, five undo steps (got ${st.undo - base}: ${st.undoLabels.join(', ')})`);
      let p = (await doc()).meta.portedFrom;
      assert(p.game === 'Assetto Corsa' && p.owned === false && p.free === true, `state after the clicks (${JSON.stringify(p)})`);

      // Ctrl+Z with focus on the checkbox: the document's undo, one step each.
      const expected = [
        (x) => x?.owned === true && x.free === true,
        (x) => x?.owned === true && x.free === false,
        (x) => x?.owned === false && x.game === 'Assetto Corsa',
        (x) => x?.game === '',
        (x) => x === undefined,
      ];
      for (const [i, ok] of expected.entries()) {
        await hook(page, 'runCommand', 'undo');
        p = (await doc()).meta.portedFrom;
        assert(ok(p), `undo ${i + 1} takes back one action (${JSON.stringify(p)})`);
      }
      assert((await hook(page, 'projectState')).undo === base, 'back to where it started');
      // …and redo brings them back one at a time.
      for (let i = 0; i < 5; i++) await hook(page, 'runCommand', 'redo');
      p = (await doc()).meta.portedFrom;
      assert(p?.owned === false && p.free === true && p.game === 'Assetto Corsa', 'redo replays all five');

      // The real keys: Ctrl+Z and Ctrl+Y (the menu's accelerators).
      await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.keyboard.press('Control+z');
      for (let i = 0; i < 20 && (await doc()).meta.portedFrom?.owned !== true; i++) await page.waitForTimeout(50);
      assert((await doc()).meta.portedFrom?.owned === true, 'Ctrl+Z undoes the last action');
      await page.keyboard.press('Control+y');
      for (let i = 0; i < 20 && (await doc()).meta.portedFrom?.owned !== false; i++) await page.waitForTimeout(50);
      assert((await doc()).meta.portedFrom?.owned === false, 'Ctrl+Y redoes it');

      // A focused text field with nothing of its own to undo doesn't swallow Ctrl+Z.
      await page.getByTestId('ported-game').focus();
      await hook(page, 'runCommand', 'undo');
      assert((await doc()).meta.portedFrom?.owned === true, `undo from a focused field still undoes the last action (${await labels()})`);
      await hook(page, 'runCommand', 'redo');

      // The undo limit setting: lowering it drops the oldest steps straight away.
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      const limit = page.getByRole('spinbutton', { name: 'Undo steps kept' }).or(page.getByLabel('Undo steps kept')).first();
      await limit.scrollIntoViewIfNeeded();
      await limit.fill('3');
      await limit.press('Enter');
      await page.getByTestId('settings-save').click();
      await page.getByTestId('settings-modal').waitFor({ state: 'detached' });
      for (let i = 0; i < 30 && (await hook(page, 'projectState')).undo > 3; i++) await page.waitForTimeout(100);
      st = await hook(page, 'projectState');
      assert(st.undo === 3, `undo limit 3 keeps three steps (got ${st.undo})`);
      for (let i = 0; i < 5; i++) await hook(page, 'runCommand', 'undo');
      p = (await doc()).meta.portedFrom;
      assert(p?.game === 'Assetto Corsa' && p.owned === false && p.free === false, `only three steps come back (${JSON.stringify(p)})`);
      assert((await hook(page, 'projectState')).dirty, 'still reads as changed');

      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await limit.fill('1000');
      await limit.press('Enter');
      await page.getByTestId('settings-save').click();
      await page.getByTestId('settings-modal').waitFor({ state: 'detached' });
      // Ctrl+Z while typing takes back the typing, and nothing else.
      const before = (await doc()).meta.portedFrom;
      const credit = page.getByTestId('ported-fields').locator('input').nth(1);
      await credit.click();
      await page.keyboard.type('Kunos', { delay: 10 });
      for (let i = 0; i < 20 && (await doc()).meta.portedFrom?.credit !== 'Kunos'; i++) await page.waitForTimeout(50);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
      p = (await doc()).meta.portedFrom;
      assert(p?.credit !== 'Kunos' && p?.owned === before.owned && p.free === before.free && p.game === before.game, `Ctrl+Z in a field undoes the typing only (${JSON.stringify(p)})`);
      await hook(page, 'runCommand', 'close');
      await page.getByTestId('unsaved-discard').click();
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
    },
  },
  {
    id: 'part-mods',
    name: 'part mods: a tyre mod and a wheel mod from the wizard · their builders · universal export',
    async run({ page }) {
      const home = async () => {
        await page.waitForSelector('[data-testid=app-ready]');
        if (await page.locator('[data-view=editor]').count()) {
          await hook(page, 'runCommand', 'close');
          if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
        }
        await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      };
      await home();
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-kind-tyres').click();
      await page.getByTestId('newmod-name').fill('Forge Grip');
      await page.getByText("Import the tyre's 3D model right after creating").click();
      await shot(page, 'newmod-kinds');
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('tyre-builder').waitFor();
      const builderWidth = await page.evaluate(() => document.querySelector('[data-testid=tyre-builder]').closest('.dv-groupview').getBoundingClientRect().width);
      assert(builderWidth >= 300, `the tyre builder gets its width (${Math.round(builderWidth)} px)`);
      const tabs = (await page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab').allTextContents()).join(',');
      assert(tabs === 'Tyre builder,Materials', `a tyre mod has its own workspaces (${tabs})`);
      await page.getByTestId('tyre-add-size').click();
      await page.getByTestId('tyre-tread').click();
      await page.getByRole('option', { name: 'Slick', exact: true }).click();
      await shot(page, 'tyre-builder');
      let out = await hook(page, 'finalExport');
      const tyres = out.files.find((f) => f.path === 'vehicles/common/forge_grip/forge_grip_tyres.jbeam');
      assert(tyres, `tyres written for every car (${out.files.map((f) => f.path).join(', ')})`);
      const doc = await hook(page, 'projectDoc');
      assert(doc.tyre.sizes.length === 2 && doc.tyre.tread === 'slick' && doc.tyre.treadCoef === 0, 'sizes and tread set');
      await home();
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-kind-wheels').click();
      await page.getByTestId('newmod-name').fill('Forge Five');
      await page.getByText("Import the wheel's 3D model right after creating").click();
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('wheel-builder').waitFor();
      out = await hook(page, 'finalExport');
      assert(out.files.some((f) => f.path === 'vehicles/common/forge_five/forge_five_wheels.jbeam'), 'wheels written for every car');
    },
  },
  {
    id: 'modelling',
    name: 'Modelling: reshape the hood (points, faces, move, extrude, flip, delete, undo) · the file saved again asks which version to keep',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      const demo = await page.evaluate(() => window.forge.invoke('tutorial:demoModel'));
      assert(demo.ok, 'practice car model written');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Model Test');
      await hook(page, 'queueDialog', [demo.value.path]);
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-confirm').click();
      await page.getByTestId('classify-apply').click({ timeout: 30_000 });
      // The first tab is Parts; Modelling is the one next to it.
      assert((await page.getByTestId('workspace-modelling').textContent()).includes('Parts'), 'first tab reads Parts');
      await page.getByTestId('workspace-model').click();
      await page.getByTestId('modelling-panel').waitFor();
      const open = await openPanels(page);
      assert(JSON.stringify(open) === JSON.stringify(['modelling', 'scene', 'viewport']), `Modelling panels ${open}`);
      await shot(page, 'modelling-start');
      // Pick the hood and reshape it.
      let doc = await hook(page, 'projectDoc');
      const hood = `${doc.sources[0].id}:hood`;
      await hook(page, 'selectMeshes', [hood]);
      await hook(page, 'frameMeshes', '^hood$');
      await hook(page, 'viewFrom', [0.9, 1.1, 1.3]);
      await hook(page, 'frameMeshes', '^hood$');
      await page.waitForTimeout(500);
      await page.getByTestId('model-start').click();
      await page.getByTestId('model-toolbar').waitFor();
      assert((await hook(page, 'modelUi')).key === hood, 'reshaping the hood');
      // A click on the hood picks its nearest point.
      const vp = await page.locator('[data-panel=viewport] canvas').boundingBox();
      await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height / 2);
      let ui = await hook(page, 'modelUi');
      assert(ui.points === 1, `one point picked (${JSON.stringify(ui)})`);
      // L picks everything joined on; move it all up 5 cm (one undo step).
      await page.locator('[data-panel=viewport] canvas').focus();
      await page.keyboard.press('l');
      ui = await hook(page, 'modelUi');
      assert(ui.points > 20, `linked points picked (${ui.points})`);
      await page.waitForTimeout(300);
      await shot(page, 'modelling-linked');
      await page.keyboard.press('Escape');
      await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height / 2);
      await hook(page, 'modelMove', [0, 0, 0.05]);
      doc = await hook(page, 'projectDoc');
      assert(Object.keys(doc.meshModels?.[hood]?.moved ?? {}).length === 1, 'the point moved');
      await page.waitForTimeout(300);
      await shot(page, 'modelling-point-moved');
      // Faces: pick one, extrude it out, flip it, delete it.
      await page.keyboard.press('3');
      await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height / 2);
      ui = await hook(page, 'modelUi');
      assert(ui.mode === 'face' && ui.faces === 1, `face mode, one face (${JSON.stringify(ui)})`);
      await page.keyboard.press('e');
      doc = await hook(page, 'projectDoc');
      const m = doc.meshModels[hood];
      assert(m.added.length === 6 && m.points.length === 3, `extruded: walls ${m.added.length}, points ${m.points.length}`);
      await hook(page, 'modelMove', [0, 0, 0.12]);
      await page.waitForTimeout(300);
      await shot(page, 'modelling-extruded');
      await page.keyboard.press('Alt+n');
      doc = await hook(page, 'projectDoc');
      assert(doc.meshModels[hood].flipped.length === 1, 'face flipped');
      await page.keyboard.press('x');
      doc = await hook(page, 'projectDoc');
      assert(doc.meshModels[hood].removed.length === 1, 'face deleted');
      // Undo takes them back one at a time.
      await page.keyboard.press('Control+z');
      doc = await hook(page, 'projectDoc');
      assert(doc.meshModels[hood].removed.length === 0 && doc.meshModels[hood].flipped.length === 1, 'undo brings the face back');
      await page.getByTestId('model-done').click();
      assert((await hook(page, 'modelUi')).key === null, 'finished reshaping');
      await shot(page, 'modelling-done');
      // "Blender" saves the file again: asked which version to keep.
      const obj = readFileSync(demo.value.path, 'utf8');
      const nv = obj.split('\n').filter((l) => l.startsWith('v ')).length;
      const tri = (name) => [`o ${name}`, 'usemtl demo_paint', 'v 0.7 1.0 -2.0', 'v -0.7 1.0 -2.0', 'v 0 1.1 -2.1', `f ${nv + 1} ${nv + 2} ${nv + 3}`].join('\n');
      writeFileSync(demo.value.path, `${obj}${tri('test_wing')}\n`);
      await page.getByTestId('confirm-no').waitFor({ timeout: 15_000 });
      await shot(page, 'modelling-reimport-ask');
      await page.getByTestId('confirm-no').click();
      doc = await hook(page, 'projectDoc');
      assert(doc.meshModels?.[hood], 'kept the reshaped version');
      assert(!(await hook(page, 'sceneStats')).meshNames.includes('test_wing'), 'the file was not reloaded');
      writeFileSync(demo.value.path, `${obj}${tri('test_wing')}\n\n`);
      await page.getByTestId('confirm-yes').waitFor({ timeout: 15_000 });
      await page.getByTestId('confirm-yes').click();
      for (let i = 0; i < 100 && !(await hook(page, 'sceneStats')).meshNames.includes('test_wing'); i++) await page.waitForTimeout(100);
      doc = await hook(page, 'projectDoc');
      assert(!doc.meshModels?.[hood], 'the new file replaced the reshaped hood');
      assert((await hook(page, 'sceneStats')).meshNames.includes('test_wing'), 'the new file was loaded');
      if (await page.getByTestId('classify-skip').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('classify-skip').click();
      writeFileSync(demo.value.path, obj);
      await hook(page, 'applyPreset', 'modelling');
    },
  },
  {
    id: 'credits',
    name: 'Help → Credits: the practice car’s author, licence and source, and the software',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      await page.getByTestId('open-help').first().click();
      await page.getByTestId('guide-credits').click();
      const credits = page.getByTestId('help-credits');
      await credits.waitFor();
      const text = await credits.textContent();
      for (const want of ['1982 BMW 3 Series E30', 'zairiq-zairiq-123-pixar-cars-bfdi', 'Creative Commons Attribution', 'three.js']) assert(text.includes(want), `credits mention ${want}`);
      assert((await credits.locator('a[href*="sketchfab.com/3d-models/1982-bmw-3-series-e30"]').count()) === 1, 'links to the model');
      await shot(page, 'help-credits');
      await page.keyboard.press('Escape');
    },
  },
  {
    id: 'reference-car',
    name: 'a reference model (JBFORGE_REF_MODEL) from the practice car’s angles, for comparing shapes',
    skip: () => !process.env.JBFORGE_REF_MODEL,
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Reference');
      await hook(page, 'queueDialog', [process.env.JBFORGE_REF_MODEL]);
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-confirm').click({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Leave unassigned' }).click({ timeout: 30_000 });
      await hook(page, 'applyPreset', 'modelling');
      await page.waitForTimeout(800);
      const views = { 'front-left': [3.2, 1.3, 3.6], side: [5, 0.6, 0], front: [0, 0.8, 5], 'rear-left-low': [2.6, 0.5, -3.2], 'front-right-low': [-3.4, 0.7, 3.4] };
      for (const [name, dir] of Object.entries(views)) {
        await hook(page, 'viewFrom', dir);
        await page.waitForTimeout(500);
        await shot(page, `reference-${name}`);
      }
    },
  },
  {
    id: 'skins',
    name: 'Skin studio: practice car laid out for skins · stretch view · template PNG and SVG · on the car · skin from a painted template · export',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      // The practice car (the tour's model): a body, hood, trunk, doors, bumpers, mirrors, wheels, glass.
      const demo = await page.evaluate(() => window.forge.invoke('tutorial:demoModel'));
      assert(demo.ok, `practice car model written (${JSON.stringify(demo).slice(0, 200)})`);
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Skin Test');
      await hook(page, 'queueDialog', [demo.value.path]);
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-confirm').click();
      await page.getByTestId('classify-apply').click({ timeout: 30_000 });
      await hook(page, 'applyPreset', 'materials');
      await page.getByTestId('toggle-skins').click();
      await page.getByTestId('skin-studio').waitFor();
      await page.getByTestId('skin-step-1').click();
      await page.getByTestId('skin-parts').waitFor();
      const picked = await page.getByTestId('skin-parts').locator('[role=checkbox][data-state=checked]').count();
      await shot(page, 'skin-studio-step1');
      await page.getByTestId('skin-next').click();
      await page.getByTestId('skin-stats').waitFor({ timeout: 15_000 });
      assert(picked >= 5, `body panels picked by default (${picked} parts)`);
      await page.waitForTimeout(400);
      await shot(page, 'skin-studio-plan');
      await page.getByTestId('skin-apply').click();
      let doc = await hook(page, 'projectDoc');
      const laid = Object.entries(doc.meshEdits).filter(([, e]) => e.uv.project?.kind === 'skin');
      assert(laid.length >= 5 && laid.every(([, e]) => e.uv.project.layout.scale > 0), `panels laid out for skins (${laid.length})`);
      const glass = Object.keys(doc.meshEdits).filter((k) => /glass|window|wheel|tyre|seat/i.test(k) && doc.meshEdits[k].uv.project?.kind === 'skin');
      assert(!glass.length, `glass, wheels and seats left alone (${glass.join(', ')})`);
      await page.getByTestId('skin-studio').getByRole('tab', { name: 'Stretch' }).click();
      await page.waitForTimeout(400);
      await shot(page, 'skin-studio-stretch');
      await page.getByTestId('skin-studio').getByRole('tab', { name: 'Parts', exact: true }).click();
      // The template, as PNG (4096 square) and layered SVG.
      const work = mkdtempSync(join(tmpdir(), 'jbf-skin-'));
      const png = join(work, 'skin_test_skin_template.png');
      await hook(page, 'queueDialog', [png]);
      await page.getByTestId('skin-save-png').click();
      await page.getByTestId('status-bar').getByText(/Template saved/).waitFor({ timeout: 30_000 });
      const head = readFileSync(png);
      assert(head.readUInt32BE(16) === 4096 && head.readUInt32BE(20) === 4096, `template is 4096 × 4096 (${head.readUInt32BE(16)} × ${head.readUInt32BE(20)})`);
      const svgPath = join(work, 'skin_test_skin_template.svg');
      await hook(page, 'queueDialog', [svgPath]);
      await page.getByTestId('skin-save-svg').click();
      await page.getByTestId('status-bar').getByText(/Template saved: .*\.svg/).waitFor({ timeout: 30_000 });
      const svg = readFileSync(svgPath, 'utf8');
      assert(svg.includes('inkscape:groupmode="layer"') && svg.includes('Left side') && /data-part="[^"]*(Door|door)/.test(svg), 'SVG has layers, view titles and part names');
      // The template on the car.
      await page.getByText('Show the template on the car').click();
      await page.waitForTimeout(800);
      await shot(page, 'skin-template-on-car');
      await page.getByText('Show the template on the car').click();
      // A skin from the painted template (here: the template itself).
      await hook(page, 'queueDialog', [png]);
      await page.getByTestId('skin-new').click();
      // Shared trim was split when laying out, so the skin never lands outside the layout.
      await page.getByTestId('status-bar').getByText(/Skin ".*" made from/).waitFor({ timeout: 15_000 });
      doc = await hook(page, 'projectDoc');
      const skin = doc.features.skins[0];
      assert(skin && Object.values(skin.overrides).every((o) => o.baseColorMap === png), `skin made with the image on the laid-out materials (${JSON.stringify(skin).slice(0, 300)})`);
      await page.waitForTimeout(800);
      await shot(page, 'skin-on-car');
      cpSync(png, join(outDir, 'skin-template.png'));
      cpSync(svgPath, join(outDir, 'skin-template.svg'));
      const out = await hook(page, 'finalExport');
      assert(/\.skin\.|skin/.test(out.materials) && out.copies.some((c) => c.endsWith('.png') || c.endsWith('.dds')), 'the skin exports as game materials with its texture');
      rmSync(work, { recursive: true, force: true });
    },
  },
  {
    id: 'panel-mod',
    name: 'body panel mod: a car in the install · pick its hood · stock guide · own model · export on the stock physics',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      // A car in the install: a body, a hood with its own nodes and beams, a front bumper.
      const dae = readFileSync(join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae'));
      const jbeam = {
        fakecar_body: { information: { name: 'Body' }, slotType: 'main', slots: [['type', 'default', 'description'], ['fakecar_hood', 'fakecar_hood', 'Hood']], flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_body', ['fakecar_body']]], nodes: [['id', 'posX', 'posY', 'posZ'], ['b1', 0, -1, 0.5]] },
        fakecar_hood: { information: { name: 'Hood', value: 400 }, slotType: 'fakecar_hood', flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_wheel_FL', ['fakecar_hood']]], nodes: [['id', 'posX', 'posY', 'posZ'], { group: 'fakecar_hood' }, ['h1', 0, -1.5, 0.9], ['h2', 0.5, -1.5, 0.9]], beams: [['id1:', 'id2:'], ['h1', 'h2'], ['h1', 'b1']] },
        fakecar_bumper_F: { information: { name: 'Front bumper' }, slotType: 'fakecar_bumper_F', flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_mirror', ['fakecar_bumper_F']]] },
      };
      const zipPath = join(fakeInstall, 'content', 'vehicles', 'fakepanel.zip');
      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(JSON.stringify(jbeam)), 'vehicles/fakepanel/fakepanel.jbeam');
        zip.addBuffer(dae, 'vehicles/fakepanel/fakepanel.dae');
        zip.addBuffer(Buffer.from(JSON.stringify({ Name: 'Panel Car', Brand: 'Forge' })), 'vehicles/fakepanel/info.json');
        zip.end();
        zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
      });
      try {
        await page.evaluate((dir) => window.forge.invoke('settings:update', { beamngInstallDir: dir }), fakeInstall);
        const scan = await page.evaluate(() => window.forge.invoke('library:rescan'));
        assert(scan.ok, `library rescanned (${JSON.stringify(scan).slice(0, 200)})`);
        await page.getByTestId('home-new').click();
        await page.getByTestId('newmod-kind-panel').click();
        await page.getByTestId('newmod-name').fill('Vented Hood');
        await shot(page, 'panel-mod-wizard');
        await page.getByTestId('newmod-create').click();
        const tabs = (await page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab').allTextContents()).join(',');
        assert(tabs === 'Panel builder,Materials', `a panel mod has its own workspaces (${tabs})`);
        await page.getByTestId('panel-picker').waitFor({ timeout: 15_000 });
        await page.getByTestId('panel-pick-fakecar_hood').click();
        await page.getByTestId('panel-builder').waitFor();
        const width = await page.evaluate(() => document.querySelector('[data-testid=panel-builder]').closest('.dv-groupview').getBoundingClientRect().width);
        assert(width >= 300, `the panel builder gets its width (${Math.round(width)} px)`);
        // The stock hood as a guide.
        await page.getByTestId('panel-guide').click();
        let st;
        for (let i = 0; i < 200; i++) {
          st = await hook(page, 'sceneStats');
          if (st.sources.length === 1 && st.sources[0].status === 'ready') break;
          await page.waitForTimeout(100);
        }
        assert(st.sources.length === 1 && st.meshes > 0, `stock hood in as a guide (${JSON.stringify(st.sources.map((s) => s.status))})`);
        // Our model.
        await hook(page, 'queueDialog', [join(ROOT, 'tests', 'fixtures', 'models', 'uv_box.obj')]);
        await page.getByTestId('panel-import').click();
        await page.getByTestId('import-confirm').click();
        if (await page.getByTestId('classify-skip').isVisible({ timeout: 2000 }).catch(() => false)) await page.getByTestId('classify-skip').click();
        for (let i = 0; i < 200; i++) {
          st = await hook(page, 'sceneStats');
          if (st.sources.length === 2 && st.sources.every((s) => s.status === 'ready')) break;
          await page.waitForTimeout(100);
        }
        await page.waitForTimeout(500);
        await shot(page, 'panel-mod-builder');
        const doc = await hook(page, 'projectDoc');
        assert(doc.panel?.part === 'fakecar_hood' && doc.panel.guideSourceId, 'panel and guide recorded');
        const out = await hook(page, 'finalExport');
        const paths = out.files.map((f) => f.path);
        assert(paths.includes('vehicles/fakepanel/vented_hood_fakecar_hood.jbeam') && paths.includes('vehicles/common/vented_hood/vented_hood.dae'), `panel written beside the car, mesh in common (${paths.join(', ')})`);
        const jb = await hook(page, 'preparedJbeams');
        const text = jb.files.find((f) => f.path.endsWith('vented_hood_fakecar_hood.jbeam')).text;
        assert(/"slotType"\s*:\s*"fakecar_hood"/.test(text) && /"fakecar_hood"\s*\]/.test(text) && /"h1"/.test(text), 'the stock slot, node groups and nodes');
        assert(!/fixture_wheel_FL/.test(text), 'the guide is not in the mod');
      } finally {
        rmSync(zipPath, { force: true });
      }
    },
  },
  {
    id: 'extension-toolbox',
    name: 'example extension: install from Settings · pick a folder · import every model in it',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Toolbox Test');
      await page.getByText('Import a 3D model right after creating').click();
      await page.getByTestId('newmod-create').click();
      await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await page.getByRole('button', { name: 'Extensions' }).first().click();
      await page.getByTestId('extension-example-forge-toolbox').click();
      await page.getByTestId('extension-list').getByText('Forge toolbox').first().waitFor();
      await page.getByTestId('extension-list').getByText(/Running: 2 commands/).first().waitFor({ timeout: 15_000 });
      await page.getByTestId('extension-list').getByText(/read folders you pick for it/).waitFor();
      await shot(page, 'extension-examples');
      await page.keyboard.press('Escape');
      await hook(page, 'queueDialog', [join(ROOT, 'tests', 'fixtures', 'models')]);
      await hook(page, 'runCommand', 'palette');
      await page.getByTestId('palette-input').fill('Import every model');
      await page.getByTestId('palette-input').press('Enter');
      let st;
      for (let i = 0; i < 200; i++) {
        st = await hook(page, 'sceneStats');
        if (st.sources.length >= 3 && st.sources.every((x) => x.status === 'ready')) break;
        await page.waitForTimeout(100);
      }
      assert(st.sources.length === 3, `every model in the folder imported (${st.sources.length})`);
      await page.getByTestId('status-bar').getByText(/Imported 3 models/).waitFor({ timeout: 5000 });
    },
  },
  {
    id: 'beamng-importer',
    name: 'example extension: BeamNG vehicle importer · zip → models, default configuration’s structure, declaration, reference files',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      // A small vehicle zip: a main part with a hood slot (two hoods, the .pc picks one), a tuning variable, a model.
      const work = mkdtempSync(join(tmpdir(), 'jbf-bng-'));
      const dae = readFileSync(join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae'), 'utf8').replace(/fixture_body/g, 'fakecar_body').replace(/fixture_wheel_FL/g, 'fakecar_hood');
      const jbeam = {
        fakecar_body: {
          information: { name: 'Body', authors: 'Tester' },
          slotType: 'main',
          slots: [['type', 'default', 'description'], ['fakecar_hood', 'fakecar_hood_alt', 'Hood'], ['fakecar_spoiler', '', 'Spoiler']],
          flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fakecar_body', ['fakecar_body']]],
          variables: [['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'], ['$spring', 'range', 'N/m', 'Body', 501000, 1000, 900000, 'Spring', 'Body spring']],
          nodes: [['id', 'posX', 'posY', 'posZ'], { nodeWeight: 10 }, { collision: true }, ['b1', 0, -1, 0.5], ['b2', 1, -1, 0.5], ['b3', 0, 0, 0.5], ['b4', 0, -1, 1.2, { nodeWeight: 5 }]],
          beams: [['id1:', 'id2:'], { beamSpring: '$spring', beamDamp: 150 }, ['b1', 'b2'], ['b2', 'b3'], ['b1', 'b3'], ['b1', 'b4'], ['b2', 'b4'], ['b3', 'b4']],
          triangles: [['id1:', 'id2:', 'id3:'], ['b1', 'b2', 'b3']],
        },
        fakecar_hood: { information: { name: 'Hood' }, slotType: 'fakecar_hood', flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fakecar_hood', ['fakecar_hood']]], nodes: [['id', 'posX', 'posY', 'posZ'], ['h1', 0, -1.5, 0.9], ['h2', 0.5, -1.5, 0.9]], beams: [['id1:', 'id2:'], ['h1', 'h2'], ['h1', 'b1']] },
        fakecar_hood_alt: { information: { name: 'Other hood' }, slotType: 'fakecar_hood', nodes: [['id', 'posX', 'posY', 'posZ'], ['h1', 5, 5, 5]] },
      };
      const zipPath = join(work, 'fakecar.zip');
      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(JSON.stringify({ Name: 'Fake Car', Brand: 'Forge', Author: 'Tester', 'Body Style': 'Coupe', default_pc: 'default' })), 'vehicles/fakecar/info.json');
        zip.addBuffer(Buffer.from(JSON.stringify({ format: 2, model: 'fakecar', parts: { fakecar_hood: 'fakecar_hood' } })), 'vehicles/fakecar/default.pc');
        zip.addBuffer(Buffer.from(JSON.stringify(jbeam, null, 1)), 'vehicles/fakecar/fakecar.jbeam');
        zip.addBuffer(Buffer.from(dae), 'vehicles/fakecar/fakecar.dae');
        zip.addBuffer(Buffer.from('{}'), 'levels/not_a_car/info.json');
        zip.end();
        zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
      });
      await page.getByTestId('home-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await page.getByRole('button', { name: 'Extensions' }).first().click();
      await page.getByTestId('extension-example-beamng-importer').click();
      await page.getByTestId('extension-list').getByText(/BeamNG vehicle importer/).first().waitFor();
      await page.getByTestId('extension-list').getByText(/Running: 1 command/).first().waitFor({ timeout: 15_000 });
      await page.keyboard.press('Escape');
      await hook(page, 'queueDialog', [zipPath]);
      // Importers make a new mod, so their commands are on the home screen too.
      await page.getByTestId('home-extensions').waitFor();
      await shot(page, 'home-extension-commands');
      await page.getByTestId('home-ext-beamng-importer-import-vehicle').click();
      // The porting declaration is the user's to make.
      await page.getByTestId('confirm-yes').waitFor({ timeout: 30_000 });
      await shot(page, 'beamng-importer-declaration');
      await page.getByTestId('confirm-yes').click();
      await page.getByTestId('status-bar').getByText(/Fake Car: \d+ meshes, 6 nodes, 8 beams, 1 triangles/).waitFor({ timeout: 60_000 });
      const doc = await hook(page, 'projectDoc');
      assert(doc.meta.name === 'Fake Car (edit)' && doc.meta.slug === 'fakecar_edit', `new mod named after the car (${doc.meta.name}, ${doc.meta.slug})`);
      assert(doc.meta.portedFrom?.game === 'BeamNG.drive' && doc.meta.portedFrom.owned && doc.meta.portedFrom.free, 'porting declaration recorded');
      const h1 = doc.nodes.find((n) => n.id === 'h1');
      assert(h1 && h1.pos[0] === 0 && h1.pos[1] === -1.5 && h1.manual, `the .pc's hood, not the slot default (${JSON.stringify(h1)})`);
      const b4 = doc.nodes.find((n) => n.id === 'b4');
      assert(b4.weight === 5 && doc.nodes.find((n) => n.id === 'b1').weight === 10 && b4.options?.collision === true, `node weights and options (${JSON.stringify(b4)})`);
      assert(doc.beams.every((b) => b.options?.beamSpring === 501000 || b.id1 === 'h1'), 'tuning variable resolved to its default');
      assert(doc.tris.length === 1, 'collision triangle');
      assert(doc.reference?.kind === 'game' && doc.reference.files['fakecar.jbeam'] && doc.reference.files['default.pc'], 'jbeam and configuration kept for reference');
      const ignored = doc.ignoredMeshes.length;
      assert(ignored >= 3, `meshes no chosen part draws are set aside (${ignored})`);
      // The export carries the imported values and the credit.
      const jb = await hook(page, 'preparedJbeams');
      assert(!jb.errors.some((e) => e.code === 'PORTED'), `declaration complete (${JSON.stringify(jb.errors)})`);
      assert(jb.files.some((f) => /"beamSpring"\s*:\s*501000/.test(f.text)), 'beam values written');
      const out = await hook(page, 'finalExport');
      assert(out.files.some((f) => f.path.endsWith('/ported_from.txt')), 'ported_from.txt in the mod');
      await page.getByTestId('toggle-reference').click();
      await page.getByTestId('reference-panel').getByText('From BeamNG.drive').waitFor();
      await shot(page, 'beamng-importer-reference');
      await page.getByTestId('toggle-reference').click();
      rmSync(work, { recursive: true, force: true });
    },
  },
  {
    id: 'cms2021-importer',
    name: 'example extension: CMS 2021 importer (proof of concept) · exported models in centimetres → metres, parts, specs',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      // An "AssetStudio export": a body 450 units long (centimetres) and a wheel, plus the car's config.
      const work = mkdtempSync(join(tmpdir(), 'jbf-cms-'));
      const car = join(work, 'car_old_coupe');
      mkdirSync(join(car, 'Mesh'), { recursive: true });
      const box = (name, [sx, sy, sz], [ox, oy, oz]) => {
        const v = [];
        for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) v.push(`v ${ox + x * sx} ${oy + y * sy} ${oz + z * sz}`);
        const f = ['1 2 4 3', '5 7 8 6', '1 5 6 2', '3 4 8 7', '1 3 7 5', '2 6 8 4'].map((q) => `f ${q}`);
        return `o ${name}\n${v.join('\n')}\n${f.join('\n')}\n`;
      };
      writeFileSync(join(car, 'Mesh', 'body.obj'), box('body', [180, 130, 450], [-90, 20, -225]));
      writeFileSync(join(car, 'Mesh', 'wheel_fl.obj'), box('wheel_fl', [20, 60, 60], [70, 0, 110]));
      writeFileSync(join(car, 'config.txt'), 'name = Old Coupe\nmass = 1180\nengine = I4 1.6\nirrelevant = yes\n');
      await page.getByTestId('home-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await page.getByRole('button', { name: 'Extensions' }).first().click();
      await page.getByTestId('extension-example-cms2021-importer').click();
      await page.getByTestId('extension-list').getByText(/Running: 1 command/).first().waitFor({ timeout: 15_000 });
      await page.keyboard.press('Escape');
      await hook(page, 'queueDialog', [car]);
      await page.getByTestId('home-ext-cms2021-importer-import-car').click();
      await page.getByTestId('confirm-yes').waitFor({ timeout: 30_000 });
      await page.getByTestId('confirm-yes').click();
      await page.getByTestId('status-bar').getByText(/Old Coupe: 2 models/).waitFor({ timeout: 60_000 });
      const doc = await hook(page, 'projectDoc');
      assert(doc.meta.name === 'Old Coupe' && doc.meta.portedFrom?.game === 'Car Mechanic Simulator 2021', `named from the config, port declared (${doc.meta.name})`);
      assert(doc.sources.length === 2 && doc.sources.every((s) => s.placement.scale === 0.01), `centimetres scaled to metres (${doc.sources.map((s) => s.placement.scale)})`);
      assert(doc.reference?.specs?.mass === '1180' && !('irrelevant' in doc.reference.specs) && doc.reference.files['config.txt'], `specs read (${JSON.stringify(doc.reference?.specs)})`);
      await page.waitForTimeout(500);
      await shot(page, 'cms2021-importer');
      rmSync(work, { recursive: true, force: true });
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
    id: 'beamng-parts',
    name: 'suspension workshop with a real BeamNG install (--beamng-install)',
    skip: () => !realInstall,
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('Parts');
      await page.getByTestId('newmod-create').click();
      await page.waitForSelector('[data-view=editor]');
      // A car body to put axles on.
      await hook(page, 'queueDialog', [join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae')]);
      await page.getByTestId('toolbar-import').click();
      await page.getByTestId('import-confirm').click();
      if (await page.getByTestId('classify-skip').isVisible({ timeout: 3000 }).catch(() => false)) await page.getByTestId('classify-skip').click();
      const invoke = (channel, req) => page.evaluate(async ([c, r]) => (await window.forge.invoke(c, r)).value, [channel, req]);
      const started = Date.now();
      await invoke('settings:update', { beamngInstallDir: realInstall });
      let sets = [];
      for (let i = 0; i < 1800 && !sets.length; i++) {
        const lib = await invoke('library:status');
        if (!lib.scanning) sets = await invoke('suspension:catalogue');
        await page.waitForTimeout(100);
      }
      assert(sets.length > 50, `suspensions read from the install (${sets.length})`);
      partsReport = { sets: sets.length, ms: Date.now() - started, types: [...new Set(sets.map((s) => s.type))] };
      await page.getByTestId('toggle-suspension').click();
      await page.getByRole('button', { name: 'Set up axles' }).click();
      await page.getByTestId('suspension-picker').waitFor();
      await page.getByTestId('workshop-type').filter({ hasText: 'MacPherson strut' }).click();
      await page.waitForTimeout(800);
      await shot(page, 'suspension-brands');
      await page.getByTestId('workshop-brand').filter({ hasText: 'ETK' }).click();
      await page.getByTestId('workshop-vehicle').first().click();
      await page.waitForTimeout(3000);
      await shot(page, 'suspension-sets');
      const before = (await hook(page, 'sceneStats')).meshes;
      await page.getByTestId('workshop-fit').first().click();
      for (let i = 0; i < 300 && (await hook(page, 'sceneStats')).meshes === before; i++) await page.waitForTimeout(100);
      await page.getByTestId('suspension-panel').waitFor();
      const st = await hook(page, 'sceneStats');
      assert(st.meshes > before, 'suspension fitted');
      partsReport.fitted = st.meshNames.slice(-12);
      partsReport.parts = (await hook(page, 'partNames')).slice(-12);
      await page.waitForTimeout(800);
      await shot(page, 'suspension-fitted');
      // Tuning page, then the jbeam brought over into the mod.
      await page.getByTestId('axle-tune').first().click();
      await page.getByTestId('workshop-tuning').waitFor();
      await page.waitForTimeout(800);
      await shot(page, 'suspension-tuning');
      const prepared = await hook(page, 'preparedJbeams');
      const susp = prepared.files.filter((f) => /_F_etk800/.test(f.path));
      assert(susp.length >= 3, `suspension jbeam brought over (${prepared.files.map((f) => f.path).join(', ')})`);
      const root = susp.find((f) => /suspension_F\.jbeam$/.test(f.path));
      assert(root && /"f_[a-z0-9]+"/.test(root.text) && /parts_F_etk800_suspension_F/.test(prepared.files.map((f) => f.text).join(' ')), 'nodes renamed and the slot added');
      partsReport.jbeam = susp.map((f) => f.path);
      writeFileSync(join(outDir, 'suspension-root.jbeam'), root.text);

      // Engine and gearbox workshop.
      await page.getByTestId('toggle-powertrain').click();
      await page.getByTestId('powertrain-panel').waitFor();
      await page.getByTestId('engine-choose').click();
      await page.getByTestId('workshop-type').filter({ hasText: 'Inline-6' }).click();
      await page.getByTestId('workshop-brand').filter({ hasText: 'ETK' }).click();
      await page.getByTestId('workshop-vehicle').first().click();
      await page.waitForTimeout(3000);
      await shot(page, 'engine-choices');
      const before2 = (await hook(page, 'sceneStats')).meshes;
      await page.getByTestId('workshop-fit').first().click();
      await page.getByTestId('powertrain-panel').waitFor({ timeout: 60_000 });
      assert((await hook(page, 'sceneStats')).meshes > before2, 'engine fitted');
      await page.getByTestId('gearbox-choose').click();
      await page.getByTestId('workshop-type').filter({ hasText: 'Manual' }).click();
      await page.getByTestId('workshop-brand').filter({ hasText: 'ETK' }).click();
      await page.getByTestId('workshop-vehicle').first().click();
      await page.getByTestId('workshop-fit').first().click();
      await page.getByTestId('powertrain-panel').waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      await shot(page, 'powertrain-fitted');
      const prepared2 = await hook(page, 'preparedJbeams');
      const eng = prepared2.files.filter((f) => /parts_E_/.test(f.path));
      const gbx = prepared2.files.filter((f) => /parts_G_/.test(f.path));
      const allText = prepared2.files.map((f) => f.text).join(' ');
      assert(eng.length >= 3 && gbx.length >= 1, `engine and gearbox jbeam brought over (${eng.length} + ${gbx.length})`);
      assert(eng.some((f) => /"parts_G_[^"]*transmission/i.test(f.text)), "the engine's transmission slot points at the fitted gearbox");
      assert(/parts_E_[^"]*engine/.test(allText), 'the body carries the engine slot');
      partsReport.powertrain = { engine: eng.map((f) => f.path), gearbox: gbx.map((f) => f.path) };
      // The designer on the fitted engine: a preset changes its curve, revs and weight, and the export carries them.
      await page.getByTestId('engine-design').click();
      await page.getByTestId('engine-designer').waitFor();
      await page.getByTestId('engine-preset-s14').click();
      await page.waitForTimeout(500);
      const designed = (await hook(page, 'projectDoc')).powertrain.engine;
      assert(designed.edits.design?.valvetrain === 'dohc' && designed.edits.torque?.length > 10, 'the design is on the fitted engine');
      const limit = Object.entries(designed.edits.fields).find(([k]) => k.endsWith('/mainEngine/revLimiterRPM') || k.endsWith('/mainEngine/maxRPM'));
      assert(limit, `the rev limit is set (${Object.keys(designed.edits.fields).join(', ')})`);
      const designedJbeam = (await hook(page, 'preparedJbeams')).files.filter((f) => /parts_E_/.test(f.path)).map((f) => f.text).join(' ');
      assert(designedJbeam.includes(String(limit[1])), 'the exported engine has the designed rev limit');
      await shot(page, 'engine-designer-fitted');
      await page.getByRole('button', { name: 'Back' }).first().click();
      writeFileSync(join(outDir, 'beamng-parts-report.json'), JSON.stringify(partsReport, null, 1));
    },
  },
  {
    id: 'practice-real',
    name: 'the practice car with a real game suspension, engine and gearbox, exported and checked as the game reads it (--beamng-install)',
    skip: () => !realInstall,
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      const invoke = (channel, req) => page.evaluate(async ([c, r]) => (await window.forge.invoke(c, r)).value, [channel, req]);
      await invoke('settings:update', { beamngInstallDir: realInstall });
      for (let i = 0; i < 1800; i++) {
        const lib = await invoke('library:status');
        if (!lib.scanning && (await invoke('suspension:catalogue')).length) break;
        await page.waitForTimeout(100);
      }
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 40); i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'modelling');
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !((await hook(page, 'projectDoc')).nodes.length > 50); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(1500);
      // A front suspension from the game.
      await page.getByTestId('toggle-suspension').click();
      await page.getByRole('button', { name: 'Set up axles' }).click();
      await page.getByTestId('suspension-picker').waitFor();
      await page.getByTestId('workshop-type').filter({ hasText: 'MacPherson strut' }).click();
      await page.getByTestId('workshop-brand').filter({ hasText: 'ETK' }).click();
      await page.getByTestId('workshop-vehicle').first().click();
      await page.waitForTimeout(2000);
      await page.getByTestId('workshop-fit').first().click();
      await page.getByTestId('suspension-panel').waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1000);
      // And a rear one from the same car, so the gearbox drives the rear wheels.
      await page.getByTestId('axle-choose').first().click();
      await page.getByTestId('suspension-picker').waitFor();
      let rearType = null;
      for (const type of ['Independent', 'Double wishbone', 'Trailing arm', 'Solid axle']) {
        const t = page.getByTestId('workshop-type').filter({ hasText: type });
        if (!(await t.count())) continue;
        await t.first().click();
        await page.waitForTimeout(500);
        const etk = page.getByTestId('workshop-brand').filter({ hasText: 'ETK' });
        if (await etk.count()) {
          await etk.first().click();
          rearType = type;
          break;
        }
        await page.getByRole('button', { name: 'Back' }).first().click();
      }
      assert(rearType, 'an ETK rear suspension in the catalogue');
      await page.getByTestId('workshop-vehicle').first().click();
      await page.waitForTimeout(2000);
      await page.getByTestId('workshop-fit').first().click();
      await page.getByTestId('suspension-panel').waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1000);
      const axles = (await hook(page, 'projectDoc')).axles;
      assert(axles.length >= 2 && axles.every((a) => a.fitted), `front and rear suspensions fitted (${axles.map((a) => a.fitted?.setId ?? 'none').join(', ')}; rear: ${rearType})`);
      // An engine and gearbox from the game.
      await page.getByTestId('toggle-powertrain').click();
      await page.getByTestId('powertrain-panel').waitFor();
      await page.getByTestId('engine-choose').click();
      await page.getByTestId('workshop-type').filter({ hasText: 'Inline-6' }).click();
      await page.getByTestId('workshop-brand').filter({ hasText: 'ETK' }).click();
      await page.getByTestId('workshop-vehicle').first().click();
      await page.waitForTimeout(2000);
      await page.getByTestId('workshop-fit').first().click();
      await page.getByTestId('powertrain-panel').waitFor({ timeout: 60_000 });
      await page.getByTestId('gearbox-choose').click();
      await page.getByTestId('workshop-type').filter({ hasText: 'Manual' }).click();
      await page.getByTestId('workshop-brand').filter({ hasText: 'ETK' }).click();
      await page.getByTestId('workshop-vehicle').first().click();
      await page.getByTestId('workshop-fit').first().click();
      await page.getByTestId('powertrain-panel').waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      await shot(page, 'practice-real-fitted');
      // Advanced: the oil volume adjustable in the game's tuning menu, and a race version of one of the engine's parts.
      await page.getByTestId('engine-build').click();
      await page.getByTestId('engine-builder').waitFor();
      await page.getByRole('textbox', { name: 'Filter settings' }).fill('oil');
      await page.getByTestId('tunable-oilVolume').first().click();
      await page.getByRole('textbox', { name: 'Filter settings' }).fill('');
      const versionButtons = page.locator('[data-testid^=engine-version-add-]');
      assert((await versionButtons.count()) >= 2, 'the engine builder lists its parts');
      await versionButtons.nth(1).click();
      await shot(page, 'practice-real-engine-advanced');
      const engineEdits = (await hook(page, 'projectDoc')).powertrain.engine.edits;
      assert(Object.keys(engineEdits.tunable ?? {}).some((k) => k.endsWith('/oilVolume')), 'oil volume adjustable in game');
      assert(engineEdits.versions?.length === 1, 'a version of an engine part');
      await page.getByRole('button', { name: 'Back' }).first().click();
      // The rest of a finished car: every opening part hinged, plates, a hitch and nitrous, folding mirrors, a second configuration.
      await page.getByTestId('workspace-moving').click();
      await page.getByTestId('moving-parts').waitFor();
      await page.getByTestId('moving-hinge-all').click();
      await page.waitForTimeout(500);
      const hinged = (await hook(page, 'projectDoc')).hinges.length;
      assert(hinged >= 4, `doors, hood and trunk hinged (${hinged})`);
      await page.getByTestId('workspace-modelling').click();
      await page.getByTestId('toggle-features').click();
      await page.getByTestId('features-panel').waitFor();
      const extras = [];
      for (const kind of ['plateFront', 'plateRear', 'hitch', 'nitrous']) {
        const sw = page.getByTestId(`feature-${kind}`).getByRole('switch').first();
        if (!(await sw.count())) continue;
        await sw.click();
        extras.push(kind);
      }
      assert(extras.length >= 3, `extras switched on (${extras.join(', ')})`);
      await hook(page, 'applyPreset', 'scripts');
      await page.getByTestId('scripts-panel').waitFor();
      await page.getByTestId('scripts-view-gallery').click();
      await page.getByTestId('template-gallery').waitFor();
      await page.getByRole('button', { name: 'Add Folding mirrors' }).click();
      await page.getByTestId('script-panel').waitFor();
      if (await page.getByTestId('guide-offer').isVisible({ timeout: 1000 }).catch(() => false)) await page.getByTestId('guide-skip').click();
      const mirrors = (await hook(page, 'meshBounds')).filter((m) => /mirror/i.test(m.name)).map((m) => m.key);
      if (mirrors.length) {
        await hook(page, 'selectMeshes', mirrors);
        await page.getByTestId('script-use-selection').first().click();
      }
      await hook(page, 'applyPreset', 'modelling');
      await page.getByTestId('toggle-configs').click();
      await page.getByTestId('configs-panel').waitFor();
      await page.getByTestId('config-add').click();
      await page.getByTestId('config-name').fill('Stripped');
      await page.getByLabel('Front bumper part').click();
      await page.getByRole('option', { name: '(empty)' }).click();
      await page.getByTestId('toggle-configs').click();
      await shot(page, 'practice-real-finished');
      // Export → Install, then read it back the way the game does.
      await page.getByTestId('toolbar-export').click();
      await page.getByTestId('export-dialog').waitFor();
      await page.getByTestId('export-install').click();
      await page.getByTestId('export-result').waitFor({ timeout: 120_000 });
      await shot(page, 'practice-real-exported');
      const unpacked = join(fakeUserDir, 'mods', 'unpacked');
      const mod = readdirSync(unpacked).sort((a, b) => statSync(join(unpacked, b)).mtimeMs - statSync(join(unpacked, a)).mtimeMs)[0];
      const modDir = join(outDir, 'practice-real-mod');
      cpSync(join(unpacked, mod), modDir, { recursive: true });
      const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const lint = spawnSync(process.execPath, [tsx, '--tsconfig', join(ROOT, 'tsconfig.node.json'), join(ROOT, 'scripts', 'lint-mod.ts'), modDir], { encoding: 'utf8', env: { ...process.env, BEAMNG_INSTALL: realInstall } });
      writeFileSync(join(outDir, 'practice-real-lint.txt'), lint.stdout + lint.stderr);
      const vdir = join(modDir, 'vehicles', readdirSync(join(modDir, 'vehicles'))[0]);
      const check = spawnSync(process.execPath, [tsx, join(ROOT, 'scripts', 'dev', 'jbeamStability.mts'), vdir], { encoding: 'utf8', env: { ...process.env, STEPS: '6000' } });
      writeFileSync(join(outDir, 'practice-real-stability.txt'), check.stdout + check.stderr);
      // The second configuration too: the game spawns whichever the player picks.
      const pcs = readdirSync(vdir).filter((f) => f.endsWith('.pc') && f !== 'default.pc');
      const checks2 = pcs.map((pc) => ({ pc, r: spawnSync(process.execPath, [tsx, join(ROOT, 'scripts', 'dev', 'jbeamStability.mts'), vdir, pc], { encoding: 'utf8', env: { ...process.env, STEPS: '4000' } }) }));
      writeFileSync(join(outDir, 'practice-real-stability-configs.txt'), checks2.map((c) => `${c.pc}\n${c.r.stdout}${c.r.stderr}`).join('\n'));
      assert(lint.status === 0, `the mod lints clean:\n${(lint.stdout + lint.stderr).split('\n').slice(0, 25).join('\n')}`);
      assert(/RUN: \d+ steps .* stable/.test(check.stdout), `holds together at 2000 Hz:\n${check.stdout.split('\n').filter((l) => /RUN|worst|nodes,/.test(l)).join('\n')}${check.stderr.slice(0, 400)}`);
      assert(pcs.length >= 1, `the second configuration is exported (${readdirSync(vdir).filter((f) => f.endsWith('.pc')).join(', ')})`);
      for (const c of checks2) assert(/RUN: \d+ steps .* stable/.test(c.r.stdout), `${c.pc} holds together at 2000 Hz:\n${c.r.stdout.split('\n').filter((l) => /RUN|worst/.test(l)).join('\n')}${c.r.stderr.slice(0, 300)}`);
      for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) await page.keyboard.press('Escape');
    },
  },
  {
    id: 'importer-real',
    name: "the BeamNG vehicle importer on a car from the install (the Pigeon): imported, exported, and read back the way the game does (--beamng-install)",
    skip: () => !realInstall || !existsSync(join(realInstall, 'content', 'vehicles', 'pigeon.zip')),
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.evaluate((dir) => window.forge.invoke('settings:update', { beamngInstallDir: dir }), realInstall);
      await page.getByTestId('home-settings').click();
      await page.getByTestId('settings-modal').waitFor();
      await page.getByRole('button', { name: 'Extensions' }).first().click();
      const ext = page.getByTestId('extension-example-beamng-importer');
      if ((await ext.count()) && (await ext.isEnabled())) await ext.click(); // already added by an earlier scenario
      await page.getByTestId('extension-list').getByText(/Running: 1 command/).first().waitFor({ timeout: 15_000 });
      await page.keyboard.press('Escape');
      await hook(page, 'queueDialog', [join(realInstall, 'content', 'vehicles', 'pigeon.zip')]);
      await page.getByTestId('home-ext-beamng-importer-import-vehicle').click();
      await page.getByTestId('confirm-yes').waitFor({ timeout: 120_000 });
      await page.getByTestId('confirm-yes').click();
      let doc = null;
      for (let i = 0; i < 1800; i++) {
        doc = await hook(page, 'projectDoc').catch(() => null);
        if (doc?.nodes.length) break;
        await page.waitForTimeout(100);
      }
      assert(doc?.nodes.length > 50 && doc.beams.length > 100, `the Pigeon imported with its structure (${doc?.nodes.length} nodes, ${doc?.beams.length} beams)`);
      await page.waitForTimeout(2000);
      await shot(page, 'importer-real-pigeon');
      await page.getByTestId('toolbar-export').click();
      await page.getByTestId('export-dialog').waitFor();
      await shot(page, 'importer-real-export');
      await page.getByTestId('export-install').click();
      await page.getByTestId('export-result').waitFor({ timeout: 180_000 });
      const unpacked = join(fakeUserDir, 'mods', 'unpacked');
      const mod = readdirSync(unpacked).sort((a, b) => statSync(join(unpacked, b)).mtimeMs - statSync(join(unpacked, a)).mtimeMs)[0];
      const modDir = join(outDir, 'importer-real-mod');
      cpSync(join(unpacked, mod), modDir, { recursive: true });
      const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const lint = spawnSync(process.execPath, [tsx, '--tsconfig', join(ROOT, 'tsconfig.node.json'), join(ROOT, 'scripts', 'lint-mod.ts'), modDir], { encoding: 'utf8', env: { ...process.env, BEAMNG_INSTALL: realInstall } });
      writeFileSync(join(outDir, 'importer-real-lint.txt'), lint.stdout + lint.stderr);
      const vdir = join(modDir, 'vehicles', readdirSync(join(modDir, 'vehicles'))[0]);
      const check = spawnSync(process.execPath, [tsx, join(ROOT, 'scripts', 'dev', 'jbeamStability.mts'), vdir], { encoding: 'utf8', env: { ...process.env, STEPS: '4000' } });
      writeFileSync(join(outDir, 'importer-real-stability.txt'), check.stdout + check.stderr);
      for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) await page.keyboard.press('Escape');
      assert(lint.status === 0, `the imported Pigeon lints clean:\n${(lint.stdout + lint.stderr).split('\n').slice(0, 25).join('\n')}`);
      assert(/RUN: \d+ steps .* stable/.test(check.stdout), `holds together at 2000 Hz:\n${check.stdout.split('\n').filter((l) => /RUN|worst|nodes,/.test(l)).join('\n')}${check.stderr.slice(0, 400)}`);
    },
  },
  {
    id: 'part-mods-real',
    name: 'part mods against a real BeamNG install: tyres, wheels, an ETK hood and an ETK engine, installed and checked against the game (--beamng-install)',
    skip: () => !realInstall,
    async run({ page }) {
      const home = async () => {
        await page.waitForSelector('[data-testid=app-ready]');
        if (await page.locator('[data-view=editor]').count()) {
          await hook(page, 'runCommand', 'close');
          if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
        }
        await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      };
      const invoke = (channel, req) => page.evaluate(async ([c, r]) => (await window.forge.invoke(c, r)).value, [channel, req]);
      const unpacked = join(fakeUserDir, 'mods', 'unpacked');
      /** Export → Install, then check what was written against the game. */
      const installAndCheck = async (label) => {
        const before = new Set(existsSync(unpacked) ? readdirSync(unpacked) : []);
        await page.getByTestId('toolbar-export').click();
        await page.getByTestId('export-dialog').waitFor();
        await shot(page, `${label}-export`);
        await page.getByTestId('export-install').click();
        await page.getByTestId('export-result').waitFor({ timeout: 120_000 });
        const mod = readdirSync(unpacked).find((m) => !before.has(m)) ?? readdirSync(unpacked).sort((a, b) => statSync(join(unpacked, b)).mtimeMs - statSync(join(unpacked, a)).mtimeMs)[0];
        const dir = join(outDir, `${label}-mod`);
        cpSync(join(unpacked, mod), dir, { recursive: true });
        const r = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(ROOT, 'tsconfig.node.json'), join(ROOT, 'scripts', 'dev', 'checkPartMod.mts'), dir, realInstall], { encoding: 'utf8' });
        writeFileSync(join(outDir, `${label}-check.txt`), r.stdout + r.stderr);
        for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) await page.keyboard.press('Escape');
        return r;
      };
      await home();
      await invoke('settings:update', { beamngInstallDir: realInstall });
      for (let i = 0; i < 1800 && (await invoke('library:status')).scanning; i++) await page.waitForTimeout(100);
      const failures = [];

      // Tyres for every car.
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-kind-tyres').click();
      await page.getByTestId('newmod-name').fill('Forge Grip');
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-confirm').waitFor({ timeout: 5000 }).catch(() => undefined);
      if (await page.getByTestId('import-confirm').isVisible().catch(() => false)) await page.keyboard.press('Escape');
      await page.getByTestId('tyre-builder').waitFor();
      await hook(page, 'queueDialog', [join(ROOT, 'tests', 'fixtures', 'models', 'uv_box.obj')]);
      await page.getByTestId('toolbar-import').click();
      await page.getByTestId('import-confirm').click();
      if (await page.getByTestId('classify-skip').isVisible({ timeout: 2000 }).catch(() => false)) await page.getByTestId('classify-skip').click();
      for (let i = 0; i < 200 && !((await hook(page, 'projectDoc')).parts.length > 0); i++) await page.waitForTimeout(100);
      let r = await installAndCheck('tyres-real');
      if (r.status !== 0) failures.push(`tyres:\n${r.stdout}${r.stderr.slice(0, 400)}`);

      // Wheels for every car.
      await home();
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-kind-wheels').click();
      await page.getByTestId('newmod-name').fill('Forge Five');
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('import-confirm').waitFor({ timeout: 5000 }).catch(() => undefined);
      if (await page.getByTestId('import-confirm').isVisible().catch(() => false)) await page.keyboard.press('Escape');
      await page.getByTestId('wheel-builder').waitFor();
      await hook(page, 'queueDialog', [join(ROOT, 'tests', 'fixtures', 'models', 'uv_box.obj')]);
      await page.getByTestId('toolbar-import').click();
      await page.getByTestId('import-confirm').click();
      if (await page.getByTestId('classify-skip').isVisible({ timeout: 2000 }).catch(() => false)) await page.getByTestId('classify-skip').click();
      for (let i = 0; i < 200 && !((await hook(page, 'projectDoc')).parts.length > 0); i++) await page.waitForTimeout(100);
      r = await installAndCheck('wheels-real');
      if (r.status !== 0) failures.push(`wheels:\n${r.stdout}${r.stderr.slice(0, 400)}`);

      // A hood for the ETK 800, on its stock physics.
      await home();
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-kind-panel').click();
      await page.getByTestId('newmod-name').fill('Vented Hood');
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('panel-picker').waitFor({ timeout: 60_000 });
      await page.getByTestId('panel-car').click();
      await page.getByRole('option', { name: /ETK 800/ }).first().click();
      await page.getByTestId('panel-pick-etk800_hood').first().waitFor({ timeout: 30_000 });
      await shot(page, 'panel-real-picker');
      await page.getByTestId('panel-pick-etk800_hood').first().click();
      await page.getByTestId('panel-builder').waitFor();
      await hook(page, 'queueDialog', [join(ROOT, 'tests', 'fixtures', 'models', 'uv_box.obj')]);
      await page.getByTestId('panel-import').click();
      await page.getByTestId('import-confirm').click();
      if (await page.getByTestId('classify-skip').isVisible({ timeout: 2000 }).catch(() => false)) await page.getByTestId('classify-skip').click();
      for (let i = 0; i < 200 && !(await hook(page, 'sceneStats')).sources.every((s) => s.status === 'ready'); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(500);
      r = await installAndCheck('panel-real');
      if (r.status !== 0) failures.push(`panel:\n${r.stdout}${r.stderr.slice(0, 400)}`);

      // An engine for the ETK 800: its own inline-6, with a designer preset on it.
      await home();
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-kind-engine').click();
      await page.getByTestId('newmod-name').fill('Forge Six');
      await page.getByTestId('newmod-create').click();
      await page.getByTestId('powertrain-panel').waitFor({ timeout: 30_000 });
      await page.getByTestId('engine-choose').click();
      await page.getByTestId('workshop-type').filter({ hasText: 'Inline-6' }).click();
      await page.getByTestId('workshop-brand').filter({ hasText: 'ETK' }).click();
      await page.getByTestId('workshop-vehicle').first().click();
      await page.waitForTimeout(2000);
      await page.getByTestId('workshop-fit').first().click();
      await page.getByTestId('powertrain-panel').waitFor({ timeout: 60_000 });
      await page.getByTestId('engine-design').click();
      await page.getByTestId('engine-designer').waitFor();
      await page.getByTestId('engine-preset-s14').click();
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: 'Back' }).first().click();
      r = await installAndCheck('engine-real');
      if (r.status !== 0) failures.push(`engine:\n${r.stdout}${r.stderr.slice(0, 400)}`);

      assert(!failures.length, failures.join('\n'));
    },
  },
  {
    id: 'soak',
    name: 'soak: the practice car open for a while (--soak=<minutes>)',
    skip: () => !soakMinutes,
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 0); i++) await page.waitForTimeout(100);
      // What someone does on the practice car: sort it into parts and generate its structure (the tour stays open).
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !((await hook(page, 'projectDoc')).nodes.length > 50); i++) await page.waitForTimeout(100);
      const workspaces = ['modelling', 'materials', 'jbeam', 'moving', 'triggers', 'scripts', 'testing'];
      const canvas = () => page.locator('canvas:visible').first();
      const sample = async (t) => {
        const frameMs = await page.evaluate(
          () =>
            new Promise((done) => {
              let n = 0;
              const start = performance.now();
              const step = () => (++n < 60 ? requestAnimationFrame(step) : done((performance.now() - start) / 60));
              requestAnimationFrame(step);
            }),
        );
        const heap = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6));
        const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
        const gl = await hook(page, 'glStats').catch(() => null);
        const log = statSync(join(userData, 'logs', 'main.log')).size;
        return { t, frameMs: Math.round(frameMs * 10) / 10, heapMB: heap, dom, ...gl, logKB: Math.round(log / 1024) };
      };
      const rows = [await sample(0)];
      const end = Date.now() + soakMinutes * 60_000;
      let k = 0;
      while (Date.now() < end) {
        // A different workspace every few rounds, then orbit and hover like someone looking the car over.
        if (k % 3 === 0) {
          await hook(page, 'applyPreset', workspaces[(k / 3) % workspaces.length]);
          await page.waitForTimeout(500);
        }
        const box = (await canvas().boundingBox().catch(() => null)) ?? { x: 400, y: 200, width: 400, height: 300 };
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(box.x + box.width * (0.3 + 0.4 * Math.random()), box.y + box.height * (0.3 + 0.4 * Math.random()));
          await page.waitForTimeout(50);
        }
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down({ button: 'right' }).catch(() => undefined);
        await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 20, { steps: 10 });
        await page.mouse.up({ button: 'right' }).catch(() => undefined);
        if (++k % 10 === 0) {
          await hook(page, 'applyPreset', 'modelling');
          await page.waitForTimeout(300);
          rows.push(await sample(Math.round((soakMinutes * 60_000 - (end - Date.now())) / 1000)));
          console.log('      ', JSON.stringify(rows.at(-1)));
        }
      }
      await hook(page, 'applyPreset', 'modelling');
      await page.waitForTimeout(300);
      rows.push(await sample(soakMinutes * 60));
      writeFileSync(join(outDir, 'soak.json'), JSON.stringify(rows, null, 1));
      const first = rows[1] ?? rows[0];
      const last = rows.at(-1);
      assert(last.frameMs < Math.max(40, first.frameMs * 2), `frames stay fast (${first.frameMs} → ${last.frameMs} ms)`);
      assert(last.heapMB < first.heapMB * 2 + 50, `memory stays flat (${first.heapMB} → ${last.heapMB} MB)`);
      assert(last.geometries <= first.geometries + 20 && last.textures <= first.textures + 10, `GL resources stay flat (${first.geometries}/${first.textures} → ${last.geometries}/${last.textures})`);
    },
  },
  {
    id: 'materials-probe',
    name: 'materials workspace on the practice car: pick, edit, library, apply (screenshots)',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 0); i++) await page.waitForTimeout(100);
      await page.getByTestId('workspace-materials').click();
      await page.getByTestId('materials-panel').waitFor();
      await page.waitForTimeout(800);
      await shot(page, 'probe-materials-workspace');
      const rows = page.getByTestId('material-row');
      assert((await rows.count()) > 0, `materials listed (${await rows.count()})`);
      await rows.first().click();
      await page.waitForTimeout(500);
      await shot(page, 'probe-material-picked');
      assert((await page.getByTestId('error-card').count()) === 0, 'no crashed panels after picking a material');
      // The material's settings are on screen, not squeezed away under the preview.
      const nameBox = await page.getByTestId('material-name').boundingBox();
      const panelBox = await page.getByTestId('materials-panel').boundingBox();
      assert(nameBox && panelBox && nameBox.y + nameBox.height <= panelBox.y + panelBox.height, `material settings visible (${JSON.stringify(nameBox)} in ${JSON.stringify(panelBox)})`);
      await page.getByTestId('material-library').click();
      await page.getByTestId('library-items').waitFor();
      await page.waitForTimeout(500);
      await shot(page, 'probe-material-library');
      await page.keyboard.press('Escape');
      assert((await page.getByTestId('error-card').count()) === 0, 'no crashed panels');
    },
  },
  {
    id: 'testing-probe',
    name: 'Testing on the practice car: the car shows, its switch and Alt+1 hide it, and it follows the physics',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-view=editor][data-testid=app-ready]');
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 0); i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !((await hook(page, 'projectDoc')).nodes.length > 50); i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'testing');
      // The quick suspension check, before Test Mode: drop it and read the gaps.
      await page.getByTestId('ride-drop').click();
      await page.waitForTimeout(900);
      await shot(page, 'probe-ride-drop');
      await page.getByTestId('ride-report').waitFor();
      const ride = await page.getByTestId('ride-report').textContent();
      assert(/Front left/.test(ride) && /Rear right/.test(ride) && /Ground clearance/.test(ride), `four wheels and the ground measured (${ride})`);
      await page.waitForTimeout(3000);
      await shot(page, 'probe-ride-report');
      await page.getByRole('button', { name: 'Enter Test Mode' }).click();
      await page.getByTestId('test-panel').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1000);
      const before = await hook(page, 'glStats');
      assert(before.liveMeshes > 0 && before.liveMeshesVisible, `the car shows in Test Mode straight away (${JSON.stringify(before)})`);
      await shot(page, 'probe-testing-mesh-paused');
      const meshSwitch = page.getByRole('switch', { name: "Show the car's mesh" });
      await meshSwitch.click();
      await page.waitForTimeout(500);
      assert((await hook(page, 'glStats')).liveMeshes === 0, 'switched off, it goes');
      await meshSwitch.click();
      await page.waitForTimeout(500);
      assert((await hook(page, 'glStats')).liveMeshes > 0, 'and back on');
      await page.keyboard.press('Alt+1');
      await page.waitForTimeout(300);
      assert(!(await hook(page, 'glStats')).liveMeshesVisible, 'the toolbar mesh toggle (Alt+1) hides it too');
      await page.keyboard.press('Alt+1');
      await page.getByTestId('sim-run').click();
      await page.waitForTimeout(2000);
      const running = await hook(page, 'glStats');
      await shot(page, 'probe-testing-mesh-running');
      assert(running.liveMeshes > 0 && running.liveMeshesVisible, `and while it runs (${JSON.stringify(running)})`);
    },
  },
  {
    id: 'engine-workspace',
    name: 'Engine workspace: the camera on the engine, the car see-through, a slow turn; the designer and fitting a design',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      // A car in the game folder with an engine, to carry a design.
      const engineZip = join(fakeInstall, 'content', 'vehicles', 'fakeengine.zip');
      const engineJbeam = {
        fakeengine_body: { information: { name: 'Body' }, slotType: 'main', slots: [['type', 'default', 'description'], ['fakeengine_engine', 'fakeengine_engine_i4', 'Engine']], nodes: [['id', 'posX', 'posY', 'posZ'], ['b1', 0, 0, 0.5]] },
        fakeengine_engine_i4: {
          information: { name: '1.8L I4 Engine' },
          slotType: 'fakeengine_engine',
          powertrain: [['type', 'name', 'inputName', 'inputIndex'], ['combustionEngine', 'mainEngine', 'dummy', 0]],
          mainEngine: { torque: [['rpm', 'torque'], [0, 80], [2000, 130], [4000, 150], [6000, 135], [7000, 110]], idleRPM: 800, maxRPM: 6500, revLimiterRPM: 6400, inertia: 0.15, friction: 12, dynamicFriction: 0.02, engineBrakeTorque: 30 },
          flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_body', ['fakeengine_engine']]],
          nodes: [['id', 'posX', 'posY', 'posZ'], { nodeWeight: 30 }, ['e1', 0, -1.2, 0.4], ['e2', 0.2, -1.2, 0.4], ['e3', 0, -1.5, 0.4], ['e4', 0, -1.2, 0.7]],
          beams: [['id1:', 'id2:'], ['e1', 'e2'], ['e1', 'e3'], ['e1', 'e4'], ['e2', 'e3'], ['e2', 'e4'], ['e3', 'e4']],
        },
      };
      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(JSON.stringify(engineJbeam)), 'vehicles/fakeengine/fakeengine.jbeam');
        zip.addBuffer(readFileSync(join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae')), 'vehicles/fakeengine/fakeengine.dae');
        zip.addBuffer(Buffer.from(JSON.stringify({ Name: 'Engine Car', Brand: 'Forge' })), 'vehicles/fakeengine/info.json');
        zip.end();
        zip.outputStream.pipe(createWriteStream(engineZip)).on('close', resolve).on('error', reject);
      });
      await page.evaluate((dir) => window.forge.invoke('settings:update', { beamngInstallDir: dir }), fakeInstall);
      // The game's parts are cached per game build; the fake game's build doesn't change, so forget the cache.
      rmSync(join(userData, 'library-scan', 'beamng', 'parts.fingerprint'), { force: true });
      const scan = await page.evaluate(() => window.forge.invoke('library:rescan'));
      assert(scan.ok, `library rescanned (${JSON.stringify(scan).slice(0, 200)})`);
      // The scan finishes in the background: wait for the fake engine to be in the catalogue.
      let engines = [];
      for (let i = 0; i < 600 && !engines.some((x) => x.vehicle === 'fakeengine'); i++) {
        const lib = await page.evaluate(() => window.forge.invoke('library:status'));
        if (!lib.value?.scanning) engines = (await page.evaluate(() => window.forge.invoke('powertrain:catalogue'))).value ?? [];
        await page.waitForTimeout(100);
      }
      assert(engines.some((x) => x.vehicle === 'fakeengine'), `the fake engine is in the catalogue (${engines.map((x) => x.id).join(', ')})`);
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 40); i++) await page.waitForTimeout(100);
      await page.getByRole('tab', { name: 'Engine', exact: true }).click();
      await page.getByTestId('engine-hero').waitFor();
      await page.waitForTimeout(1200);
      let stage = await hook(page, 'engineStage');
      assert(stage.active && stage.orbiting, `the Engine tab turns the camera round the engine (${JSON.stringify(stage)})`);
      assert(stage.focus >= 3, `the car's own engine stays solid and the rest goes see-through (${stage.focus} meshes in focus)`);
      await shot(page, 'engine-workspace');
      // Taking the camera stops the turn.
      const box = await page.locator('canvas:visible').first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 10, { steps: 6 });
      await page.mouse.up();
      stage = await hook(page, 'engineStage');
      assert(!stage.orbiting, 'dragging the view stops the slow turn');
      // See-through off: the whole car solid again.
      await page.getByTestId('engine-view-options').getByRole('switch').first().click();
      await page.waitForTimeout(300);
      assert((await hook(page, 'engineStage')).focus === null, 'see-through car switched off');
      await page.getByTestId('engine-view-options').getByRole('switch').first().click();
      // The designer: presets, and the numbers follow.
      await page.getByTestId('engine-design').click();
      await page.getByTestId('engine-designer').waitFor();
      await page.getByTestId('engine-preset-e30-m10').click();
      assert(/1\.8 L inline-4/.test(await page.getByTestId('engine-design-name').textContent()), 'the M10 preset');
      await page.waitForTimeout(400);
      await shot(page, 'engine-designer');
      await page.getByTestId('engine-preset-hot-hatch').click();
      assert(/2\.0 L inline-4 turbo/.test(await page.getByTestId('engine-design-name').textContent()), 'the hot-hatch preset');
      await page.getByRole('tab', { name: 'Induction' }).click();
      await page.waitForTimeout(300);
      await shot(page, 'engine-designer-induction');
      // Put it on the closest game engine (from the harness's game folder).
      const fit = page.getByTestId('engine-design-fit');
      await fit.waitFor({ timeout: 15_000 });
      {
        await fit.click();
        for (let i = 0; i < 600 && !(await hook(page, 'projectDoc')).powertrain?.engine?.edits?.design; i++) await page.waitForTimeout(100);
        const engine = (await hook(page, 'projectDoc')).powertrain.engine;
        assert(engine?.edits?.design?.aspiration === 'turbo' && engine.edits.torque?.length > 10, `the design went onto ${engine?.vehicle} ${engine?.name}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);
        await shot(page, 'engine-designed-fitted');
        assert(/inline-4 turbo/.test(await page.getByTestId('engine-design-name').textContent()), 'the designer shows the fitted design');
        // Exported, the engine part carries the design's rev limit.
        const limit = Object.entries(engine.edits.fields).find(([k]) => k.endsWith('/mainEngine/revLimiterRPM'));
        assert(limit, `rev limit set on the engine (${Object.keys(engine.edits.fields).join(', ')})`);
        const files = (await hook(page, 'preparedJbeams')).files;
        assert(files.some((f) => f.text.includes(`"revLimiterRPM": ${limit[1]}`) || f.text.includes(`"revLimiterRPM":${limit[1]}`)), `the exported engine has the designed rev limit (${files.map((f) => f.path).join(', ')})`);
      }
      rmSync(engineZip, { force: true });
      // An engine from a car exported from Automation (Camso parts, its own info.json), picked from a zip.
      const automationZip = join(userData, 'automation-export.zip');
      const camso = {
        Camso_body_8f3a: { information: { name: 'Body' }, slotType: 'main', slots: [['type', 'default', 'description'], ['Camso_Engine', 'Camso_Engine_8f3a', 'Engine']], nodes: [['id', 'posX', 'posY', 'posZ'], ['b1', 0, 0, 0.5]] },
        Camso_Engine_8f3a: {
          information: { name: 'Forge Works 2.4L I4 DOHC (Automation)' },
          slotType: 'Camso_Engine',
          powertrain: [['type', 'name', 'inputName', 'inputIndex'], ['combustionEngine', 'mainEngine', 'dummy', 0]],
          mainEngine: { torque: [['rpm', 'torque'], [0, 120], [2000, 210], [4500, 245], [6500, 220], [7500, 190]], idleRPM: 850, maxRPM: 7200, revLimiterRPM: 7100, inertia: 0.12, friction: 14, dynamicFriction: 0.024 },
          flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_body', ['Camso_engine']]],
          nodes: [['id', 'posX', 'posY', 'posZ'], { nodeWeight: 35 }, ['ce1', 0, -1.2, 0.4], ['ce2', 0.2, -1.2, 0.4], ['ce3', 0, -1.5, 0.4], ['ce4', 0, -1.2, 0.7]],
          beams: [['id1:', 'id2:'], ['ce1', 'ce2'], ['ce1', 'ce3'], ['ce1', 'ce4'], ['ce2', 'ce3'], ['ce2', 'ce4'], ['ce3', 'ce4']],
        },
      };
      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(JSON.stringify(camso)), 'vehicles/forge_coupe_8f3a/forge_coupe_8f3a.jbeam');
        zip.addBuffer(readFileSync(join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae')), 'vehicles/forge_coupe_8f3a/forge_coupe_8f3a.dae');
        zip.addBuffer(Buffer.from(JSON.stringify({ Name: 'Forge Coupe', Brand: 'Automation' })), 'vehicles/forge_coupe_8f3a/info.json');
        zip.end();
        zip.outputStream.pipe(createWriteStream(automationZip)).on('close', resolve).on('error', reject);
      });
      await page.getByRole('button', { name: 'Back' }).first().click();
      await hook(page, 'queueDialog', [automationZip]);
      await page.getByTestId('engine-import-automation').click();
      for (let i = 0; i < 600 && !/Forge Coupe/.test((await hook(page, 'projectDoc')).powertrain?.engine?.vehicle ?? ''); i++) await page.waitForTimeout(100);
      const imported = (await hook(page, 'projectDoc')).powertrain.engine;
      assert(/Forge Coupe/.test(imported?.vehicle ?? '') && /2\.4L I4/.test(imported?.name ?? ''), `the Automation engine is fitted (${imported?.vehicle} ${imported?.name})`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
      await shot(page, 'engine-from-automation');
      const autoFiles = (await hook(page, 'preparedJbeams')).files;
      assert(autoFiles.some((f) => /"revLimiterRPM"\s*:\s*7100/.test(f.text)), 'its own engine jbeam goes into the mod');
    },
  },
  {
    id: 'script-tutorial',
    name: 'script tutorials: offered once with Watch or Skip; setup steps, then the code line by line',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.evaluate(() => window.forge.invoke('settings:update', { lessonsSeen: [], offerLessons: true }));
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 40); i++) await page.waitForTimeout(100);
      await page.getByRole('tab', { name: 'Scripts' }).click();
      await page.getByTestId('scripts-view-gallery').click();
      await page.getByTestId('template-gallery').getByRole('button', { name: 'Add Windscreen wipers', exact: true }).click();
      await page.getByTestId('guide-offer').waitFor();
      await shot(page, 'script-tutorial-offer');
      await page.getByTestId('guide-watch').click();
      await page.getByTestId('guide-card').waitFor();
      // Step through: settings (a list of every setting), picking the arms (skipped), keys, outputs, the test, then the code.
      const seen = [];
      const shotTaken = {};
      for (let i = 0; i < 60; i++) {
        const card = page.getByTestId('guide-card');
        const id = await card.getAttribute('data-step');
        seen.push(id);
        if (id === 'settings') {
          assert((await card.textContent()).includes('Low speed wipe'), 'the settings step names each setting');
          await page.waitForTimeout(600);
          await shot(page, 'script-tutorial-settings');
        }
        if (id === 'keys') assert(/lctrl w/.test(await card.textContent()), 'the keys step lists each key');
        if (id.startsWith('code-') && (await card.locator('h3').textContent()).includes('updateGFX')) {
          const code = await page.getByTestId('guide-code').textContent();
          assert(/updateGFX/.test(code) && /Every frame/.test(code), `a code step shows its lines with what each does (${code.slice(0, 200)})`);
          await page.waitForTimeout(600);
          await shot(page, 'script-tutorial-code');
          shotTaken.code = true;
        }
        if (id === 'done') break;
        await page.getByTestId('guide-next').click();
        await page.waitForTimeout(120);
      }
      assert(seen.includes('pick-arms') && seen.includes('test') && seen.filter((s) => s.startsWith('code-')).length >= 6, `the tutorial walks setup and code (${seen.join(', ')})`);
      assert(shotTaken.code, 'the updateGFX step was shown');
      await shot(page, 'script-tutorial-done');
      await page.getByTestId('guide-finish').click();
      // Seen: adding wipers again doesn't offer it; another template does, and Skip remembers it.
      await page.getByTestId('scripts-view-gallery').click();
      await page.getByTestId('template-gallery').getByRole('button', { name: 'Add Windscreen wipers', exact: true }).click();
      await page.waitForTimeout(600);
      assert(!(await page.getByTestId('guide-offer').isVisible()), 'a watched tutorial is not offered again');
      await page.getByTestId('scripts-view-gallery').click();
      await page.getByTestId('template-gallery').getByRole('button', { name: 'Add Sunroof', exact: true }).click();
      await page.getByTestId('guide-skip').click({ timeout: 5000 });
      await page.waitForTimeout(400);
      const settings = await page.evaluate(async () => (await window.forge.invoke('settings:get')).value);
      assert(settings.lessonsSeen.includes('script:wipers') && settings.lessonsSeen.includes('script:sunroof'), `watched and skipped tutorials remembered (${settings.lessonsSeen})`);
      // The cap button next to the script's name replays it any time.
      await page.getByTestId('script-tutorial').click();
      await page.getByTestId('guide-card').waitFor();
      await page.getByRole('button', { name: 'Stop the tutorial' }).click();
      // The workspaces' tutorials: offered the first time each opens; the cap buttons replay them (on a car with parts and nodes).
      await page.getByRole('tab', { name: 'Parts', exact: true }).click();
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !((await hook(page, 'projectDoc')).nodes.length > 50); i++) await page.waitForTimeout(100);
      for (const [tab, testid, lesson] of [['Triggers', 'triggers-tutorial', 'workspace:triggers'], ['Moving parts', 'moving-tutorial', 'workspace:moving'], ['JBeam', 'jbeam-tutorial', 'workspace:jbeam']]) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await page.getByTestId('guide-offer').waitFor({ timeout: 5000 });
        await page.getByTestId('guide-skip').click();
        await page.getByTestId(testid).click();
        await page.getByTestId('guide-card').waitFor();
        let steps = 0;
        for (; steps < 20; steps++) {
          if ((await page.getByTestId('guide-card').getAttribute('data-step')) === 'done') break;
          await page.getByTestId('guide-next').click();
          await page.waitForTimeout(100);
        }
        assert(steps >= 3, `${tab}: a tutorial of several steps (${steps})`);
        await page.waitForTimeout(500);
        await shot(page, `tutorial-${testid}`);
        await page.getByTestId('guide-finish').click();
        const seenNow = (await page.evaluate(async () => (await window.forge.invoke('settings:get')).value)).lessonsSeen;
        assert(seenNow.includes(lesson), `${lesson} remembered`);
      }
      // Help → Tutorials: every tutorial listed step by step, by group; Start switches workspace and runs it.
      await page.getByTestId('open-help').click();
      await page.getByTestId('help-centre').waitFor();
      for (const group of ['Tutorials: getting started', 'Tutorials: vehicle scripts', 'Tutorials: part mods']) await page.getByTestId('help-centre').getByText(group, { exact: true }).waitFor();
      await page.getByTestId('guide-tutorial-engine-design').click();
      assert((await page.getByTestId('help-article').locator('ol li').count()) >= 5, 'a written tutorial lists its steps');
      await page.getByTestId('guide-tutorial-script-wipers').click();
      assert((await page.getByTestId('help-article').locator('ol li').count()) >= 6, 'a script tutorial lists its lesson’s steps');
      await shot(page, 'help-tutorials');
      await page.getByTestId('guide-tutorial-triggers').click();
      await page.getByTestId('help-start').click();
      await page.getByTestId('guide-card').waitFor();
      assert((await page.getByTestId('workspace-triggers').getAttribute('aria-selected')) === 'true', 'starting from Help opens the Triggers workspace');
      await page.getByRole('button', { name: 'Stop the tutorial' }).click();
      await page.evaluate(() => window.forge.invoke('settings:update', { offerLessons: false }));
    },
  },
  {
    id: 'high-poly',
    name: 'a high-poly car (the practice car subdivided to about a million triangles): load, view, structure, Test Mode, materials',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      // Every triangle split into four, twice: 16 times the practice car.
      const dir = join(userData, 'highpoly');
      mkdirSync(dir, { recursive: true });
      const src = readFileSync(join(ROOT, 'assets', 'demo-car', 'demo_car.obj'), 'utf8').split('\n');
      const verts = [];
      const out = ['mtllib demo_car.mtl'];
      let written = 0;
      let tris = 0;
      const emit = (p) => {
        out.push(`v ${p[0].toFixed(4)} ${p[1].toFixed(4)} ${p[2].toFixed(4)}`);
        return ++written;
      };
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const split = (t, depth) => {
        if (!depth) {
          const ids = t.map(emit);
          out.push(`f ${ids.join(' ')}`);
          tris++;
          return;
        }
        const [a, b, c] = t;
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        for (const q of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) split(q, depth - 1);
      };
      for (const line of src) {
        if (line.startsWith('v ')) verts.push(line.split(' ').slice(1, 4).map(Number));
        else if (line.startsWith('o ') || line.startsWith('usemtl ')) out.push(line);
        else if (line.startsWith('f ')) {
          const ids = line.split(' ').slice(1).map((c) => Number(c.split('/')[0]) - 1);
          for (let i = 1; i + 1 < ids.length; i++) split([verts[ids[0]], verts[ids[i]], verts[ids[i + 1]]], 2);
        }
      }
      const objPath = join(dir, 'highpoly_car.obj');
      writeFileSync(objPath, `${out.join('\n')}\n`);
      writeFileSync(join(dir, 'demo_car.mtl'), readFileSync(join(ROOT, 'assets', 'demo-car', 'demo_car.mtl'), 'utf8').replace(/^map_Kd .*$/gm, ''));
      const timings = { triangles: tris };
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('High poly');
      await page.getByTestId('newmod-create').click();
      await page.waitForSelector('[data-view=editor]');
      let t = Date.now();
      await hook(page, 'queueDialog', [objPath]);
      await page.getByTestId('toolbar-import').click();
      await page.getByTestId('import-confirm').click({ timeout: 120_000 });
      if (await page.getByTestId('classify-skip').isVisible({ timeout: 3000 }).catch(() => false)) await page.getByTestId('classify-skip').click();
      let st;
      for (let i = 0; i < 1200; i++) {
        st = await hook(page, 'sceneStats');
        if (st.meshes > 40 && st.sources.every((x) => x.status === 'ready')) break;
        await page.waitForTimeout(100);
      }
      timings.loadMs = Date.now() - t;
      assert(st.meshes > 40, `the high-poly car loaded (${st.meshes} meshes)`);
      await page.waitForTimeout(2000);
      const gl = await hook(page, 'glStats');
      timings.viewTriangles = gl.triangles;
      timings.fps = gl.fps;
      assert(gl.triangles > 900_000, `about a million triangles drawn (${gl.triangles})`);
      await shot(page, 'high-poly-loaded');
      // Parts and structure.
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      t = Date.now();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 3000 && !((await hook(page, 'projectDoc')).nodes.length > 50); i++) await page.waitForTimeout(100);
      timings.generateMs = Date.now() - t;
      timings.generateReported = (await page.getByTestId('status-bar').textContent())?.match(/Generated \d+ parts? in (\d+) ms/)?.[1] ?? null;
      const nodes = (await hook(page, 'projectDoc')).nodes.length;
      assert(nodes > 50, `structure generated (${nodes} nodes)`);
      await page.waitForTimeout(500);
      await shot(page, 'high-poly-structure');
      // Test Mode with the car's mesh following the physics: the window keeps answering.
      await hook(page, 'applyPreset', 'testing');
      t = Date.now();
      await page.getByRole('button', { name: 'Enter Test Mode' }).click();
      await page.getByTestId('test-panel').waitFor({ timeout: 120_000 });
      timings.testModeMs = Date.now() - t;
      await page.getByTestId('sim-run').click();
      await page.waitForTimeout(3000);
      t = Date.now();
      await shot(page, 'high-poly-testing');
      timings.testingShotMs = Date.now() - t;
      timings.testingFps = (await hook(page, 'glStats')).fps;
      await page.getByTestId('sim-exit').click();
      // A material change on a million triangles.
      await hook(page, 'applyPreset', 'materials');
      await page.getByTestId('material-row').first().click();
      t = Date.now();
      const rough = page.getByLabel('Roughness value').first();
      await rough.fill('0.3');
      await rough.press('Enter');
      await page.waitForTimeout(100);
      await shot(page, 'high-poly-material');
      timings.materialMs = Date.now() - t;
      writeFileSync(join(outDir, 'high-poly-timings.json'), JSON.stringify(timings, null, 1));
      console.log('high-poly timings', JSON.stringify(timings));
    },
  },
  {
    id: 'audit',
    name: 'audit on the practice car: every workspace, every toolbar button and every key; nothing errors and the window keeps answering',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 40); i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !((await hook(page, 'projectDoc')).nodes.length > 50); i++) await page.waitForTimeout(100);
      const problems = [];
      const closeAll = async () => {
        for (let i = 0; i < 4 && (await page.locator('[role=dialog]').count()); i++) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
        }
      };
      const check = async (what) => {
        const t0 = Date.now();
        // The window answers: a round trip to the page.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(1))));
        const ms = Date.now() - t0;
        if (ms > 3000) problems.push(`${what}: the window took ${ms} ms to answer`);
        const cards = await page.locator('[data-testid=error-card]').count();
        if (cards) problems.push(`${what}: ${cards} panel error card(s)`);
        if (!(await page.locator('[data-testid=app-ready]').count())) problems.push(`${what}: the app is no longer ready`);
      };
      const workspaces = await page.locator('[data-testid^=workspace-]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      assert(workspaces.length >= 9, `every workspace has a tab (${workspaces.join(', ')})`);
      for (const ws of workspaces) {
        await page.getByTestId(ws).click();
        await page.waitForTimeout(700);
        await closeAll();
        await check(ws);
        await shot(page, `audit-${ws}`);
        // Every side panel toggle in this workspace, on and off again.
        const toggles = await page.locator('[data-testid^=toggle-]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
        for (const t of toggles) {
          for (let k = 0; k < 2; k++) {
            const b = page.getByTestId(t);
            if (!(await b.isVisible()) || (await b.isDisabled())) continue;
            await b.click();
            await page.waitForTimeout(250);
            await check(`${ws} ${t}`);
          }
        }
      }
      await page.getByTestId('workspace-model').click().catch(() => page.getByTestId(workspaces[0]).click());
      await page.waitForTimeout(500);
      // The toolbar's own buttons: the view toggles twice, the windows opened and shut.
      for (const id of ['toolbar-view-mesh', 'toolbar-view-structure', 'toolbar-view-xray']) {
        for (let k = 0; k < 2; k++) await page.getByTestId(id).click();
        await check(id);
      }
      for (const id of ['open-settings', 'open-downloads', 'open-help', 'open-configs', 'toolbar-export']) {
        await page.getByTestId(id).click();
        await page.waitForTimeout(600);
        const dialogs = await page.locator('[role=dialog]').count();
        if (!dialogs) problems.push(`${id}: no window opened`);
        await shot(page, `audit-${id}`);
        await closeAll();
        if (await page.locator('[role=dialog]').count()) problems.push(`${id}: Escape did not close it`);
        await check(id);
      }
      // Every key that isn't a native-menu accelerator, in the editor and then in edit mode.
      const keyed = async (key, what, expectDialog = false) => {
        await page.locator('[data-testid=viewport]').hover();
        await page.keyboard.press(key);
        await page.waitForTimeout(350);
        if (expectDialog && !(await page.locator('[role=dialog]').count())) problems.push(`${what} (${key}): nothing opened`);
        await closeAll();
        await check(`${what} (${key})`);
      };
      for (let n = 1; n <= 9; n++) {
        await keyed(`Control+${n}`, `layout${n}`);
      }
      await page.getByTestId(workspaces[0]).click();
      for (const [k, w] of [['Alt+1', 'viewMesh'], ['Alt+1', 'viewMesh'], ['Alt+2', 'viewStructure'], ['Alt+2', 'viewStructure'], ['Alt+3', 'viewXray'], ['Alt+3', 'viewXray'], ['Home', 'frameAll'], ['f', 'focus'], ['g', 'move'], ['r', 'rotate'], ['s', 'scale'], ['Escape', 'cancel']]) await keyed(k, w);
      await keyed('Control+E', 'export', true);
      await keyed('Control+Shift+C', 'configs', true);
      // Menu accelerators belong to the native menu, which synthetic keys don't reach: their menu commands are run instead.
      for (const [k, w] of [['Control+K', 'palette'], ['F1', 'shortcuts'], ['Shift+F1', 'help'], ['Control+,', 'settings'], ['Control+Shift+D', 'downloads']]) await keyed(k, w);
      for (const cmd of ['palette', 'shortcuts', 'help', 'settings', 'downloads']) {
        await hook(page, 'runCommand', cmd);
        await page.waitForTimeout(400);
        if (!(await page.locator('[role=dialog]').count())) problems.push(`menu ${cmd}: nothing opened`);
        await closeAll();
        await check(`menu ${cmd}`);
      }
      const nodes0 = (await hook(page, 'projectDoc')).nodes.length;
      await keyed('Tab', 'editMode');
      for (const [k, w] of [['Control+A', 'nodeSelectAll'], ['i', 'nodeInvert'], ['i', 'nodeInvert'], ['Shift+T', 'selectTris'], ['Shift+B', 'selectBeams'], ['l', 'nodeConnected'], ['Escape', 'cancel']]) await keyed(k, w);
      // Escape may have left edit mode: back in, a node picked, then N adds one beside it.
      if (!(await hook(page, 'editState')).active) await keyed('Tab', 'editMode');
      const firstNode = (await hook(page, 'projectDoc')).nodes[0].id;
      await hook(page, 'editSelect', [firstNode]);
      await keyed('n', 'nodeAdd');
      if ((await hook(page, 'projectDoc')).nodes.length !== nodes0 + 1) problems.push('nodeAdd (N): no node added');
      await keyed('Control+A', 'nodeSelectAll');
      for (const [k, w] of [['Shift+M', 'nodeMirror'], ['t', 'triAdd'], ['b', 'nodeConnect'], ['d', 'beamSplit'], ['m', 'nodeMerge'], ['Delete', 'nodeDelete']]) await keyed(k, w);
      for (let i = 0; i < 20 && (await hook(page, 'projectDoc')).nodes.length !== nodes0; i++) {
        await page.keyboard.press('Control+Z');
        await page.waitForTimeout(200);
      }
      await keyed('Tab', 'editMode off');
      const nodes1 = (await hook(page, 'projectDoc')).nodes.length;
      await shot(page, 'audit-end');
      assert(!problems.length, `no problems:\n  ${problems.join('\n  ')}`);
      assert(nodes1 === nodes0, `undo puts the structure back (${nodes0} → ${nodes1})`);
    },
  },
  {
    id: 'practice-export',
    name: 'the practice car exported as a beginner would: sort into parts, Generate, Export → Install',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 40); i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !((await hook(page, 'projectDoc')).nodes.length > 50); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(1500);
      // The generated project, for offline physics checks (scripts/dev/simParts.mts).
      writeFileSync(join(outDir, 'practice-doc.json'), JSON.stringify(await hook(page, 'projectDoc')));
      await page.getByTestId('toolbar-export').click();
      await page.getByTestId('export-dialog').waitFor();
      await shot(page, 'practice-export-dialog');
      await page.getByTestId('export-install').click();
      await page.getByTestId('export-result').waitFor({ timeout: 60_000 });
      const unpacked = join(fakeUserDir, 'mods', 'unpacked');
      // The one just written (other scenarios install mods here too).
      const mod = readdirSync(unpacked).sort((a, b) => statSync(join(unpacked, b)).mtimeMs - statSync(join(unpacked, a)).mtimeMs)[0];
      cpSync(join(unpacked, mod), join(outDir, 'practice-mod'), { recursive: true });
      // Run it the way the game does (explicit steps at 2000 Hz, no sub-steps): it must hold together.
      const vdir = join(outDir, 'practice-mod', 'vehicles', readdirSync(join(outDir, 'practice-mod', 'vehicles'))[0]);
      const check = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'scripts', 'dev', 'jbeamStability.mts'), vdir], { encoding: 'utf8', env: { ...process.env, STEPS: '6000' } });
      writeFileSync(join(outDir, 'practice-stability.txt'), check.stdout + check.stderr);
      // And read the way the game reads it: slots, nodes, groups, meshes and materials all resolve.
      const lint = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(ROOT, 'tsconfig.node.json'), join(ROOT, 'scripts', 'lint-mod.ts'), join(outDir, 'practice-mod')], { encoding: 'utf8' });
      writeFileSync(join(outDir, 'practice-lint.txt'), lint.stdout + lint.stderr);
      assert(lint.status === 0, `the practice mod lints clean:\n${(lint.stdout + lint.stderr).split('\n').slice(0, 25).join('\n')}`);
      // And in the app's physics on stands: every part holds (none hinging on one edge or dropping).
      const sag = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(ROOT, 'tsconfig.node.json'), join(ROOT, 'scripts', 'dev', 'simParts.mts'), join(outDir, 'practice-doc.json'), '4'], { encoding: 'utf8' });
      writeFileSync(join(outDir, 'practice-sag.txt'), sag.stdout + sag.stderr);
      const worstSag = Number(/^\s*(\d+) mm/m.exec(sag.stdout)?.[1] ?? NaN);
      assert(worstSag < 100, `every part holds on its stands (worst ${worstSag} mm):\n${sag.stdout.split('\n').slice(0, 6).join('\n')}${sag.stderr.slice(0, 300)}`);
      assert(/RUN: \d+ steps .* stable/.test(check.stdout), `the exported car holds together at 2000 Hz:\n${check.stdout.split('\n').filter((l) => /RUN|worst|nodes,/.test(l)).join('\n')}${check.stderr.slice(0, 400)}`);
      // The export result stays open otherwise, over the next scenario's home screen.
      for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) await page.keyboard.press('Escape');
    },
  },
  {
    id: 'suspension-wheels',
    name: "fitting a game suspension to the practice car: its wheels and brakes land on the set's hubs, and follow it when it's moved",
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      // A car in the game folder with a front suspension and its hubs (the wheels sit on fw1l/fw1ll and fw1r/fw1rr).
      const suspJbeam = {
        fakesusp_body: { information: { name: 'Body' }, slotType: 'main', slots: [['type', 'default', 'description'], ['fakesusp_suspension_F', 'fakesusp_suspension_F', 'Front Suspension']], nodes: [['id', 'posX', 'posY', 'posZ'], ['b1l', 0.5, -1.0, 0.7], ['b1r', -0.5, -1.0, 0.7], ['b2l', 0.4, -1.4, 0.4], ['b2r', -0.4, -1.4, 0.4]] },
        fakesusp_suspension_F: {
          information: { name: 'Front Struts' },
          slotType: 'fakesusp_suspension_F',
          slots: [['type', 'default', 'description'], ['fakesusp_hub_F', 'fakesusp_hub_F', 'Front Hubs']],
          flexbodies: [['mesh', '[group]:', 'nonFlexMaterials'], ['fixture_body', ['fakesusp_strut_F']]],
          nodes: [['id', 'posX', 'posY', 'posZ'], { group: 'fakesusp_strut_F', nodeWeight: 4 }, ['fs1l', 0.62, -1.0, 0.55], ['fs1r', -0.62, -1.0, 0.55], { group: '' }],
          beams: [['id1:', 'id2:'], ['fs1l', 'b1l'], ['fs1r', 'b1r'], ['fs1l', 'b2l'], ['fs1r', 'b2r']],
        },
        fakesusp_hub_F: {
          information: { name: 'Front Hubs' },
          slotType: 'fakesusp_hub_F',
          slots: [['type', 'default', 'description'], ['wheel_F_5', 'steelwheel_F', 'Front Wheels']],
          nodes: [['id', 'posX', 'posY', 'posZ'], { nodeWeight: 5 }, ['fw1l', 0.8, -1.0, 0.3], ['fw1ll', 0.68, -1.0, 0.3], ['fw1r', -0.8, -1.0, 0.3], ['fw1rr', -0.68, -1.0, 0.3]],
          beams: [['id1:', 'id2:'], ['fw1l', 'fw1ll'], ['fw1r', 'fw1rr'], ['fw1ll', 'fs1l'], ['fw1rr', 'fs1r']],
          pressureWheels: [['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'], ['FR', 'wheel_FR', 'tire_FR', 'fw1rr', 'fw1r', 9999, 'fs1r', -1], ['FL', 'wheel_FL', 'tire_FL', 'fw1ll', 'fw1l', 9999, 'fs1l', 1]],
        },
      };
      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(JSON.stringify(suspJbeam)), 'vehicles/fakesusp/fakesusp.jbeam');
        zip.addBuffer(readFileSync(join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae')), 'vehicles/fakesusp/fakesusp.dae');
        zip.addBuffer(Buffer.from(JSON.stringify({ Name: 'Strut Car', Brand: 'Forge' })), 'vehicles/fakesusp/info.json');
        zip.end();
        zip.outputStream.pipe(createWriteStream(join(fakeInstall, 'content', 'vehicles', 'fakesusp.zip'))).on('close', resolve).on('error', reject);
      });
      await page.evaluate((dir) => window.forge.invoke('settings:update', { beamngInstallDir: dir }), fakeInstall);
      rmSync(join(userData, 'library-scan', 'beamng', 'parts.fingerprint'), { force: true });
      const scan = await page.evaluate(() => window.forge.invoke('library:rescan'));
      assert(scan.ok, `library rescanned (${JSON.stringify(scan).slice(0, 200)})`);
      let sets = [];
      for (let i = 0; i < 600 && !sets.some((x) => x.vehicle === 'fakesusp'); i++) {
        const lib = await page.evaluate(() => window.forge.invoke('library:status'));
        if (!lib.value?.scanning) sets = (await page.evaluate(() => window.forge.invoke('suspension:catalogue'))).value ?? [];
        await page.waitForTimeout(100);
      }
      assert(sets.some((x) => x.vehicle === 'fakesusp'), `the fake suspension is in the catalogue (${sets.map((x) => x.id).join(', ')})`);
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 40); i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      const wheelBefore = await hook(page, 'partCentre', '^Front Left (wheel|tire)$');
      const caliperBefore = await hook(page, 'partCentre', '^Front Left brake');
      assert(wheelBefore && caliperBefore, `the practice car has a front-left wheel and caliper (${JSON.stringify([wheelBefore, caliperBefore])})`);
      await page.getByTestId('toggle-suspension').click();
      await page.getByRole('button', { name: 'Set up axles' }).click();
      await page.getByTestId('suspension-picker').waitFor();
      await page.getByTestId('workshop-type').filter({ hasText: 'MacPherson strut' }).click();
      await page.getByTestId('workshop-brand').filter({ hasText: 'Forge' }).click();
      await page.getByTestId('workshop-vehicle').first().click();
      await page.getByTestId('workshop-fit').first().click();
      await page.getByTestId('suspension-panel').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1000);
      const doc = await hook(page, 'projectDoc');
      const axle = doc.axles[0];
      const offset = doc.sources.find((s) => s.id === axle.fitted.sourceId).placement.position;
      // The left wheel's centre: the middle of fw1ll–fw1l, moved with the set.
      const want = [0.74 + offset[0], -1.0 + offset[1], 0.3 + offset[2]];
      const near = (a, b, tol = 0.01) => a.every((v, i) => Math.abs(v - b[i]) < tol);
      // The whole wheel (rim and tyre) is centred on the hub.
      const wheel = await hook(page, 'partCentre', '^Front Left (wheel|tire)$');
      assert(near(wheel, want), `the front-left wheel sits on the set's hub (${wheel.map((v) => v.toFixed(3))} vs ${want.map((v) => v.toFixed(3))})`);
      const caliper = await hook(page, 'partCentre', '^Front Left brake');
      const moved = wheel.map((v, i) => v - wheelBefore[i]);
      assert(near(caliper, caliperBefore.map((v, i) => v + moved[i])), 'its brake moved with it');
      const right = await hook(page, 'partCentre', '^Front Right (wheel|tire)$');
      assert(near(right, [-0.74 + offset[0], want[1], want[2]]), `the front-right wheel too (${right.map((v) => v.toFixed(3))})`);
      const rear = await hook(page, 'partCentre', '^Rear Left wheel$');
      assert(rear && Math.abs(rear[1] - want[1]) > 0.5, 'the rear wheels stay where they were');
      await shot(page, 'suspension-wheels-fitted');
      // Dragging the suspension: the wheels and brakes follow.
      await hook(page, 'gizmoTransform', { pivot: [0, 0, 0], translate: [0, 0.05, 0.02], rotate: [0, 0, 0, 1], scale: [1, 1, 1] });
      await page.waitForTimeout(800);
      const after = await hook(page, 'partCentre', '^Front Left (wheel|tire)$');
      assert(near(after, [want[0], want[1] + 0.05, want[2] + 0.02]), `the wheel follows the suspension (${after.map((v) => v.toFixed(3))})`);
      await shot(page, 'suspension-wheels-moved');
    },
  },
  {
    id: 'generate-modes',
    name: 'Generate options on the practice car: each proxy mode from the dropdown, its structure and how it holds up',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      for (let i = 0; i < 300 && !((await hook(page, 'sceneStats')).meshes > 40); i++) await page.waitForTimeout(100);
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      const modes = { auto: 'Best for each part (recommended)', hull: 'Convex hull, body included', surface: 'Follow the surface', decimate: 'Simplified mesh' };
      const counts = {};
      for (const [mode, label] of Object.entries(modes)) {
        await page.getByTestId('toolbar-generate-options').click();
        await page.getByTestId('generate-menu').waitFor();
        await page.getByTestId('generate-mode').click();
        await page.getByRole('option', { name: label }).click();
        await page.waitForTimeout(300);
        if (mode === 'auto') await shot(page, 'generate-menu');
        const before = (await hook(page, 'projectDoc')).beams.length;
        await page.getByTestId('generate-go').click();
        for (let i = 0; i < 1800; i++) {
          const d = await hook(page, 'projectDoc');
          if (d.nodes.length > 50 && d.beams.length !== before && !(await page.evaluate(() => document.querySelector('[data-testid=toolbar-generate]')?.hasAttribute('disabled')))) break;
          await page.waitForTimeout(100);
        }
        await page.waitForTimeout(800);
        const doc = await hook(page, 'projectDoc');
        const body = doc.parts.find((p) => p.taxonomyId === 'body');
        assert(mode === 'auto' || doc.proxy.parts[body.id]?.mode === mode, `the body was built as ${mode} (${doc.proxy.parts[body.id]?.mode})`);
        counts[mode] = { nodes: doc.nodes.length, beams: doc.beams.length, tris: doc.tris.length };
        writeFileSync(join(outDir, `modes-${mode}.json`), JSON.stringify(doc));
        await page.keyboard.press('Alt+1');
        await hook(page, 'viewFrom', [3.2, 1.3, 3.6]);
        await page.waitForTimeout(600);
        await shot(page, `generate-${mode}`);
        await page.keyboard.press('Alt+1');
      }
      writeFileSync(join(outDir, 'modes-counts.json'), JSON.stringify(counts, null, 1));
      // The choice is remembered.
      const s = await page.evaluate(() => window.forge.invoke('settings:get'));
      assert(s.value.generateMode === 'decimate', `remembered (${s.value.generateMode})`);
      await page.evaluate(() => window.forge.invoke('settings:update', { generateMode: 'auto' }));
    },
  },
  {
    id: 'demo-car',
    name: 'the practice car (E30-style saloon): every angle, and with its panels off',
    async run({ page }) {
      await page.waitForSelector('[data-testid=app-ready]');
      if (await page.locator('[data-view=editor]').count()) {
        await hook(page, 'runCommand', 'close');
        if (await page.getByTestId('unsaved-discard').isVisible({ timeout: 1500 }).catch(() => false)) await page.getByTestId('unsaved-discard').click();
      }
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-tour').click();
      await page.waitForSelector('[data-testid=tour-card]');
      await page.getByRole('button', { name: 'Skip the tutorial' }).click();
      let st;
      for (let i = 0; i < 300; i++) {
        st = await hook(page, 'sceneStats');
        if (st.meshes > 40 && st.sources.every((x) => x.status === 'ready')) break;
        await page.waitForTimeout(100);
      }
      assert(st.meshes >= 45, `practice car loaded (${st.meshes} meshes)`);
      await hook(page, 'applyPreset', 'modelling');
      await page.waitForTimeout(500);
      const views = { 'front-left': [3.2, 1.3, 3.6], 'rear-right': [-3.4, 1.4, -3.4], side: [5, 0.6, 0], front: [0, 0.8, 5], 'rear-left-low': [2.6, 0.5, -3.2], rear: [0, 0.9, -5], 'front-right-low': [-3.4, 0.7, 3.4] };
      for (const [name, dir] of Object.entries(views)) {
        await hook(page, 'viewFrom', dir);
        await page.waitForTimeout(500);
        await shot(page, `demo-car-${name}`);
      }
      // Bonnet off on its own: do the wings meet it along a clean line?
      assert((await hook(page, 'hideMeshes', '^hood$')) === 1, 'bonnet hidden');
      await hook(page, 'viewFrom', [2.4, 2.8, 2.6], '^(fender_F[LR]|engine_bay|grille)$');
      await page.waitForTimeout(500);
      await shot(page, 'demo-car-bonnet-off');
      await hook(page, 'hideMeshes', '.', false);
      // Panels off: the bonnet (engine bay), the left doors and their glass (the cabin), the boot lid.
      assert((await hook(page, 'hideMeshes', '^(hood|door_FL|door_glass_FL|trunk|fender_FL|spoiler|bumper_F)$')) === 7, 'seven panels hidden');
      await hook(page, 'viewFrom', [3.2, 1.8, 3]);
      await page.waitForTimeout(500);
      await shot(page, 'demo-car-panels-off');
      await hook(page, 'viewFrom', [4.5, 2.2, -1]);
      await page.waitForTimeout(500);
      await shot(page, 'demo-car-cabin');
      await hook(page, 'viewFrom', [1.6, 2.6, -4]);
      await page.waitForTimeout(500);
      await shot(page, 'demo-car-boot-open');
      await hook(page, 'viewFrom', [1.2, 2.2, -2.6], '^(trunk_trim|taillight_[LR])$');
      await page.waitForTimeout(500);
      await shot(page, 'demo-car-boot-close');
      // Close-ups: the engine, and the front seats with the steering wheel.
      await hook(page, 'viewFrom', [2.2, 2.6, 2.4], '^(engine|radiator|battery)$');
      await page.waitForTimeout(500);
      await shot(page, 'demo-car-engine');
      await hook(page, 'viewFrom', [3, 1.5, 0.6], '^(seat_F[LR]|steering_wheel)$');
      await page.waitForTimeout(500);
      await shot(page, 'demo-car-seats');
      await hook(page, 'hideMeshes', '.', false);
      // Sorted into parts by name: every removable piece becomes its own part.
      await hook(page, 'applyPreset', 'modelling'); // the Scene panel (a scenario before may have left another workspace)
      await page.getByTestId('scene-classify').click();
      await page.getByTestId('classify-apply').click();
      const parts = await hook(page, 'partNames');
      assert(parts.length >= 30, `sorted into ${parts.length} parts`);
      await shot(page, 'demo-car-parts');
      // Its structure, on its own: does it follow the car's shape?
      await page.getByTestId('toolbar-generate').click();
      for (let i = 0; i < 1800 && !((await hook(page, 'projectDoc')).nodes.length > 50); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(500);
      await page.keyboard.press('Alt+1');
      for (const [name, dir] of Object.entries({ side: [5, 0.6, 0], front: [0, 0.8, 5], 'front-left': [3.2, 1.3, 3.6], top: [0.01, 6, 0.01] })) {
        await hook(page, 'viewFrom', dir);
        await page.waitForTimeout(500);
        await shot(page, `demo-car-structure-${name}`);
      }
      await page.keyboard.press('Alt+1');
    },
  },
  {
    id: 'ac-car',
    name: 'local Assetto Corsa car import (--ac-car)',
    skip: () => !acCar,
    async run({ page }) {
      await page.waitForSelector('[data-view=home][data-testid=app-ready]');
      await page.getByTestId('home-new').click();
      await page.getByTestId('newmod-name').fill('AC Car');
      await page.getByTestId('newmod-create').click();
      await page.waitForSelector('[data-view=editor]');
      await hook(page, 'queueDialog', [acCar]);
      await hook(page, 'runCommand', 'importAc');
      await page.getByTestId('ac-import-dialog').waitFor({ timeout: 60_000 });
      await shot(page, 'ac-import-dialog');
      const started = Date.now();
      // The port declaration: owns the game, mod is free (Import stays off until both are ticked).
      assert(await page.getByTestId('ac-import-confirm').isDisabled(), 'import waits for the declaration');
      await page.getByTestId('ac-import-declare').getByText('I own Assetto Corsa').click();
      await page.getByTestId('ac-import-declare').getByText('The mod will be free', { exact: false }).click();
      await page.getByTestId('ac-import-confirm').click();
      let st;
      for (let i = 0; i < 3000; i++) {
        st = await hook(page, 'sceneStats');
        if (st.meshes > 0 && st.sources.every((x) => x.status === 'ready')) break;
        await page.waitForTimeout(100);
      }
      assert(st.meshes > 0, `car model imported (${JSON.stringify(st).slice(0, 300)})`);
      if (await page.getByTestId('classify-skip').isVisible().catch(() => false)) await page.getByTestId('classify-skip').click();
      const src = st.sources[0];
      acReport = { wallMs: Date.now() - started, meshes: st.meshes, triangles: src.stats?.triangles, importMs: src.stats?.totalMs, textures: src.textures && { loaded: src.textures.loaded, missing: src.textures.missing, unsupported: src.textures.unsupported } };
      await page.waitForTimeout(1500);
      await shot(page, 'ac-car-model');
      await hook(page, 'maximizePanel', 'viewport');
      for (const [name, pattern] of [['body', '^body$|carpaint|chassis|body_main|geo_body'], ['wheel', 'rim|wheel'], ['interior', 'dash|cockpit|seat'], ['light', 'light|lamp']]) {
        if ((await hook(page, 'frameMeshes', pattern)) === 0) continue;
        await page.waitForTimeout(1200);
        await shot(page, `ac-close-${name}`);
      }
      await hook(page, 'exitMaximized');
      await page.getByTestId('toggle-reference').click();
      await page.getByTestId('reference-panel').waitFor();
      await shot(page, 'ac-reference-panel');
      const saved = await hook(page, 'projectState');
      acReport.projectName = saved.name;
      writeFileSync(join(outDir, 'ac-car-report.json'), JSON.stringify(acReport, null, 1));
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
let acReport = null;
let partsReport = null;
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
      // JBFORGE_DUMP_DOCS=<folder>: keep each scenario's project as it ended (for save-file fixtures).
      if (process.env.JBFORGE_DUMP_DOCS) {
        const doc = await hook(ctx.page, 'projectDoc').catch(() => null);
        if (doc) {
          mkdirSync(process.env.JBFORGE_DUMP_DOCS, { recursive: true });
          writeFileSync(join(process.env.JBFORGE_DUMP_DOCS, `${s.id}.json`), `${JSON.stringify(doc, null, 2)}\n`);
        }
      }
    } catch (err) {
      await shot(ctx.page, `FAILED-${s.id}`).catch(() => undefined);
      results.push({ id: s.id, name: s.name, ok: false, ms: Date.now() - started, error: err.message });
      // Close whatever window it left open, so one failure doesn't block every scenario after it.
      for (let i = 0; i < 3; i++) await ctx.page.keyboard.press('Escape').catch(() => undefined);
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
