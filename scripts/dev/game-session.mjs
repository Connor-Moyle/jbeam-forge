#!/usr/bin/env node
/**
 * The game kept open between test runs: start it once, then send it batch after batch of cars
 * (it picks up the new mod files and spawns each car fresh), and stop it at the end. Saves the game's
 * start and the map's load on every run.
 *
 *   node scripts/dev/game-session.mjs start [--aside=practice_car] [--level=gridmap_v2]
 *   node scripts/dev/game-session.mjs run --vehicle-mod=<folder> [--vehicles=all|a,b,car:vehicles/car/x.pc] [--drive] [--timeout=1200]
 *   node scripts/dev/game-session.mjs stop
 *
 * Like game-test.mjs it moves clashing mods into a backup folder (outside mods) and puts them back
 * on stop; the in-game version under test is release/jbeam_forge_ingame.zip.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { carsFromLog, printCars } from './game-log-cars.mjs';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ROOT = resolve(import.meta.dirname, '..', '..');
const EXE = 'BeamNG.drive.x64.exe';
const say = (msg) => console.log(`game-session: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = () => spawnSync('tasklist', ['/FI', `IMAGENAME eq ${EXE}`], { encoding: 'utf8' }).stdout.includes(EXE);

function locate() {
  const ini = join(process.env.LOCALAPPDATA ?? '', 'BeamNG', 'BeamNG.drive.ini');
  const text = existsSync(ini) ? readFileSync(ini, 'utf8') : '';
  const get = (k) => new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, 'm').exec(text)?.[1]?.trim();
  const install = arg('install', get('installPath') ?? 'C:/Program Files (x86)/Steam/steamapps/common/BeamNG.drive');
  const userRoot = get('userFolder') ?? join(process.env.LOCALAPPDATA ?? '', 'BeamNG', 'BeamNG.drive');
  return { install, user: join(userRoot, 'current') };
}

const { install, user } = locate();
const mods = join(user, 'mods');
const store = join(user, 'settings', 'jbeamForge');
const backup = join(user, '_jbeam_forge_test_backup');
const stateFile = join(user, '_jbeam_forge_session.json');
const batchDir = join(mods, 'unpacked', 'jbeam_forge_test_batch');
const logPath = join(user, 'beamng.log');
const LOG_ROOM = 13000;
const readLog = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '');

async function start(opts = { aside: arg('aside', ''), level: arg('level', 'gridmap_v2') }) {
  if (running()) throw new Error('BeamNG.drive is already running: stop it first');
  if (existsSync(stateFile)) throw new Error(`${stateFile} is still there: run stop first`);
  if (existsSync(backup) && readdirSync(backup).length) throw new Error(`${backup} still holds mods from a run that didn't finish`);
  mkdirSync(backup, { recursive: true });
  mkdirSync(store, { recursive: true });
  const moved = [];
  const aside = (path) => {
    const to = join(backup, path.slice(mods.length + 1).replace(/[\\/]/g, '__'));
    renameSync(path, to);
    moved.push({ from: path, to });
    say(`moved aside: ${path.slice(mods.length + 1)}`);
  };
  for (const name of ['jbeam_forge.zip', 'jbeam_forge_ingame.zip']) if (existsSync(join(mods, name))) aside(join(mods, name));
  for (const dir of readdirSync(join(mods, 'unpacked'))) if (/^jbeam_forge($|_ingame$)/i.test(dir)) aside(join(mods, 'unpacked', dir));
  for (const v of opts.aside ? opts.aside.split(',') : []) {
    for (const dir of readdirSync(join(mods, 'unpacked'))) if (existsSync(join(mods, 'unpacked', dir, 'vehicles', v))) aside(join(mods, 'unpacked', dir));
    for (const f of readdirSync(mods)) if (f.toLowerCase() === `${v.toLowerCase()}.zip`) aside(join(mods, f));
  }
  cpSync(resolve(ROOT, 'release', 'jbeam_forge_ingame.zip'), join(mods, 'jbeam_forge_ingame.zip'));
  const vehiclesDir = join(user, 'vehicles');
  const before = existsSync(vehiclesDir) ? readdirSync(vehiclesDir) : [];
  writeFileSync(stateFile, JSON.stringify({ moved, before, opts }));
  for (const f of ['queue.json', 'queue-done.json', 'quit.json', 'selftest-result.json']) rmSync(join(store, f), { force: true });
  writeFileSync(join(store, 'selftest.json'), JSON.stringify({ level: opts.level, steps: [], serve: true }));
  say('starting BeamNG.drive');
  spawn(join(install, 'Bin64', EXE), [], { cwd: install, detached: true, stdio: 'ignore' }).unref();
  // Ready once the map has loaded.
  for (let i = 0; i < 100; i++) {
    await sleep(3000);
    if (/Level loaded in/.test(readLog())) {
      await sleep(10000);
      say('ready');
      return;
    }
  }
  throw new Error('the map never loaded');
}

async function run() {
  if (!running() || !existsSync(stateFile)) throw new Error('no session: run start first');
  const src = resolve(arg('vehicle-mod'));
  // The game's log stops taking lines at 15000 (a car is some 700): a fresh game before that.
  const count = !arg('vehicles') || arg('vehicles') === 'all' ? readdirSync(join(src, 'vehicles')).length : arg('vehicles').split(',').length;
  if (readLog().split(/\r?\n/).length + count * 700 > LOG_ROOM) {
    say('the log of the game is nearly full: restarting the game');
    const { opts } = JSON.parse(readFileSync(stateFile, 'utf8'));
    await stop();
    await start(opts);
  }
  rmSync(batchDir, { recursive: true, force: true });
  cpSync(src, batchDir, { recursive: true });
  const all = readdirSync(join(src, 'vehicles')).filter((d) => statSync(join(src, 'vehicles', d)).isDirectory());
  const list = !arg('vehicles') || arg('vehicles') === 'all' ? all : arg('vehicles').split(',');
  const vehicles = list.map((v) => {
    const [name, pc] = v.split(':');
    return { vehicle: name, ...(pc ? { config: pc } : all.includes(name) ? { config: `vehicles/${name}/default.pc` } : {}) };
  });
  const id = Date.now();
  const from = readLog().split(/\r?\n/).length;
  rmSync(join(store, 'queue-done.json'), { force: true });
  rmSync(join(store, 'shots'), { recursive: true, force: true });
  mkdirSync(join(store, 'shots'), { recursive: true });
  writeFileSync(join(store, 'queue.json'), JSON.stringify({ id, vehicles, drive: process.argv.includes('--drive') }));
  say(`sent ${vehicles.length} cars`);
  const deadline = Date.now() + Number(arg('timeout', '1800')) * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const done = join(store, 'queue-done.json');
    if (existsSync(done) && JSON.parse(readFileSync(done, 'utf8')).id === id) break;
    if (!running()) throw new Error('the game closed');
  }
  // The game writes its log in blocks: the last car's lines are there once "batch done" is.
  let lines = [];
  for (let i = 0; i < 20; i++) {
    lines = readLog().split(/\r?\n/).slice(from);
    const end = lines.findIndex((l) => l.includes('self-test: batch done'));
    if (end >= 0) {
      lines = lines.slice(0, end + 1);
      break;
    }
    await sleep(1000);
  }
  if (!lines.some((l) => l.includes('self-test: batch done'))) say('the log stops before the end of the batch: the last car may be missing results');
  const cars = carsFromLog(lines);
  const out = resolve(ROOT, 'artifacts', 'game-session', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'beamng.log'), lines.filter((l) => !l.includes('self-test: flush')).join('\n'));
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ cars }, null, 2));
  // The pictures the game took of each car (front left at rest, side, and after the drive).
  const shots = join(store, 'shots');
  if (existsSync(shots)) {
    for (const f of readdirSync(shots)) renameSync(join(shots, f), join(out, f));
    say(`pictures: ${readdirSync(out).filter((f) => /\.(png|jpe?g)$/i.test(f)).length}`);
  }
  printCars(cars, say);
  say(`results in ${out}`);
}

async function stop() {
  if (running()) {
    writeFileSync(join(store, 'quit.json'), '{}');
    spawnSync('taskkill', ['/IM', EXE], { stdio: 'ignore' });
    for (let i = 0; i < 20 && running(); i++) await sleep(1000);
    if (running()) spawnSync('taskkill', ['/IM', EXE, '/F'], { stdio: 'ignore' });
  }
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { moved: [], before: [] };
  rmSync(join(mods, 'jbeam_forge_ingame.zip'), { force: true });
  rmSync(batchDir, { recursive: true, force: true });
  for (const m of state.moved.reverse()) if (existsSync(m.to)) renameSync(m.to, m.from);
  rmSync(backup, { recursive: true, force: true });
  const vehiclesDir = join(user, 'vehicles');
  if (existsSync(vehiclesDir)) for (const d of readdirSync(vehiclesDir)) if (!state.before.includes(d)) rmSync(join(vehiclesDir, d), { recursive: true, force: true });
  for (const f of ['selftest.json', 'queue.json', 'queue-done.json', 'quit.json']) rmSync(join(store, f), { force: true });
  rmSync(join(store, 'shots'), { recursive: true, force: true });
  rmSync(stateFile, { force: true });
  say('stopped; mods folder put back as it was');
}

const cmd = process.argv[2];
const main = cmd === 'start' ? start : cmd === 'run' ? run : cmd === 'stop' ? stop : null;
if (!main) {
  console.error('usage: game-session.mjs start|run|stop');
  process.exit(2);
}
main().catch((err) => {
  console.error(`game-session: ${err.message}`);
  process.exit(1);
});
