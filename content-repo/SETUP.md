# Setting up the content repository (once)

1. On github.com: **New repository** → name `jbeam-forge-content`, **Public** (downloads have to work
   without signing in), and leave it empty (no README, licence or .gitignore).
2. Run `powershell -ExecutionPolicy Bypass -File C:\dev\publish-content.ps1`. It pushes this folder;
   the **Actions** tab then shows "Build downloads" running, and a **downloads** branch appears.
3. In JBeam Forge: Settings → Downloads → Publishing → **Choose**, and pick this folder. Materials and
   scripts get an "Add to the download library" button, and **Publish** sends whatever you've added.

The app downloads from `Connor-Moyle/jbeam-forge-content/textures`, `/meshes` and `/scripts` on the
`downloads` branch (Settings → Downloads → Repositories), so nothing else needs changing.

## Adding the old packs

Only add what you're allowed to share: the repository is public. Copy folders from
`C:\dev\jbeam-forge\packs\materials` into `textures\` and from `packs\objects` into `meshes\`
(keep the category folders), then Publish in the app or commit and push.

To copy a whole pack in one go:

```
cd C:\dev\jbeam-forge
npm run content:init -- C:\dev\jbeam-forge-content --textures packs\materials
```

## If a build fails

The Actions tab shows the run in red and says which folder is wrong. Fix or remove that folder and
push again; everything else was still published.

Settings → Actions → General → Workflow permissions must allow **Read and write** (it's the default
for a new personal repository); the workflow needs it to publish the downloads branch.
