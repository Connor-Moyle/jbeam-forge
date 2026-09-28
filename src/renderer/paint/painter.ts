import { CanvasTexture, NoColorSpace, SRGBColorSpace, type BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute } from 'three';
import { create } from 'zustand';
import { defaultLayer, LIVERY_SUFFIX, liveryLayerIndex, type MaterialDef } from '@shared/materials/schema';
import { presetByName } from '@shared/paints/paints';
import { DEFAULT_PATTERN, patternAt, rasterizeMesh, type Bounds, type PatternSpec, type Vec3 } from '@shared/paints/patterns';
import { pixelsPerMetre, surfaceFrame, type SurfaceFrame } from '@shared/paints/frame';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { provideTexture } from '@renderer/materials/runtime';
import { slotsOf } from '@renderer/materials/seed';
import { setTexture } from '@renderer/materials/commands';
import type { BrushHit } from '@renderer/panels/viewport/viewportRuntime';
import { addPaint, canvasPng, MASK_COLORS } from './commands';

/**
 * The paint studio: painting on the car in the viewport. Two things can be
 * painted on a paint material, both as textures the game uses as they are:
 *
 *  - the paint-slot mask (its colour palette map): where paint 1, 2 and 3
 *    go, so one body can carry three paints the player can still change;
 *  - a livery: any colours, on a layer of its own over the paint (see-through
 *    where nothing is painted).
 *
 * Tools: a soft brush and eraser, whole-panel fill, patterns worked out on
 * the car in 3D (stripes, fades, checks, camo: seamless across panels),
 * text and image stamps (numbers, logos), and an eyedropper. Mirror paints
 * both sides at once. Everything shows on the car straight away and is
 * saved as PNGs after each action; images can be exported to finish in an
 * image editor and brought back.
 */

const logger = rlog('paint');

export type PaintTarget = 'mask' | 'livery';
export type BrushTool = 'brush' | 'erase' | 'fill' | 'pattern' | 'stamp' | 'picker';
export type Rgb = [number, number, number];
export type Slot = 0 | 1 | 2;

export interface StampSettings {
  kind: 'text' | 'image';
  text: string;
  font: string;
  bold: boolean;
  italic: boolean;
  /** Text height / image width on the car, centimetres. */
  size: number;
  /** Degrees, anticlockwise as seen from outside. */
  rotation: number;
  /** Stamps come out upright and reading the right way on their own; these turn them over anyway. */
  flipX: boolean;
  flipY: boolean;
  /** Outline width, centimetres. */
  outline: number;
  outlineColor: Rgb;
  /** Picked image file (for image stamps). */
  image: string | null;
}

export const FONTS = ['Impact', 'Arial Black', 'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Trebuchet MS', 'Segoe UI', 'Consolas'] as const;

interface PainterState {
  on: boolean;
  /** The paint material being painted (picked from the mesh under the first stroke, or chosen). */
  materialId: string | null;
  target: PaintTarget;
  /** Paint slot the mask brush lays down. */
  slot: Slot;
  /** Livery brush colour, sRGB 0–1. */
  color: Rgb;
  /** Livery brush cycles through the rainbow as it goes. */
  rainbow: boolean;
  tool: BrushTool;
  /** Paint the other side of the car too. */
  mirror: boolean;
  /** Brush width on the car, centimetres. */
  size: number;
  hardness: number;
  strength: number;
  /** Size of new textures. */
  resolution: 1024 | 2048 | 4096;
  pattern: PatternSpec;
  /** Livery colours of a pattern's first, second and third colour. */
  patternColors: [Rgb, Rgb, Rgb];
  /** Paint slots of a pattern's colours on the mask. */
  patternSlots: [Slot, Slot, Slot];
  stamp: StampSettings;
  /** Most recent colours used, for quick picking. */
  recent: Rgb[];
  /** Bumped after every change to a picture (for previews). */
  rev: number;
  set: (patch: Partial<Omit<PainterState, 'set'>>) => void;
}

