import { CanvasTexture, NoColorSpace, SRGBColorSpace, type BufferGeometry } from 'three';
import { create } from 'zustand';
import { defaultLayer, LIVERY_SUFFIX, liveryLayerIndex, type MaterialDef } from '@shared/materials/schema';
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
import { presetByName } from '@shared/paints/paints';

/**
 * Painting on the car in the viewport. Two things can be painted on a paint
 * material, both as textures the game uses as they are:
 *
 *  - the paint-slot mask (its colour palette map): where paint 1, 2 and 3
 *    go, so one body can carry three paints (two-tone roofs, stripes…);
 *  - a livery: any colours, on a layer of its own over the paint (see-through
 *    where nothing is painted).
 *
 * Strokes are drawn in texture space at the point under the brush, show on
 * the car straight away, and are saved as PNGs when each stroke ends.
 */

const logger = rlog('paint');

export type PaintTarget = 'mask' | 'livery';
export type BrushTool = 'brush' | 'erase' | 'fill';

interface PainterState {
  on: boolean;
  /** The paint material being painted (picked from the mesh under the first stroke). */
  materialId: string | null;
  target: PaintTarget;
  /** Paint slot the mask brush lays down. */
  slot: 0 | 1 | 2;
  /** Livery colour, sRGB 0–1. */
  color: [number, number, number];
  /** Livery brush cycles through the rainbow as it goes. */
  rainbow: boolean;
  tool: BrushTool;
  /** Brush radius in texture pixels (of a 2048 texture; scaled to the real size). */
  size: number;
  hardness: number;
  strength: number;
  /** Size of new textures. */
  resolution: 1024 | 2048 | 4096;
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
  size: 24,
  hardness: 0.7,
  strength: 1,
  resolution: 2048,
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
  saving: Promise<void> | null;
  dirty: boolean;
}

const surfaces = new Map<string, Surface>();
const loading = new Map<string, Promise<Surface | null>>();
const MAX_UNDO = 6;

const surfaceKey = (materialId: string, target: PaintTarget) => `${materialId}:${target}`;
const fileFor = (slug: string, materialId: string, target: PaintTarget) => `${slug}_${materialId.replace(/[^\w.-]+/g, '_')}_${target === 'livery' ? LIVERY_SUFFIX.slice(1) : 'paintmask.png'}`;

function doc() {
  return projectStore.getState().doc;
}

function meshGeometry(key: string): { geometry: BufferGeometry; flipY: boolean } | null {
  const sourceId = key.slice(0, key.indexOf(':'));
  const mesh = useSceneStore.getState().sources[sourceId]?.meshes.find((m) => m.key === key);
  if (!mesh) return null;
  const format = doc()?.sources.find((s) => s.id === sourceId)?.format;
  return { geometry: mesh.geometry, flipY: format !== 'gltf' && format !== 'glb' };
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
    logger.warn(`could not start from ${path}:`, err instanceof Error ? err.message : String(err));
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
    const surface: Surface = { canvas, g, tex, path, flipY, undo: [], saving: null, dirty: false };
    surfaces.set(key, surface);
    provideTexture(path, tex);
    // Point the material at the painted file (once; later strokes just rewrite it).
    if (target === 'mask') {
      if (def.layers[0]?.maps.colorPaletteMap !== path) setTexture(def.id, 0, 'colorPaletteMap', path);
    } else if (liveryLayerIndex(def) < 0) {
      if (def.layers.length >= 4) {
        useUiStore.getState().pushStatus('This material already has 4 layers; remove one to paint a livery on it.', 'warning');
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
      useUiStore.getState().pushStatus('Could not save the painting. Check the log.', 'danger');
    })
    .finally(() => {
      s.saving = null;
      if (s.dirty) void save(s);
    });
  await s.saving;
}

const hueColor = (h: number): [number, number, number] => {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};
const css = (c: readonly number[], a: number) => `rgba(${c.map((v) => Math.round(v * 255)).join(',')},${a})`; // token-lint-ignore: pixel colour for the painted texture
const MASK_RGB: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** The active stroke. */
let stroke: { surface: Surface; meshKey: string; last: [number, number] | null; hue: number } | null = null;
/** The button is down (a quick click can end before the canvas is ready). */
let pressed = false;

function toPixel(s: Surface, uv: [number, number]): [number, number] {
  const u = uv[0] - Math.floor(uv[0]);
  const v = uv[1] - Math.floor(uv[1]);
  return [u * s.canvas.width, (s.flipY ? 1 - v : v) * s.canvas.height];
}

function brushColor(): { rgb: [number, number, number]; erase: boolean } {
  const p = usePainter.getState();
  if (p.target === 'mask') return { rgb: p.tool === 'erase' ? MASK_RGB[0]! : MASK_RGB[p.slot]!, erase: false };
  return { rgb: p.color, erase: p.tool === 'erase' };
}

