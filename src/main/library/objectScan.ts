/**
 * Turns a folder of object sets (universal meshes: brake calipers, discs,
 * gauges…) into ready objects: shared by the pack build script and the app's
 * startup scan of the user's own folders.
 *
 * Each folder holding a mesh (.glb/.gltf/.fbx/.obj/.dae/.kn5) is one object;
 * a loose mesh file next to other object folders is an object of its own.
 * Names are made consistent and sortable: "APLockheedCaliper00" under
 * "Brake calipers" becomes "AP Lockheed 01" in Suspension › Brake Calipers.
 * Packed textures are split into the maps BeamNG uses: ORM (occlusion,
 * roughness, metallic) and NAO (normal XY + ambient occlusion), and each
 * object gets a ready material. kn5 objects keep their own materials.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { defaultLayer, defaultMaterial, MaterialDefSchema, type TextureSlot } from '@shared/materials/schema';
import { channelPng, decodePng, encodePng, type Rgba } from './png';

const MESH = new Set(['.glb', '.gltf', '.fbx', '.obj', '.dae']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.dds', '.tga']);
const TYPE_WORDS = /(caliper|calliper|disc|disk|rotor)$/i;

const titleWord = (w: string) => (/^[A-Z0-9]{1,3}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
/** "Brake calipers" → "Brake Calipers", "Digital Guage" → "Digital Gauges". */
function niceCategory(s: string): string {
  return s
    .replace(/guage/gi, 'Gauge')
    .replace(/calliper/gi, 'Caliper')
    .split(/[\s_]+/)
    .map(titleWord)
    .join(' ')
    .replace(/\bDigital Gauge\b/, 'Digital Gauges');
}

/** "APLockheedCaliper00" → "AP Lockheed 01", "AlfaRomeoDisc00" → "Alfa Romeo 01", "PlaceholderCaliper" → "Generic 01". */
export function objectName(folder: string): string {
  const m = folder.match(/^(.*?)(\d+)?$/)!;
  let stem = m[1]!.replace(TYPE_WORDS, '').replace(/[_-]+$/, '');
  const n = m[2] !== undefined ? String(Number(m[2]) + 1).padStart(2, '0') : '01';
  if (!stem || /^placeholder$/i.test(stem)) stem = 'Generic';
  const words = stem
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z]{4,}$/.test(w) ? titleWord(w) : titleWord(w)));
  return `${words.join(' ')} ${n}`;
}

/** kn5 dashes and gauges: the file name alone doesn't say what they are. */
const KN5_NAMES: Record<string, { name: string; credit?: string }> = {
  haltech_ic7: { name: 'Haltech iC-7' },
  haltech_uc10: { name: 'Haltech uC-10', credit: 'MetalRoachTwo' },
  strada_7: { name: 'Link MXG Strada 7', credit: 'HenTaiMU' },
};
const LICENSE_FILE = /^(license|licence|readme)|readme/i;

// ---------------------------------------------------------------- textures

interface Tex {
  entry: string;
  data?: Buffer;
  from?: string;
}

/** Normal map from NAO's red/green (tangent X/Y): rebuild Z. */
function normalFromRg(img: Rgba): Buffer {
  const out = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) {
    const x = img.data[i * 4]! / 127.5 - 1;
    const y = img.data[i * 4 + 1]! / 127.5 - 1;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    out.set([img.data[i * 4]!, img.data[i * 4 + 1]!, Math.round((z * 0.5 + 0.5) * 255)], i * 3);
  }
  return encodePng(img.width, img.height, 3, out);
}

const flat = (img: Rgba, c: number) => {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < img.width * img.height; i += 97) {
    const v = img.data[i * 4 + c]!;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo < 8;
};