export const usePainter = create<PainterState>()((set) => ({
  on: false,
  materialId: null,
  target: 'mask',
  slot: 1,
  color: [0.1, 0.6, 1],
  rainbow: false,
  tool: 'brush',
  mirror: false,
  size: 8,
  hardness: 0.7,
  strength: 1,
  resolution: 2048,
  pattern: DEFAULT_PATTERN,
  patternColors: [
    [1, 1, 1],
    [0.05, 0.05, 0.05],
    [0.9, 0.1, 0.1],
  ],
  patternSlots: [1, 2, 0],
  stamp: { kind: 'text', text: '23', font: 'Impact', bold: false, italic: false, size: 30, rotation: 0, flipX: false, flipY: false, outline: 1.5, outlineColor: [0, 0, 0], image: null },
  recent: [],
  rev: 0,
  set: (patch) => set(patch),
}));

interface Surface {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  tex: CanvasTexture;
  path: string;
  /** Texture rows run bottom-up (DAE/FBX/OBJ UVs) or top-down (glTF). */
  flipY: boolean;
  undo: ImageData[];
  redo: ImageData[];
  saving: Promise<void> | null;
  dirty: boolean;
}

const surfaces = new Map<string, Surface>();
const loading = new Map<string, Promise<Surface | null>>();
const MAX_UNDO = 12;

