#!/usr/bin/env node
/**
 * Check JBeam Forge's in-game build without the game: serves the assembled mod
 * (npm run build:ingame → release/ingame/jbeam_forge) like the game's UI does, mounts the screen
 * the way JBeamForge.vue does, and answers its calls with a stand-in for jbeamForge.lua (the
 * game's file system is the mod folder; writes go to a temporary user folder). Then it runs the
 * practice car through to Export → Install and lints what was written.
 *
 *   node scripts/dev/ingame-check.mjs [--out=artifacts/ingame-check]
 */
import { _electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const MOD = join(ROOT, 'release', 'ingame', 'jbeam_forge');
const outDir = resolve(ROOT, process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? join('artifacts', 'ingame-check'));
mkdirSync(outDir, { recursive: true });
const user = mkdtempSync(join(tmpdir(), 'jbforge-ingame-user-'));
// The game's own files: one small car (its model, and the structure the game would report for it).
const gameFiles = mkdtempSync(join(tmpdir(), 'jbforge-ingame-game-'));
mkdirSync(join(gameFiles, 'vehicles', 'fakecar'), { recursive: true });
writeFileSync(join(gameFiles, 'vehicles', 'fakecar', 'fakecar.dae'), readFileSync(join(ROOT, 'tests', 'fixtures', 'models', 'zup_nodes.dae')));
const fakeCar = {
  id: 1, model: 'fakecar', dir: '/vehicles/fakecar/', config: { file: '/vehicles/fakecar/base.pc', parts: { fakecar_hood: 'fakecar_hood' } },
  jbeamFiles: ['/vehicles/fakecar/fakecar.jbeam'], models: ['/vehicles/fakecar/fakecar.dae'],
  nodes: [['b1', 0, -1, 0.5], ['b2', 0.8, -1, 0.5], ['b3', 0, 1, 0.5], ['b4', 0, 0, 1.2], ['h1', 0, -1.5, 1]].map(([id, x, y, z]) => ({ id, pos: [x, y, z], weight: 20, part: id.startsWith('h') ? 'fakecar_hood' : 'fakecar_body' })),
  beams: [['b1', 'b2', 501000, 150, 1e38, 1e38, 'fakecar_body'], ['b2', 'b3', 501000, 150, 1e38, 1e38, 'fakecar_body'], ['b1', 'b3', 501000, 150, 1e38, 1e38, 'fakecar_body'], ['b1', 'b4', 501000, 150, 1e38, 1e38, 'fakecar_body'], ['b2', 'b4', 501000, 150, 1e38, 1e38, 'fakecar_body'], ['b3', 'b4', 501000, 150, 1e38, 1e38, 'fakecar_body'], ['h1', 'b1', 300000, 100, 1e38, 1e38, 'fakecar_hood'], ['h1', 'b4', 300000, 100, 1e38, 1e38, 'fakecar_hood']],
  flexbodies: [{ mesh: 'fixture_body', part: 'fakecar_body' }, { mesh: 'fixture_wheel_FL', part: 'fakecar_hood' }],
  refNodes: { ref: 'b1', back: 'b3', left: 'b2', up: 'b4' },
};
// Seen the tour already: the home screen first.
mkdirSync(join(user, 'settings', 'jbeamForge'), { recursive: true });
writeFileSync(join(user, 'settings', 'jbeamForge', 'settings.json'), JSON.stringify({ tutorialSeen: true }));
if (!existsSync(join(MOD, 'ui', 'ui-vue', 'mods', 'jbeamForge', 'forge.mjs'))) throw new Error('Run npm run build:ingame first.');

// ---- the stand-in for jbeamForge.lua: the same channels and paths, on the disk
const vfs = (p) => {
  const clean = p.replace(/\\/g, '/');
  const inUser = join(user, clean);
  if (existsSync(inUser)) return inUser;
  return existsSync(join(gameFiles, clean)) ? join(gameFiles, clean) : join(MOD, clean);
};
const writable = (p) => /^\/settings\/jbeamForge\//.test(p) || /^\/mods\/unpacked\/jbeam_forge_[\w-]+\//.test(p);
const write = (p, data) => {
  if (!writable(p)) throw new Error(`Not a place JBeam Forge may write: ${p}`);
  const file = join(user, p);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return data.length;
};
const calls = [];
const channels = {
  'store:read': (r) => (existsSync(join(user, '/settings/jbeamForge/', r.key)) ? readFileSync(join(user, '/settings/jbeamForge/', r.key), 'utf8') : null),
  'store:write': (r) => void write(`/settings/jbeamForge/${r.key}`, Buffer.from(r.text ?? '')),
  'fs:read': (r) => {
    const f = vfs(r.path);
    if (!existsSync(f)) throw new Error(`No such file: ${r.path}`);
    const data = readFileSync(f);
    return r.binary ? data.toString('base64') : data.toString('utf8');
  },
  'fs:exists': (r) => r.paths.map((p) => existsSync(vfs(p)) && statSync(vfs(p)).isFile()),
  'fs:list': (r) => (existsSync(vfs(r.dir)) ? readdirSync(vfs(r.dir)).map((n) => `${r.dir.replace(/\/?$/, '/')}${n}`) : []),
  'fs:writeMany': (r) => {
    let bytes = 0;
    for (const f of r.files ?? []) bytes += write(f.path, f.base64 !== undefined ? Buffer.from(f.base64, 'base64') : Buffer.from(f.text ?? ''));
    for (const c of r.copies ?? []) if (existsSync(vfs(c.from))) bytes += write(c.to, readFileSync(vfs(c.from)));
    return bytes;
  },
  'mods:refresh': () => null,
  'vehicle:current': () => fakeCar,
  'vehicle:spawn': () => null,
  'world:draw': () => null,
  'ui:close': () => null,
};

// ---- the game's UI: the mod's files, and a page standing in for the route JBeamForge.vue mounts
const page = `<!doctype html><html><head><meta charset="utf-8"><title>JBeam Forge (in-game check)</title>
<link rel="stylesheet" href="/ui/ui-vue/mods/jbeamForge/forge.css"></head>
<body style="margin:0;background:#2b3a2b"><div id="host" style="position:absolute;inset:0"></div>
<script type="module">
  const forge = await import('/ui/ui-vue/mods/jbeamForge/forge.mjs');
  window.__unmount = forge.mountForge(document.getElementById('host'), {
    base: '/ui/ui-vue/mods/jbeamForge/',
    call: (channel, req) => window.luaCall(channel, JSON.stringify(req ?? null)).then((t) => JSON.parse(t)),
    on: () => () => undefined,
  });
</script></body></html>`;
const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.obj': 'text/plain', '.mtl': 'text/plain', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/' || url === '/check.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(page);
  }
  const file = join(MOD, url);
  if (!file.startsWith(MOD) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/check.html`;

const app = await _electron.launch({ args: [join(ROOT, 'scripts', 'dev', 'ingame-shell.cjs'), url], cwd: ROOT, timeout: 30_000 });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.exposeFunction('luaCall', (channel, json) => {
  calls.push(channel);
  try {
    const h = channels[channel];
    if (!h) return JSON.stringify({ ok: false, error: { message: `no "${channel}" yet` } });
    return JSON.stringify({ ok: true, value: h(JSON.parse(json) ?? {}) ?? null });
  } catch (err) {
    return JSON.stringify({ ok: false, error: { message: err.message } });
  }
});
await win.reload();
let n = 0;
const shot = async (name) => {
  await win.waitForTimeout(600);
  await win.screenshot({ path: join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`) });
  console.log('shot', name);
};
const report = { steps: [] };
const step = async (name, fn) => {
  try {
    await fn();
    report.steps.push({ name, ok: true });
  } catch (err) {
    report.steps.push({ name, ok: false, error: String(err.message).split('\n')[0] });
    await shot(`FAILED-${name}`);
  }
};

