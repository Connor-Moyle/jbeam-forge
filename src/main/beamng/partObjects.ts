import { mkdirSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamObject } from '@shared/jbeam/parse';
import { withZip, type ZipReader } from './zip';

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
export function subsetDae(sources: { doc: DaeDoc; names: string[] }[], shade: string): string | null {
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
<library_effects>
${mats.map((m) => `<effect id="${m}-fx"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${shade} 1</color></diffuse></lambert></technique></profile_COMMON></effect>`).join('\n')}
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
  try {
    const info = parseJbeam(await zip.readText(`vehicles/${vehicle}/info.json`)).value;
    if (isJbeamObject(info) && typeof info.Name === 'string') {
      const name = t(info.Name);
      const brand = typeof info.Brand === 'string' ? info.Brand : '';
      if (!name.startsWith('vehiclesData.')) return brand && !name.startsWith(brand) ? `${brand} ${name}` : name;
    }
  } catch {
    // no info.json (common parts, props)
  }
  if (vehicle === 'common') return 'Shared';
  return vehicle.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
  let count = 0;
  const taken = new Set<string>();
  for (const z of zips) {
    const vehicle = z.replace(/\.zip$/i, '');
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
      if (!parts.length) return;
      onVehicle?.(name);
      const own = vehicle === 'common' ? common : await daesOf(zip);
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
        const dae = sources.length ? subsetDae(sources, SHADES[p.category] ?? '0.5 0.5 0.52') : null;
        if (!dae) continue;
        let title = safe(`${p.vehicleName} · ${p.partName}`);
        for (let i = 2; taken.has(`${p.category}/${title}`.toLowerCase()); i++) title = safe(`${p.vehicleName} · ${p.partName} ${i}`);
        taken.add(`${p.category}/${title}`.toLowerCase());
        const dir = join(out, 'BeamNG', p.category, title);
        mkdirSync(dir, { recursive: true });
        const meshFile = `${p.part}.dae`;
        writeFileSync(join(dir, meshFile), dae);
        writeFileSync(join(dir, 'object.json'), JSON.stringify({ version: 1, name: title, category: p.category, group: 'BeamNG', mesh: meshFile, material: null, gameMaterials: true, source: `${vehicle}: ${p.part}`, credit: 'BeamNG (from your install)' }, null, 2));
        count++;
      }
    });
  }
  return count;
}
