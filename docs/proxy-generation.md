# Proxy generation — verified numbers and design (Phase 4)

**Evidence:** `npm run study-structure -- sunburst2` (after `npm run study-vehicle -- sunburst2`), which reads every jbeam of the official **Hirochi Sunburst** (BeamNG.drive 0.39.1).
- The script prints aggregates only. Nothing from the game files is copied.
- Re-run it before changing presets (SPEC §3.1). Where a number below differs from SPEC §4.4's remembered values, **the measurement wins** and the difference is noted.

## What an official car's structure looks like

| Measure | Sunburst |
|---|---|
| Total | 2,773 nodes · 18,933 beams · 2,319 collision triangles in 266 structural parts |
| Nodes per part | median 7, p90 21, max 160 (body) |
| Body | 152–160 nodes, ~1,000 beams, ~240 triangles, ~305 kg |
| Beams per node | median 6.3 (panels 6–10, glass 2) |
| Beam length | p10 0.31 m, **median 0.32 m**, p90 0.74 m, max 2.0 m |
| nodeWeight | p10 0.3, **median 0.75**, p90 4.5, max 40 kg |
| Triangles per node | body 1.5, panels 0.75–1.1, glass 0.3 |

**Consequences:**
- **Node spacing:** target ≈ 0.3 m and subdivide beams longer than ~0.75 m. This is the `maxEdge` default.
- **Whole-car budget** of ~600–1,200 generated nodes (SPEC §4.4) fits: the official car is 2,773 nodes, but that includes suspension, powertrain and every variant.
- **Light nodes are normal:** bumpers and trim run 0.3 kg. SPEC's "<0.5 kg warning" would flag official content, so we warn below **0.25 kg**. The stability predictor (below) is the real guard.

## Beam presets (measured medians of `|NORMAL` beams, per part kind)

| Preset (taxonomy `beamPreset`) | Measured from | spring | damp | deform | strength | nodeWeight |
|---|---|---:|---:|---:|---:|---:|
| `structure_stiff` | body sedan/wagon | 1.2e6 | 80 | 7.5e3 | 5.0e4 | 2 |
| `panel_metal` | hood, doors, fenders | 8.0e5 | 60 | 8.0e3 | 5.5e4 | 0.75 |
| `panel_plastic` | bumpers, side skirts, spoilers | 2.0e5 | 30 | 6.0e3 | 2.5e4 | 0.3 |
| `trim_light` | exhaust trim, small panels | 1.5e5 | 25 | 4.0e3 | 1.2e4 | 0.3 |
| `glass_brittle` | windshield, side/door/rear glass | 3.0e5 | 250 | 3.5e3 | 3.5e3 | 1.6 |
| `mechanical` | suspension arms, subframes | 4.0e6 | 150 | 2.5e4 | 2.75e5 | 4.5 |
| `mechanical_block` | engine, transaxle | 1.5e7 | 500 | 1.75e5 | FLT_MAX | 15 |
| `tyre_rubber` | — | — | — | — | — | — |

- `tyre_rubber` is not generated as a proxy: wheels are `pressureWheels` (Phase 10).
- SPEC §4.4 says "structural spring ~2–4M". That matches **suspension** (4e6), not the body shell (1.2e6). We use the measured values.
- Glass: high damping, and strength equal to deform (3.5e3), so it breaks rather than bends. This is the "glass brittle" behaviour.

## Beam types and groups

- `|NORMAL` 15,158 · `|SUPPORT` 3,783 · `|BOUNDED` 296 (suspension/steering).
  - **Generated edges and braces are `|NORMAL`.**
  - `|SUPPORT` (compression-only collision support) and `|BOUNDED` belong to later phases (editing, suspension).
- `breakGroup` is on 7,500 / 19,341 beams (225 distinct groups). `deformGroup`: 50, used by lights and glass (Phase 12).
- **Node options** seen: `nodeMaterial` `|NM_METAL`, `|NM_PLASTIC`, `|NM_CLOTH`, `|NM_RUBBER`, `|NM_GLASS`; `frictionCoef` 0.5–1.1 (median 0.5); `collision`/`selfCollision` mostly true.

## Attachments (how parts hang on their parent)

- **Half of all beams attach a part to its parent's nodes:** 9,216 beams in 196 parts, median 36 per part (p90 101).
- **76 % carry a `breakGroup`:** bumpers 146/146, doors 65/65, fenders 59/59.
- Attach beams measure spring median 2.5e5, strength median 6.5e4, deform median 7.5e3.

