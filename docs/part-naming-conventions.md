# Part naming conventions

How JBeam Forge reads mesh names when it auto-classifies an import, and how it
names the parts it creates. Implementation: `src/shared/taxonomy/tokenize.ts`,
`src/shared/taxonomy/classify.ts`, `src/shared/parts/ops.ts`.

## Naming meshes so they classify well

Recommended pattern (any separator works: `_`, `-`, `.`, space or camelCase):

```
[vehicle]_<Part>_[Position]_[Variant]
```

| Example                        | Part type     | Position | Variant    |
| ------------------------------ | ------------- | -------- | ---------- |
| `mycar_door_FL`                | Door          | FL       | —          |
| `mycar_doorglass_RR`           | Door glass    | RR       | —          |
| `mycar_bumper_race_F`          | Bumper        | F        | race       |
| `mycar_bumper_custom_splitter` | Splitter      | —        | custom     |
| `mycar_headlight_L`            | Headlight     | L        | —          |
| `mycar_fender_widebody_R`      | Fender        | R        | widebody   |
| `Driveline_Axel_Boot_Inner_Rear` | Halfshaft   | (rear)   | —          |

### What the tokenizer understands

- **Vehicle prefix.** The first segment shared by ≥ 60 % of a model's names
  (`sunburst2_…`) is ignored.
- **Compound words.** `lowerarm`, `doorglass` and `fenderflare` are split into
  known words. Blender duplicate suffixes (`.001`) are dropped.
- **Misspellings.** A synonym table (`axel` → axle, `fenderfalre`, `raceing`,
  `braket`, …) plus a one-typo fuzzy match for words of 5+ letters.
- **Positions.**
  - `FL FR RL RR`, `F`/`front`, `rear`/`back`, `L`/`left`/`LH`, `right`/`RH`.
  - A bare **`R` is ambiguous** and is resolved by the part type's position
    axis: it means *rear* on a front/rear part (bumper) and *right* on a
    left/right part (headlight).
  - On four-corner parts it fills the missing half (`bumper_R_flare_L` → RL).
- **Variants.** Words like race, drift, custom, widebody, offroad, rally,
  sport, wagon, sedan and cut, plus free-standing letters/numbers (`_a`, `_b`,
  `_18`), make a *variant*: an alternative for the same slot.
- **Pieces.** Words like inner, outer, sheet, bracket, support, cap, pipe and
  base, and digits glued to a word (`pulley3`, `R2`), mark pieces of the same
  part. They are merged into it, not split out.
- **Context words.** A word naming the part's parent type counts as explained
  context (`bumper_custom_splitter` is fully a splitter; bumper is its parent).

Names the classifier can't explain with confidence ≥ 0.5 stay **unassigned**.
Confidence below 0.75 is reported as *low confidence* in the summary.

## Names JBeam Forge gives parts

- **Part name** (jbeam part and slot identity):
  `<mod slug>_<slotType>[_<position>][_<variant>]`, for example
  `test_door_FL`, `test_bumper_F_race`. A numeric suffix (`_2`) keeps names
  unique.
- **Display name** (shown in BeamNG's parts selector): the position in words
  plus the type label, with the variant in brackets. For example "Front Left
  door", "Rear bumper (Race)". Editable in the Inspector.
- **Variants** share their base part's type and position (same slot). The first
  unsuffixed part is the base; the others are marked *variant* in the tree.
- **Parents** come from the taxonomy: a part attaches to the nearest existing
  part of an ancestor type whose position is compatible (door glass FR → door
  FR, headlight → body). Otherwise it goes further up the chain.

## Measured on the official Sunburst (names only)

`npm run classify:bench -- sunburst2` gives:

- 99 % agreement on part type and 98 % on type + position, over a
  hand-labelled list of 100 names (`tests/fixtures/classify/sunburst2-expected.json`).
- With a local study, 98 % coverage of all 418 mesh names.

The labels are our own judgement; nothing is copied from the game's jbeam.
