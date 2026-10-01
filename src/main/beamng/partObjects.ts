import { mkdirSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject, type JbeamValue } from '@shared/jbeam/parse';
import { withZip, ZipReader } from './zip';
import { definedNodes, externalNodeRefs, type V3 } from '@shared/suspension/transplant';
import { findOptions } from '@shared/suspension/options';
import { engineSpecs, gearboxSpecs, isEnginePart, isGearboxPart, partTitle } from '@shared/powertrain/specs';

/**
 * Suspension, brake and steering meshes from the user's own BeamNG.drive
 * install, as objects. Each stock part's flexbodies name its meshes; those
 * nodes are cut out of the car's DAE into a small DAE per object (kept in
 * userData, never shipped), so adding one or drawing its preview doesn't
 * mean reading the whole car.
 */

export interface PartObject {
  vehicle: string;
  vehicleName: string;
  part: string;
  partName: string;
  slotType: string;
  category: string;
  meshes: string[];
}

const KINDS: [RegExp, string][] = [
  [/hubcap/i, 'Hubcaps'],
  [/brake/i, 'Brakes'],
  [/strutbrace|strut_brace/i, 'Strut Braces'],
  [/steer/i, 'Steering'],
  [/swaybar|sway_bar|antiroll/i, 'Sway Bars'],
  [/coilover|spring|shock|damper|strut/i, 'Springs & Dampers'],
  [/diff|halfshaft|driveshaft|axle|transfer/i, 'Axles & Differentials'],
  [/suspension|wishbone|trailingarm|leaf|knuckle|hub|subframe/i, 'Suspension'],
];

/** What kind of object a part is, from its slot type (null: not a suspension-area part). */
export function categoryOf(slotType: string): string | null {
  const kind = KINDS.find(([re]) => re.test(slotType))?.[1];
  if (!kind) return null;
  if (kind !== 'Suspension') return kind;
  // Front and rear suspension read as different kits.
  return /_F(_|$)|front/i.test(slotType) ? 'Front Suspension' : /_R(_|$)|rear/i.test(slotType) ? 'Rear Suspension' : 'Suspension';
}

export function partsOf(doc: JbeamObject, vehicle: string, vehicleName: string): PartObject[] {
  const out: PartObject[] = [];
  for (const [part, body] of Object.entries(doc)) {
    if (!isJbeamObject(body)) continue;
    const slotType = typeof body.slotType === 'string' ? body.slotType : '';
    const category = categoryOf(slotType);
    if (!category || !Array.isArray(body.flexbodies)) continue;
    const meshes = [...new Set(body.flexbodies.slice(1).flatMap((row) => (Array.isArray(row) && typeof row[0] === 'string' ? [row[0]] : [])))];
    if (!meshes.length) continue;
    const info = isJbeamObject(body.information) ? body.information : null;
    const partName = typeof info?.name === 'string' && info.name.trim() ? info.name.trim() : part;
    out.push({ vehicle, vehicleName, part, partName, slotType, category, meshes });
  }
  return out;
}

// ---------------------------------------------------------------- DAE subsets

export interface DaeDoc {
  text: string;
  /** node name → [start, end) of its <node> element. */
  nodes: Map<string, [number, number]>;
}

/** End of the <node> element opened at `from` (nested nodes included). */
function nodeEnd(text: string, from: number): number {
  let depth = 0;
  let i = from;
  for (;;) {
    const open = text.indexOf('<node', i);
    const close = text.indexOf('</node>', i);
    if (close < 0) return text.length;
    if (open >= 0 && open < close) {
      const tagEnd = text.indexOf('>', open);
      // <node …/> opens and closes at once.
      if (text[tagEnd - 1] !== '/') depth++;
      else if (depth === 0) return tagEnd + 1;
      i = tagEnd + 1;
    } else {
      depth--;
      i = close + 7;
      if (depth === 0) return i;
    }
  }
}

export function indexDae(text: string): DaeDoc {
  const nodes = new Map<string, [number, number]>();
  for (const m of text.matchAll(/<node\b[^>]*\bname="([^"]+)"[^>]*>/g)) {
    if (!nodes.has(m[1]!)) nodes.set(m[1]!, [m.index, nodeEnd(text, m.index)]);
  }
  return { text, nodes };
}