function texturesFor(images: string[], slug: string): { maps: Partial<Record<TextureSlot, string>>; files: Tex[]; notes: string[] } {
  const maps: Partial<Record<TextureSlot, string>> = {};
  const files: Tex[] = [];
  const notes: string[] = [];
  const put = (slot: TextureSlot, role: string, t: Omit<Tex, 'entry'>, ext = '.png') => {
    const entry = `textures/${slug}_${role}${ext}`;
    files.push({ entry, ...t });
    maps[slot] = entry;
  };
  const suffix = (f: string) => basename(f, extname(f)).split(/[_-]/).pop()!.toLowerCase();
  for (const f of images) {
    const s = suffix(f);
    const ext = extname(f).toLowerCase();
    if (ext === '.png' && s === 'nao') {
      const img = decodePng(readFileSync(f));
      put('normalMap', 'normal', { data: normalFromRg(img) });
      if (!flat(img, 2)) put('ambientOcclusionMap', 'ao', { data: channelPng(img, 2) });
      notes.push('NAO split into normal + AO');
    } else if (ext === '.png' && s === 'orm') {
      const img = decodePng(readFileSync(f));
      if (!flat(img, 0) && !maps.ambientOcclusionMap) put('ambientOcclusionMap', 'ao', { data: channelPng(img, 0) });
      put('roughnessMap', 'roughness', { data: channelPng(img, 1) });
      put('metallicMap', 'metallic', { data: channelPng(img, 2) });
      notes.push('ORM split into roughness + metallic');
    } else if (/^(b|basecolou?r|albedo|diff(use)?|d|col(ou?r)?)$/.test(s)) put('baseColorMap', 'basecolor', { from: f }, ext === '.jpeg' ? '.jpg' : ext);
    else if (/^(n|nm|normal|nor)$/.test(s)) put('normalMap', 'normal', { from: f }, ext);
    else if (/^(r|rough(ness)?)$/.test(s)) put('roughnessMap', 'roughness', { from: f }, ext);
    else if (/^(m|metal(lic|ness)?)$/.test(s)) put('metallicMap', 'metallic', { from: f }, ext);
    else if (/^(ao|occlusion)$/.test(s)) put('ambientOcclusionMap', 'ao', { from: f }, ext);
    else notes.push(`not used: ${basename(f)}`);
  }
  return { maps, files, notes };
}

// ---------------------------------------------------------------- objects

export interface BuiltObject {
  group: string;
  category: string;
  name: string;
  mesh: string;
  textures: Tex[];
  /** null: the mesh keeps its own materials (kn5). */
  materialJson: unknown;
  source: string;
  notes: string[];
  credit?: string;
  extras?: string[];
}

function walkDirs(dir: string): string[] {
  return [dir, ...readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => walkDirs(join(dir, e.name)))];
}

