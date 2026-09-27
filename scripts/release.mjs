// Builds the Windows installer + portable exe and publishes them as a GitHub release.
//
//   node scripts/release.mjs            build, tag v<version>, upload
//   node scripts/release.mjs --no-build upload whatever is already in release/
//
// Release notes come from docs/releases/v<version>.md (first line is the title).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;
const notesPath = join(root, 'docs', 'releases', `${tag}.md`);
if (!existsSync(notesPath)) throw new Error(`Write the release notes first: docs/releases/${tag}.md`);

const gh = process.platform === 'win32' && existsSync('C:/Program Files/GitHub CLI/gh.exe') ? 'C:/Program Files/GitHub CLI/gh.exe' : 'gh';
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: cmd === 'npm' });

if (!process.argv.includes('--no-build')) run('npm', ['run', 'dist']);

const assets = [`JBeam-Forge-Setup-${version}.exe`, `JBeam-Forge-${version}-portable.exe`].map((f) => join(root, 'release', f));
for (const a of assets) if (!existsSync(a)) throw new Error(`Missing build output: ${a}`);

const [titleLine, ...body] = readFileSync(notesPath, 'utf8').split('\n');
const title = titleLine.replace(/^#\s*/, '').trim();
const bodyFile = join(root, 'release', 'notes.md');
writeFileSync(bodyFile, body.join('\n').trim() + '\n');

const tags = execFileSync('git', ['tag', '--list', tag], { cwd: root, encoding: 'utf8' }).trim();
if (!tags) run('git', ['tag', '-a', tag, '-m', title]);
run('git', ['push', 'origin', tag]);
run(gh, ['release', 'create', tag, ...assets, '--title', title, '--notes-file', bodyFile]);
console.log(`Released ${tag}`);