const between = (text: string, open: string, close: string): string | null => {
  const a = text.indexOf(open);
  const b = a < 0 ? -1 : text.indexOf(close, a);
  return a < 0 || b < 0 ? null : text.slice(a, b + close.length);
};

/** A DAE holding just these nodes (from one or more source DAEs), with plain materials that keep the game's names. */
export function subsetDae(sources: { doc: DaeDoc; names: string[] }[], shade: string, texture: (material: string) => string | null = () => null): string | null {
  const nodes: string[] = [];
  const geometries: string[] = [];
  const materials = new Set<string>();
  sources.forEach(({ doc, names }, d) => {
    const prefix = sources.length > 1 ? `d${d}_` : '';
    for (const name of names) {
      const range = doc.nodes.get(name);
      if (!range) continue;
      let node = doc.text.slice(range[0], range[1]);
      for (const url of node.matchAll(/url="#([^"]+)"/g)) {
        const id = url[1]!;
        const g = doc.text.indexOf(`<geometry id="${id}"`);
        const end = g < 0 ? -1 : doc.text.indexOf('</geometry>', g);
        if (end > 0) geometries.push(doc.text.slice(g, end + '</geometry>'.length).replace(`id="${id}"`, `id="${prefix}${id}"`));
      }
      if (prefix) node = node.replace(/url="#/g, `url="#${prefix}`).replace(/\bid="/g, `id="${prefix}`);
      // Materials: the game's material name without Blender's "-material" suffix.
      node = node.replace(/target="#([^"]+)"/g, (_m, t: string) => {
        const mat = t.replace(/-material$/, '');
        materials.add(mat);
        return `target="#${mat}-m"`;
      });
      nodes.push(node);
    }
  });
  if (!nodes.length) return null;
  const asset = between(sources[0]!.doc.text, '<asset>', '</asset>') ?? '<asset><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>';
  const mats = [...materials];
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
${asset}
<library_images>
${mats
  .flatMap((m) => {
    const t = texture(m);
    return t ? [`<image id="${m}-img" name="${m}-img"><init_from>${t}</init_from></image>`] : [];
  })
  .join('\n')}
