# Vehicle scripts

The Scripts tab (layout picker → Scripts) gives the car working functions in game: Lua controllers that ship with the mod.

## Easy mode: templates

Scripts → Templates → **Add**, then set it up in the Script panel (Set up). Pick meshes by selecting them in the viewport or Scene list and pressing **Add the selected meshes**. Each picked mesh becomes an animated part driven by the script. Fine-tune its pivot and axis in the Inspector (Animation) if the first guess is off.

| Template | What it does | Outputs (electrics) |
|---|---|---|
| Windscreen wipers | Off / intermittent / low / high, parks at the bottom, wash = three wipes | `jbf_wipers`, `jbf_wipers_mode` |
| Power windows | One-touch down/up, stop anywhere, vent; frameless glass drops while a door is open and rises after it shuts | `jbf_windows` |
| Folding mirrors | Fold on a key, and automatically with the ignition | `jbf_mirrors` |
| Sunroof | Tilt, then slide; closes in the right order; wind deflector | `jbf_sunroof`, `jbf_sunroof_tilt` |
| Convertible roof | Cover lifts, roof folds, cover closes; only below a set speed | `jbf_roof`, `jbf_roof_cover`, `jbf_roof_open` |
| Power seats | Slide and recline on keys; easy entry while the door is open | `jbf_seat_slide`, `jbf_seat_recline` |
| Pop-up headlights | Rise with the lights, wink on a key | `jbf_popups` |
| Welcome lights | Courtesy lights with the doors, follow-me-home headlights | `jbf_welcome`, `jbf_welcome_home` |
| Ambient lighting | Brightness steps, breathing, colour cycling | `jbf_ambient`, `_colour`, `_hue` |
| Active rear wing | Rises above a speed, tucks away below another, air brake under hard braking | `jbf_aero`, `jbf_aero_angle`, `jbf_aero_mode` |
| Launch control | Holds a launch rpm on the brake, then launches | `jbf_launch` |
| Pops and bangs | Off / street / race overrun crackle (the engine's afterfire) | `jbf_pops` |
| Shift light | Light at the shift point, flashing near the limiter; rev bar | `jbf_shiftlight`, `jbf_shiftlight_bar` |
| Wind and road noise | Louder with windows, sunroof or roof open, or broken glass; ships its own loop | `jbf_windnoise` |
| Emergency brake flash | Flashes under an emergency stop, hazards once stopped | `jbf_ess`, `jbf_ess_active` |
| Head unit (phone projection) | An Android Auto or CarPlay style screen on your screen mesh: home, maps, music, phone, car | `jbf_headunit_app`, `_play`, `_track`, `_on` |

Door signals default to the car's own doors (the `<coupler>_notAttached` values its hinged doors publish).

## Advanced mode: code

Script → **Code**. A template's code is read-only until you **Customise the code** for this car. **Write one** starts a script from scratch. The editor checks as you type:
- syntax, with hints for slips from other languages (`+=`, `!=`, `//`, braces)
- names that aren't defined, and globals made by a missing `local`
- `obj.` where BeamNG needs `obj:`
- functions vehicle Lua doesn't have (files, processes)
- `electrics.x` written instead of `electrics.values.x`
- `return M`, and hooks the game calls, with their exact spelling

It also offers completions for the vehicle API and the electrics values, and help on hover. The Reference section lists everything.

## Testing

The Script test panel runs the script in a Lua VM with stand-ins for BeamNG's vehicle API: electrics, input, obj (sounds, beams, nodes), powertrain devices, controllers, smoothing helpers and `vec3`. You pick a scenario, press keys on a timeline, and can break the glass halfway. You then see every value the script writes, its log and on-screen messages, and sounds' volume. **Play** moves the real meshes in the viewport. The head unit previews its page with the test's values.

The runner is Lua 5.3 with LuaJIT's names shimmed (`bit`, `unpack`, `loadstring`), so the game is the final check.

## Export

For each enabled script:
- `lua/vehicle/controller/jbf_<slug>/<name>.lua`
- a row in its part's `controller` section, with its settings as jbeam data
- `vehicles/<slug>/input_actions.json` and `inputmaps/keyboard.json` (players rebind in Options → Controls → Vehicle specific)
- the template's files: the head unit page (`ui/<name>/index.html`, shown through `gauges/genericGauges` on a live screen material), the wind loop (`sounds/jbf_wind_loop.wav`)

Errors in a script stop the export. Settings → Scripts can make warnings stop it too.

## Sharing

- **Save to my library** keeps a script for your other cars (Scripts → Library).
- **Share** saves a `.jbscript` anyone can import.
- **Save the .lua** saves the code alone.
- Downloads → Scripts fetches scripts from the scripts repository (`Connor-Moyle/jbeam-forge-scripts`). `npm run build-content-repos` seeds that repository with the built-in templates.

## Please check in game

These use parts of the game's API I couldn't run here:
- vehicle-specific input actions and default keys
- `gauges/genericGauges` with a custom page (the head unit)
- launch control's rev limiter (`revLimiterAV`)
- pops and bangs' afterfire coefficients
- `obj:createSFXSource` with the wind loop
- the `_notAttached` door signals
