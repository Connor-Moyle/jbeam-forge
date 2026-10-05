/**
 * Set up (or refresh) a copy of the content repository from this project's template:
 *
 *   npm run content:init -- <folder> [--textures <pack>] [--meshes <pack>]
 *
 * Copies content-repo/ (the build tool, its workflow and the guides) into <folder>, makes it a git
 * repository if it isn't one, and fills scripts/ with the app's built-in vehicle scripts. With
 * --textures or --meshes, a pack folder is copied in as well (only content you may share: the
 * repository is public). Then commit and push it; the workflow builds the downloads.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUILT_IN_TEMPLATES } from '../src/shared/lua/library';
import { templateToLibrary } from '../src/shared/lua/library/share';

const target = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : null;
if (!target) {
  console.error('Usage: npm run content:init -- <folder> [--textures <pack>] [--meshes <pack>]');
  process.exit(1);
}
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]!) : null;
};

mkdirSync(target, { recursive: true });
cpSync(resolve('content-repo'), target, { recursive: true });
writeFileSync(join(target, '.gitignore'), 'node_modules/\nout/\n');
writeFileSync(join(target, '.gitattributes'), '* text=auto\n*.png binary\n*.jpg binary\n*.jpeg binary\n*.dds binary\n*.tga binary\n*.dae binary\n*.fbx binary\n*.glb binary\n*.kn5 binary\n*.zip binary\n');
writeFileSync(join(target, 'package.json'), `${JSON.stringify({ name: 'jbeam-forge-content', private: true, type: 'module', scripts: { check: 'node tools/build.mjs --check', build: 'node tools/build.mjs' }, devDependencies: { yazl: '^2.5.1' } }, null, 2)}\n`);

let scripts = 0;
for (const t of BUILT_IN_TEMPLATES) {
  const dir = join(target, 'scripts', t.category.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase(), t.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'script.jbscript'), `${JSON.stringify(templateToLibrary(t), null, 2)}\n`);
  writeFileSync(join(dir, `${t.name0}.lua`), t.lua);
  scripts++;
}
for (const [kind, from] of [['textures', arg('textures')], ['meshes', arg('meshes')]] as const) {
  if (!from) continue;
  cpSync(from, join(target, kind), { recursive: true, filter: (p) => !/(^|[\\/])(MATERIALS|OBJECTS)\.md$/.test(p) });
  console.log(`${kind}: copied from ${from}`);
}
if (!existsSync(join(target, '.git'))) execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
console.log(`Content repository ready in ${target} (${scripts} scripts).`);
console.log('Next: git add -A, commit, add the GitHub remote and push (see content-repo/SETUP.md).');
