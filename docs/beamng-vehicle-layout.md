# Vehicle mod layout — verified (BeamNG.drive 0.39.1)

**Evidence:**
- `npm run study-vehicle -- <name> --common` for **covet**, **pickup** and **etk800**. The output lands in `scratch/vehicle-study/` and is not committed.
- The corpus catalogue (`docs/beamng-section-catalogue.md`).

"n/N" means n out of N parts or files. Every statement below was read from those files. Re-verify before changing any exporter (SPEC §3.1).

## Folder / zip layout

```
vehicles/<model>/                       e.g. vehicles/covet/
  <model>.jbeam                          the main part (slotType "main")
  <model>_*.jbeam                        other parts; one file can hold MANY parts
  <model>.dae (+ <model>.cdae)           meshes; .cdae is a compiled cache shipped alongside (3/3 vehicles)
  main.materials.json, skin.materials.json
  info.json                              vehicle metadata
  <config>.pc + info_<config>.json + <config>.jpg   one per config (covet 40, pickup 74, etk800 29)
  <subfolder>/…                          allowed (covet/trailer/, covet/3wheel/, etk800 ships UI html/js/lua)
```

- **Parts per vehicle:** covet 815 parts in 157 jbeam files, pickup 679 in 193, etk800 317 in 59. Parts, not files, are the unit of structure.
- Mods live in the user folder: `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current\mods` (see `testing-in-beamng.md`).

## The main part

In all three vehicles the main part is named after the model (`covet`, `pickup`, `etk800`), lives in `<model>.jbeam`, and has `"slotType": "main"`.

It carries **no nodes/beams/flexbodies**. Its sections are only `information, slotType, slots2, variables, components, glowMap` (+ `scaledragCoef`).

The chassis is a child slot marked `coreSlot`:

```
["covet_body",  ["covet_body"],  [], "covet_body",        "Body", {"coreSlot":true}]
["pickup_frame",["pickup_frame"],[], "pickup_frame",      "Frame",{"coreSlot":true}]
["etk800_body", ["etk800_body"], [], "etk800_body_wagon", "Body", {"coreSlot":true}]
```

`coreSlot` is also used deeper in the tree (e.g. `etk800_body_sedan → etk800_dash`), marking slots that cannot be emptied.

## Slots: `slots2` (current) and `slots` (legacy) — both live

| Format | Header | Corpus |
|---|---|---|
| `slots2` | `["name","allowTypes","denyTypes","default","description"]` (+ options dict) | 5573 parts, 69 vehicles |
| `slots` (legacy) | `["type","default","description"]` (+ options dict) | 2059 parts, 52 vehicles |

- No part uses both.
- In `slots2`, `allowTypes` is a **list** of slotTypes and `default` is the part id to pre-select (`""` means empty).
- A part's **`slotType` is usually a string, but may be an array** (117 parts corpus-wide).
- **Our exporter should write `slots2`.** It is the current format and is used by every main part studied.

## Parts and flexbodies

- `flexbodies` header: `["mesh","[group]:","nonFlexMaterials"]` (15,522). A 2-column variant `["mesh","[group]:"]` also exists (131).
- **Mesh names resolve against the vehicle's own DAE `<node name>`s *and* shared content in `common.zip`:**

  | Vehicle | Mesh references | Not in own DAEs | Not in own + common |
  |---|---:|---:|---:|
  | pickup | 912 | 142 | **0** |
  | covet | 746 | 328 | 2 |
  | etk800 | 320 | 66 | 6 |

  - Wheels, brakes, wings and similar meshes come from common.
  - The 6 etk800 "misses" are `$=` expressions (`"$= $components.hasDiffuserCutout ~= true and '…' or '…_cut'"`) evaluated at runtime.
  - The 2 covet misses (`covet_boxutility_tonguejack*`) exist in no DAE at all: a dangling reference *in official content*.
- **Validator implication (Phase 5):**
  - Resolve names against our exported DAE, plus common's node index when a user references shared meshes.
  - Skip `$=` names.
  - For our own parts, every mesh must be in our DAE (SPEC §3.2).
- DAE node tags look like `<node id="boxutility_tonguejack" name="boxutility_tonguejack" type="NODE">`: `id` equals `name` in all samples, and flexbodies reference the `name`.
- Parts **without** flexbodies are normal for non-visual parts (ECUs, engine internals, tuning parts): covet 128/815, pickup 56/679, etk800 59/317.

## Nodes, beams, triangles, refNodes

- Headers are uniform across the corpus:
  - `nodes`: `["id","posX","posY","posZ"]`
  - `beams`: `["id1:","id2:"]`
  - `triangles`: `["id1:","id2:","id3:"]`
- Node **groups** are set with option rows (`{"group":"covet_hood"}` … `{"group":""}`), not a column.
- `refNodes` has two headers in use: `["ref:","back:","left:","up:","leftCorner:","rightCorner:"]` (171) and `["ref:","back:","left:","up:"]` (109). **Write the 6-column form.** All three studied vehicles use it.
- `pressureWheels`: `["name","hubGroup","group","node1:","node2:","nodeS","nodeArm:","wheelDir"]` (3798 of 3799).

## `.pc` configs

- **Current (format 2):** `{"format": 2, "model": "<model>", "parts": {"<slot>": "<partId or \"\">", …}, "vars": {…}}`. The `parts` map is flat over every slot in the whole tree.
- **Legacy (still shipped):** `pickup/d15_4wd_A.pc` is a bare flat `{"<slot>": "<part>", …}` with no `format`/`model`/`parts` keys, and it also has missing commas. Our importer must accept it. **Our exporter writes format 2.**

## `info.json` (vehicle) and `info_<config>.json`

- **`info.json` keys** (union over the three vehicles): `Author, Name, Brand, Body Style, Country, Region, Derby Class, Description, Type, InsuranceClass, Years, Slogan, defaultPaintName1, default_pc, paints, multiPaintSetups, libraryPaints, paintCollections`.
  - Not every vehicle has every key; for example pickup has no `Years`/`paints`, and only etk800 has `Slogan`.
  - covet's `info.json` has trailing commas: parse it leniently.
- **`info_<config>.json` keys** (covet sample): `Configuration, Config Type, Description, Value, Weight, Power, Weight/Power, Torque, TorquePeakRPM, PowerPeakRPM, Top Speed, 0-60 mph, 0-100 km/h, 60-0 mph, 100-0 km/h, Braking G, Drag Times, Drivetrain, Fuel Type, Induction Type, Propulsion, Transmission, Off-Road Score, BoundingBox, Population, defaultPaintName1, vehicleSelectorSubGroup`.
  - Many of these are performance results BeamNG measures itself. We only write what we can compute honestly (SPEC §1 honesty stance).

## Materials (`*.materials.json`)

- Top level is `{ "<material name>": { "name", "mapTo", "class": "Material", "Stages": [ … ], "version": 1.5, … } }`.
- Two generations coexist in the same file: **v1.5 PBR** entries (`"version": 1.5`) and legacy entries without `version`.
- v1.5 stage keys seen:
  - maps: `baseColorMap, metallicMap, roughnessMap, normalMap, ambientOcclusionMap`
  - factors: `baseColorFactor, metallicFactor, roughnessFactor`
  - material-level: `dynamicCubemap`, `alphaRef`, `materialTag0/1`
- `main.materials.json` can be small: pickup defines only 2 materials there, with the rest coming from shared content. Material names therefore resolve across files, like meshes. Verify the exact lookup in Phase 8 before relying on it.