const surfaceKey = (materialId: string, target: PaintTarget) => `${materialId}:${target}`;
const fileFor = (slug: string, materialId: string, target: PaintTarget) => `${slug}_${materialId.replace(/[^\w.-]+/g, '_')}_${target === 'livery' ? LIVERY_SUFFIX.slice(1) : 'paintmask.png'}`;
const status = (text: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info', ms?: number) => useUiStore.getState().pushStatus(text, tone, ms);

function doc() {
  return projectStore.getState().doc;
}

interface MeshInfo {
  key: string;
  geometry: BufferGeometry;
  flipY: boolean;
}

function meshInfo(key: string): MeshInfo | null {
  const sourceId = key.slice(0, key.indexOf(':'));
  const mesh = useSceneStore.getState().sources[sourceId]?.meshes.find((m) => m.key === key);
  if (!mesh) return null;
  const format = doc()?.sources.find((s) => s.id === sourceId)?.format;
  return { key, geometry: mesh.geometry, flipY: format !== 'gltf' && format !== 'glb' };
}

/** Every loaded mesh that wears a material. */
export function meshesOfMaterial(materialId: string): MeshInfo[] {
  const d = doc();
  if (!d) return [];
  const out: MeshInfo[] = [];
  for (const src of Object.values(useSceneStore.getState().sources)) {
    for (const m of src.meshes) {
      if (!(slotsOf(d, m.key) ?? []).includes(materialId)) continue;
      const info = meshInfo(m.key);
      if (info) out.push(info);
    }
  }
  return out;
}

/** The whole car's extent (BeamNG space), for patterns laid out along it. */
function carBounds(): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const hidden = useSceneStore.getState().hidden;
  for (const src of Object.values(useSceneStore.getState().sources)) {
    for (const m of src.meshes) {
      if (hidden[m.key]) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      if (!b || b.isEmpty()) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, b.min.getComponent(i));
        max[i] = Math.max(max[i]!, b.max.getComponent(i));
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : { min: [-1, -2, 0], max: [1, 2, 1.5] };
}

/** The paint material on a mesh (the chosen one if it's there, else its first). */
export function paintMaterialOf(meshKey: string): MaterialDef | null {
  const d = doc();
  if (!d) return null;
  const ids = slotsOf(d, meshKey) ?? [];
  const mats = ids.map((id) => d.materials.find((m) => m.id === id)).filter((m): m is MaterialDef => !!m && m.paint && !m.gameMaterial);
  const chosen = usePainter.getState().materialId;
  return mats.find((m) => m.id === chosen) ?? mats[0] ?? null;
}

async function loadImage(path: string): Promise<ImageBitmap | null> {
  try {
    const bytes = await call('import:readFile', { path });
    return await createImageBitmap(new Blob([bytes.slice()]));
  } catch (err) {
    logger.warn(`could not read ${path}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** The canvas for a material's mask or livery, starting from what it has now. */
async function surfaceFor(def: MaterialDef, target: PaintTarget, flipY: boolean): Promise<Surface | null> {
  const key = surfaceKey(def.id, target);
  const have = surfaces.get(key);
  if (have) return have;
  const pending = loading.get(key);
  if (pending) return pending;
  const job = (async () => {
    const d = doc();
    if (!d) return null;
    const existing = target === 'mask' ? def.layers[0]?.maps.colorPaletteMap : def.layers[liveryLayerIndex(def)]?.maps.baseColorMap;
    const image = existing && !existing.startsWith('/vehicles/') ? await loadImage(existing) : null;
    const size = image ? Math.max(image.width, image.height) : usePainter.getState().resolution;
    const canvas = document.createElement('canvas');
    canvas.width = image?.width ?? size;
    canvas.height = image?.height ?? size;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    if (image) g.drawImage(image, 0, 0);
    else if (target === 'mask') {
      g.fillStyle = MASK_COLORS[0]; // everything paint slot 1 to start with
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    const tex = new CanvasTexture(canvas);
    tex.flipY = flipY;
    tex.colorSpace = target === 'livery' ? SRGBColorSpace : NoColorSpace;
    const path = await call('materials:saveTexture', { name: fileFor(d.meta.slug, def.id, target), bytes: await canvasPng(canvas) });
    const surface: Surface = { canvas, g, tex, path, flipY, undo: [], redo: [], saving: null, dirty: false };
    surfaces.set(key, surface);
    provideTexture(path, tex);
    // Point the material at the painted file (once; later strokes just rewrite it).
    if (target === 'mask') {
      if (def.layers[0]?.maps.colorPaletteMap !== path) setTexture(def.id, 0, 'colorPaletteMap', path);
    } else if (liveryLayerIndex(def) < 0) {
      if (def.layers.length >= 4) {
        status('This material already has 4 layers; remove one to paint a livery on it.', 'warning');
        surfaces.delete(key);
        return null;
      }
      projectStore.getState().execute({
        label: 'Add livery layer',
        apply: (dd) => {
          const m = dd.materials.find((x) => x.id === def.id);
          if (m && m.layers.length < 4) m.layers.push(defaultLayer({ roughness: 0.3, clearCoat: 1, clearCoatRoughness: 0.04, maps: { baseColorMap: path } }));
        },
      });
    } else setTexture(def.id, liveryLayerIndex(def), 'baseColorMap', path);
    return surface;
  })().finally(() => loading.delete(key));
  loading.set(key, job);
  return job;
}

/** The surface of the chosen material and target, made if need be. */
async function currentSurface(): Promise<{ surface: Surface; def: MaterialDef } | null> {
  const p = usePainter.getState();
  const def = p.materialId ? doc()?.materials.find((m) => m.id === p.materialId) : undefined;
  if (!def) {
    status('Pick the paint material to work on first (or click it on the car).', 'warning');
    return null;
  }
  const flipY = meshesOfMaterial(def.id)[0]?.flipY ?? true;
  const surface = await surfaceFor(def, p.target, flipY);
  return surface ? { surface, def } : null;
}

async function save(s: Surface): Promise<void> {
  if (s.saving) {
    s.dirty = true;
    return;
  }
  s.dirty = false;
  const name = s.path.slice(Math.max(s.path.lastIndexOf('/'), s.path.lastIndexOf('\\')) + 1);
  s.saving = canvasPng(s.canvas)
    .then((bytes) => call('materials:saveTexture', { name, bytes }))
    .then(() => undefined)
    .catch((err: unknown) => {
      logger.error('saving a painted texture failed:', err instanceof Error ? err.message : String(err));
      status('Could not save the painting. Check the log.', 'danger');
    })
    .finally(() => {
      s.saving = null;
      if (s.dirty) void save(s);
    });
  await s.saving;
}

/** Remember the picture before a change (for undo); a new change forgets what was undone. */
function snapshot(s: Surface): void {
  s.undo.push(s.g.getImageData(0, 0, s.canvas.width, s.canvas.height));
  if (s.undo.length > MAX_UNDO) s.undo.shift();
  s.redo = [];
}

function changed(s: Surface): void {
  s.tex.needsUpdate = true;
  usePainter.setState((st) => ({ rev: st.rev + 1 }));
  void save(s);
}

const hueColor = (h: number): Rgb => {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};
const css = (c: readonly number[], a: number) => `rgba(${c.map((v) => Math.round(v * 255)).join(',')},${a})`; // token-lint-ignore: pixel colour for the painted texture
export const MASK_RGB: Rgb[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function rememberColor(c: Rgb): void {
  const p = usePainter.getState();
  const same = (a: Rgb) => a.every((v, i) => Math.abs(v - c[i]!) < 0.004);
  if (p.recent[0] && same(p.recent[0])) return;
  p.set({ recent: [c, ...p.recent.filter((x) => !same(x))].slice(0, 10) });
}

/** One painted track: the main stroke, or its mirror image on the other side. */
interface Track {
  surface: Surface | null;
  mesh: MeshInfo | null;
  last: [number, number] | null;
}

/** The active stroke. */
let stroke: { tracks: Track[]; hue: number } | null = null;
/** The button is down (a quick click can end before the canvas is ready). */
let pressed = false;

function toPixel(s: Surface, uv: [number, number]): [number, number] {
  const wrap = (x: number) => (x < 0 || x > 1 ? x - Math.floor(x) : x);
  return [wrap(uv[0]) * s.canvas.width, (s.flipY ? 1 - wrap(uv[1]) : wrap(uv[1])) * s.canvas.height];
}

function brushColor(): { rgb: Rgb; erase: boolean } {
  const p = usePainter.getState();
  if (p.target === 'mask') return { rgb: p.tool === 'erase' ? MASK_RGB[0]! : MASK_RGB[p.slot]!, erase: false };
  return { rgb: p.color, erase: p.tool === 'erase' };
}

function dab(s: Surface, x: number, y: number, hue: number, ppm: number): void {
  const p = usePainter.getState();
  const r = Math.max(1, (p.size / 200) * ppm);
  const { rgb, erase } = brushColor();
  const color = p.target === 'livery' && p.rainbow && !erase ? hueColor(hue) : rgb;
  const grad = s.g.createRadialGradient(x, y, r * Math.min(0.99, p.hardness), x, y, r);
  grad.addColorStop(0, css(color, p.strength));
  grad.addColorStop(1, css(color, 0));
  s.g.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  s.g.fillStyle = grad;
  s.g.beginPath();
  s.g.arc(x, y, r, 0, Math.PI * 2);
  s.g.fill();
  s.g.globalCompositeOperation = 'source-over';
}

/** A geometry attribute as a flat array (interleaved ones copied out). */
function flat(attr: BufferAttribute | InterleavedBufferAttribute, size: number): ArrayLike<number> {
  if (!('isInterleavedBufferAttribute' in attr) && attr.itemSize === size) return attr.array;
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.getComponent(i, k);
  return out;
}

/** Where a mesh triangle sits on a surface's image, and which way the car's up and right run there. */
function frameAt(s: Surface, mesh: MeshInfo, face: number): SurfaceFrame | null {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  if (!pos || !uv) return null;
  const ids = [0, 1, 2].map((k) => (g.index ? g.index.getX(face * 3 + k) : face * 3 + k));
  if (ids.some((i) => i >= pos.count)) return null;
  const p = ids.map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]) as [Vec3, Vec3, Vec3];
  // Raw UVs (not wrapped): only the differences between corners matter.
  const q = ids.map((i) => [uv.getX(i) * s.canvas.width, (s.flipY ? 1 - uv.getY(i) : uv.getY(i)) * s.canvas.height]) as [[number, number], [number, number], [number, number]];
  const nrm = g.getAttribute('normal');
  let n: Vec3;
  if (nrm) n = ids.reduce<Vec3>((acc, i) => [acc[0] + nrm.getX(i), acc[1] + nrm.getY(i), acc[2] + nrm.getZ(i)], [0, 0, 0]);
  else {
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  }
  return surfaceFrame(p, q, n);
}

/** Texture pixels per metre where there's no frame to go by (a car is about 4 m of texture). */
const fallbackPpm = (s: Surface) => s.canvas.width / 4;

/** Fill every triangle of a mesh in texture space (a whole panel in one click). */
function fillMesh(s: Surface, geometry: BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  const index = geometry.index;
  const count = index ? index.count : uv.count;
  const { rgb, erase } = brushColor();
  const p = usePainter.getState();
  s.g.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  s.g.fillStyle = css(rgb, p.strength);
  s.g.strokeStyle = css(rgb, p.strength);
  s.g.lineWidth = 2; // cover the seams between triangles
  s.g.beginPath();
  for (let t = 0; t + 2 < count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(t + k) : t + k;
      const [x, y] = toPixel(s, [uv.getX(i), uv.getY(i)]);
      if (k === 0) s.g.moveTo(x, y);
      else s.g.lineTo(x, y);
    }
    s.g.closePath();
  }
  s.g.fill();
  s.g.stroke();
  s.g.globalCompositeOperation = 'source-over';
}

/**
 * Lay the pattern over meshes, worked out point by point on the car. The
 * pattern's colours are livery colours, or paint slots on the mask.
 */
export function paintPattern(s: Surface, meshes: readonly MeshInfo[], bounds = carBounds()): number {
  const p = usePainter.getState();
  const colors = p.target === 'mask' ? p.patternSlots.map((k) => MASK_RGB[k]!) : p.patternColors;
  const { width: W, height: H } = s.canvas;
  const img = s.g.getImageData(0, 0, W, H);
  const d = img.data;
  const a = p.strength;
  let pixels = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const uv = m.geometry.getAttribute('uv');
    if (!pos || !uv) continue;
    pixels += rasterizeMesh({ positions: flat(pos, 3), uvs: flat(uv, 2), index: m.geometry.index ? m.geometry.index.array : null }, { width: W, height: H, flipY: s.flipY }, (x, y, at) => {
      const sample = patternAt(p.pattern, at, bounds);
      if (!sample) return;
      const ca = colors[sample.a]!;
      const cb = colors[sample.b]!;
      const i = (y * W + x) * 4;
      const dstA = d[i + 3]! / 255;
      const outA = a + dstA * (1 - a);
      for (let k = 0; k < 3; k++) {
        const c = (ca[k]! + (cb[k]! - ca[k]!) * sample.t) * 255;
        d[i + k] = outA > 0 ? (c * a + d[i + k]! * dstA * (1 - a)) / outA : c;
      }
      d[i + 3] = outA * 255;
    });
  }
  s.g.putImageData(img, 0, 0);
  return pixels;
}

let stampImage: { path: string; bitmap: ImageBitmap } | null = null;

/**
 * Text or an image stamped at a point of the texture, laid along the car's
 * surface there: upright, reading the right way from outside, and the size
 * asked for in centimetres, however the panel's UVs run.
 */
async function stampAt(s: Surface, x: number, y: number, frame: SurfaceFrame | null): Promise<void> {
  const p = usePainter.getState();
  const st = p.stamp;
  // Stamp space: 100 units = the stamp's size; +x is the car's right, +y down the car (canvas style).
  const UNITS = 100;
  const m = st.size / 100 / UNITS; // metres per unit
  const ppm = fallbackPpm(s);
  const right = frame?.right ?? [ppm, 0];
  const up = frame?.up ?? [0, -ppm];
  const g = s.g;
  g.save();
  g.setTransform(right[0] * m, right[1] * m, -up[0] * m, -up[1] * m, x, y);
  g.rotate((-st.rotation * Math.PI) / 180);
  g.scale(st.flipX ? -1 : 1, st.flipY ? -1 : 1);
  g.globalAlpha = p.strength;
  if (st.kind === 'text') {
    g.font = `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${UNITS}px "${st.font}"`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fill = p.target === 'mask' ? MASK_RGB[p.slot]! : p.color;
    if (st.outline > 0) {
      g.lineJoin = 'round';
      g.lineWidth = ((st.outline / 100) * 2) / m;
      g.strokeStyle = css(p.target === 'mask' ? MASK_RGB[(p.slot + 1) % 3]! : st.outlineColor, 1);
      g.strokeText(st.text, 0, 0);
    }
    g.fillStyle = css(fill, 1);
    g.fillText(st.text, 0, 0);
  } else if (st.image) {
    if (stampImage?.path !== st.image) {
      const bitmap = await loadImage(st.image);
      stampImage = bitmap ? { path: st.image, bitmap } : null;
    }
    if (stampImage) {
      const h = (UNITS * stampImage.bitmap.height) / stampImage.bitmap.width;
      g.drawImage(stampImage.bitmap, -UNITS / 2, -h / 2, UNITS, h);
    }
  }
  g.restore();
}

/** Eyedropper: the colour (or paint slot) under the brush. */
function pickAt(s: Surface, uv: [number, number]): void {
  const [x, y] = toPixel(s, uv);
  const px = s.g.getImageData(Math.min(s.canvas.width - 1, Math.floor(x)), Math.min(s.canvas.height - 1, Math.floor(y)), 1, 1).data;
  const p = usePainter.getState();
  if (p.target === 'mask') {
    const ch = [px[0]!, px[1]!, px[2]!];
    const slot = ch.indexOf(Math.max(...ch)) as Slot;
    p.set({ slot, tool: 'brush' });
    status(`Picked paint ${slot + 1}.`);
  } else if (px[3]! > 8) {
    const c: Rgb = [px[0]! / 255, px[1]! / 255, px[2]! / 255];
    p.set({ color: c, tool: 'brush' });
    rememberColor(c);
    status('Picked the livery colour.');
  } else status('Nothing painted there yet.');
}

async function trackSurface(hit: BrushHit): Promise<{ surface: Surface; mesh: MeshInfo } | null> {
  const def = paintMaterialOf(hit.meshKey);
  const mesh = meshInfo(hit.meshKey);
  if (!def || !mesh?.geometry.getAttribute('uv')) return null;
  const surface = await surfaceFor(def, usePainter.getState().target, mesh.flipY);
  return surface ? { surface, mesh } : null;
}

/** Viewport callback: the brush touching the car. */
export function onBrush(hit: BrushHit | null, phase: 'start' | 'move' | 'end'): void {
  if (phase === 'end') {
    pressed = false;
    if (stroke) for (const t of stroke.tracks) if (t.surface) changed(t.surface);
    stroke = null;
    return;
  }
  if (phase === 'start') {
    pressed = true;
    if (!hit) return;
    const def = paintMaterialOf(hit.meshKey);
    if (!def) {
      status('That mesh has no paint material. Tick "Car paint" on its material in the Materials panel first.', 'warning', 6000);
      return;
    }
    const mesh = meshInfo(hit.meshKey);
    if (!mesh?.geometry.getAttribute('uv')) {
      status('That mesh has no texture coordinates (UVs), so it can’t be painted. Give it UVs in your modelling program.', 'warning', 6000);
      return;
    }
    usePainter.getState().set({ materialId: def.id });
    void startAction(hit);
    return;
  }
  if (!stroke) return;
  paintTrack(stroke.tracks[0], hit);
  if (stroke.tracks[1]) paintTrack(stroke.tracks[1], hit?.mirror ?? null);
}

/** What a click or the start of a drag does, per tool (on both sides with mirror on). */
async function startAction(hit: BrushHit): Promise<void> {
  const p = usePainter.getState();
  const hits = [hit, ...(p.mirror && hit.mirror ? [hit.mirror] : [])];
  const targets = (await Promise.all(hits.map(trackSurface))).map((t, i) => (t ? { ...t, hit: hits[i]! } : null));
  const main = targets[0];
  if (!main) return;
  // Each surface touched is snapshotted once, even when both sides share it.
  const touched = [...new Set(targets.flatMap((t) => (t ? [t.surface] : [])))];
  if (p.tool === 'picker') {
    if (main.hit.uv) pickAt(main.surface, main.hit.uv);
    return;
  }
  for (const s of touched) snapshot(s);
  if (p.tool === 'fill') {
    for (const t of targets) if (t) fillMesh(t.surface, t.mesh.geometry);
    if (p.target === 'livery') rememberColor(p.color);
    touched.forEach(changed);
    return;
  }
  if (p.tool === 'pattern') {
    const bounds = carBounds();
    const done = new Set<string>();
    for (const t of targets) {
      if (!t || done.has(t.mesh.key)) continue;
      done.add(t.mesh.key);
      paintPattern(t.surface, [t.mesh], bounds);
    }
    touched.forEach(changed);
    return;
  }
  if (p.tool === 'stamp') {
    for (const t of targets) if (t?.hit.uv) await stampAt(t.surface, ...toPixel(t.surface, t.hit.uv), frameAt(t.surface, t.mesh, t.hit.face));
    touched.forEach(changed);
    return;
  }
  if (p.target === 'livery' && p.tool === 'brush' && !p.rainbow) rememberColor(p.color);
  stroke = { tracks: targets.map((t) => ({ surface: t?.surface ?? null, mesh: t?.mesh ?? null, last: null })), hue: Math.random() };
  for (const [i, t] of targets.entries()) if (t) paintTrack(stroke.tracks[i], t.hit);
  if (!pressed) onBrush(null, 'end'); // released while the canvas was being set up
}

function paintTrack(track: Track | undefined, hit: BrushHit | null): void {
  if (!stroke || !track?.surface) return;
  if (!hit?.uv || !track.mesh || hit.meshKey !== track.mesh.key) {
    track.last = null; // left the panel: don't draw a line across the texture
    return;
  }
  const s = track.surface;
  const [x, y] = toPixel(s, hit.uv);
  const frame = frameAt(s, track.mesh, hit.face);
  const ppm = frame ? pixelsPerMetre(frame) : fallbackPpm(s);
  const r = Math.max(1, (usePainter.getState().size / 200) * ppm);
  const last = track.last;
  // Fill the gap from the last dab, unless the pointer jumped across a UV seam.
  if (last && Math.hypot(x - last[0], y - last[1]) < s.canvas.width * 0.15) {
    const steps = Math.ceil(Math.hypot(x - last[0], y - last[1]) / Math.max(1, r * 0.35));
    for (let i = 1; i <= steps; i++) {
      stroke.hue = (stroke.hue + 0.004) % 1;
      dab(s, last[0] + ((x - last[0]) * i) / steps, last[1] + ((y - last[1]) * i) / steps, stroke.hue, ppm);
    }
  } else dab(s, x, y, stroke.hue, ppm);
  track.last = [x, y];
  s.tex.needsUpdate = true;
}

function chosenSurface(): Surface | undefined {
  const p = usePainter.getState();
  return p.materialId ? surfaces.get(surfaceKey(p.materialId, p.target)) : undefined;
}

/** Undo the last change on the material and target being painted. */
export function undoStroke(): void {
  const s = chosenSurface();
  const img = s?.undo.pop();
  if (!s || !img) return;
  s.redo.push(s.g.getImageData(0, 0, s.canvas.width, s.canvas.height));
  s.g.putImageData(img, 0, 0);
  changed(s);
}

export function redoStroke(): void {
  const s = chosenSurface();
  const img = s?.redo.pop();
  if (!s || !img) return;
  s.undo.push(s.g.getImageData(0, 0, s.canvas.width, s.canvas.height));
  s.g.putImageData(img, 0, 0);
  changed(s);
}

/** Start from scratch: the whole mask back to paint slot 1, or the livery cleared. */
export async function clearSurface(): Promise<void> {
  const cur = await currentSurface();
  if (!cur) return;
  const s = cur.surface;
  snapshot(s);
  if (usePainter.getState().target === 'mask') {
    s.g.fillStyle = MASK_COLORS[0];
    s.g.fillRect(0, 0, s.canvas.width, s.canvas.height);
  } else s.g.clearRect(0, 0, s.canvas.width, s.canvas.height);
  changed(s);
}

/** The pattern over every mesh wearing the chosen material. */
export async function patternWholeMaterial(): Promise<void> {
  const cur = await currentSurface();
  if (!cur) return;
  const meshes = meshesOfMaterial(cur.def.id).filter((m) => m.geometry.getAttribute('uv'));
  if (!meshes.length) return status('No mesh wearing this material has UVs to paint on.', 'warning');
  snapshot(cur.surface);
  const pixels = paintPattern(cur.surface, meshes);
  changed(cur.surface);
  status(`Pattern laid over ${meshes.length} mesh${meshes.length === 1 ? '' : 'es'} (${Math.round(pixels / 1000)}k pixels).`, 'success');
}

/** Bring in an image (made in an image editor, e.g. over the UV template) as the whole mask or livery. */
export async function importImage(): Promise<void> {
  const cur = await currentSurface();
  if (!cur) return;
  const path = await call('materials:pickTexture');
  if (!path) return;
  const img = await loadImage(path);
  if (!img) return status('Could not read that image. PNG, JPG, BMP and WebP work.', 'warning');
  const s = cur.surface;
  snapshot(s);
  s.g.clearRect(0, 0, s.canvas.width, s.canvas.height);
  s.g.drawImage(img, 0, 0, s.canvas.width, s.canvas.height);
  changed(s);
  status('Image brought in.', 'success');
}

/** Save the mask or livery as a PNG somewhere, to work on in an image editor. */
export async function exportImage(): Promise<void> {
  const cur = await currentSurface();
  if (!cur) return;
  const p = usePainter.getState();
  const path = await call('paint:saveImage', { suggestedName: `${cur.def.name}_${p.target === 'mask' ? 'paint_slots' : 'livery'}.png`, bytes: await canvasPng(cur.surface.canvas) });
  if (path) status(`Saved ${path}`, 'success');
}

/**
 * A picture of the material's UV layout (every triangle's outline over the
 * current painting, faded) to paint over in an image editor.
 */
export async function exportUvTemplate(): Promise<void> {
  const cur = await currentSurface();
  if (!cur) return;
  const s = cur.surface;
  const c = document.createElement('canvas');
  c.width = s.canvas.width;
  c.height = s.canvas.height;
  const g = c.getContext('2d')!;
  g.globalAlpha = 0.35;
  g.drawImage(s.canvas, 0, 0);
  g.globalAlpha = 1;
  g.strokeStyle = css([0, 0, 0], 0.85);
  g.lineWidth = Math.max(1, c.width / 2048);
  g.beginPath();
  for (const m of meshesOfMaterial(cur.def.id)) {
    const uv = m.geometry.getAttribute('uv');
    if (!uv) continue;
    const index = m.geometry.index;
    const count = index ? index.count : uv.count;
    for (let t = 0; t + 2 < count; t += 3) {
      for (let k = 0; k <= 3; k++) {
        const i = index ? index.getX(t + (k % 3)) : t + (k % 3);
        const [x, y] = toPixel(s, [uv.getX(i), uv.getY(i)]);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
  }
  g.stroke();
  const path = await call('paint:saveImage', { suggestedName: `${cur.def.name}_uv_template.png`, bytes: await canvasPng(c) });
  if (path) status(`Saved the UV template: ${path}`, 'success');
}

/** Choose an image for the image stamp. */
export async function pickStampImage(): Promise<void> {
  const path = await call('materials:pickTexture');
  if (!path) return;
  const p = usePainter.getState();
  p.set({ stamp: { ...p.stamp, kind: 'image', image: path }, tool: 'stamp' });
}

/** A small preview of the mask or livery (data URL), or null before anything is painted. */
export function surfacePreview(materialId: string, target: PaintTarget, size = 160): string | null {
  const s = surfaces.get(surfaceKey(materialId, target));
  if (!s) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')?.drawImage(s.canvas, 0, 0, size, size);
  return c.toDataURL('image/png');
}

/** Turn the painter on or off. Paint needs paints to show: three are added if there are none. */
export function setPainterOn(on: boolean): void {
  if (on && !doc()?.paints.list.length) {
    for (const name of ['Arctic White', 'Signal Red', 'Jet Black']) addPaint(presetByName(name)!);
    status('Added three paints to paint with; change them in the Paints panel.', 'info', 6000);
  }
  usePainter.getState().set({ on });
}

/** Forget cached canvases (a different project was opened). */
export function resetPainter(): void {
  surfaces.clear();
  stroke = null;
  stampImage = null;
  usePainter.getState().set({ on: false, materialId: null });
}