function dab(s: Surface, x: number, y: number, hue: number): void {
  const p = usePainter.getState();
  const r = Math.max(1, (p.size * s.canvas.width) / 2048);
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

/** Viewport callback: the brush touching the car. */
export function onBrush(hit: BrushHit | null, phase: 'start' | 'move' | 'end'): void {
  if (phase === 'end') {
    pressed = false;
    if (stroke) {
      stroke.surface.tex.needsUpdate = true;
      void save(stroke.surface);
    }
    stroke = null;
    return;
  }
  if (phase === 'start') {
    pressed = true;
    if (!hit) return;
    const def = paintMaterialOf(hit.meshKey);
    if (!def) {
      useUiStore.getState().pushStatus('That mesh has no paint material. Tick "Car paint" on its material in the Materials panel first.', 'warning', 6000);
      return;
    }
    const mesh = meshGeometry(hit.meshKey);
    if (!mesh?.geometry.getAttribute('uv')) {
      useUiStore.getState().pushStatus('That mesh has no texture coordinates (UVs), so it can’t be painted. Give it UVs in your modelling program.', 'warning', 6000);
      return;
    }
    usePainter.getState().set({ materialId: def.id });
    const target = usePainter.getState().target;
    void surfaceFor(def, target, mesh.flipY).then((surface) => {
      if (!surface) return;
      surface.undo.push(surface.g.getImageData(0, 0, surface.canvas.width, surface.canvas.height));
      if (surface.undo.length > MAX_UNDO) surface.undo.shift();
      if (usePainter.getState().tool === 'fill') {
        fillMesh(surface, mesh.geometry);
        surface.tex.needsUpdate = true;
        void save(surface);
        return;
      }
      stroke = { surface, meshKey: hit.meshKey, last: null, hue: Math.random() };
      if (hit.uv) paintAt(hit.uv);
      if (!pressed) onBrush(null, 'end'); // released while the canvas was being set up
    });
    return;
  }
  if (stroke && hit?.uv && hit.meshKey === stroke.meshKey) paintAt(hit.uv);
  else if (stroke) stroke.last = null; // left the panel: don't draw a line across the texture
}

function paintAt(uv: [number, number]): void {
  if (!stroke) return;
  const s = stroke.surface;
  const [x, y] = toPixel(s, uv);
  const r = Math.max(1, (usePainter.getState().size * s.canvas.width) / 2048);
  const last = stroke.last;
  // Fill the gap from the last dab, unless the pointer jumped across a UV seam.
  if (last && Math.hypot(x - last[0], y - last[1]) < s.canvas.width * 0.15) {
    const steps = Math.ceil(Math.hypot(x - last[0], y - last[1]) / Math.max(1, r * 0.35));
    for (let i = 1; i <= steps; i++) {
      stroke.hue = (stroke.hue + 0.004) % 1;
      dab(s, last[0] + ((x - last[0]) * i) / steps, last[1] + ((y - last[1]) * i) / steps, stroke.hue);
    }
  } else dab(s, x, y, stroke.hue);
  stroke.last = [x, y];
  s.tex.needsUpdate = true;
}

/** Undo the last stroke on the material being painted. */
export function undoStroke(): void {
  const p = usePainter.getState();
  const s = p.materialId ? surfaces.get(surfaceKey(p.materialId, p.target)) : undefined;
  const img = s?.undo.pop();
  if (!s || !img) return;
  s.g.putImageData(img, 0, 0);
  s.tex.needsUpdate = true;
  void save(s);
}

/** Start from scratch: the whole mask back to paint slot 1, or the livery cleared. */
export async function clearSurface(): Promise<void> {
  const p = usePainter.getState();
  const def = p.materialId ? doc()?.materials.find((m) => m.id === p.materialId) : undefined;
  if (!def) return;
  const s = await surfaceFor(def, p.target, true);
  if (!s) return;
  s.undo.push(s.g.getImageData(0, 0, s.canvas.width, s.canvas.height));
  if (p.target === 'mask') {
    s.g.fillStyle = MASK_COLORS[0];
    s.g.fillRect(0, 0, s.canvas.width, s.canvas.height);
  } else s.g.clearRect(0, 0, s.canvas.width, s.canvas.height);
  s.tex.needsUpdate = true;
  await save(s);
}

/** Turn the painter on or off. Paint needs paints to show: three are added if there are none. */
export function setPainterOn(on: boolean): void {
  if (on && !doc()?.paints.list.length) {
    for (const name of ['Arctic White', 'Signal Red', 'Jet Black']) addPaint(presetByName(name)!);
    useUiStore.getState().pushStatus('Added three paints to paint with; change them in the Paints panel.', 'info', 6000);
  }
  usePainter.getState().set({ on });
}

/** Forget cached canvases (a different project was opened). */
export function resetPainter(): void {
  surfaces.clear();
  stroke = null;
  usePainter.getState().set({ on: false, materialId: null });
}
