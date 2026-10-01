# Unreleased (after 0.14.0)

## Fixed

**Exported cars explode on spawn ("Instability detected", "Error loading vehicle")**
- The game steps its physics at 2000 Hz. Light panel nodes (0.3 kg) carried more spring than a step that size can hold, so they vibrated to infinity in the first frames. Test Mode hid it by quietly taking smaller steps.
- Every export is now checked node by node: a light node first takes up to 1.6× its weight, then any beam still too stiff for it is softened just enough. Values you set by hand, and the beams of fitted game parts, are never changed (the nodes they hang on get weight instead). Test Mode uses the same values, so what you test is what the game gets.
- The practice car: blew up 17 ms after spawning (run at 2000 Hz with no smaller steps); now steady. It weighs 1045 kg (an E30 is about 1100).

**Windows pivoting on one point and dropping; parts sagging**
- Parts were attached only where they came within 15 cm of their parent, so most hung from one edge. Now each part is held all round: every node within 35 cm of an attachment (20 cm for glass), the attachments spanning most of the part both ways, flat parts (glass, a radiator core) held at every node, and at least four well-spread points on the parent (a mirror no longer pivots on one door node).
- A part may also hold on to its grandparent (a grille to the body as well as the bumper), never through a door, hood or trunk.
- Settled on stands, every part of the practice car stays within about 50 mm. Before, the engine bay sagged 512 mm, the grille 406 mm and the rear window 296 mm.

**Fitting a game suspension**
- Your car's own wheels, tyres, discs, drums, hubs and calipers move onto the suspension's hubs (each wheel centred on the axle the game builds it on), and follow it when you drag the suspension to fine-tune.
- In the game they ride on the game's wheel instead of being bolted to the body: the rim and disc spin with the hub, the tyre with the tyre, and the caliper steers with the knuckle.

## New

**Generate options**: the arrow beside the Generate button.
- Proxy mode: Best for each part (recommended), Convex hull (body included), Follow the surface, Simplified mesh, or Boxes.
- Detail: Very low to Very high.
- Both are remembered. The choice is written onto each part, so the Inspector shows it and you can still change a single part.

**Convex hull by default**: every part is wrapped in its convex hull (closed, well braced, closest to correct). The body shell still follows its surface, because a hull would bridge its wheel arches and put collision faces through the tyres.

## Under the hood
- Door hinge guess: the two hinge points are always well apart up the door (a hull door has nodes only at its corners). Hull doors swing to their stop and close onto their seals.
- Attach beams are at least 2 cm long.
- `scripts/dev/jbeamStability.mts` checks an exported vehicle folder and runs it at 2000 Hz. `scripts/dev/simParts.mts` settles a project on stands and lists how far each part sags.
- New harness scenarios: the practice car exported and checked at 2000 Hz and on stands; a game suspension fitted to the practice car; each Generate mode; a click-through of every workspace, toolbar button and key.
