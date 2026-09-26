#!/usr/bin/env tsx
/**
 * Source of truth for the shipped part taxonomy (SPEC §4.3), written as
 * compact rows and emitted to src/shared/taxonomy/taxonomy.json.
 *
 * Usage: npm run build-taxonomy   (commit the regenerated JSON)
 *
 * Row: [id, label, category, subcategory, axis, parent, massKg, nodePrefix, beamPreset, openable, hints]
 *   axis: none | fr (front/rear) | lr (left/right) | corner (FL/FR/RL/RR)
 *   hints: lowercase words/phrases a mesh name may use for this part
 *          (the id and label words are matched automatically).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Axis = 'none' | 'fr' | 'lr' | 'corner';
type Preset = 'structure_stiff' | 'panel_metal' | 'panel_plastic' | 'trim_light' | 'glass_brittle' | 'mechanical' | 'mechanical_light' | 'mechanical_block' | 'tyre_rubber';
type Row = [string, string, string, string, Axis, string | null, number, string, Preset, boolean, string[]];

const BODY = 'Body & Structure';
const PANELS = 'Panels';
const AERO = 'Bumpers & Aero';
const LIGHTS = 'Lights';
const GLASS = 'Glass';
const TRIM = 'Exterior Trim';
const INTERIOR = 'Interior';
const MECH = 'Mechanical';
const MISC = 'Misc';

const rows: Row[] = [
  // ---- Body & structure
  ['body', 'Body shell', BODY, 'Structure', 'none', null, 350, 'b', 'structure_stiff', false, ['shell', 'unibody', 'main body', 'bodyshell', 'body main']],
  ['frame', 'Chassis frame', BODY, 'Structure', 'none', 'body', 180, 'fr', 'structure_stiff', false, ['chassis', 'ladder frame', 'ladderframe']],
  ['roof', 'Roof', BODY, 'Structure', 'none', 'body', 15, 'rf', 'panel_metal', false, ['roof panel', 'hardtop']],
  ['firewall', 'Firewall', BODY, 'Structure', 'none', 'body', 8, 'fw', 'structure_stiff', false, ['bulkhead']],
  ['radiator_support', 'Radiator support', BODY, 'Structure', 'none', 'body', 6, 'rs', 'structure_stiff', false, ['core support', 'rad support']],
  ['floor', 'Floor pan', BODY, 'Structure', 'none', 'body', 25, 'fl', 'structure_stiff', false, ['floorpan', 'floor pan', 'underbody']],
  ['subframe', 'Subframe', BODY, 'Structure', 'fr', 'body', 20, 'sf', 'structure_stiff', false, ['crossmember', 'k frame', 'kframe']],
  ['engine_bay', 'Engine bay', BODY, 'Structure', 'none', 'body', 10, 'eb', 'structure_stiff', false, ['engbay', 'enginebay', 'inner fender', 'strut tower']],
  ['inner_fender', 'Inner fender liner', BODY, 'Structure', 'corner', 'body', 1.5, 'if', 'panel_plastic', false, ['innerfender', 'arch liner', 'wheel liner', 'liners']],
  ['rollcage', 'Roll cage', BODY, 'Rollcage', 'none', 'body', 45, 'rc', 'structure_stiff', false, ['roll cage', 'cage', 'full cage']],
  ['rollbar', 'Roll bar (half cage)', BODY, 'Rollcage', 'none', 'body', 25, 'rb', 'structure_stiff', false, ['half cage', 'halfcage']],
  ['exocage', 'Exterior cage', BODY, 'Rollcage', 'none', 'body', 40, 'ec', 'structure_stiff', false, ['exo cage', 'exterior cage']],
  ['chassis_brace', 'Chassis brace', BODY, 'Structure', 'fr', 'body', 3, 'cb', 'structure_stiff', false, ['strut bar', 'strutbar', 'brace', 'tower brace']],

  // ---- Panels
  ['hood', 'Hood', PANELS, 'Body panels', 'none', 'body', 15, 'h', 'panel_metal', true, ['bonnet']],
  ['trunk', 'Trunk lid', PANELS, 'Body panels', 'none', 'body', 12, 't', 'panel_metal', true, ['boot', 'decklid', 'deck lid', 'trunklid']],
  ['tailgate', 'Tailgate', PANELS, 'Body panels', 'none', 'body', 18, 'tg', 'panel_metal', true, ['hatch', 'liftgate', 'rear hatch']],
  ['door', 'Door', PANELS, 'Doors', 'corner', 'body', 22, 'd', 'panel_metal', true, ['door shell', 'door sheet', 'door skin']],
  ['sliding_door', 'Sliding door', PANELS, 'Doors', 'lr', 'body', 28, 'sd', 'panel_metal', true, ['slider']],
  ['fender', 'Fender', PANELS, 'Fenders', 'lr', 'body', 5, 'fe', 'panel_metal', false, ['front wing', 'wing panel']],
  ['quarter_panel', 'Quarter panel', PANELS, 'Fenders', 'lr', 'body', 8, 'q', 'panel_metal', false, ['quarterpanel', 'quarter', 'rear quarter']],
  ['fender_flare', 'Fender flare', PANELS, 'Fenders', 'corner', 'body', 1.5, 'ff', 'panel_plastic', false, ['flare', 'overfender', 'arch extension', 'wheel arch']],
  ['side_skirt', 'Side skirt', PANELS, 'Body panels', 'lr', 'body', 3, 'ss', 'panel_plastic', false, ['sideskirt', 'rocker', 'sill', 'skirt']],
  ['fuel_door', 'Fuel filler door', PANELS, 'Body panels', 'none', 'body', 0.3, 'fd', 'panel_metal', true, ['fuel flap', 'fuel door', 'gas cap', 'filler', 'fuel lid']],
  ['bed', 'Truck bed', PANELS, 'Body panels', 'none', 'frame', 60, 'bd', 'panel_metal', false, ['pickup bed', 'box', 'tray']],
  ['cab', 'Cab', PANELS, 'Body panels', 'none', 'frame', 150, 'cab', 'structure_stiff', false, ['cabin']],

  // ---- Bumpers & aero
  ['bumper', 'Bumper', AERO, 'Bumpers', 'fr', 'body', 10, 'bp', 'panel_plastic', false, ['bumper cover', 'fascia', 'bumperbar']],
  ['bumper_reinforcement', 'Bumper reinforcement', AERO, 'Bumpers', 'fr', 'body', 6, 'br', 'structure_stiff', false, ['crash bar', 'bumper beam', 'reinforcement', 'bumperbar', 'bar']],
  ['bull_bar', 'Bull bar', AERO, 'Bumpers', 'fr', 'body', 15, 'bb', 'structure_stiff', false, ['bullbar', 'bash bar', 'bashbar', 'push bar', 'offroad bumper']],
  ['splitter', 'Splitter', AERO, 'Aero', 'none', 'bumper', 3, 'spl', 'panel_plastic', false, ['front splitter', 'air dam']],
  ['lip', 'Lip spoiler', AERO, 'Aero', 'fr', 'bumper', 2, 'lp', 'panel_plastic', false, ['chin', 'front lip', 'bumper lip']],
  ['diffuser', 'Diffuser', AERO, 'Aero', 'none', 'bumper', 3, 'df', 'panel_plastic', false, ['rear diffuser']],
  ['wing', 'Rear wing', AERO, 'Aero', 'none', 'trunk', 6, 'wg', 'panel_plastic', false, ['gt wing', 'bigwing', 'rear wing']],
  ['spoiler', 'Spoiler', AERO, 'Aero', 'none', 'trunk', 3, 'sp', 'panel_plastic', false, ['ducktail', 'lip spoiler', 'roof spoiler']],
  ['canard', 'Canard', AERO, 'Aero', 'lr', 'bumper', 0.4, 'cn', 'panel_plastic', false, ['canards', 'dive plane']],
  ['mudflap', 'Mud flap', AERO, 'Aero', 'corner', 'body', 0.4, 'mf', 'panel_plastic', false, ['mudflaps', 'mud guard', 'splash guard']],
  ['skidplate', 'Skid plate', AERO, 'Aero', 'fr', 'body', 4, 'sk', 'panel_metal', false, ['skid plate', 'sump guard', 'bash plate', 'underbody protection', 'protection']],
  ['tow_hook', 'Tow hook', AERO, 'Aero', 'fr', 'bumper', 0.8, 'th', 'mechanical_light', false, ['towhook', 'tow eye', 'tow strap', 'shackle', 'recovery point']],
  ['tow_hitch', 'Tow hitch', AERO, 'Aero', 'none', 'frame', 12, 'hi', 'mechanical_light', false, ['towhitch', 'tow bar', 'towbar', 'receiver', 'hitch']],
  ['roof_scoop', 'Roof scoop', AERO, 'Aero', 'none', 'roof', 1, 'rsc', 'panel_plastic', false, ['roofscoop', 'scoop']],
  ['hood_scoop', 'Hood scoop', AERO, 'Aero', 'none', 'hood', 1, 'hsc', 'panel_plastic', false, ['bonnet scoop']],

  // ---- Lights
  ['headlight', 'Headlight', LIGHTS, 'Lights', 'lr', 'body', 1.5, 'hl', 'trim_light', false, ['headlamp', 'head light', 'lowbeam', 'highbeam', 'lowhighbeam', 'headlightglass']],
  ['taillight', 'Taillight', LIGHTS, 'Lights', 'lr', 'body', 1, 'tl', 'trim_light', false, ['tail light', 'taillamp', 'rear light', 'taillightglass', 'brakelight', 'tailgate light', 'tailgate lightglass']],
  ['foglight', 'Fog light', LIGHTS, 'Lights', 'lr', 'bumper', 0.4, 'fg', 'trim_light', false, ['fog light', 'fog lamp', 'foglamp']],
  ['indicator', 'Indicator', LIGHTS, 'Lights', 'corner', 'body', 0.2, 'in', 'trim_light', false, ['turn signal', 'signal', 'blinker', 'side marker', 'sidemarker', 'signalglass', 'mirrorsignal']],
  ['reverse_light', 'Reverse light', LIGHTS, 'Lights', 'lr', 'body', 0.2, 'rv', 'trim_light', false, ['reverselight', 'backup light']],
  ['brake_light', 'Third brake light', LIGHTS, 'Lights', 'none', 'body', 0.2, 'cm', 'trim_light', false, ['chmsl', 'third brake light']],
  ['underglow', 'Underglow', LIGHTS, 'Lights', 'none', 'body', 0.5, 'ug', 'trim_light', false, ['neon', 'neon light', 'underbody light']],
  ['plate_light', 'License plate light', LIGHTS, 'Lights', 'none', 'body', 0.1, 'pl', 'trim_light', false, ['plate light', 'license light', 'number plate light']],
  ['light_bar', 'Light bar', LIGHTS, 'Lights', 'none', 'roof', 3, 'lb', 'trim_light', false, ['lightbar', 'rally lights', 'rallylights', 'roundlight', 'auxiliary lights', 'aux lights', 'spotlight']],
  ['police_lights', 'Emergency lights', LIGHTS, 'Lights', 'none', 'roof', 4, 'pol', 'trim_light', false, ['police lights', 'emergency', 'siren', 'beacon']],

  // ---- Glass
  ['windshield', 'Windshield', GLASS, 'Glass', 'none', 'body', 12, 'ws', 'glass_brittle', false, ['windscreen', 'front glass', 'front window']],
  ['rear_window', 'Rear window', GLASS, 'Glass', 'none', 'body', 8, 'rw', 'glass_brittle', false, ['rearglass', 'rear glass', 'backlight', 'back glass']],
  ['door_glass', 'Door glass', GLASS, 'Glass', 'corner', 'door', 3, 'dg', 'glass_brittle', false, ['doorglass', 'door window', 'side window']],
  ['quarter_glass', 'Quarter glass', GLASS, 'Glass', 'lr', 'quarter_panel', 2, 'qg', 'glass_brittle', false, ['quarter window', 'sideglass', 'side glass', 'opera window']],
  ['sunroof', 'Sunroof', GLASS, 'Glass', 'none', 'roof', 6, 'sr', 'glass_brittle', true, ['moonroof', 'roof glass']],
  ['tailgate_glass', 'Tailgate glass', GLASS, 'Glass', 'none', 'tailgate', 5, 'tgg', 'glass_brittle', false, ['hatch glass', 'liftgate glass']],

  // ---- Exterior trim
  ['grille', 'Grille', TRIM, 'Trim', 'none', 'bumper', 1, 'gr', 'panel_plastic', false, ['grill', 'front grille', 'kidney']],
  ['mirror', 'Side mirror', TRIM, 'Trim', 'lr', 'door', 0.8, 'mi', 'panel_plastic', false, ['wing mirror', 'door mirror', 'side mirror']],
  ['door_handle', 'Door handle', TRIM, 'Trim', 'corner', 'door', 0.2, 'dh', 'trim_light', false, ['handle', 'door pull']],
  ['wiper', 'Wiper', TRIM, 'Trim', 'lr', 'windshield', 0.3, 'wi', 'mechanical_light', false, ['wipers', 'wiper arm', 'windshield wiper']],
  ['rear_wiper', 'Rear wiper', TRIM, 'Trim', 'none', 'tailgate', 0.2, 'rwi', 'mechanical_light', false, ['rear wiper']],
  ['badge', 'Badge', TRIM, 'Trim', 'fr', 'body', 0.05, 'bg', 'trim_light', false, ['emblem', 'logo', 'lettering', 'script', 'decal', 'decals']],
  ['antenna', 'Antenna', TRIM, 'Trim', 'none', 'roof', 0.2, 'an', 'mechanical_light', false, ['aerial', 'rallyantenna', 'radio antenna']],
  ['roof_rack', 'Roof rack', TRIM, 'Trim', 'none', 'roof', 5, 'rr', 'mechanical_light', false, ['roofrack', 'roof bars', 'roofbars', 'rails', 'cargo rack']],
  ['snorkel', 'Snorkel', TRIM, 'Trim', 'none', 'fender', 1.5, 'sn', 'panel_plastic', false, ['air snorkel']],
  ['sunstrip', 'Sun strip', TRIM, 'Trim', 'none', 'windshield', 0.1, 'sst', 'trim_light', false, ['sun strip', 'windshield banner', 'visor strip']],
  ['trim', 'Trim piece', TRIM, 'Trim', 'none', 'body', 0.3, 'tr', 'trim_light', false, ['moulding', 'molding', 'chrome', 'garnish', 'cladding', 'pillar trim', 'stripe', 'stripes']],
  ['spare_wheel_carrier', 'Spare wheel carrier', TRIM, 'Trim', 'none', 'tailgate', 4, 'swc', 'mechanical_light', false, ['spare carrier', 'spare wheel mount']],
  ['cargo', 'Cargo / load', TRIM, 'Trim', 'none', 'body', 10, 'cg', 'mechanical_light', false, ['load', 'cargo box', 'straps', 'strap', 'luggage']],

  // ---- Interior
  ['dashboard', 'Dashboard', INTERIOR, 'Interior', 'none', 'body', 12, 'da', 'trim_light', false, ['dash', 'instrument panel']],
  ['gauges', 'Gauge cluster', INTERIOR, 'Interior', 'none', 'dashboard', 1, 'ga', 'trim_light', false, ['gauge', 'cluster', 'instrument cluster', 'speedo', 'tacho', 'needle', 'dials']],
  ['center_console', 'Center console', INTERIOR, 'Interior', 'none', 'dashboard', 3, 'cc', 'trim_light', false, ['console', 'centre console', 'armrest']],
  ['radio', 'Radio / head unit', INTERIOR, 'Interior', 'none', 'dashboard', 1, 'ra', 'trim_light', false, ['head unit', 'stereo', 'nav', 'screen']],
  ['steering_wheel', 'Steering wheel', INTERIOR, 'Interior', 'none', 'dashboard', 2, 'sw', 'mechanical_light', false, ['steeringwheel', 'wheel steering']],
  ['steering_column', 'Steering column', INTERIOR, 'Interior', 'none', 'dashboard', 3, 'sc', 'mechanical_light', false, ['column', 'column shroud', 'signalstalk', 'wiperstalk']],
  ['shifter', 'Shifter', INTERIOR, 'Interior', 'none', 'center_console', 1, 'shf', 'mechanical_light', false, ['gear stick', 'gearstick', 'gear lever', 'knob', 'paddles', 'shift boot']],
  ['handbrake', 'Handbrake', INTERIOR, 'Interior', 'none', 'center_console', 1, 'hb', 'mechanical_light', false, ['parkingbrake', 'parking brake', 'e brake', 'ebrake']],
  ['pedals', 'Pedals', INTERIOR, 'Interior', 'none', 'floor', 1.5, 'pe', 'mechanical_light', false, ['pedal', 'brakepedal', 'gaspedal', 'clutchpedal', 'pedal box']],
  ['seat', 'Seat', INTERIOR, 'Seats', 'corner', 'floor', 15, 'se', 'trim_light', false, ['seats', 'bucket seat', 'bench']],
  ['rear_seat', 'Rear bench', INTERIOR, 'Seats', 'none', 'floor', 20, 'rse', 'trim_light', false, ['rear seat', 'back seat', 'bench seat', 'rear bench']],
  ['seatbelt', 'Seat belt', INTERIOR, 'Seats', 'corner', 'seat', 0.3, 'sb', 'trim_light', false, ['belt', 'harness']],
  ['door_card', 'Door card', INTERIOR, 'Interior', 'corner', 'door', 2, 'dc', 'trim_light', false, ['doorpanel', 'door panel', 'door trim', 'doorcard']],
  ['window_switch', 'Window switch', INTERIOR, 'Interior', 'corner', 'door_card', 0.1, 'wsw', 'trim_light', false, ['button', 'buttons', 'switch', 'switches', 'window button']],
  ['headliner', 'Headliner', INTERIOR, 'Interior', 'none', 'roof', 3, 'hli', 'trim_light', false, ['roof lining', 'sunvisor', 'sunvisors', 'sun visor']],
  ['interior_mirror', 'Interior mirror', INTERIOR, 'Interior', 'none', 'windshield', 0.3, 'im', 'mechanical_light', false, ['rearview mirror', 'rear view mirror']],
  ['carpet', 'Carpet', INTERIOR, 'Interior', 'fr', 'floor', 2, 'ca', 'trim_light', false, ['floor mat', 'mats', 'trunkcarpet']],
  ['parcel_shelf', 'Parcel shelf', INTERIOR, 'Interior', 'none', 'body', 2, 'ps', 'trim_light', false, ['package tray', 'rear shelf', 'cargo cover']],
  ['trunk_trim', 'Trunk trim', INTERIOR, 'Interior', 'none', 'body', 3, 'tt', 'trim_light', false, ['trunkpanel', 'trunk panel', 'boot trim', 'cargo area']],
  ['interior_trim', 'Interior trim', INTERIOR, 'Interior', 'none', 'body', 5, 'it', 'trim_light', false, ['interior', 'pillar', 'kick panel', 'partition']],

  // ---- Mechanical: engine & ancillaries
  ['engine', 'Engine', MECH, 'Engine', 'none', 'body', 140, 'e', 'mechanical_block', false, ['motor', 'block', 'boxer', 'flat four', 'inline', 'v6', 'v8', 'pulley', 'belt']],
  ['intake', 'Intake', MECH, 'Engine', 'none', 'engine', 3, 'ik', 'mechanical_light', false, ['airbox', 'air filter', 'airfilter', 'cold air', 'intake manifold']],
  ['turbo', 'Turbocharger', MECH, 'Engine', 'none', 'engine', 6, 'tu', 'mechanical_light', false, ['turbocharger', 'turbo charger', 'wastegate']],
  ['supercharger', 'Supercharger', MECH, 'Engine', 'none', 'engine', 9, 'su', 'mechanical_light', false, ['blower', 'roots', 'twin screw']],
  ['engine_cover', 'Engine cover', MECH, 'Engine', 'none', 'engine', 1, 'ecv', 'panel_plastic', false, ['heatshield', 'heat shield', 'engine shroud']],
  ['engine_mount', 'Engine mount', MECH, 'Engine', 'none', 'engine', 2, 'em', 'mechanical_light', false, ['mounts', 'motor mount', 'mount']],
  ['exhaust_manifold', 'Exhaust manifold', MECH, 'Exhaust', 'none', 'engine', 5, 'xm', 'mechanical_light', false, ['header', 'headers', 'manifold']],
  ['exhaust', 'Exhaust', MECH, 'Exhaust', 'none', 'body', 12, 'x', 'mechanical_light', false, ['downpipe', 'midpipe', 'catalytic', 'resonator']],
  ['muffler', 'Muffler', MECH, 'Exhaust', 'none', 'exhaust', 6, 'mu', 'mechanical_light', false, ['silencer', 'tip', 'exhaust tip', 'backbox']],
  ['radiator', 'Radiator', MECH, 'Cooling', 'none', 'radiator_support', 7, 'rd', 'mechanical_light', false, ['rad', 'fan', 'cooling', 'coolant']],
  ['intercooler', 'Intercooler', MECH, 'Cooling', 'none', 'radiator_support', 5, 'ic', 'mechanical_light', false, ['fmic', 'charge cooler']],
  ['oil_cooler', 'Oil cooler', MECH, 'Cooling', 'none', 'radiator_support', 2, 'oc', 'mechanical_light', false, ['oil cooler']],
  ['fuel_tank', 'Fuel tank', MECH, 'Fuel', 'none', 'body', 10, 'ft', 'mechanical_light', false, ['fueltank', 'gas tank', 'petrol tank', 'fuel cell']],
  ['nitrous', 'Nitrous bottle', MECH, 'Fuel', 'none', 'body', 8, 'n2o', 'mechanical_light', false, ['n2o', 'nos', 'bottle']],
  ['battery', 'Battery', MECH, 'Electrical', 'none', 'body', 15, 'bt', 'mechanical_light', false, ['accumulator']],
  ['washer_tank', 'Washer tank', MECH, 'Electrical', 'none', 'body', 2, 'wt', 'mechanical_light', false, ['watertank', 'water tank', 'washer fluid', 'reservoir']],

  // ---- Mechanical: driveline
  ['transmission', 'Transmission', MECH, 'Driveline', 'none', 'engine', 50, 'tx', 'mechanical_block', false, ['gearbox', 'transaxle', 'trans', 'clutch', 'bellhousing']],
  ['transfer_case', 'Transfer case', MECH, 'Driveline', 'none', 'transmission', 20, 'tc', 'mechanical_block', false, ['transfercase', 'transfer box', 'awd']],
  ['driveshaft', 'Driveshaft', MECH, 'Driveline', 'fr', 'body', 8, 'ds', 'mechanical', false, ['propshaft', 'prop shaft', 'drive shaft', 'ujoint', 'u joint', 'cardan']],
  ['differential', 'Differential', MECH, 'Driveline', 'fr', 'subframe', 20, 'di', 'mechanical_block', false, ['diff', 'dif', 'cdiff', 'final drive', 'rear end', 'lsd']],
  ['halfshaft', 'Halfshaft', MECH, 'Driveline', 'corner', 'differential', 5, 'hs', 'mechanical', false, ['half shaft', 'axle shaft', 'cv shaft', 'driveshaft side', 'axle boot', 'cv boot']],
  ['axle', 'Solid axle', MECH, 'Driveline', 'fr', 'frame', 60, 'ax', 'mechanical', false, ['live axle', 'beam axle', 'axle housing']],

  // ---- Mechanical: suspension
  ['strut', 'Strut', MECH, 'Suspension', 'corner', 'subframe', 4, 'st', 'mechanical', false, ['macpherson', 'strut mount', 'uppermount', 'upper mount', 'camberplate', 'camber plate', 'top mount']],
  ['coilover', 'Coilover', MECH, 'Suspension', 'corner', 'subframe', 4, 'co', 'mechanical', false, ['coil over', 'shock', 'damper', 'shocks']],
  ['spring', 'Spring', MECH, 'Suspension', 'corner', 'subframe', 2, 'sg', 'mechanical', false, ['coil spring', 'leaf spring', 'leaf', 'springs']],
  ['lower_arm', 'Lower control arm', MECH, 'Suspension', 'corner', 'subframe', 3, 'la', 'mechanical', false, ['lowerarm', 'lca', 'lower wishbone', 'wishbone lower', 'control arm']],
  ['upper_arm', 'Upper control arm', MECH, 'Suspension', 'corner', 'subframe', 2, 'ua', 'mechanical', false, ['upperarm', 'uca', 'upper wishbone', 'wishbone upper']],
  ['trailing_arm', 'Trailing arm', MECH, 'Suspension', 'corner', 'subframe', 4, 'ta', 'mechanical', false, ['trailingarm', 'radius arm', 'semi trailing']],
  ['link', 'Suspension link', MECH, 'Suspension', 'corner', 'subframe', 1, 'lk', 'mechanical', false, ['toelink', 'toe link', 'lateral link', 'panhard', 'watts', 'links']],
  ['sway_bar', 'Anti-roll bar', MECH, 'Suspension', 'fr', 'subframe', 4, 'arb', 'mechanical', false, ['swaybar', 'anti roll bar', 'antiroll', 'arb', 'stabilizer', 'endlink', 'drop link']],
  ['hub', 'Hub', MECH, 'Suspension', 'corner', 'knuckle', 3, 'hu', 'mechanical', false, ['wheel hub', 'hub carrier', 'bearing']],
  ['knuckle', 'Knuckle', MECH, 'Suspension', 'corner', 'subframe', 4, 'kn', 'mechanical', false, ['upright', 'spindle', 'steering knuckle']],
  ['tie_rod', 'Tie rod', MECH, 'Steering', 'lr', 'steering_rack', 0.5, 'tie', 'mechanical', false, ['tierod', 'track rod', 'tie rod end', 'steeringboot', 'steering boot']],
  ['steering_rack', 'Steering rack', MECH, 'Steering', 'none', 'subframe', 5, 'srk', 'mechanical', false, ['steeringrack', 'rack', 'steering box', 'power steering']],

  // ---- Mechanical: wheels & brakes
  ['wheel', 'Wheel', MECH, 'Wheels', 'corner', 'hub', 9, 'w', 'mechanical', false, ['rim', 'rims', 'hubcap', 'wheel cover']],
  ['tire', 'Tire', MECH, 'Wheels', 'corner', 'wheel', 9, 'ti', 'tyre_rubber', false, ['tyre', 'tires', 'tyres', 'rubber']],
  ['spare_wheel', 'Spare wheel', MECH, 'Wheels', 'none', 'body', 15, 'spw', 'mechanical', false, ['spare', 'spare tire', 'spare tyre']],
  ['brake_disc', 'Brake disc', MECH, 'Brakes', 'corner', 'hub', 5, 'bdi', 'mechanical', false, ['rotor', 'disc', 'disk', 'brake rotor']],
  ['brake_caliper', 'Brake caliper', MECH, 'Brakes', 'corner', 'knuckle', 3, 'bc', 'mechanical', false, ['caliper', 'calliper']],
  ['brake_drum', 'Brake drum', MECH, 'Brakes', 'corner', 'hub', 5, 'bdr', 'mechanical', false, ['brakedrum', 'drum']],

  // ---- Misc
  ['license_plate', 'License plate', MISC, 'Misc', 'fr', 'bumper', 0.4, 'lpl', 'trim_light', false, ['plate', 'licenseplate', 'number plate', 'numberplate', 'license']],
  ['police_equipment', 'Police equipment', MISC, 'Misc', 'none', 'body', 5, 'peq', 'mechanical_light', false, ['police', 'laptop', 'radar', 'push bar', 'partition']],
  ['custom', 'Custom part', MISC, 'Misc', 'none', 'body', 5, 'cu', 'mechanical_light', false, []],
];

const entries = rows.map(([id, label, category, subcategory, axis, parent, defaultMass, nodePrefix, beamPreset, openable, nameHints]) => ({
  id,
  label,
  category,
  subcategory,
  positionAxis: axis,
  slotType: id,
  parent,
  defaultMass,
  nodePrefix,
  beamPreset,
  openable,
  nameHints,
}));

const out = join(import.meta.dirname, '..', 'src', 'shared', 'taxonomy', 'taxonomy.json');
writeFileSync(out, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
console.log(`wrote ${entries.length} taxonomy entries → ${out}`);
