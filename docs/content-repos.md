# The download library: textures, meshes and scripts

Materials, ready-made meshes and vehicle scripts aren't in the installer. They live in one public
GitHub repository, [`Connor-Moyle/jbeam-forge-content`](https://github.com/Connor-Moyle/jbeam-forge-content),
and the app downloads them (Downloads window, Ctrl+Shift+D). `content-repo/` in this project is that
repository's template: its build tool, workflow and guides (`SETUP.md` covers the first setup).

## How it fits together

```
jbeam-forge-content
├── main branch          what people edit: one folder per item
│   ├── textures/<Category>/<Name>/material.json + textures/
│   ├── meshes/<Group>/<Category>/<Name>/object.json + mesh
│   ├── scripts/<category>/<id>/script.jbscript + .lua
│   ├── tools/build.mjs  zips each folder and writes the manifests
│   └── .github/workflows/build.yml
└── downloads branch     built on every push to main, never edited by hand
    ├── textures/manifest.json + items/<id>.zip
    ├── meshes/…
    └── scripts/…        (each build is also tagged v<date>.<build>)
```

The app's settings point at a folder of a repository: `Connor-Moyle/jbeam-forge-content/textures` (and
`/meshes`, `/scripts`) on the `downloads` branch. Any repository laid out the same way works, for a mirror
or someone's own library (Settings → Downloads → Repositories).

## Publishing content

From the app: Settings → Downloads → Publishing → choose the local copy of the repository (or **Get a
copy**). Materials (Materials panel) and scripts (script editor) then have **Add to the download library**;
**Add a finished folder** takes a mesh or anything made outside the app. **Publish** commits and pushes.

Without the app: add folders on the GitHub website (Add file → Upload files) or with git. The repository's
`ADDING.md` explains the folder formats.

Either way, the workflow checks every folder, builds the downloads branch and tags a new version. A folder
that fails the check is left out and named in the run's log; the rest still publish.

`npm run content:init -- <folder> [--textures <pack>] [--meshes <pack>]` sets up a copy of the repository
from the template, with the built-in scripts (and optionally a whole pack).

## Ids and hashes

An item's id comes from its folder path, so it never changes unless the folder moves. Zips are
deterministic (sorted entries, fixed timestamps), so an item that didn't change keeps its SHA-256 and
"Update changed" skips it. `tools/build.mjs` must build exactly what `src/main/content/buildRepo.ts` does;
`tests/main/content.test.ts` checks that it does.

## How the app downloads

- Files come from `raw.githubusercontent.com/<repo>/<ref>/<folder>/…`, versions from the GitHub API
  (tags). Only GitHub hosts are allowed.
- Every zip is checked against the manifest's size and SHA-256, unpacked with path checks (no `..`, no
  absolute paths, size and file-count caps) and swapped in atomically. A failed or cancelled item leaves
  the previous copy in place.
- What's installed is recorded in `<content folder>/<kind>/.installed.json` (repository, ref, version and
  each item's hash).

## Where content is saved

| How the app runs | Content folder |
|---|---|
| Portable exe | `JBeam Forge Content` beside the exe |
| Installed | `JBeam Forge Content` beside the install folder (kept when the app updates) |
| Development | `content/` in the checkout (git-ignored) |

Settings → Downloads can move it anywhere. If the folder can't be written, the app falls back to its user
data folder and says so.

## App versions

The Application tab lists GitHub Releases of the app repository. It downloads the installer or portable
exe, checks its size and GitHub's SHA-256 digest when present, and runs the installer (or shows the
portable exe). Older releases are listed for rolling back. Pre-releases show only with Settings →
Downloads → "Include pre-release (test) versions". The app repository (or a public releases-only
repository) has to be public for this to work for other people.
