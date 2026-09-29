# Content repositories: textures and meshes

The materials and objects packs are no longer inside the installer. They live in two optional GitHub repositories that the app downloads from (Downloads window, Ctrl+Shift+D):

| Kind | Repository (default) | What's in it |
|---|---|---|
| Textures | `Connor-Moyle/jbeam-forge-textures` | material folders (the old materials pack) |
| Meshes | `Connor-Moyle/jbeam-forge-meshes` | object folders (the old objects pack) |
| Scripts | `Connor-Moyle/jbeam-forge-scripts` | vehicle script folders (`script.jbscript` + its `.lua`) |

Both can be changed in Settings → Downloads (repository and branch), for a mirror or your own content.

## Layout

```
manifest.json        every item: id, name, category, folder, zip path, size, SHA-256, file count
items/<id>.zip       one material or object folder per zip
README.md
.gitattributes       *.zip binary
```

`manifest.json` has `format: 1`, `kind` (`textures` or `meshes`), `version` and `items`. Item folders unpack to `<content folder>/<kind>/<folder>/`, the same layout as the old packs, so projects that used a pack item find it again once it's downloaded.

## Publishing a version

1. Put the source folders in `packs/materials`, `packs/objects` and `packs/scripts`. Without `packs/scripts`, the scripts repository is made from the app's built-in templates.
2. `npm run build-content-repos -- --version 2026.09.29`
   writes `release/content/textures`, `release/content/meshes` and `release/content/scripts`. Zips are deterministic, so unchanged items keep the same hash and aren't downloaded again.
3. Copy each folder over a clone of its repository, commit, push to `main`, and tag it `v<version>` (e.g. `v2026.09.29`). Push the tag.

Each tag is a version users can roll back to (Downloads → Textures/Meshes → Version). "Latest" follows the branch set in Settings (default `main`).

## How the app downloads

- Files come from `raw.githubusercontent.com/<repo>/<ref>/…`, tags from the GitHub API. Only GitHub hosts are allowed.
- Every zip is checked against the manifest's size and SHA-256, unpacked with path checks (no `..`, no absolute paths, size and file-count caps), and swapped in atomically. A failed or cancelled item leaves the previous copy in place.
- What's installed is recorded in `<content folder>/<kind>/.installed.json` (repository, ref, version and each item's hash), so "Update changed" only fetches items whose hash changed.

## Where content is saved

| How the app runs | Content folder |
|---|---|
| Portable exe | `JBeam Forge Content` beside the exe |
| Installed | `JBeam Forge Content` beside the install folder (the uninstaller clears the install folder on updates) |
| Development | `content/` in the checkout (git-ignored) |

Settings → Downloads can move it anywhere. If the folder can't be written, the app falls back to its user data folder and says so.

## App versions

The Application tab lists GitHub Releases of the app repository (Settings → Downloads). It downloads the installer or portable exe, checks its size and GitHub's SHA-256 digest when present, and runs the installer (or shows the portable exe). Older releases are listed for rolling back. Pre-releases show only with Settings → Downloads → "Include pre-release (test) versions".
