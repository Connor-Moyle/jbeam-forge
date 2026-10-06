#!/usr/bin/env node
/**
 * Test in the real game, hands off: put the builds under test in BeamNG's mods folder (moving
 * anything that would clash into a backup folder first), start the game, let JBeam Forge's
 * in-game self-test load a map, spawn the car, press F10 and write its result, then close the
 * game, collect what its log says about the car, and put the mods folder back as it was.
 *
 *   node scripts/dev/game-test.mjs [--vehicle-mod=<folder with vehicles/ or a .zip>] [--vehicle=practice_car]
 *        [--config=vehicles/practice_car/default.pc] [--ingame=release/jbeam_forge_ingame.zip] [--level=gridmap_v2]
 *        [--timeout=600] [--out=artifacts/game-test]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import yauzl from 'yauzl';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ROOT = resolve(import.meta.dirname, '..', '..');
const vehicleMod = arg('vehicle-mod');
const vehicle = arg('vehicle');
// A batch: --vehicles=a,b,c or --vehicles=all (every vehicle folder in --vehicle-mod).
const vehiclesArg = arg('vehicles');
const batch = !vehiclesArg ? null : vehiclesArg === 'all' ? readdirSync(join(resolve(vehicleMod), 'vehicles')).filter((d) => statSync(join(resolve(vehicleMod), 'vehicles', d)).isDirectory()) : vehiclesArg.split(',');
const config = arg('config');
const ingame = resolve(ROOT, arg('ingame', 'release/jbeam_forge_ingame.zip'));
const level = arg('level', 'gridmap_v2');
const timeoutS = Number(arg('timeout', '600'));
const out = resolve(ROOT, arg('out', join('artifacts', 'game-test', new Date().toISOString().replace(/[:.]/g, '-'))));
const EXE = 'BeamNG.drive.x64.exe';

function say(msg) {
  console.log(`game-test: ${msg}`);
}

// Where the game and its user folder are (BeamNG.drive.ini names both).
function locate() {
  const ini = join(process.env.LOCALAPPDATA ?? '', 'BeamNG', 'BeamNG.drive.ini');
  const text = existsSync(ini) ? readFileSync(ini, 'utf8') : '';
  const get = (k) => new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, 'm').exec(text)?.[1]?.trim();
  const install = arg('install', get('installPath') ?? 'C:/Program Files (x86)/Steam/steamapps/common/BeamNG.drive');
  const userRoot = get('userFolder') ?? join(process.env.LOCALAPPDATA ?? '', 'BeamNG', 'BeamNG.drive');
  return { install, user: join(userRoot, 'current') };
}

// The whole screen, through PowerShell (the game is in front while the test runs).
function screenshot(file) {
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
    `$bmp.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join('; ');
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
}

const running = () => spawnSync('tasklist', ['/FI', `IMAGENAME eq ${EXE}`], { encoding: 'utf8' }).stdout.includes(EXE);

function zipHas(zip, prefix) {
  return new Promise((done) => {
    yauzl.open(zip, { lazyEntries: true, autoClose: true }, (err, z) => {
      if (err || !z) return done(false);
      let found = false;
      z.on('entry', (e) => {
        if (e.fileName.toLowerCase().startsWith(prefix)) {
          found = true;
          z.close();
          done(true);
        } else z.readEntry();
      });
      z.on('end', () => !found && done(false));
      z.on('error', () => done(false));
      z.readEntry();
    });
  });
}

async function main() {
  if (process.platform !== 'win32') throw new Error('this runs the Windows game');
  if (running()) throw new Error('BeamNG.drive is running: close it first (only one copy can run).');
  if (!existsSync(ingame)) throw new Error(`no in-game build at ${ingame}: run npm run build:ingame`);
  const { install, user } = locate();
  const exe = join(install, 'Bin64', EXE);
  if (!existsSync(exe)) throw new Error(`the game isn't at ${install}`);
  const mods = join(user, 'mods');
  mkdirSync(join(mods, 'unpacked'), { recursive: true });
  mkdirSync(out, { recursive: true });
  const store = join(user, 'settings', 'jbeamForge');
  mkdirSync(store, { recursive: true });

  // 1. Anything that would clash goes into a backup folder (put back at the end).
  // Outside mods: the game loads zips from its subfolders too.
  const backup = join(user, `_jbeam_forge_test_backup`);
  if (existsSync(backup) && readdirSync(backup).length) throw new Error(`${backup} is still there from a run that didn't finish: put its contents back into mods first.`);
  mkdirSync(backup, { recursive: true });
  const moved = [];
  const moveAside = (path) => {
    const to = join(backup, path.slice(mods.length + 1).replace(/[\\/]/g, '__'));
    renameSync(path, to);
    moved.push({ from: path, to });
    say(`moved aside: ${path.slice(mods.length + 1)}`);
  };
  const installed = [];
  const restore = () => {
    for (const p of installed) rmSync(p, { recursive: true, force: true });
    for (const m of moved.reverse()) if (existsSync(m.to)) renameSync(m.to, m.from);
    rmSync(backup, { recursive: true, force: true });
    rmSync(join(store, 'selftest.json'), { force: true });
    say('mods folder put back as it was');
  };

  try {
    // The in-game version under test replaces any installed copy (old names included).
    for (const name of ['jbeam_forge.zip', 'jbeam_forge_ingame.zip']) if (existsSync(join(mods, name))) moveAside(join(mods, name));
    for (const dir of readdirSync(join(mods, 'unpacked'))) if (/^jbeam_forge($|_ingame$)/i.test(dir)) moveAside(join(mods, 'unpacked', dir));
    // Other copies of the car under test: the game merges same-named vehicle folders from every mod.
    // --aside=a,b: other vehicles to set aside too (the player's default car, spawned with the map).
    for (const v of [...(vehicle ? [vehicle] : []), ...(arg('aside', '') ? arg('aside').split(',') : [])]) {
      const prefix = `vehicles/${v.toLowerCase()}/`;
      for (const dir of readdirSync(join(mods, 'unpacked'))) if (existsSync(join(mods, 'unpacked', dir, 'vehicles', v))) moveAside(join(mods, 'unpacked', dir));
      for (const f of readdirSync(mods)) if (f.toLowerCase().endsWith('.zip') && statSync(join(mods, f)).isFile() && (await zipHas(join(mods, f), prefix))) moveAside(join(mods, f));
    }

    // 2. The builds under test.
    cpSync(ingame, join(mods, 'jbeam_forge_ingame.zip'));
    installed.push(join(mods, 'jbeam_forge_ingame.zip'));
    if (vehicleMod) {
      const src = resolve(vehicleMod);
      const to = src.toLowerCase().endsWith('.zip') ? join(mods, `jbeam_forge_test_${basename(src)}`) : join(mods, 'unpacked', `jbeam_forge_test_${vehicle ?? (batch ? 'batch' : 'vehicle')}`);
      cpSync(src, to, { recursive: true });
      installed.push(to);
      say(`installed ${basename(src)}`);
    }

    // 3. The self-test plan, then the game.
    rmSync(join(store, 'selftest-result.json'), { force: true });
    writeFileSync(join(store, 'selftest.json'), JSON.stringify({ level, steps: [], ...(vehicle ? { vehicle } : {}), ...(config ? { config } : {}), ...(batch ? { vehicles: batch.map((v) => ({ vehicle: v, config: `vehicles/${v}/default.pc` })) } : {}) }));
    say(`starting BeamNG.drive (${level}${vehicle ? `, ${vehicle}` : ''})`);
    const game = spawn(exe, [], { cwd: install, detached: true, stdio: 'ignore' });
    game.unref();

    const started = Date.now();
    let result = null;
    let shotTaken = false;
    while (Date.now() - started < timeoutS * 1000) {
      await new Promise((r) => setTimeout(r, 3000));
      // A picture while JBeam Forge should be on screen (the self-test opens it, then waits).
      if (!shotTaken && existsSync(join(user, 'beamng.log')) && /\|I\|GELua\.jbeamForge\.jbeamForge\| opening/.test(readFileSync(join(user, 'beamng.log'), 'utf8'))) {
        await new Promise((r) => setTimeout(r, 12000));
        screenshot(join(out, 'screen-jbeam-forge.png'));
        shotTaken = true;
      }
      if (existsSync(join(store, 'selftest-result.json'))) {
        await new Promise((r) => setTimeout(r, 4000)); // the car settles; its log lines land
        screenshot(join(out, 'screen-end.png'));
        result = JSON.parse(readFileSync(join(store, 'selftest-result.json'), 'utf8'));
        break;
      }
      if (Date.now() - started > 30000 && !running()) {
        say('the game closed before the self-test finished');
        break;
      }
    }
    say(result ? 'self-test finished: closing the game' : 'no result in time: closing the game');
    spawnSync('taskkill', ['/IM', EXE], { stdio: 'ignore' });
    for (let i = 0; i < 20 && running(); i++) await new Promise((r) => setTimeout(r, 1000));
    if (running()) spawnSync('taskkill', ['/IM', EXE, '/F'], { stdio: 'ignore' });

    // 4. What the game said.
    const logPath = join(user, 'beamng.log');
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    writeFileSync(join(out, 'beamng.log'), log);
    const lines = log.split(/\r?\n/);
    const spawnAt = vehicle ? lines.findIndex((l) => l.includes(`spawning vehicle /vehicles/${vehicle}/`)) : -1;
    const carStart = vehicle ? Math.max(0, lines.findIndex((l) => l.includes(`vehicles/${vehicle}/`) || l.includes(`/${vehicle}_`))) : 0;
    const pick = (re) => lines.filter((l, i) => i >= carStart && re.test(l));
    const summary = {
      result,
      vehicleSpawned: spawnAt >= 0,
      instability: pick(/Instability detected/).length,
      noController: pick(/No main controller found/).length > 0,
      linkErrors: pick(/link target not found/).length,
      flexbodyErrors: pick(/FLEXBODY ERROR/),
      missingMeshes: [...new Set(pick(/Mesh '.*' not found/).map((l) => /Mesh '(.*)' not found/.exec(l)[1]))],
      zeroBeams: pick(/zero size beam/).length,
      duplicatedBeams: pick(/duplicated beam/).length,
      missingMaterials: [...new Set(pick(/NO-MATERIAL/).map((l) => /mapping to: (\S+)/.exec(l)?.[1]))],
      jbeamForge: lines.filter((l) => /jbeamForge/.test(l) && !/Failed to set unload mode/.test(l)),
      errors: pick(/\|E\|/).slice(0, 80),
    };
    // A batch: each car's lines, from its spawn to the next.
    if (batch) {
      const marks = lines.map((l, i) => [i, /self-test: spawning (\S+)/.exec(l)?.[1]]).filter(([, v]) => v);
      summary.cars = marks.map(([at, v], k) => {
        const seg = lines.slice(at, marks[k + 1]?.[0] ?? lines.length);
        const has = (re) => seg.filter((l) => re.test(l));
        return {
          vehicle: v,
          spawned: has(/spawning vehicle \/vehicles\//).length > 0,
          instability: has(/Instability detected/).length,
          noController: has(/No main controller found/).length > 0,
          linkErrors: has(/link target not found/).length,
          flexbodyErrors: has(/FLEXBODY ERROR/).length,
          missingMeshes: [...new Set(has(/Mesh '.*' not found/).map((l) => /Mesh '(.*)' not found/.exec(l)[1]))],
          zeroBeams: has(/zero size beam/).length,
          duplicatedBeams: has(/duplicated beam/).length,
          missingMaterials: [...new Set(has(/NO-MATERIAL/).map((l) => /mapping to: (\S+)/.exec(l)?.[1]))],
          luaErrors: has(/expressionParser|attempt to|stack traceback/).length,
          errors: has(/\|E\|/).slice(0, 30),
        };
      });
      for (const c of summary.cars) say(`${c.vehicle}: ${c.spawned ? 'spawned' : 'NOT spawned'} · instability ${c.instability} · controller ${c.noController ? 'MISSING' : 'ok'} · links ${c.linkErrors} · flexbody ${c.flexbodyErrors} · meshes ${c.missingMeshes.length} · materials ${c.missingMaterials.length} · zero beams ${c.zeroBeams} · dup beams ${c.duplicatedBeams} · lua ${c.luaErrors}`);
    }
    writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
    say(`results in ${out}`);
    console.log(JSON.stringify({ ...summary, errors: `${summary.errors.length} error lines (summary.json)`, jbeamForge: summary.jbeamForge.slice(-12) }, null, 2));
  } finally {
    if (running()) spawnSync('taskkill', ['/IM', EXE, '/F'], { stdio: 'ignore' });
    restore();
  }
}

main().catch((err) => {
  console.error(`game-test: ${err.message}`);
  process.exit(1);
});
