# Reference vehicle notes — re-verified on 0.39.1

**Sources:** covet, pickup and etk800, extracted with `npm run study-vehicle -- <name> --common` from **BeamNG.drive 0.39.1.0** (`I:\SteamLibrary\steamapps\common\BeamNG.drive`).

The previous build kept notes from an older game version (Covet only). Each claim is re-checked here: ✔ still true · ✘ changed or wrong · ➕ new finding. Details live in `beamng-vehicle-layout.md` and `beamng-jbeam-syntax.md`.

| Old claim | 0.39.1 | Notes |
|---|---|---|
| Main part `<model>` in `<model>.jbeam`, `slotType: "main"`, no nodes/beams | ✔ | Same in covet, pickup and etk800 |
| Body/frame is a child slot with `coreSlot: true` | ✔ | covet_body, pickup_frame, etk800_body |
| Slots are declared in a `slots` table | ✘ | Current format is **`slots2`** `["name","allowTypes","denyTypes","default","description"]`. Legacy `slots` `["type","default","description"]` still exists in 52 vehicles (e.g. covet/trailer) |
| Every meshed part has `flexbodies` `["mesh","[group]:","nonFlexMaterials"]` | ✔ | Plus a 2-column variant (131 parts). Non-visual parts legitimately have none |
| Flexbody mesh = DAE `<node name>` in the vehicle's DAE | ✘ (incomplete) | Also resolves from **common.zip** DAEs (pickup: 142 of 912 meshes come from common). Names can be `$=` expressions |
| Node group is an option row, not a column | ✔ | `{"group":"x"}` … `{"group":""}` |
| refNodes header has 6 columns incl. leftCorner/rightCorner | ✔ | 171 parts; a 4-column variant is in 109 parts |
| pressureWheels header `["name","hubGroup","group","node1:","node2:","nodeS","nodeArm:","wheelDir"]` | ✔ | 3798 of 3799 |
| `.pc` = `{format:2, model, parts, vars}` | ✔ | ➕ A legacy flat `.pc` (no format/parts keys, missing commas) still ships: `pickup/d15_4wd_A.pc` |
| `info.json` shape (Author, Name, Brand, …, paints, libraryPaints) | ✔ | ➕ Also `Region`, `InsuranceClass`, `Derby Class`, `multiPaintSetups`, `paintCollections`, `Slogan`. ➕ covet's `info.json` is **not valid JSON** (trailing commas) |
| `info_<config>.json` has `Value/Weight/Power/Weight/Power` + performance fields | ✔ | 27 keys in the covet sample |
| materials: v1.5 PBR (`baseColorMap`, `metallicMap`, `roughnessMap`, `version: 1.5`, `class: "Material"`) coexists with legacy entries | ✔ | etk800 also uses `baseColorFactor`/`metallicFactor`/`roughnessFactor`, `alphaRef`, `materialTag0/1` |
| `.cdae` is a game cache — do not emit | ✔ (unchanged) | Every studied `.dae` ships with a `.cdae`. Whether the game regenerates it for mods is to be confirmed in the Phase 5 in-game gate |
| Coordinates: +X left, +Y rearward, +Z up | not re-verified | Needs geometry, not text. Phase 3 locks it with a Z-up fixture test (SPEC §2) |

➕ **Also new in 0.39.1:**
- `slotType` may be an **array** (117 parts).
- One `.jbeam` file can hold many parts: covet has 815 parts in 157 files.
- Official content contains header typos (`nonRLexMaterials`) and 2 flexbody meshes that exist in no DAE. BeamNG evidently tolerates both. Our exporter must still be exact.
