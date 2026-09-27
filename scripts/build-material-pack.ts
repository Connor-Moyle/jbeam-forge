/**
 * Build the downloadable material pack from a folder of material sets.
 *
 *   npm run build-material-pack -- "Materials Libary"   → release/JBeam-Forge-Materials-<version>.zip
 *
 * Each folder holding texture files is one material (named after the folder,
 * filed under its top-level folder). A MaterialX file (.mtlx, e.g. Adobe
 * Substance exports) gives the factors and which texture does what; without
 * one, texture roles come from the usual file-name conventions (Poly Haven
 * _diff/_nor_gl/_rough, ambientCG _Color/_NormalGL, BeamNG-style _nm, …).
 * EXR textures are converted to 8-bit PNG (BeamNG and the app don't read EXR).
 *
 * The pack is a zip of <Category>/<Name>/material.json + textures/, the same
 * layout as a .jbmat, so the app's library import takes it as-is.
 */
import { readdirSync, readFileSync, statSync, createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { deflateSync } from 'node:zlib';
import { ZipFile } from 'yazl';
import { FloatType } from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { defaultLayer, defaultMaterial, MaterialDefSchema, type MaterialDef, type TextureSlot } from '../src/shared/materials/schema';

const root = resolve(process.argv[2] ?? 'Materials Libary');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const out = resolve('release', `JBeam-Forge-Materials-${version}.zip`);

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.dds', '.tga', '.exr']);
// ---------------------------------------------------------------- consistent names

const CATEGORY_NAMES: Record<string, string> = { 'car paints': 'Paint', 'small details': 'Details' };
/** Spelling and wording, applied word by word before title-casing. */
const SPELLING: [RegExp, string][] = [
  [/\bfib(er|re)\b/gi, 'Fiber'],
  [/\bstailness\b/gi, 'Stainless'],
  [/\buphostery\b/gi, 'Upholstery'],
  [/\bdimonds?\b/gi, 'Diamonds'],
  [/\balumin(i)?um\b/gi, 'Aluminium'],
  [/\bmatt\b/gi, 'Matte'],
  [/\bcarpaint\b/gi, 'Car Paint'],
  [/\bdash ?board\b/gi, 'Dashboard'],
  [/\bcomposits\b/gi, 'Composites'],
];
const SMALL_WORDS = new Set(['and', 'of', 'the', 'with', 'on']);

/** "LEather 08" → "Leather 08", "Light Uphostery" → "Light Upholstery", "Denim_Fabric" → "Denim Fabric". */
export function niceName(raw: string): string {
  const spaced = raw.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const fixed = SPELLING.reduce((t, [re, to]) => t.replace(re, to), spaced);
  return fixed
    .split(' ')
    .map((w, i) => (/^\d+$/.test(w) ? w.padStart(2, '0') : i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
/** Texture file role names: <material>_<role>.<ext>. */
const ROLE_NAME: Record<TextureSlot, string> = {
  baseColorMap: 'basecolor',
  normalMap: 'normal',
  roughnessMap: 'roughness',
  metallicMap: 'metallic',
  ambientOcclusionMap: 'ao',
  opacityMap: 'opacity',
  emissiveMap: 'emissive',
  clearCoatMap: 'clearcoat',
  colorPaletteMap: 'palette',
  detailNormalMap: 'detail_normal',
};

// ---------------------------------------------------------------- MaterialX

interface Mtlx {
  maps: Partial<Record<TextureSlot, string>>;
  values: Record<string, string>;
}

/** The few things we need from a MaterialX file: standard_surface values and image nodes by usage. */
function readMtlx(path: string): Mtlx {
  const xml = readFileSync(path, 'utf8');
  const values: Record<string, string> = {};
  const surface = xml.match(/<standard_surface[\s\S]*?<\/standard_surface>/)?.[0] ?? '';
  for (const m of surface.matchAll(/<input name="([^"]+)"[^>]*\svalue="([^"]*)"/g)) values[m[1]!] = m[2]!;
  // Inputs fed from the node graph: follow output → node, and take the value of constants.
  for (const m of surface.matchAll(/<input name="([^"]+)"[^>]*\soutput="([^"]+)"/g)) {
    const node = xml.match(new RegExp(`<output name="${m[2]}"[^>]*nodename="([^"]+)"`))?.[1];
    const constant = node && xml.match(new RegExp(`<constant name="${node}"[^>]*>[\\s]*<input name="value"[^>]*value="([^"]+)"`))?.[1];
    if (constant) values[m[1]!] = constant;
  }
  const maps: Partial<Record<TextureSlot, string>> = {};
  const usage: Record<string, TextureSlot> = { baseColor: 'baseColorMap', metallic: 'metallicMap', roughness: 'roughnessMap', normal: 'normalMap', ambientOcclusion: 'ambientOcclusionMap', opacity: 'opacityMap', emissive: 'emissiveMap' };
  for (const img of xml.matchAll(/<image\b[^>]*GLSLFX_usage="([^"]+)"[\s\S]*?<input name="file"[^>]*value="([^"]+)"/g)) {
    const slot = usage[img[1]!];
    if (slot && !maps[slot]) maps[slot] = basename(img[2]!);
  }
  // Only a "diffuse" image and no baseColor: use it.
  if (!maps.baseColorMap) {
    const diffuse = xml.match(/<image\b[^>]*GLSLFX_usage="diffuse"[\s\S]*?<input name="file"[^>]*value="([^"]+)"/);
    if (diffuse) maps.baseColorMap = basename(diffuse[1]!);
  }
  return { maps, values };
}

/** MaterialX colours are linear; the app stores sRGB like a colour picker. */
const toSrgb = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
const color3 = (s: string | undefined): [number, number, number] | null => {
  const v = s?.split(',').map(Number);
  return v && v.length === 3 && v.every(Number.isFinite) ? (v.map((c) => toSrgb(Math.max(0, c))) as [number, number, number]) : null;
};
const num = (s: string | undefined, d: number) => (s !== undefined && Number.isFinite(Number(s)) ? Number(s) : d);
const clamp = (v: number) => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------- file-name conventions

const ROLES: [TextureSlot, RegExp][] = [
  ['normalMap', /(normal|nor_gl|norgl|_nm\b|normasl|_n\.)/i],
  ['roughnessMap', /rough/i],
  ['metallicMap', /metal|metel/i],
  ['ambientOcclusionMap', /ambientocclusion|occlusion|_ao\b/i],
  ['opacityMap', /opacity|alpha/i],
  ['emissiveMap', /emissi/i],
  ['baseColorMap', /(base_?colou?r|diff(use)?|albedo|colou?rs?\b|_col\b|color)/i],
];
/** Texture kinds BeamNG has no slot for. */
const SKIP = /(disp|height|bump|mask|spec_ior|anisotropy|position|scattering|_any\b|normaldx|nor_dx|coatroughness)/i;

/**
 * The part of a texture name that says what it is: what's left after the name
 * all files of the set share ("MetalPlates004_1K-PNG_Color" → "Color"), minus
 * size and index tags. Matching the whole name would read "Metal" in a
 * "MetalPlates" colour map as metallic.
 */
function roleText(name: string, siblings: readonly string[]): string {
  let prefix = siblings.reduce((p, s) => {
    let i = 0;
    while (i < p.length && i < s.length && p[i]!.toLowerCase() === s[i]!.toLowerCase()) i++;
    return p.slice(0, i);
  }, name);
  if (siblings.length < 2) prefix = '';
  const tail = name.slice(prefix.length) || name;
  return tail.replace(/([_\-. ]?(\d+k|\d+|png|jpg|gl))+$/i, (m) => (/gl$/i.test(m) ? '_gl' : ''));
}

function guessRoles(files: readonly string[]): Partial<Record<TextureSlot, string>> {
  const maps: Partial<Record<TextureSlot, string>> = {};
  const rest: string[] = [];
  const stems = files.map((f) => basename(f, extname(f)));
  for (const f of files) {
    const name = basename(f, extname(f));
    if (SKIP.test(name)) continue;
    const text = roleText(name, stems);
    const role = (ROLES.find(([, re]) => re.test(`_${text}`)) ?? ROLES.find(([, re]) => re.test(name)))?.[0];
    if (role && !maps[role]) maps[role] = f;
    else if (!role) rest.push(f);
  }
  // DDS sets like alcnt.dds + alcnt_nm.dds: the plain one is the colour.
  if (!maps.baseColorMap && rest.length) maps.baseColorMap = rest.sort((a, b) => a.length - b.length)[0];
  return maps;
}

// ---------------------------------------------------------------- EXR → PNG

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

/** Linear EXR (data maps: normals, roughness, metal) → 8-bit RGB PNG, top row first. */
function exrToPng(path: string): Buffer {
  const file = readFileSync(path);
  const loader = new EXRLoader();
  loader.setDataType(FloatType);
  const img = loader.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  const w = img.width ?? 0;
  const h = img.height ?? 0;
  const data = img.data as Float32Array;
  const ch = data.length / (w * h);
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w; // EXRLoader rows run bottom-up
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        const v = data[(src + x) * ch + Math.min(c, ch - 1)]!;
        raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.round(clamp(v) * 255);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- materials

interface Built {
  category: string;
  name: string;
  def: MaterialDef;
  textures: { entry: string; role: string; original: string; from?: string; data?: Buffer }[];
  source: string;
  /** Texture files in the set BeamNG has no slot for (height, displacement, masks…). */
  unused: string[];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function build(folder: string, files: string[], mtlxPath: string | null): Built {
  const rel = relative(root, folder).split(/[\\/]/);
  const top = rel[0]!;
  const category = CATEGORY_NAMES[top.toLowerCase()] ?? niceName(top);
  const name = niceName(mtlxPath && rel.length === 1 ? basename(mtlxPath, '.mtlx') : rel[rel.length - 1]!);
  const images = files.filter((f) => IMAGE.has(extname(f).toLowerCase()));
  const byBase = new Map(images.map((f) => [basename(f).toLowerCase(), f]));
  const mtlx = mtlxPath ? readMtlx(mtlxPath) : null;
  // MaterialX roles first (resolved by file name next to it), then file-name conventions for the rest.
  const maps: Partial<Record<TextureSlot, string>> = {};
  for (const [slot, file] of Object.entries(mtlx?.maps ?? {}) as [TextureSlot, string][]) {
    const found = byBase.get(file.toLowerCase());
    if (found) maps[slot] = found;
  }
  for (const [slot, file] of Object.entries(guessRoles(images)) as [TextureSlot, string][]) if (!maps[slot] && file) maps[slot] = file;

  const v = mtlx?.values ?? {};
  const cat = category.toLowerCase();
  const metal = cat === 'metals';
  const baseColor = color3(v.base_color) ?? (metal ? [0.8, 0.8, 0.82] : [0.8, 0.8, 0.8]);
  const layer = defaultLayer({
    baseColor: maps.baseColorMap ? [1, 1, 1, 1] : [clamp(baseColor[0]), clamp(baseColor[1]), clamp(baseColor[2]), 1],
    metallic: clamp(num(v.metalness, metal ? 1 : 0)),
    roughness: clamp(num(v.specular_roughness, metal ? 0.35 : cat === 'fabrics' ? 0.9 : 0.5)),
    clearCoat: clamp(num(v.coat, cat === 'composites' ? 1 : 0)),
    clearCoatRoughness: clamp(num(v.coat_roughness, 0.03)),
    useAnisotropic: /brushed|carbon|fiber/i.test(name),
  });
  // Every texture renamed to one scheme: <material>_<role>.<ext> (EXR converted to PNG).
  const textures: Built['textures'] = [];
  const slug = slugOf(name);
  for (const [slot, src] of Object.entries(maps) as [TextureSlot, string][]) {
    const ext = extname(src).toLowerCase();
    const isExr = ext === '.exr';
    const entry = `textures/${slug}_${ROLE_NAME[slot]}${isExr ? '.png' : ext === '.jpeg' ? '.jpg' : ext}`;
    textures.push({ entry, role: ROLE_NAME[slot], original: relative(root, src), ...(isExr ? { data: exrToPng(src) } : { from: src }) });
    layer.maps[slot] = entry;
  }

  const transmission = num(v.transmission, cat === 'glass' ? 1 : 0);
  const glass = transmission > 0.5;
  const paint = cat === 'paint';
  const def = defaultMaterial('pack', slug, {
    // Paint: the paint coat on layer 1 (the player's colours), the flake/normal set underneath.
    layers: paint ? [defaultLayer({ baseColor: [0.6, 0.05, 0.05, 1], metallic: 1, roughness: 0.3, clearCoat: 1, clearCoatRoughness: 0.03 }), layer] : [glass ? { ...layer, opacity: 0.2, metallic: 1, roughness: 0.02, pixelSpecular: true } : layer],
    paint,
    translucent: glass,
    blend: glass ? 'PreMulAlpha' : 'None',
    castShadows: !glass,
  });
  MaterialDefSchema.parse(def);
  const usedFiles = new Set(Object.values(maps));
  const unused = images.filter((f) => !usedFiles.has(f)).map((f) => basename(f));
  return { category, name, def, textures, source: relative(root, folder).split(sep).join('/'), unused };
}

const all = walk(root);
const folders = new Map<string, string[]>();
for (const f of all) {
  const d = dirname(f);
  const list = folders.get(d);
  if (list) list.push(f);
  else folders.set(d, [f]);
}
const built: Built[] = [];
for (const [folder, files] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
  const mtlxFiles = files.filter((f) => extname(f).toLowerCase() === '.mtlx');
  const images = files.filter((f) => IMAGE.has(extname(f).toLowerCase()));
  if (!images.length && mtlxFiles.length) {
    // A lone MaterialX (no textures): a parametric material, one per file.
    for (const m of mtlxFiles) built.push(build(folder, [], m));
  } else if (images.length) built.push(build(folder, files, mtlxFiles[0] ?? null));
}

// Output: the zip for the app, plus the same layout unpacked next to it for browsing.
mkdirSync(dirname(out), { recursive: true });
const folderOut = out.replace(/\.zip$/, '');
rmSync(folderOut, { recursive: true, force: true });
const zip = new ZipFile();
const put = (entry: string, data: Buffer | string) => {
  const buf = typeof data === 'string' ? readFileSync(data) : data;
  zip.addBuffer(buf, entry);
  mkdirSync(dirname(join(folderOut, entry)), { recursive: true });
  writeFileSync(join(folderOut, entry), buf);
};
const names = new Set<string>();
const index: string[] = [`# JBeam Forge materials ${version}`, '', `${built.length} materials. Import the zip from the Materials panel: Library → Import.`, '', 'Every material folder holds `material.json` and `textures/<material>_<role>.<ext>` (basecolor, normal, roughness, metallic, ao, opacity).', ''];
let lastCategory = '';
for (const b of [...built].sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name))) {
  let dir = `${b.category}/${b.name}`;
  for (let i = 2; names.has(dir.toLowerCase()); i++) dir = `${b.category}/${b.name} ${i}`;
  names.add(dir.toLowerCase());
  put(`${dir}/material.json`, Buffer.from(JSON.stringify({ version: 1, name: b.name, category: b.category, def: b.def }, null, 2)));
  for (const t of b.textures) put(`${dir}/${t.entry}`, t.data ?? t.from!);
  if (b.category !== lastCategory) {
    index.push(`## ${b.category}`, '', '| Material | Textures | Not used (no BeamNG slot) | From |', '|---|---|---|---|');
    lastCategory = b.category;
  }
  index.push(`| ${b.name} | ${b.textures.map((t) => t.role).join(', ') || 'values only (MaterialX)'} | ${b.unused.join(', ') || '—'} | ${b.source} |`);
  if (index.at(-1) && built.indexOf(b) === built.length - 1) index.push('');
  const slots = b.textures.map((t) => t.role).join(', ');
  console.log(`${b.category.padEnd(11)} ${b.name.padEnd(28)} ${b.textures.length} textures  [${slots || 'values only'}]`);
}
put('MATERIALS.md', Buffer.from(`${index.join('\n').replace(/\n## /g, '\n\n## ')}\n`));
zip.end();
await new Promise<void>((res, rej) => {
  const s = createWriteStream(out);
  s.on('close', () => res());
  s.on('error', rej);
  zip.outputStream.pipe(s);
});
console.log(`\n${built.length} materials → ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB), browsable copy in ${folderOut}`);
