// The full regression run before a release: every check the project has, in order, with a summary.
//
//   npm run regress                      typecheck, lint, unit tests, desktop harness, lint the exported mod
//   npm run regress -- --quick           skip the desktop harness (and the mod lint that needs it)
//   npm run regress -- --beamng-install="I:/…/BeamNG.drive" --ac-car="…"   passed on to the harness
//
// Stops at the first failure so its output is the last thing on screen.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const quick = process.argv.includes('--quick');
const passOn = process.argv.slice(2).filter((a) => a !== '--quick');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** The newest harness run's folder. */
function latestRun() {
  const dir = join(root, 'artifacts', 'run-desktop');
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir).sort();
  return runs.length ? join(dir, runs.at(-1)) : null;
}

const steps = [
  ['typecheck', () => [npm, ['run', '-s', 'typecheck']]],
  ['lint', () => [npm, ['run', '-s', 'lint']]],
  ['unit tests', () => [npm, ['run', '-s', 'test']]],
  ...(quick
    ? []
    : [
        ['desktop harness', () => [npm, ['run', '-s', 'run-desktop', '--', ...passOn]]],
        [
          'exported mod lint',
          () => {
            const mod = latestRun() && join(latestRun(), 'exported-mod');
            if (!mod || !existsSync(mod)) throw new Error('the harness kept no exported mod');
            return [npm, ['run', '-s', 'lint-mod', '--', mod]];
          },
        ],
      ]),
];

const results = [];
let failed = false;
for (const [name, command] of steps) {
  console.log(`\n── ${name} ──`);
  const start = Date.now();
  let ok = false;
  try {
    const [cmd, args] = command();
    ok = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
  }
  results.push({ name, ok, seconds: (Date.now() - start) / 1000 });
  if (!ok) {
    failed = true;
    break;
  }
}

console.log('\n── summary ──');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(20)} ${r.seconds.toFixed(1)} s`);
for (const [name] of steps.slice(results.length)) console.log(`skip  ${name}`);
process.exit(failed ? 1 : 0);
