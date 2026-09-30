# Releasing JBeam Forge

Every release is the next version number and goes out from `main`.

1. Work happens on a branch. When it's ready: `npm run typecheck`, `npm run lint`,
   `npx vitest run` and the full desktop harness
   (`JBFORGE_SWIFTSHADER=1 xvfb-run -a node scripts/run-desktop.mjs`) all pass.
2. Bump the version in `package.json` (and the lock file):
   `npm version <next> --no-git-tag-version`. Patch for fixes and additions
   (0.13.1 → 0.13.2), minor for a big step (0.13 → 0.14). Never reuse a number.
3. Write `docs/releases/v<version>.md` (first line is the release title) and add a
   row to the release table in `docs/PROGRESS.md`.
4. Fast-forward `main` to that commit.
5. Run the **Release** workflow on `main` (Actions → Release → Run workflow). It
   builds the installer and the portable exe on Windows and publishes them as
   `v<version>`. It refuses to run when that release exists already, or when the
   version isn't newer than the latest release, so older releases are never touched.

## Save files stay compatible

Projects (`.jbforge`) from every earlier version open in the new one:

- Any change to what a project holds bumps `CURRENT_PROJECT_VERSION` in
  `src/shared/project/schema.ts` and adds an upgrade step in
  `src/shared/project/migrations.ts` (from the old version to the new one).
- A project saved by the version before goes into `tests/fixtures/jbforge/`
  (never edited afterwards), and `npx vitest run` is run once with
  `UPDATE_FORMAT_LOCK=1` to record the new format.
- `tests/shared/projectUpgrade.test.ts` checks that every fixture opens at the
  current version with its work intact and saves and opens again unchanged, that
  there is an upgrade step for every version, and fails when the format changes
  without a new version.
- The first save after opening an older project keeps the original beside it as
  `name.jbforge.v<old>.bak`.

Settings and layouts upgrade by themselves: settings are merged field by field
over the defaults (a field the app no longer knows is dropped, a new one takes
its default), and a layout the app can't use falls back to the workspace's default.