await step('home screen', async () => {
  await win.waitForSelector('[data-view=home][data-testid=app-ready]', { timeout: 30_000 });
  await shot('home');
});
await step('the car being driven', async () => {
  await win.getByTestId('home-current-car').click();
  await win.getByTestId('confirm-yes').click({ timeout: 15_000 });
  await win.waitForFunction(() => /5 nodes/.test(document.querySelector('[data-testid=status-bar]')?.textContent ?? ''), null, { timeout: 60_000 });
  await shot('current-car');
  report.currentCar = await win.evaluate(() => document.querySelector('[data-testid=scene-tree]')?.textContent?.slice(0, 300));
});
await step('back home', async () => {
  await win.getByTestId('toolbar-back-to-driving').waitFor({ timeout: 5000 });
  await win.keyboard.press('Control+w').catch(() => undefined);
});
await step('practice car', async () => {
  await win.evaluate(() => document.querySelector('[data-testid=open-help]') && undefined);
  if (await win.locator('[data-view=editor]').count()) {
    await win.getByTestId('toolbar-save').click();
    await win.waitForTimeout(800);
  }
  await win.evaluate(() => window.location.reload());
  await win.waitForSelector('[data-view=home][data-testid=app-ready]', { timeout: 30_000 });
  await win.getByTestId('home-tour').click();
  await win.waitForSelector('[data-testid=tour-card]', { timeout: 30_000 });
  await win.getByRole('button', { name: 'Skip the tutorial' }).click();
  await win.waitForFunction(() => document.querySelectorAll('[data-testid=scene-tree] [role=treeitem]').length > 10, null, { timeout: 60_000 });
  await shot('practice-car');
});
await step('sort into parts and generate', async () => {
  await win.getByTestId('scene-classify').click();
  await win.getByTestId('classify-apply').click();
  await win.getByTestId('toolbar-generate').click();
  await win.waitForFunction(() => /\d[\d,]* nodes/.test(document.querySelector('[data-testid=status-bar]')?.textContent ?? '') && !/— nodes/.test(document.querySelector('[data-testid=status-bar]')?.textContent ?? ''), null, { timeout: 120_000 });
  await shot('generated');
});
await step('export → install into the game', async () => {
  await win.getByTestId('toolbar-export').click();
  await win.getByTestId('export-dialog').waitFor();
  await shot('export');
  await win.getByTestId('export-install').click();
  await win.getByTestId('export-result').waitFor({ timeout: 120_000 });
  await shot('installed');
});
await step('save the project', async () => {
  await win.keyboard.press('Escape');
  await win.getByTestId('toolbar-save').click();
  await win.waitForTimeout(1500);
});

const unpacked = join(user, 'mods', 'unpacked');
const mods = existsSync(unpacked) ? readdirSync(unpacked) : [];
let lint = null;
if (mods.length) {
  const r = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(ROOT, 'tsconfig.node.json'), join(ROOT, 'scripts', 'lint-mod.ts'), join(unpacked, mods[0])], { encoding: 'utf8' });
  lint = { status: r.status, out: (r.stdout + r.stderr).split('\n').slice(0, 12).join('\n') };
}
const projects = existsSync(join(user, 'settings', 'jbeamForge', 'projects')) ? readdirSync(join(user, 'settings', 'jbeamForge', 'projects')) : [];
const result = { ...report, mods, projects, lint, unknownChannels: [...new Set(calls)].filter((c) => !channels[c]), channelsUsed: [...new Set(calls)], errors: errors.slice(0, 20) };
writeFileSync(join(outDir, 'report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await app.close();
server.close();
