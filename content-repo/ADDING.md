# Adding content

Each item is one folder. Put it in `textures/`, `meshes/` or `scripts/` (in a category folder of
your choice), commit it to `main`, and within a few minutes it's in everyone's Downloads window.
Nothing else needs doing: the workflow (Actions tab) checks it, zips it and publishes a new version.

**Rename or move a folder only if you mean to**: an item's id comes from its folder path, so a
moved folder is a new item (and projects using the old one won't find it).

## The quickest way: from JBeam Forge

Make the material, object or script in the app and use **Share → Save for the download library**
(in the Materials panel, the object library or the script editor). It writes a ready folder with
everything it needs. Then add that folder here (next section).

## Uploading on the GitHub website

1. Open the folder you want it in (for example `textures/Paint`).
2. **Add file → Upload files**, and drag the item's whole folder in.
3. Write what it is in the box at the bottom and press **Commit changes**.

## With git

```
git pull
# copy the folder in, e.g. textures/Paint/Candy Red/
node tools/build.mjs --check   # optional: the same check the website runs
git add -A
git commit -m "Candy red paint"
git push
```

## What a folder needs

### A material (`textures/<Category>/<Name>/`)

| File | |
|---|---|
| `material.json` | made by JBeam Forge (Share → Save for the download library). Needs `"name"`. |
| `textures/…` | the texture files it uses (PNG, JPG or DDS), referenced by relative path |
| `LICENSE` / `README.md` | optional: where it's from and how it may be used |

### A mesh (`meshes/<Group>/<Category>/<Name>/`)

| File | |
|---|---|
| `object.json` | `{"version": 1, "name": "…", "category": "…", "group": "…", "mesh": "file.dae", "material": null}` |
| the mesh | DAE, OBJ, FBX, GLB or KN5, named in `object.json` |
| textures | anything the mesh uses, beside it |

### A script (`scripts/<category>/<id>/`)

| File | |
|---|---|
| `script.jbscript` | made by JBeam Forge (script editor → Share → Save for the download library) |
| `<name>.lua` | the controller it adds to a car |

## Limits

- One zipped item must stay under 95 MB (GitHub's limit is 100 MB per file). Big textures: save them as
  DDS or halve their size.
- Folder names: letters, digits, spaces, `-` and `_` are safe. No `< > : " | ? *`, no leading dot.
- If the check fails, the Actions tab says which folder and why; the other items still publish.

## Taking something out

Delete its folder and commit. People who already downloaded it keep their copy; the app shows it as
"no longer in the library".