| Style | Links per boundary node | spring | damp | deform | strength | breakGroup |
|---|---:|---:|---:|---:|---:|---|
| Bolted | 3 | 4.0e5 | 40 | 1.2e4 | 6.5e4 | yes |
| Clipped | 2 | 1.5e5 | 20 | 4.0e3 | 8.0e3 | yes |
| Rivets | 3 | 6.0e5 | 50 | 1.5e4 | 4.0e4 | yes |
| Welded | 4 | 1.0e6 | 60 | 2.0e4 | 1.5e5 | no (tears, doesn't detach) |

- **Openable parts** (doors, hood, trunk, tailgate, fuel door) get **no rigid attachment**; hinges own them (Phase 9).
- Until then they generate with a flag, and the validator will list them as unattached.

## Node naming

- Official ids are overwhelmingly `letters + number + side`: shape `a0a` ×2,236, `a0` ×444. The side suffix is `l`/`r`; centre nodes have none.
- **Our scheme:** `<nodePrefix><tag><n><l|r>`.
  - `nodePrefix` comes from the taxonomy, unique per kind.
  - `tag` disambiguates positions of the same kind: `f`/`r` fore, or corner.
  - `n` is shared by a mirrored pair.
  - Variants of one slot reuse the base's names, since only one variant is ever installed.
- **Left is +X** in BeamNG space.
  - Only 472 of 1,140 official `…l` ids have an exact mirrored `…r` twin. Symmetry isn't guaranteed there.
  - Our symmetric proxies give every off-centre node an exact twin.

## refNodes

- `["ref:","back:","left:","up:","leftCorner:","rightCorner:"]`, placed on the body:
  - `ref` near the floor centre;
  - `back` behind it (+Y);
  - `left` to its left (+X);
  - `up` above it;
  - corners at the front-lower left/right.
- They're editable in Phase 7.

## Pipeline (per part)

1. **Gather** every mesh assigned to the part (split results included) in BeamNG space.
2. **Shape** by mode:
   - **decimate** (meshoptimizer, border-locked when the budget allows): panels, body, glass, trim;
   - **hull** (convex hull, then decimate): engine, gearbox, diff, hubs;
   - **box/cylinder** (PCA fit): driveshafts and arms.
3. **Symmetry** (centred parts, decimate mode): left half → mirror → weld seam.
4. **Quality:** remove slivers and duplicates → collapse edges < `minEdge` → subdivide edges > `maxEdge` (longest first, capped at 1.5× budget) → coherent outward winding → inset along normals.
5. **Derive:** vertices → nodes, edges → beams, faces → triangles, plus braces (density none/light/standard/heavy) and attach beams to the parent part's nearest nodes.
6. **Mass:** part target mass = taxonomy `defaultMass` × construction-material multiplier (or an override), spread over its nodes.
7. **Stability predictor:** per node, ω = √(Σ incident spring / nodeWeight), with Δt = 1/2000 s.
   - **Calibrated on official content** (sedan config, 767 nodes): ω·Δt median 1.50, p90 2.46, p99 3.36, max 5.3.
   - The textbook symplectic-Euler limit (ω·Δt < 2) would flag a third of the official car, so the limits come from the measurement: **ok ≤ 2.5** (≈ official p90), **marginal ≤ 4** (beyond official p99), **unstable > 4**.
   - **Checked across vehicle types** (game 0.39, every official vehicle, `scripts/dev/calibrate-stability.mts`). Each part is counted on its own, so beams that other parts attach to a node are left out and the figures sit a little below the whole-car ones above. The spread is the same for every type, so one set of limits fits them all:

     | Type | Nodes | p50 | p90 | p99 | p99.9 |
     |---|---|---|---|---|---|
     | Car | 50,763 | 1.33 | 1.79 | 2.11 | 2.37 |
     | Truck | 37,070 | 1.29 | 1.73 | 2.06 | 2.37 |
     | Trailer | 13,496 | 0.72 | 1.53 | 2.00 | 2.41 |
     | Traffic | 6,930 | 1.10 | 1.34 | 1.67 | 2.00 |
     | Heavy machinery | 3,323 | 1.01 | 1.72 | 2.19 | 4.33 |
     | Prop | 9,634 | 0.61 | 1.48 | 1.98 | 2.54 |

     Only hydraulic machinery (the WL-40's rams) goes past 4, and it does that on purpose.
   - Offenders are reported with a concrete fix ("node dl4r 0.2 kg with ~4M of beams: add mass or soften").
   - Phase 6's own solver re-checks this with real integration.

Budgets (SPEC §4.4, vertices): panels 24–40 · bumpers 20–36 · body 150–350 · glass 8–16 · hulls 12–24 · driveline 8–12. The Detail slider moves within the range.

## Structure roles: not every part is a proxy

**Evidence:** 106 of the Sunburst's meshed parts have **no nodes of their own**. Their flexbodies bind to another part's node group. Examples: sparewheel ×26, brake ×11, strut ×10, lettering ×9, licenseplate ×6, foglight ×4, flashers, gauges, emblems, chmsl, sunstrip, radio/nav, underglow. 73 more have ≤ 4 nodes, mostly suspension and driveline bits with heavy nodes.

Each taxonomy kind therefore has a **role**, and it can be overridden per part in the Inspector:

| Role | Kinds | What happens |
|---|---|---|
| `own` | panels, body, glass, bumpers, aero, big lights, engine block, cooling, tanks… | generated proxy |
| `rides` | badges, plates, small lights, gauges, radio, handles, switches, interior trim, wipers, antenna… | no nodes; at export (Phase 5) its flexbody uses the parent part's node group |
| `suspension` | arms, hubs, struts, springs, sway bars, steering, halfshafts, driveshafts, brakes, wheels/tyres | built with few heavy nodes by the suspension system (Phase 10) |

## Mass caps node count

- Nodes never get lighter than `max(0.1 kg, 0.4 × the preset's official node weight)`.
- The budget is capped at mass ÷ that weight (minimum 4). Engine blocks get a few heavy nodes (official transaxle: ≤ 4 nodes at 30 kg); panels get many light ones.
- The cap is hard: subdivision never exceeds it.
- A `mechanical_light` preset was added for radiators, exhausts, tanks, turbos and similar hardware. Measured: radiator 7e5/70, exhaust 3e5/50, fuel tank 1.6e5/100 → **3e5 / 70 / 6e3 / 1.5e4, node weight 1 kg**. The 4e6 `mechanical` preset stays for suspension-grade parts.

## Result on the whole Sunburst (all 285 parts incl. every variant, auto-classified)

| | Generated | Official (all variants) |
|---|---:|---:|
| Parts with own structure | 196 | 266 |
| Nodes | 2,480 | 2,773 |
| Beams | 11,180 (5,378 edge · 3,344 brace · 2,458 attach) | 18,933 |
| Collision triangles | 3,227 | 2,319 |
| Stability | 195 ok · 1 marginal · **0 unstable** | — |
| Time | 2.2 s (whole car, renderer thread) | — |

- **Fragmented meshes** (light housings, dashboards made of hundreds of islands) resist edge collapse. The decimator falls back to vertex clustering, then to a convex hull, so budgets always hold.
- **Generation runs on a plain copy** of the document and commits as one undoable assignment. Running inside an immer draft was ~6× slower.

## Revision: surface remeshing (measured against the official jbeam)

**Why:** you reported that generated nodes and beams didn't follow the mesh. Decimation keeps whichever edges survive collapsing. On real car meshes (overlapping skins, many islands, long thin triangles) it gave irregular blobs, and its fallbacks (clustering, hulls) made shapes worse or left parts empty.

**Measuring it:**
- `npm run proxy-bench -- sunburst2 [--verbose] [--parts=door,hood]` feeds the meshes each **official part's flexbodies** use (131 parts) to our generator, using the official part's mass.
- It compares the result against the mesh and against the official nodes and beams. Only aggregates are printed; the geometry cache stays in `scratch/`.
- Visual check: `node scripts/visual-structure.mjs --tag=<name>` drives the app and screenshots our structure, the mesh, and the **official structure drawn in the same viewport** (`npm run dump-reference` produces it).

**The new default for shells** (body, panels, bumpers, glass, trim, and hardware such as tanks, exhausts and engine blocks) is the `surface` mode (`src/shared/proxy/remesh.ts`), a Voronoi/ACVD-style remesher:
1. Densify the surface (about 40 samples per node).
2. Seed nodes along **feature lines** first (open boundaries and creases over 35°: panel outlines, window openings, sills), then fill the rest by farthest-point sampling.
3. Lloyd relaxation (4 iterations), with feature nodes sliding only along their lines.
4. Beams where regions touch; collision triangles where three regions meet in a mesh triangle, with winding taken from the mesh.
5. Islands are tied together, so fragmented meshes stay one structure.
6. Symmetric parts are generated on the left half, mirrored into exact twins, and tied across the centre line. Symmetry now requires a real mirror match (90% of sampled points have a partner within 2% of the part's size), not just spanning X = 0. An asymmetric skid plate was being mirrored into metal that doesn't exist.

**Heavy bracing on bodies now adds a cage,** as official bodies have: every off-centre node ties to its mirror twin (a width beam), with X-diagonals to its neighbours' twins.

**Budgets** moved toward the official counts (body 110–290, panels 14–38, bumpers 16–34, glass 6–14, hardware 10–22). With surface placement the shape holds at lower counts.

**Results over 131 official Sunburst parts** (medians; distances divided by each part's size; lower is better):

| | Before (decimate) | After (surface) | Official jbeam |
|---|---:|---:|---:|
| Parts that came out empty | 10 | **0** | — |
| Coverage (p90 mesh → nearest node), ratio to official | 1.21 | **0.63** | 1.00 |
| Parts with coverage > 25 % worse than official | 55 | **2** | — |
| Node fidelity (mean node → mesh) | 0.008 | 0.008 | 0.024 |
| Outline (p90 feature line → node), ratio to official | — | **0.66** | 1.00 |
| Beams off the surface (p90 midpoint → mesh) | — | 0.026 | 0.075 |
| Beam-length variation (CV) | — | **0.23** | 0.37 |
| Node count, ratio to official | 1.11 | 1.40 | 1.00 |

- Example: a rear door's coverage went from 0.219 to 0.066, against the official 0.117. Hulls were replaced for concave hardware (turbo intakes 0.159 → 0.074, official 0.121).
- The regenerated `test` mod (default config) has 1,343 nodes, 5,471 beams and 235 flexbodies, and lints with no errors.
- **Still different from official:** official bodies place nodes in rows along the car's design lines with long cage beams through the cabin. Ours is an even skin net plus a mirror cage. Stiffness tuning against BeamNG itself needs your in-game test.