/** Every object in a folder tree. */
export function scanObjects(root: string): BuiltObject[] {
  const objects: BuiltObject[] = [];
  for (const dir of walkDirs(root)) {
    const files = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(dir, e.name));
    // LOD0 … LOD3 of one mesh are one object: keep the most detailed.
    const lodStem = (f: string) => basename(f, extname(f)).replace(/_?lod\d+$/i, '');
    const lodNum = (f: string) => Number(basename(f, extname(f)).match(/lod(\d+)$/i)?.[1] ?? 0);
    const byStem = new Map<string, string[]>();
    for (const f of files.filter((x) => MESH.has(extname(x).toLowerCase()))) byStem.set(lodStem(f), [...(byStem.get(lodStem(f)) ?? []), f]);
    const meshes = [...byStem.values()].map((g) => g.sort((a, b) => lodNum(a) - lodNum(b))[0]!);
    const rel = relative(root, dir).split(sep);
    // A kn5 carries its own materials and textures; its folder's licence and readme travel with it.
    for (const k of files.filter((f) => extname(f).toLowerCase() === '.kn5')) {
      const stem = basename(k, '.kn5');
      const known = KN5_NAMES[stem.toLowerCase()];
      objects.push({
        group: niceCategory(rel[0] ?? 'Objects'),
        category: niceCategory(rel[rel.length - 2] ?? rel[0] ?? 'Objects'),
        name: known?.name ?? stem.split(/[_\s-]+/).map(titleWord).join(' '),
        mesh: k,
        textures: [],
        materialJson: null,
        source: relative(root, k).split(sep).join('/'),
        notes: ['kn5 with its own materials and textures'],
        credit: known?.credit,
        extras: files.filter((f) => LICENSE_FILE.test(basename(f))),
      });
    }
    if (!meshes.length) continue;
    const hasSubObjects = readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory());
    const images = files.filter((f) => IMAGE.has(extname(f).toLowerCase()));
    // A folder with sub-folders keeps its own meshes as loose objects; otherwise the folder is the object.
    const loose = hasSubObjects || meshes.length > 1;
    const group = niceCategory(rel[0] ?? 'Objects');
    for (const mesh of loose ? meshes : [meshes[0]!]) {
      const category = niceCategory(loose ? (rel[rel.length - 1] ?? group) : (rel[rel.length - 2] ?? group));
      const name = loose ? objectName(basename(mesh, extname(mesh)).replace(/^SM_/, '').replace(/_?lod\d+$/i, '')) : objectName(rel[rel.length - 1]!);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const { maps, files: tex, notes } = loose ? { maps: {}, files: [], notes: [] } : texturesFor(images, `${category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${slug}`);
      const def = defaultMaterial('object', `${category} ${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '_'), {
        layers: [
          defaultLayer({
            maps,
            // With maps, factors are multipliers: keep them at 1 so the textures drive the look.
            // Without textures: gloss red calipers, cast-iron discs.
            ...(maps.baseColorMap ? {} : /caliper/i.test(category) ? { baseColor: [0.62, 0.05, 0.04, 1] as [number, number, number, number], clearCoat: 0.6 } : /disc|rotor/i.test(category) ? { baseColor: [0.42, 0.41, 0.4, 1] as [number, number, number, number] } : {}),
            metallic: maps.metallicMap ? 1 : /caliper/i.test(category) ? 0.3 : /disc|rotor/i.test(category) ? 0.9 : 0,
            roughness: maps.roughnessMap ? 1 : /caliper/i.test(category) ? 0.35 : /disc|rotor/i.test(category) ? 0.55 : 0.5,
          }),
        ],
      });
      MaterialDefSchema.parse(def);
      objects.push({ group, category, name, mesh, textures: tex, materialJson: def, source: relative(root, mesh).split(sep).join('/'), notes });
    }
  }
  return objects;
}

/** Write objects out as a pack folder (and to `extra`, e.g. a zip). `folderOut` is emptied first. */
export function writeObjectPack(built: readonly BuiltObject[], folderOut: string, title: string, extra?: (entry: string, data: Buffer) => void): string {
  rmSync(folderOut, { recursive: true, force: true });
  const put = (entry: string, data: Buffer) => {
    extra?.(entry, data);
    mkdirSync(dirname(join(folderOut, entry)), { recursive: true });
    writeFileSync(join(folderOut, entry), data);
  };
  const objects = [...built];
  const index = [`# ${title}`, '', `${objects.length} objects. Each folder holds \`object.json\`, the mesh, and \`textures/\` (basecolor, normal, ao, roughness, metallic). kn5 objects carry their own materials and textures, with their licence or readme alongside.`, ''];
  let last = '';
  const taken = new Set<string>();
  for (const o of objects.sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name))) {
    let dir = `${o.group}/${o.category}/${o.name}`;
    for (let i = 2; taken.has(dir.toLowerCase()); i++) dir = `${o.group}/${o.category}/${o.name} ${i}`;
    taken.add(dir.toLowerCase());
    // Named after the object, so it reads well as a model in the Scene tree ("brake_calipers_brembo_01.glb").
    const meshFile = `${`${o.category} ${o.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '_')}${extname(o.mesh).toLowerCase()}`;
    put(`${dir}/${meshFile}`, readFileSync(o.mesh));
    for (const t of o.textures) put(`${dir}/${t.entry}`, t.data ?? readFileSync(t.from!));
    for (const x of o.extras ?? []) put(`${dir}/${basename(x)}`, readFileSync(x));
    put(`${dir}/object.json`, Buffer.from(JSON.stringify({ version: 1, name: o.name, category: o.category, group: o.group, mesh: meshFile, material: o.materialJson, source: o.source, ...(o.credit ? { credit: o.credit } : {}) }, null, 2)));
    const head = `${o.group} › ${o.category}`;
    if (head !== last) {
      index.push('', `## ${head}`, '', '| Object | Textures | Notes | From |', '|---|---|---|---|');
      last = head;
    }
    index.push(`| ${o.name} | ${o.textures.map((t) => basename(t.entry).replace(/^.*_(\w+)\.\w+$/, '$1')).join(', ') || '—'} | ${[...o.notes, ...(o.credit ? [`by ${o.credit}`] : [])].join('; ') || '—'} | ${o.source} |`);
  }
  const md = `${index.join('\n')}\n`;
  put('OBJECTS.md', Buffer.from(md));
  return md;
}