</library_images>
<library_effects>
${mats.map((m) => (texture(m) ? `<effect id="${m}-fx"><profile_COMMON><newparam sid="${m}-surface"><surface type="2D"><init_from>${m}-img</init_from></surface></newparam><newparam sid="${m}-sampler"><sampler2D><source>${m}-surface</source></sampler2D></newparam><technique sid="common"><lambert><diffuse><texture texture="${m}-sampler" texcoord="UVMap"/></diffuse></lambert></technique></profile_COMMON></effect>` : `<effect id="${m}-fx"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${shade} 1</color></diffuse></lambert></technique></profile_COMMON></effect>`)).join('\n')}
</library_effects>
<library_materials>
${mats.map((m) => `<material id="${m}-m" name="${m}"><instance_effect url="#${m}-fx"/></material>`).join('\n')}
</library_materials>
<library_geometries>
${geometries.join('\n')}
</library_geometries>
<library_visual_scenes>
<visual_scene id="Scene" name="Scene">
${nodes.join('\n')}
</visual_scene>
</library_visual_scenes>
<scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
`;
}

/** The game material names a subset uses (as subsetDae names them). */
export function subsetMaterials(sources: { doc: DaeDoc; names: string[] }[]): string[] {
  const out = new Set<string>();
  for (const { doc, names } of sources) {
    for (const name of names) {
      const r = doc.nodes.get(name);
      if (!r) continue;
      for (const m of doc.text.slice(r[0], r[1]).matchAll(/target="#([^"]+)"/g)) out.add(m[1]!.replace(/-material$/, ''));
    }
  }
  return [...out];
}

/** Material name (and mapTo) → its colour texture, from a zip's *.materials.json files. */
async function materialTextures(zip: ZipReader): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const e of (await zip.entries()).filter((x) => /materials\.json$/i.test(x.name))) {
    let doc: JbeamValue;
    try {
      doc = parseJbeam(await zip.readText(e.name)).value;
    } catch {
      continue;
    }
    if (!isJbeamObject(doc)) continue;
    for (const [key, mat] of Object.entries(doc)) {
      if (!isJbeamObject(mat) || !Array.isArray(mat.Stages)) continue;
      let tex: string | null = null;
      for (const stage of mat.Stages) {
        if (!isJbeamObject(stage)) continue;
        const t = stage.baseColorMap ?? stage.colorMap ?? stage.diffuseMap;
        if (typeof t === 'string' && t) {
          tex = t.replace(/^\//, '');
          break;
        }
      }
      if (!tex) continue;
      for (const n of [key, mat.name, mat.mapTo]) if (typeof n === 'string' && !out.has(n.toLowerCase())) out.set(n.toLowerCase(), tex);
    }
  }
  return out;
}

/**
 * Textures the cut-out parts use, copied once into <out>/_textures/<path in the game>. Every
 * object/set DAE sits three folders below <out>, so it refers to them as ../../../_textures/….
 */
class TextureStore {
  private readonly placed = new Map<string, string | null>();
  constructor(
    private readonly out: string,
    private readonly common: ZipReader | null,
  ) {}

  private readonly indexes = new WeakMap<ZipReader, Promise<Map<string, string>>>();

  /** The zip's entry for a texture path: exact, any case, or the .dds the game converted it to. */
  private async entry(zip: ZipReader, path: string): Promise<string | null> {
    let index = this.indexes.get(zip);
    if (!index) {
      index = zip.entries().then((es) => new Map(es.map((e) => [e.name.toLowerCase(), e.name])));
      this.indexes.set(zip, index);
    }
    const map = await index;
    const lower = path.toLowerCase();
    return map.get(lower) ?? map.get(lower.replace(/\.[a-z0-9]+$/, '.dds')) ?? null;
  }

  async place(zipPath: string, zip: ZipReader): Promise<string | null> {
    const key = zipPath.toLowerCase();
    let found = this.placed.get(key);
    if (found === undefined) {
      found = null;
      for (const source of [zip, this.common]) {
        if (!source) continue;
        try {
          const name = await this.entry(source, zipPath);
          if (!name) continue;
          const target = join(this.out, '_textures', name);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, await source.readBuffer(name, 256 * 1024 * 1024));
          found = name;
          break;
        } catch {
          // unreadable texture: the part stays plain
        }
      }
      this.placed.set(key, found);
    }
    return found ? `../../../_textures/${found}` : null;
  }

  /** Texture URLs (relative to a part's DAE) for these materials. */
  async lookup(materials: readonly string[], index: ReadonlyMap<string, string>, zip: ZipReader): Promise<(m: string) => string | null> {
    const urls = new Map<string, string>();
    for (const m of materials) {
      const path = index.get(m.toLowerCase());
      const url = path ? await this.place(path, zip) : null;
      if (url) urls.set(m, url);
    }
    return (m) => urls.get(m) ?? null;
  }
}

const SHADES: Record<string, string> = {
  Brakes: '0.42 0.41 0.40',
  Hubcaps: '0.75 0.75 0.76',
  'Springs & Dampers': '0.55 0.12 0.10',
};

// ---------------------------------------------------------------- the whole install

type Translate = (key: string) => string;

/** The game's English names ("vehiclesData.etk800.Name" → "800-Series"); keys pass through when missing. */
async function translations(installDir: string): Promise<Translate> {
  try {
    const text = await readFile(join(installDir, 'locales', 'translations', 'en-US', 'vehiclesGenerated.translation.json'), 'utf8');
    const map = JSON.parse(text) as Record<string, unknown>;
    return (key) => (typeof map[key] === 'string' ? map[key] : key);
  } catch {
    return (key) => key;
  }
}

/** "ETK 800-Series", "Gavril D-Series"… from info.json (brand + translated name). */
async function vehicleName(zip: ZipReader, vehicle: string, t: Translate): Promise<string> {
  return (await vehicleInfo(zip, vehicle, t)).name;
}

async function vehicleInfo(zip: ZipReader, vehicle: string, t: Translate): Promise<{ name: string; brand: string }> {
  try {
    const info = parseJbeam(await zip.readText(`vehicles/${vehicle}/info.json`)).value;
    if (isJbeamObject(info) && typeof info.Name === 'string') {
      const name = t(info.Name);
      const brand = typeof info.Brand === 'string' ? info.Brand : '';
      if (!name.startsWith('vehiclesData.')) return { name: brand && !name.startsWith(brand) ? `${brand} ${name}` : name, brand };
    }
  } catch {
    // no info.json (common parts, props)
  }
  if (vehicle === 'common') return { name: 'Shared', brand: '' };
  return { name: vehicle.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), brand: '' };
}

async function daesOf(zip: ZipReader): Promise<DaeDoc[]> {
  const docs: DaeDoc[] = [];
  for (const e of (await zip.entries()).filter((x) => x.name.toLowerCase().endsWith('.dae'))) {
    try {
      docs.push(indexDae(await zip.readText(e.name, 512 * 1024 * 1024)));
    } catch {
      // unreadable or too large: its meshes just won't be found
    }
  }
  return docs;
}

const safe = (s: string) => s.replace(/[<>:"/\\|?*]+/g, '-').trim();

/** What kind of suspension a set is, from its part and mesh names. */
export function suspensionType(text: string): string {
  const t = text.toLowerCase();
  if (/leaf/.test(t)) return 'Leaf spring';
  if (/torsion/.test(t)) return 'Torsion beam';
  if (/swing ?axle|swing ?arm/.test(t)) return 'Swing axle';
  if (/trailing/.test(t)) return 'Trailing arm';
  if (/(live|solid|beam) ?axle|[34]-? ?link|torque ?tube|tandem|axle_r\b|axle_f\b/.test(t)) return 'Solid axle';
  if (/multi-?link/.test(t)) return 'Multi-link';
  if (/upperarm|upper_arm|wishbone|dwb/.test(t)) return 'Double wishbone';
  if (/strut/.test(t)) return 'MacPherson strut';
  return 'Independent';
}

/** Default part names a part's slots fill ("slots" and the newer "slots2"). */
export function slotDefaults(body: JbeamObject): string[] {
  const out: string[] = [];
  for (const key of ['slots', 'slots2'] as const) {
    const table = body[key];
    if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
    const header = (table[0] as unknown[]).map(String);
    const col = header.indexOf('default');
    if (col < 0) continue;
    for (const row of table.slice(1)) if (Array.isArray(row) && typeof row[col] === 'string' && row[col]) out.push(row[col]);
  }
  return out;
}

const NOT_SUSPENSION = /^wheel|^tire|tyre|hubcap|cladding|mudflap|fender|trim|skin|paint|licenseplate/i;

const SET_CATEGORIES = new Set(['Front Suspension', 'Rear Suspension', 'Suspension']);

const PANEL_KINDS: [RegExp, string][] = [
  [/hood|bonnet/i, 'Hoods'],
  [/trunk|tailgate|hatch|boot|liftgate/i, 'Trunks & tailgates'],
  [/fender_?flare|flare/i, 'Fender flares'],
  [/bumper/i, 'Bumpers'],
  [/fender|wing_?F/i, 'Fenders'],
  [/door/i, 'Doors'],
  [/spoiler|wing/i, 'Spoilers & wings'],
  [/skirt|sidestep|rocker|running_?board/i, 'Side skirts'],
  [/mirror/i, 'Mirrors'],
  [/grille/i, 'Grilles'],
  [/lip|splitter|diffuser|valance/i, 'Lips & diffusers'],
  [/roof|hardtop|softtop|sunroof/i, 'Roofs'],
];

/** Which kind of body panel a slot takes (null: not a body panel, e.g. glass, lights or trim inside). */
export function panelCategory(slotType: string): string | null {
  if (/glass|window|light|lamp|interior|dash|seat|trim_?in|handle|hinge|latch|strut|reinforce|support|bracket|mount|ecu|radiator|intercooler|licen[cs]e|plate/i.test(slotType)) return null;
  return PANEL_KINDS.find(([re]) => re.test(slotType))?.[1] ?? null;
}

/** A suspension as the game fits it: the part plus the defaults of its slots, all the way down. */
export function suspensionClosure(start: string, find: (name: string) => JbeamObject | undefined, max = 40): string[] {
  // Wheels, tyres and trim hang off the hubs' slots, but they aren't the suspension.
  return partClosure(start, find, (b) => typeof b.slotType === 'string' && NOT_SUSPENSION.test(b.slotType), max);
}

/** An engine without its gearbox (that belongs to the gearbox workshop), wheels or body parts. */
export function engineClosure(start: string, find: (name: string) => JbeamObject | undefined, max = 60): string[] {
  return partClosure(start, find, (b) => isGearboxPart(b) || (typeof b.slotType === 'string' && /transmission|transaxle|gearbox|^wheel|^tire/i.test(b.slotType)), max);
}

/** A part and the defaults of its slots, all the way down; `skip` leaves out branches (not the start). */
export function partClosure(start: string, find: (name: string) => JbeamObject | undefined, skip: (body: JbeamObject) => boolean, max = 40): string[] {
  const seen: string[] = [];
  const queue = [start];
  while (queue.length && seen.length < max) {
    const name = queue.shift()!;
    if (seen.includes(name)) continue;
    const body = find(name);
    if (!body) continue;
    if (seen.length && skip(body)) continue;
    seen.push(name);
    queue.push(...slotDefaults(body));
  }
  return seen;
}

/** Every slot type a set of parts declares (the type/name column and allowTypes). */
export function declaredSlotTypes(parts: Iterable<JbeamObject>): Set<string> {
  const out = new Set<string>();
  for (const p of parts) {
    for (const key of ['slots', 'slots2'] as const) {
      const t = p[key];
      if (!Array.isArray(t) || !Array.isArray(t[0])) continue;
      const h = (t[0] as unknown[]).map(String);
      for (const row of t.slice(1)) {
        if (!Array.isArray(row)) continue;
        for (const col of ['type', 'name']) {
          const v = row[h.indexOf(col)];
          if (typeof v === 'string') out.add(v);
        }
        const allow = row[h.indexOf('allowTypes')];
        if (Array.isArray(allow)) for (const a of allow) if (typeof a === 'string') out.add(a);
      }
    }
  }
  return out;
}

function flexMeshes(body: JbeamObject): string[] {
  return Array.isArray(body.flexbodies) ? body.flexbodies.slice(1).flatMap((row) => (Array.isArray(row) && typeof row[0] === 'string' ? [row[0]] : [])) : [];
}

async function allParts(zip: ZipReader): Promise<Map<string, JbeamObject>> {
  const map = new Map<string, JbeamObject>();
  for (const e of (await zip.entries()).filter((x) => x.name.endsWith('.jbeam'))) {
    try {
      const doc = parseJbeam(await zip.readText(e.name)).value;
      if (!isJbeamObject(doc)) continue;
      for (const [name, body] of Object.entries(doc)) if (isJbeamObject(body) && !map.has(name)) map.set(name, body);
    } catch {
      // unreadable jbeam: skip
    }
  }
  return map;
}

/**
 * Complete suspensions of one vehicle, as the game fits them (the part and
 * its slot defaults): <out>/<vehicle>/<part>/set.json + set.dae +
 * jbeam.json (the parts' definitions, for bringing the jbeam over), and the
 * brand logo.
 */
async function writeSets(
  zip: ZipReader,
  vehicle: string,
  info: { name: string; brand: string },
  commonParts: ReadonlyMap<string, JbeamObject>,
  brandLogos: ReadonlyMap<string, Buffer>,
  locate: (mesh: string) => DaeDoc | undefined,
  out: string,
  textures: TextureStore,
  materialIndex: ReadonlyMap<string, string>,
): Promise<void> {
  const own = await allParts(zip);
  const find = (n: string) => own.get(n) ?? commonParts.get(n);
  let logo: Buffer | null = brandLogos.get(info.brand.toLowerCase()) ?? null;
  if (!logo) {
    try {
      logo = await zip.readBuffer(`vehicles/${vehicle}/logo.png`);
    } catch {
      logo = null;
    }
  }
  if (logo) {
    mkdirSync(join(out, '_logos'), { recursive: true });
    writeFileSync(join(out, '_logos', `${vehicle}.png`), logo);
  }

  // What goes in: suspensions from the car's own parts; engines and gearboxes (often shared, in
  // common) that fit a slot the car or its engines declare.
  const roots: { kind: 'suspension' | 'engine' | 'gearbox' | 'panel'; part: string; parts: string[] }[] = [];
  for (const [partName, body] of own) {
    const slotType = typeof body.slotType === 'string' ? body.slotType : '';
    const category = categoryOf(slotType);
    // A set starts at the suspension itself (not a hub or subframe on its own).
    if (category && SET_CATEGORIES.has(category) && /suspension|axle/i.test(slotType)) roots.push({ kind: 'suspension', part: partName, parts: suspensionClosure(partName, find) });
    // Body panels (fork): the stock part alone; its own slots (glass, handles) stay the game's.
    else if (panelCategory(slotType) && flexMeshes(body).length) roots.push({ kind: 'panel', part: partName, parts: [partName] });
  }
  const pool = new Map([...commonParts, ...own]);
  const carSlots = declaredSlotTypes(own.values());
  // Landing gear and the like have motors too; they aren't engines.
  const engines = [...pool].filter(([n, b]) => typeof b.slotType === 'string' && carSlots.has(b.slotType) && isEnginePart(b) && !/landing|winch|crane|ramp/i.test(`${n} ${partTitle(b, n)}`));
  for (const [name] of engines) roots.push({ kind: 'engine', part: name, parts: engineClosure(name, find) });
  const engineSlots = declaredSlotTypes(engines.map(([, b]) => b));
  for (const [name, b] of pool) {
    if (typeof b.slotType === 'string' && (carSlots.has(b.slotType) || engineSlots.has(b.slotType)) && isGearboxPart(b)) {
      roots.push({ kind: 'gearbox', part: name, parts: partClosure(name, find, (x) => typeof x.slotType === 'string' && /^wheel|^tire/i.test(x.slotType)) });
    }
  }

  // Every node the car and its engines define, so a set's attachments can be placed.
  const vehicleNodes = new Map<string, V3>();
  const engineParts = engines.flatMap(([n]) => engineClosure(n, find).map((p) => find(p)!));
  for (const body of [...own.values(), ...engineParts]) for (const [id, pos] of definedNodes(body)) if (!vehicleNodes.has(id)) vehicleNodes.set(id, pos);

  const seen = new Set<string>();
  for (const { kind, part: partName, parts } of roots) {
    const body = find(partName)!;
    const slotType = typeof body.slotType === 'string' ? body.slotType : '';
    const meshes = [...new Set(parts.flatMap((p) => flexMeshes(find(p)!)))];
    const key = `${kind}:${meshes.sort().join('|')}:${kind === 'suspension' ? '' : partName}`;
    if (!meshes.length || seen.has(key)) continue;
    seen.add(key);
    const sources: { doc: DaeDoc; names: string[] }[] = [];
    for (const mesh of meshes) {
      const doc = locate(mesh);
      if (!doc) continue;
      const s = sources.find((x) => x.doc === doc);
      if (s) s.names.push(mesh);
      else sources.push({ doc, names: [mesh] });
    }
    const dae = sources.length ? subsetDae(sources, kind === 'suspension' ? '0.5 0.5 0.52' : kind === 'panel' ? '0.62 0.63 0.66' : '0.32 0.33 0.35', await textures.lookup(subsetMaterials(sources), materialIndex, zip)) : null;
    if (!dae) continue;
    const title = partTitle(body, partName);
    const closure = Object.fromEntries(parts.map((p) => [p, find(p)!]));
    const category = categoryOf(slotType);
    const axle = kind !== 'suspension' ? 'any' : category === 'Front Suspension' ? 'front' : category === 'Rear Suspension' ? 'rear' : /_F(_|$)/.test(slotType) ? 'front' : /_R(_|$)/.test(slotType) ? 'rear' : 'any';
    const engine = kind === 'engine' ? engineSpecs(body, Object.values(closure), title) : undefined;
    const gearbox = kind === 'gearbox' ? gearboxSpecs(body) : undefined;
    const type = kind === 'suspension' ? suspensionType(`${title} ${parts.join(' ')} ${meshes.join(' ')}`) : kind === 'panel' ? (panelCategory(slotType) ?? 'Panel') : engine ? engine.layout : gearbox!.kind;
    const dir = join(out, vehicle, safe(partName));
    mkdirSync(dir, { recursive: true });
    const meshFile = `${vehicle}_${safe(partName)}.dae`;
    writeFileSync(join(dir, meshFile), dae);
    writeFileSync(join(dir, 'jbeam.json'), JSON.stringify(closure, null, 1));
    writeFileSync(join(dir, 'anchors.json'), JSON.stringify(externalNodeRefs(closure, vehicleNodes)));
    // The game's other parts for the set's slots (brakes, racks, turbos…), offered as choices.
    const options = findOptions(parts, find, pool);
    if (options.slots.length) writeFileSync(join(dir, 'options.json'), JSON.stringify({ ...options, anchors: externalNodeRefs(options.parts, vehicleNodes) }));
    const setJson = {
      version: 1,
      kind,
      vehicle,
      vehicleName: info.name,
      brand: info.brand || 'Other',
      axle,
      type,
      name: title,
      part: partName,
      slotType,
      parts,
      mesh: meshFile,
      logo: logo ? `../../_logos/${vehicle}.png` : null,
      ...(engine ? { engine } : {}),
      ...(gearbox ? { gearbox } : {}),
    };
    writeFileSync(join(dir, 'set.json'), JSON.stringify(setJson, null, 1));
  }
}

async function readableZip(path: string): Promise<boolean> {
  try {
    await withZip(path, async (zip) => void (await zip.entries()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Write every suspension-area part of every stock vehicle as an object
 * (<out>/BeamNG/<Category>/<Vehicle · Part>/object.json + <part>.dae).
 * Parts with the same meshes (tuned variants) become one object.
 */
export async function buildPartObjects(installDir: string, out: string, onVehicle?: (name: string) => void): Promise<number> {
  const root = join(installDir, 'content', 'vehicles');
  const zips = (await readdir(root)).filter((z) => z.toLowerCase().endsWith('.zip'));
  const t = await translations(installDir);
  const common = zips.includes('common.zip') ? await withZip(join(root, 'common.zip'), daesOf) : [];
  const commonParts = zips.includes('common.zip') ? await withZip(join(root, 'common.zip'), allParts) : new Map<string, JbeamObject>();
  const brandLogos = zips.includes('common.zip')
    ? await withZip(join(root, 'common.zip'), async (zip) => {
        const logos = new Map<string, Buffer>();
        for (const e of (await zip.entries()).filter((x) => /vehicles\/common\/brand_[^/]+\.png$/i.test(x.name))) logos.set(e.name.replace(/^.*brand_|\.png$/gi, '').toLowerCase(), await zip.readBuffer(e.name));
        return logos;
      })
    : new Map<string, Buffer>();
  let count = 0;
  const taken = new Set<string>();
  const commonZip = zips.includes('common.zip') ? await ZipReader.open(join(root, 'common.zip')) : null;
  const textures = new TextureStore(out, commonZip);
  const commonMaterials = commonZip ? await materialTextures(commonZip) : new Map<string, string>();
  try {
    for (const z of zips) {
      const vehicle = z.replace(/\.zip$/i, '');
      // One unreadable zip (a broken download, a stray file) mustn't stop the rest from being read.
      if (!(await readableZip(join(root, z)))) continue;
      await withZip(join(root, z), async (zip) => {
        const parts: PartObject[] = [];
        const name = await vehicleName(zip, vehicle, t);
        for (const e of (await zip.entries()).filter((x) => x.name.endsWith('.jbeam'))) {
          try {
            const doc = parseJbeam(await zip.readText(e.name)).value;
            if (isJbeamObject(doc)) parts.push(...partsOf(doc, vehicle, name));
          } catch {
            // a jbeam the lenient parser can't read: skip it
          }
        }
        onVehicle?.(name);
        const own = vehicle === 'common' ? common : await daesOf(zip);
        const locate = (mesh: string) => own.find((d) => d.nodes.has(mesh)) ?? common.find((d) => d.nodes.has(mesh));
        // The car's own materials first, then the shared ones.
        const materialIndex = new Map([...commonMaterials, ...(vehicle === 'common' ? [] : await materialTextures(zip))]);
        // Sets first: a car with no suspension objects still has panels, engines and gearboxes.
        if (vehicle !== 'common') await writeSets(zip, vehicle, await vehicleInfo(zip, vehicle, t), commonParts, brandLogos, locate, join(out, 'sets'), textures, materialIndex);
        if (!parts.length) return;
        const seen = new Set<string>();
        for (const p of parts) {
          const key = [...p.meshes].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const sources: { doc: DaeDoc; names: string[] }[] = [];
          for (const mesh of p.meshes) {
            const doc = own.find((d) => d.nodes.has(mesh)) ?? common.find((d) => d.nodes.has(mesh));
            if (!doc) continue;
            const s = sources.find((x) => x.doc === doc);
            if (s) s.names.push(mesh);
            else sources.push({ doc, names: [mesh] });
          }
          const dae = sources.length ? subsetDae(sources, SHADES[p.category] ?? '0.5 0.5 0.52', await textures.lookup(subsetMaterials(sources), materialIndex, zip)) : null;
          if (!dae) continue;
          let title = safe(`${p.vehicleName} · ${p.partName}`);
          for (let i = 2; taken.has(`${p.category}/${title}`.toLowerCase()); i++) title = safe(`${p.vehicleName} · ${p.partName} ${i}`);
          taken.add(`${p.category}/${title}`.toLowerCase());
          const dir = join(out, 'BeamNG', p.category, title);
          mkdirSync(dir, { recursive: true });
          const meshFile = `${p.part}.dae`;
          writeFileSync(join(dir, meshFile), dae);
          writeFileSync(
            join(dir, 'object.json'),
            JSON.stringify({ version: 1, name: title, category: p.category, group: 'BeamNG', mesh: meshFile, material: null, gameMaterials: true, source: `${vehicle}: ${p.part}`, credit: 'BeamNG (from your install)' }, null, 2),
          );
          count++;
        }
      });
    }
  } finally {
    commonZip?.close();
  }
  return count;
}

/**
 * Engines and gearboxes (and suspensions, panels) from a car mod outside the
 * install: a car exported from Automation (Camso), or any car mod zip. The
 * mod's vehicles are read the same way as the game's, with the install's
 * common parts and meshes when the install is known (exports lean on them).
 * Sets land in `<out>/sets/<vehicle>/…`; the vehicles found are returned.
 */
export async function importModSets(modZip: string, installDir: string | null, out: string, fallbackBrand = 'Automation'): Promise<string[]> {
  const commonPath = installDir ? join(installDir, 'content', 'vehicles', 'common.zip') : null;
  const hasCommon = !!commonPath && (await readableZip(commonPath));
  const common = hasCommon ? await withZip(commonPath, daesOf) : [];
  const commonParts = hasCommon ? await withZip(commonPath, allParts) : new Map<string, JbeamObject>();
  const commonZip = hasCommon ? await ZipReader.open(commonPath) : null;
  const t = installDir ? await translations(installDir) : (key: string) => key;
  const textures = new TextureStore(out, commonZip);
  const commonMaterials = commonZip ? await materialTextures(commonZip) : new Map<string, string>();
  const found: string[] = [];
  try {
    await withZip(modZip, async (zip) => {
      const vehicles = [...new Set((await zip.entries()).map((e) => /^vehicles\/([^/]+)\/.+\.jbeam$/i.exec(e.name)?.[1]).filter((v): v is string => !!v && v.toLowerCase() !== 'common'))];
      if (!vehicles.length) throw new Error('No car in this file: an Automation export is a zip with a vehicles/<name>/ folder (in BeamNG’s mods folder).');
      const own = await daesOf(zip);
      const locate = (mesh: string) => own.find((d) => d.nodes.has(mesh)) ?? common.find((d) => d.nodes.has(mesh));
      const materialIndex = new Map([...commonMaterials, ...(await materialTextures(zip))]);
      for (const vehicle of vehicles) {
        const info = await vehicleInfo(zip, vehicle, t);
        await writeSets(zip, vehicle, { name: info.name || vehicle, brand: info.brand && info.brand !== 'Other' ? info.brand : fallbackBrand }, commonParts, new Map(), locate, join(out, 'sets'), textures, materialIndex);
        found.push(vehicle);
      }
    });
  } finally {
    commonZip?.close();
  }
  return found;
}
