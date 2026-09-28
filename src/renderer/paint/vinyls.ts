import { create } from 'zustand';
import type { Draft } from 'immer';
import type { VinylLayer, VinylSet } from '@shared/project/schema';
import { shapeById } from '@shared/paints/shapes';
import { VINYL_GROUPS } from '@shared/paints/vinylLibrary';
import { composeVinyls, layerAt, newLayer, placement, planeCoords, sideFacing, SIDE_FRAMES, viewCentre, type LayerLook, type Side, type Texels } from '@shared/paints/vinyl';
import { rasterizeMesh, type Vec3 } from '@shared/paints/patterns';
import { VinylLayerSchema } from '@shared/project/schema';
import { projectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import type { BrushHit } from '@renderer/panels/viewport/viewportRuntime';
import { carBounds, ensureSurface, flat, loadImage, MASK_RGB, meshesOfMaterial, present, save, setPainterOn, surfaceOf, usePainter, type PaintTarget, type Surface } from './painter';
import { z } from 'zod';

/**
 * The vinyl editor: layers of shapes, text and images on a material's livery
 * or paint-slot mask, kept in the project (so every change can be undone and
 * a layer can be moved, resized or recoloured any time later), rendered over
 * the freehand painting whenever they change.
 */

const logger = rlog('vinyl');
const status = (text: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info') => useUiStore.getState().pushStatus(text, tone);

// ---- editor state ----

interface VinylUi {
  /** Selected layer ids (on the material and target being painted). */
  selected: string[];
  /** A layer is being dragged on the car (renders at preview quality meanwhile). */
  dragging: boolean;
  /** Side the editor is looking at: new layers go there. */
  side: Side;
  /** Keep width and height in proportion when resizing. */
  lockAspect: boolean;
  /** A side-view camera move for the viewport (seq changes each time). */
  view: { side: Side; seq: number } | null;
  select: (ids: string[]) => void;
  set: (patch: Partial<Omit<VinylUi, 'select' | 'set'>>) => void;
}

export const useVinylUi = create<VinylUi>()((set) => ({
  selected: [],
  dragging: false,
  side: 'left',
  lockAspect: true,
  view: null,
  select: (selected) => set({ selected }),
  set: (patch) => set(patch),
}));

/** Look at the car from a side (and put new layers there). */
export function viewSide(side: Side): void {
  const ui = useVinylUi.getState();
  ui.set({ side, view: { side, seq: (ui.view?.seq ?? 0) + 1 } });
}

// ---- the set being edited ----

function current(): { materialId: string; target: PaintTarget } | null {
  const p = usePainter.getState();
  return p.materialId ? { materialId: p.materialId, target: p.target } : null;
}

export function currentSet(): VinylSet | undefined {
  const c = current();
  const doc = projectStore.getState().doc;
  return c ? doc?.vinyls.find((v) => v.materialId === c.materialId && v.target === c.target) : undefined;
}

/** Change the edited set (made if need be) as one undoable step. */
function edit(label: string, fn: (set: Draft<VinylSet>) => void, coalesce?: string): boolean {
  const c = current();
  if (!c) {
    status('Choose the paint material to put vinyls on first (or click it on the car with the brush).', 'warning');
    return false;
  }
  projectStore.getState().execute({
    label,
    ...(coalesce ? { coalesce } : {}),
    apply: (d) => {
      let set = d.vinyls.find((v) => v.materialId === c.materialId && v.target === c.target);
      if (!set) {
        d.vinyls.push({ materialId: c.materialId, target: c.target, layers: [], groups: [] });
        set = d.vinyls[d.vinyls.length - 1]!;
      }
      fn(set);
    },
  });
  return true;
}

const uid = () => `vl_${crypto.randomUUID().slice(0, 8)}`;

function uniqueName(base: string): string {
  const taken = new Set((currentSet()?.layers ?? []).map((l) => l.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** Text's width for a height (so letters aren't squashed): measured in the font. */
export function textAspect(l: Pick<VinylLayer, 'text' | 'font' | 'bold' | 'italic'>): number {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return Math.max(1, l.text.length * 0.6);
  c.font = `${l.italic ? 'italic ' : ''}${l.bold ? 'bold ' : ''}100px "${l.font}"`; // token-lint-ignore: canvas font for measuring text, not UI
  return Math.max(0.2, c.measureText(l.text || ' ').width / 100);
}

// ---- layer commands ----

export function addLayers(layers: Partial<VinylLayer>[], label = 'Add vinyl', group?: string): string[] {
  const ui = useVinylUi.getState();
  const gid = group ? `vg_${crypto.randomUUID().slice(0, 8)}` : null;
  // New layers take the studio's current colour (or paint slot); ready-made designs bring their own.
  const p = usePainter.getState();
  const made = layers.map((over) => newLayer(uid(), { side: ui.side, color: p.color, slot: p.slot, ...over, groupId: gid ?? over.groupId ?? null }));
  for (const l of made) l.name = uniqueName(l.name);
  const ok = edit(label, (set) => {
    set.layers.push(...made);
    if (gid) set.groups.push({ id: gid, name: group! });
  });
  if (!ok) return [];
  ui.select(made.map((l) => l.id));
  usePainter.getState().set({ tool: 'vinyl' });
  return made.map((l) => l.id);
}

export function addShape(shapeId: string): void {
  addLayers([{ name: shapeById(shapeId).name, kind: 'shape', shape: shapeId }]);
}

export function addText(text = 'TEXT'): void {
  const base = { text, font: 'Impact', bold: false, italic: false };
  const h = 0.25;
  addLayers([{ name: `Text "${text}"`, kind: 'text', ...base, h, w: h * textAspect(base) }]);
}

export async function addImage(): Promise<void> {
  const path = await call('materials:pickTexture');
  if (!path) return;
  const bmp = await loadImage(path);
  const ratio = bmp ? bmp.width / Math.max(1, bmp.height) : 1;
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).replace(/\.[^.]+$/, '');
  addLayers([{ name, kind: 'image', image: path, w: 0.5 * Math.min(2, ratio), h: 0.5 / Math.max(0.5, ratio) }]);
}

export function addLibraryGroup(name: string): void {
  const g = VINYL_GROUPS.find((x) => x.name === name);
  if (!g) return;
  const layers = g.layers.map((l) => (l.kind === 'text' && !l.w ? { ...l, w: (l.h ?? 0.25) * textAspect({ text: l.text ?? '', font: l.font ?? 'Impact', bold: !!l.bold, italic: !!l.italic }) } : l));
  addLayers(layers, `Add ${g.name}`, g.name);
}

/** Change layers; a drag or slider's run of changes is one undo step (`coalesce`). */
export function updateLayers(ids: readonly string[], patch: Partial<VinylLayer> | ((l: Draft<VinylLayer>) => void), coalesce?: string): void {
  if (!ids.length) return;
  edit(
    'Edit vinyl',
    (set) => {
      for (const l of set.layers) {
        if (!ids.includes(l.id)) continue;
        if (typeof patch === 'function') patch(l);
        else Object.assign(l, patch);
      }
    },
    coalesce ?? `vinyl:${ids.join(',')}:${typeof patch === 'function' ? 'fn' : Object.keys(patch).join(',')}`,
  );
}

export function deleteLayers(ids: readonly string[]): void {
  edit('Delete vinyl', (set) => {
    set.layers = set.layers.filter((l) => !ids.includes(l.id));
    set.groups = set.groups.filter((g) => set.layers.some((l) => l.groupId === g.id));
  });
  useVinylUi.getState().select([]);
}

export function duplicateLayers(ids: readonly string[]): void {
  const set = currentSet();
  if (!set) return;
  const copies = set.layers.filter((l) => ids.includes(l.id)).map((l) => ({ ...structuredClone(l), id: uid(), name: `${l.name} copy`, x: l.x + 0.08, y: l.y - 0.05 }));
  edit('Duplicate vinyl', (s) => void s.layers.push(...copies));
  useVinylUi.getState().select(copies.map((c) => c.id));
}

/** Move layers up or down the stack ('up' = towards the top). */
export function reorder(ids: readonly string[], dir: 'up' | 'down' | 'top' | 'bottom'): void {
  edit('Reorder vinyls', (set) => {
    const moving = set.layers.filter((l) => ids.includes(l.id));
    const rest = set.layers.filter((l) => !ids.includes(l.id));
    if (dir === 'top') set.layers = [...rest, ...moving];
    else if (dir === 'bottom') set.layers = [...moving, ...rest];
    else {
      const order = [...set.layers];
      const idx = order.map((l, i) => (ids.includes(l.id) ? i : -1)).filter((i) => i >= 0);
      if (dir === 'up') for (const i of idx.reverse()) if (i < order.length - 1 && !ids.includes(order[i + 1]!.id)) [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
      if (dir === 'down') for (const i of idx) if (i > 0 && !ids.includes(order[i - 1]!.id)) [order[i], order[i - 1]] = [order[i - 1]!, order[i]!];
      set.layers = order;
    }
  });
}

/** Move one layer to a position in the stack (drag and drop in the list). */
export function moveLayerTo(id: string, index: number): void {
  edit('Reorder vinyls', (set) => {
    const from = set.layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [l] = set.layers.splice(from, 1);
    set.layers.splice(Math.max(0, Math.min(set.layers.length, index)), 0, l!);
  });
}

export function groupLayers(ids: readonly string[], name = 'Group'): void {
  if (ids.length < 2) return;
  const gid = `vg_${crypto.randomUUID().slice(0, 8)}`;
  edit('Group vinyls', (set) => {
    set.groups.push({ id: gid, name: uniqueGroupName(set, name) });
    // A group's layers sit together in the stack, where its top layer was.
    const members = set.layers.filter((l) => ids.includes(l.id));
    for (const l of members) l.groupId = gid;
    const top = Math.max(...set.layers.map((l, i) => (ids.includes(l.id) ? i : -1)));
    const rest = set.layers.filter((l) => !ids.includes(l.id));
    const at = rest.filter((_, i) => i < top - members.length + 1).length;
    set.layers = [...rest.slice(0, at), ...members, ...rest.slice(at)];
  });
}

function uniqueGroupName(set: Draft<VinylSet>, base: string): string {
  const taken = new Set(set.groups.map((g) => g.name));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  return name;
}

export function ungroupLayers(ids: readonly string[]): void {
  edit('Ungroup vinyls', (set) => {
    for (const l of set.layers) if (ids.includes(l.id)) l.groupId = null;
    set.groups = set.groups.filter((g) => set.layers.some((l) => l.groupId === g.id));
  });
}

export function renameGroup(id: string, name: string): void {
  edit('Rename vinyl group', (set) => {
    const g = set.groups.find((x) => x.id === id);
    if (g) g.name = name;
  });
}

/** A mirrored copy of layers on the other side of the car (a separate layer you can change on its own). */
export function mirrorCopy(ids: readonly string[]): void {
  const set = currentSet();
  if (!set) return;
  const src = set.layers.filter((l) => ids.includes(l.id));
  const copies = src.map((l) => {
    const keep = l.readable && (l.kind === 'text' || l.kind === 'image');
    const side: Side = l.side === 'left' ? 'right' : l.side === 'right' ? 'left' : l.side;
    return { ...structuredClone(l), id: uid(), name: `${l.name} (mirror)`, side, x: -l.x, rotation: -l.rotation, skew: -l.skew, flipX: keep ? l.flipX : !l.flipX, mirror: false };
  });
  edit('Mirror vinyl copy', (s) => void s.layers.push(...copies));
  useVinylUi.getState().select(copies.map((c) => c.id));
}

/** The selected layers' bounding box in their side's view (layers on another side are left out). */
function selectionBox(layers: readonly VinylLayer[]): { minH: number; maxH: number; minV: number; maxV: number; side: Side } | null {
  if (!layers.length) return null;
  const side = layers[0]!.side;
  const boxes = layers.filter((l) => l.side === side).map((l) => placement(l).box);
  return { side, minH: Math.min(...boxes.map((b) => b.minH)), maxH: Math.max(...boxes.map((b) => b.maxH)), minV: Math.min(...boxes.map((b) => b.minV)), maxV: Math.max(...boxes.map((b) => b.maxV)) };
}

/**
 * Move, scale and turn the selected layers together, about the middle of
 * the selection (a group moves as one). Positions are relative to `from`,
 * the layers as they were when the gesture started.
 */
export function transformLayers(from: readonly VinylLayer[], t: { dx?: number; dy?: number; scale?: number; rotate?: number }, coalesce: string): void {
  const box = selectionBox(from);
  if (!box) return;
  const cx = (box.minH + box.maxH) / 2;
  const cy = (box.minV + box.maxV) / 2;
  const k = t.scale ?? 1;
  const r = ((t.rotate ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const byId = new Map(from.map((l) => [l.id, l]));
  updateLayers(
    from.map((l) => l.id),
    (l) => {
      const o = byId.get(l.id);
      if (!o || o.locked) return;
      const ox = (o.x - cx) * k;
      const oy = (o.y - cy) * k;
      l.x = cx + (t.dx ?? 0) + ox * c - oy * s;
      l.y = cy + (t.dy ?? 0) + ox * s + oy * c;
      l.w = Math.max(0.005, o.w * k);
      l.h = Math.max(0.005, o.h * k);
      l.rotation = o.rotation + (t.rotate ?? 0);
    },
    coalesce,
  );
}

/** Line the selected layers up (in their side's view). */
export function alignLayers(ids: readonly string[], how: 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'): void {
  const layers = (currentSet()?.layers ?? []).filter((l) => ids.includes(l.id));
  const box = selectionBox(layers);
  if (!box || layers.length < 2) return;
  updateLayers(
    ids,
    (l) => {
      if (l.locked || l.side !== box.side) return;
      const b = placement(l).box;
      if (how === 'left') l.x += box.minH - b.minH;
      if (how === 'right') l.x += box.maxH - b.maxH;
      if (how === 'centre') l.x += (box.minH + box.maxH) / 2 - (b.minH + b.maxH) / 2;
      if (how === 'bottom') l.y += box.minV - b.minV;
      if (how === 'top') l.y += box.maxV - b.maxV;
      if (how === 'middle') l.y += (box.minV + box.maxV) / 2 - (b.minV + b.maxV) / 2;
    },
    `align:${Date.now()}`,
  );
}

// ---- vinyl group files ----

const VinylFileSchema = z.object({ format: z.literal('jbforge-vinyl'), version: z.literal(1), name: z.string(), layers: z.array(VinylLayerSchema) });

/** Save the selected layers as a vinyl group file, to use on other cars. */
export async function saveGroupFile(ids: readonly string[]): Promise<void> {
  const layers = (currentSet()?.layers ?? []).filter((l) => ids.includes(l.id));
  if (!layers.length) return;
  const box = selectionBox(layers)!;
  const cx = (box.minH + box.maxH) / 2;
  const cy = (box.minV + box.maxV) / 2;
  const name = currentSet()?.groups.find((g) => g.id === layers[0]!.groupId)?.name ?? layers[0]!.name;
  // Saved around (0, 0) so it goes wherever it's brought in.
  const text = JSON.stringify({ format: 'jbforge-vinyl', version: 1, name, layers: layers.map((l) => ({ ...l, x: l.x - cx, y: l.y - cy, groupId: null })) }, null, 1);
  const path = await call('vinyl:save', { suggestedName: `${name.replace(/[^\w -]+/g, '_')}.jbvinyl`, text });
  if (path) status(`Saved the vinyl group: ${path}`, 'success');
}

/** Bring in a vinyl group file where the editor is looking. */
export async function loadGroupFile(): Promise<void> {
  const file = await call('vinyl:open');
  if (!file) return;
  try {
    const parsed = VinylFileSchema.parse(JSON.parse(file.text));
    const side = useVinylUi.getState().side;
    addLayers(
      parsed.layers.map(({ id: _id, ...l }) => ({ ...l, side, groupId: null })),
      `Add ${parsed.name}`,
      parsed.name,
    );
  } catch (err) {
    status(`That isn't a vinyl group file (${err instanceof Error ? err.message.slice(0, 120) : 'unreadable'}).`, 'danger');
  }
}

// ---- rendering ----

interface TexelMap extends Texels {
  /** Image pixel of each texel. */
  pix: Uint32Array;
}

const texelCache = new Map<string, TexelMap>();

/** Every pixel of a material's image that shows the car: the point and way it faces. */
function texelsFor(materialId: string, w: number, h: number, flipY: boolean): TexelMap {
  const meshes = meshesOfMaterial(materialId).filter((m) => m.geometry.getAttribute('uv'));
  const key = `${materialId}:${w}x${h}:${flipY}:${meshes.map((m) => m.geometry.uuid).join(',')}`;
  const have = texelCache.get(key);
  if (have) return have;
  const owner = new Int32Array(w * h).fill(-1);
  let cap = 1 << 16;
  let pos = new Float32Array(cap * 3);
  let nrm = new Float32Array(cap * 3);
  let pix = new Uint32Array(cap);
  let count = 0;
  for (const m of meshes) {
    const g = m.geometry;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    rasterizeMesh({ positions: flat(g.getAttribute('position'), 3), uvs: flat(g.getAttribute('uv'), 2), index: g.index ? g.index.array : null, normals: flat(g.getAttribute('normal'), 3) }, { width: w, height: h, flipY }, (x, y, p, n) => {
      const px = y * w + x;
      let i = owner[px]!;
      if (i < 0) {
        if (count === cap) {
          cap *= 2;
          const grow = <T extends Float32Array | Uint32Array>(a: T, k: number): T => {
            const b = new (a.constructor as new (n: number) => T)(cap * k);
            b.set(a);
            return b;
          };
          pos = grow(pos, 3);
          nrm = grow(nrm, 3);
          pix = grow(pix, 1);
        }
        i = count++;
        owner[px] = i;
        pix[i] = px;
      }
      pos.set(p, i * 3);
      const l = n ? Math.hypot(n[0], n[1], n[2]) || 1 : 1;
      nrm.set(n ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 1], i * 3);
    });
  }
  const map: TexelMap = { count, pos: pos.subarray(0, count * 3), nrm: nrm.subarray(0, count * 3), pix: pix.subarray(0, count) };
  // Keep the cache small: a couple of sizes of a couple of materials.
  if (texelCache.size > 6) texelCache.delete(texelCache.keys().next().value!);
  texelCache.set(key, map);
  return map;
}

/** A coverage mask sampled with bilinear filtering; (s, t) run −½…½, t up. */
function maskLook(w: number, h: number, alpha: Uint8ClampedArray, rgba: Uint8ClampedArray | null): LayerLook {
  const at = (s: number, t: number, ch: number) => {
    const x = (s + 0.5) * w - 0.5;
    const y = (0.5 - t) * h - 0.5;
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = Math.min(1, Math.max(0, x - x0));
    const fy = Math.min(1, Math.max(0, y - y0));
    const src = ch < 0 ? alpha : rgba!;
    const k = ch < 0 ? 1 : 4;
    const c = ch < 0 ? 0 : ch;
    const v = (xx: number, yy: number) => src[(yy * w + xx) * k + c]!;
    return (v(x0, y0) * (1 - fx) * (1 - fy) + v(x1, y0) * fx * (1 - fy) + v(x0, y1) * (1 - fx) * fy + v(x1, y1) * fx * fy) / 255;
  };
  return rgba ? { alpha: () => 1, rgba: (s, t) => [at(s, t, 0), at(s, t, 1), at(s, t, 2), at(s, t, 3)] } : { alpha: (s, t) => at(s, t, -1) };
}

const lookCache = new Map<string, LayerLook>();
const imageCache = new Map<string, ImageBitmap | null>();

function lookKey(l: VinylLayer, target: PaintTarget): string {
  if (l.kind === 'shape') return `shape:${l.shape}`;
  if (l.kind === 'text') return `text:${l.font}:${l.bold}:${l.italic}:${l.text}`;
  return `image:${l.image}:${target}`;
}

/** What a layer covers, drawn once and kept: its shape, its text, or its image. */
async function lookOf(l: VinylLayer, target: PaintTarget): Promise<LayerLook | null> {
  const key = lookKey(l, target);
  const have = lookCache.get(key);
  if (have) return have;
  let canvas: HTMLCanvasElement | null = null;
  let own = false;
  if (l.kind === 'shape') {
    const shape = shapeById(l.shape);
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const g = canvas.getContext('2d')!;
    g.scale(5.12, 5.12);
    g.fillStyle = MASK_COLOR_WHITE;
    g.fill(new Path2D(shape.path), shape.evenOdd ? 'evenodd' : 'nonzero');
  } else if (l.kind === 'text') {
    const font = `${l.italic ? 'italic ' : ''}${l.bold ? 'bold ' : ''}200px "${l.font}"`; // token-lint-ignore: canvas font for the text mask, not UI
    const m = document.createElement('canvas').getContext('2d')!;
    m.font = font;
    const w = Math.max(8, Math.ceil(m.measureText(l.text || ' ').width));
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = 200;
    const g = canvas.getContext('2d')!;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = MASK_COLOR_WHITE;
    g.fillText(l.text, w / 2, 106);
  } else if (l.image) {
    if (!imageCache.has(l.image)) imageCache.set(l.image, await loadImage(l.image));
    const bmp = imageCache.get(l.image);
    if (!bmp) return null;
    canvas = document.createElement('canvas');
    canvas.width = Math.min(1024, bmp.width);
    canvas.height = Math.max(1, Math.round((canvas.width * bmp.height) / bmp.width));
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    own = target === 'livery';
  }
  if (!canvas) return null;
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let look: LayerLook;
  if (own) look = maskLook(canvas.width, canvas.height, new Uint8ClampedArray(0), data);
  else {
    const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
    look = maskLook(canvas.width, canvas.height, alpha, null);
  }
  if (lookCache.size > 200) lookCache.delete(lookCache.keys().next().value!);
  lookCache.set(key, look);
  return look;
}

const MASK_COLOR_WHITE = '#ffffff'; // token-lint-ignore: coverage mask pixels, not UI colour
const OUTLINE: [number, number, number] = [1, 0.1, 0.85];

/** Looks for a set's layers (images load on first use). */
async function looksFor(layers: readonly VinylLayer[], target: PaintTarget): Promise<Map<string, LayerLook>> {
  const out = new Map<string, LayerLook>();
  for (const l of layers) {
    const look = await lookOf(l, target);
    if (look) out.set(l.id, look);
  }
  return out;
}

/** Whether the selection outline shows (the vinyl tool is in use). */
const outlineShown = () => {
  const p = usePainter.getState();
  return p.on && p.tool === 'vinyl';
};

/** Render a material's vinyls into its surface and show them (and save, unless it's a drag preview). */
async function render(materialId: string, target: PaintTarget, quality: 'full' | 'preview', persist: boolean): Promise<void> {
  const doc = projectStore.getState().doc;
  const set = doc?.vinyls.find((v) => v.materialId === materialId && v.target === target);
  const s: Surface | null | undefined = set?.layers.length ? await ensureSurface(materialId, target) : surfaceOf(materialId, target);
  if (!s) return;
  if (!set?.layers.length) {
    s.vinyl = null;
    s.overlay = null;
    present(s);
    if (persist) void save(s);
    return;
  }
  const scale = quality === 'preview' ? Math.min(1, 1024 / s.canvas.width) : 1;
  const w = Math.max(64, Math.round(s.canvas.width * scale));
  const h = Math.max(64, Math.round(s.canvas.height * scale));
  const texels = texelsFor(materialId, w, h, s.flipY);
  const looks = await looksFor(set.layers, target);
  const ui = useVinylUi.getState();
  const selected = outlineShown() && usePainter.getState().materialId === materialId && usePainter.getState().target === target ? new Set(ui.selected) : null;
  const t0 = performance.now();
  const comp = composeVinyls(texels, set.layers, {
    bounds: carBounds(),
    looks,
    colorOf: (l, which) => (target === 'mask' ? MASK_RGB[which === 1 ? l.slot : l.slot2]! : which === 1 ? l.color : l.color2),
    selected,
  });
  const vinyl = s.vinyl && s.vinyl.width === w && s.vinyl.height === h ? s.vinyl : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const vg = vinyl.getContext('2d')!;
  const img = vg.createImageData(w, h);
  const ov = selected?.size ? vg.createImageData(w, h) : null;
  for (let i = 0; i < texels.count; i++) {
    const p = texels.pix[i]! * 4;
    img.data[p] = comp.rgba[i * 4]!;
    img.data[p + 1] = comp.rgba[i * 4 + 1]!;
    img.data[p + 2] = comp.rgba[i * 4 + 2]!;
    img.data[p + 3] = comp.rgba[i * 4 + 3]!;
    if (ov && comp.outline[i]) {
      ov.data[p] = OUTLINE[0] * 255;
      ov.data[p + 1] = OUTLINE[1] * 255;
      ov.data[p + 2] = OUTLINE[2] * 255;
      ov.data[p + 3] = 255;
    }
  }
  vg.putImageData(img, 0, 0);
  s.vinyl = vinyl;
  if (ov) {
    const oc = s.overlay && s.overlay.width === w && s.overlay.height === h ? s.overlay : Object.assign(document.createElement('canvas'), { width: w, height: h });
    oc.getContext('2d')!.putImageData(ov, 0, 0);
    s.overlay = oc;
  } else s.overlay = null;
  present(s);
  usePainter.setState((st) => ({ rev: st.rev + 1 }));
  if (persist) void save(s);
  logger.debug(`vinyls ${materialId}/${target}: ${set.layers.length} layers, ${texels.count} texels, ${Math.round(performance.now() - t0)} ms (${quality})`);
}

/** Renders asked for, run one at a time, latest request winning. */
const queue = new Map<string, { materialId: string; target: PaintTarget; quality: 'full' | 'preview'; persist: boolean }>();
let running = false;

export function requestRender(materialId: string, target: PaintTarget, quality: 'full' | 'preview' = 'full', persist = true): void {
  const key = `${materialId}:${target}`;
  const prev = queue.get(key);
  // A full render (or a save) asked for earlier isn't downgraded by a later preview.
  queue.set(key, { materialId, target, quality: prev?.quality === 'full' ? 'full' : quality, persist: persist || !!prev?.persist });
  if (!running) void pump();
}

async function pump(): Promise<void> {
  running = true;
  try {
    while (queue.size) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const [key, job] = queue.entries().next().value!;
      queue.delete(key);
      try {
        await render(job.materialId, job.target, job.quality, job.persist);
      } catch (err) {
        logger.error('vinyl render failed:', err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    running = false;
  }
}

let fullTimer: ReturnType<typeof setTimeout> | null = null;

/** Keep the car up to date with the vinyls: re-render sets that changed (undo and redo included). */
export function startVinylSync(): void {
  let last = projectStore.getState().doc?.vinyls ?? null;
  projectStore.subscribe((s) => {
    const now = s.doc?.vinyls ?? null;
    if (now === last) return;
    const before = new Map((last ?? []).map((v) => [`${v.materialId}:${v.target}`, v]));
    last = now;
    const dragging = useVinylUi.getState().dragging;
    for (const v of now ?? []) {
      const k = `${v.materialId}:${v.target}`;
      if (before.get(k) !== v) requestRender(v.materialId, v.target, dragging ? 'preview' : 'full', !dragging);
      before.delete(k);
    }
    for (const v of before.values()) requestRender(v.materialId, v.target, 'full', true);
    // Selection that no longer exists is dropped.
    const ids = new Set((now ?? []).flatMap((v) => v.layers.map((l) => l.id)));
    const sel = useVinylUi.getState().selected;
    if (sel.some((id) => !ids.has(id))) useVinylUi.getState().select(sel.filter((id) => ids.has(id)));
  });
  // The outline follows the selection and the tool.
  const outline = () => {
    const c = current();
    if (c && currentSet()) requestRender(c.materialId, c.target, 'full', false);
  };
  let prevSel = useVinylUi.getState().selected;
  useVinylUi.subscribe((ui) => {
    if (ui.selected !== prevSel) {
      prevSel = ui.selected;
      outline();
    }
  });
  let prevTool = usePainter.getState().tool;
  let prevOn = usePainter.getState().on;
  let prevMat = `${usePainter.getState().materialId}:${usePainter.getState().target}`;
  usePainter.subscribe((p) => {
    const mat = `${p.materialId}:${p.target}`;
    if ((p.tool === 'vinyl') !== (prevTool === 'vinyl') || p.on !== prevOn || mat !== prevMat) {
      prevTool = p.tool;
      prevOn = p.on;
      if (mat !== prevMat) useVinylUi.getState().select([]);
      prevMat = mat;
      outline();
    }
  });
}

/** After a drag, render at full quality and save. */
function settle(): void {
  if (fullTimer) clearTimeout(fullTimer);
  fullTimer = setTimeout(() => {
    const c = current();
    if (c) requestRender(c.materialId, c.target, 'full', true);
  }, 30);
}

// ---- on the car ----

let gesture: { mode: 'move' | 'scale' | 'rotate'; from: VinylLayer[]; grab: [number, number]; side: Side; screen: [number, number]; id: string } | null = null;

/**
 * The vinyl tool in the viewport: click a layer to select it, drag it to
 * move it along the car, Shift-drag to resize, Alt-drag to turn, and
 * Ctrl-click to put the selected layer where you clicked (on that side).
 */
export function vinylPointer(hit: BrushHit | null, phase: 'start' | 'move' | 'end'): void {
  if (phase === 'end') {
    if (gesture) {
      gesture = null;
      useVinylUi.getState().set({ dragging: false });
      settle();
    }
    return;
  }
  const set = currentSet();
  const ui = useVinylUi.getState();
  if (phase === 'start') {
    if (!hit?.point || !hit.normal) return;
    const layers = set?.layers ?? [];
    const looks = new Map<string, LayerLook>();
    for (const l of layers) {
      const look = lookCache.get(lookKey(l, usePainter.getState().target));
      if (look) looks.set(l.id, look);
    }
    const bounds = carBounds();
    const centre = viewCentre(bounds);
    if (hit.mods?.ctrl && ui.selected.length) {
      // Put the selection here: its side becomes the side this point faces.
      const side = sideFacing(hit.normal);
      const [x, y] = planeCoords(side, hit.point, centre);
      const sel = layers.filter((l) => ui.selected.includes(l.id));
      const box = selectionBox(sel);
      if (!box) return;
      const [cx, cy] = [(box.minH + box.maxH) / 2, (box.minV + box.maxV) / 2];
      updateLayers(ui.selected, (l) => {
        if (l.locked) return;
        const o = sel.find((s) => s.id === l.id)!;
        l.side = side;
        l.x = x + (o.x - cx);
        l.y = y + (o.y - cy);
      });
      ui.set({ side });
      return;
    }
    const id = layerAt(layers, looks, hit.point, hit.normal, bounds);
    if (!id) {
      if (!hit.mods?.shift && !hit.mods?.alt) ui.select([]);
      if (!layers.length) status('Add a shape, text or image first; then drag it around the car here.');
      return;
    }
    // A click on a grouped layer takes its whole group, unless it's already selected (then it's picked on its own).
    const layer = layers.find((l) => l.id === id)!;
    let sel = ui.selected;
    if (!sel.includes(id)) {
      sel = layer.groupId ? layers.filter((l) => l.groupId === layer.groupId).map((l) => l.id) : [id];
      ui.select(sel);
    }
    const from = layers.filter((l) => sel.includes(l.id));
    if (from.every((l) => l.locked)) return;
    const [h, v] = planeCoords(layer.side, hit.point, centre);
    gesture = { mode: hit.mods?.shift ? 'scale' : hit.mods?.alt ? 'rotate' : 'move', from: structuredClone(from), grab: [h, v], side: layer.side, screen: hit.screen ?? [0, 0], id: `vdrag:${Date.now()}` };
    ui.set({ dragging: true, side: layer.side });
    return;
  }
  if (!gesture) return;
  if (gesture.mode === 'move') {
    if (!hit?.point) return;
    const [h, v] = planeCoords(gesture.side, hit.point, viewCentre(carBounds()));
    transformLayers(gesture.from, { dx: h - gesture.grab[0], dy: v - gesture.grab[1] }, gesture.id);
  } else if (hit?.screen) {
    const dx = hit.screen[0] - gesture.screen[0];
    const dy = hit.screen[1] - gesture.screen[1];
    if (gesture.mode === 'scale') transformLayers(gesture.from, { scale: Math.exp(-dy / 150) }, gesture.id);
    else transformLayers(gesture.from, { rotate: -dx * 0.5 }, gesture.id);
  }
}

/** Keys for the selected layers while the vinyl tool is on; true when handled. */
export function vinylKey(e: KeyboardEvent): boolean {
  const p = usePainter.getState();
  const ui = useVinylUi.getState();
  const set = currentSet();
  if (!p.on || p.tool !== 'vinyl' || !set || !ui.selected.length) return false;
  const from = set.layers.filter((l) => ui.selected.includes(l.id));
  const step = e.shiftKey ? 0.1 : e.altKey ? 0.002 : 0.01;
  const key = `vkey:${e.key}:${ui.selected.join(',')}`;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'ArrowLeft') transformLayers(from, { dx: -step }, key);
  else if (e.key === 'ArrowRight') transformLayers(from, { dx: step }, key);
  else if (e.key === 'ArrowUp') transformLayers(from, { dy: step }, key);
  else if (e.key === 'ArrowDown') transformLayers(from, { dy: -step }, key);
  else if (e.key === 'q' || e.key === 'Q') transformLayers(from, { rotate: e.shiftKey ? 15 : 2 }, key);
  else if (e.key === 'e' || e.key === 'E') transformLayers(from, { rotate: e.shiftKey ? -15 : -2 }, key);
  else if (e.key === '+' || e.key === '=') transformLayers(from, { scale: e.shiftKey ? 1.2 : 1.03 }, key);
  else if (e.key === '-' || e.key === '_') transformLayers(from, { scale: e.shiftKey ? 1 / 1.2 : 1 / 1.03 }, key);
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteLayers(ui.selected);
  else if (ctrl && (e.key === 'd' || e.key === 'D')) duplicateLayers(ui.selected);
  else if (ctrl && (e.key === 'g' || e.key === 'G')) (e.shiftKey ? ungroupLayers : groupLayers)(ui.selected);
  else if (e.key === 'h' || e.key === 'H') updateLayers(ui.selected, { visible: !from[0]!.visible });
  else if (e.key === 'Escape') ui.select([]);
  else return false;
  if (e.key !== 'Escape') settle();
  return true;
}

/** Start the vinyl editor on a material (turns painting on and picks the vinyl tool). */
export function openVinylEditor(): void {
  if (!usePainter.getState().on) setPainterOn(true);
  usePainter.getState().set({ tool: 'vinyl' });
}

/** For views: the side frames (camera placement). */
export { SIDE_FRAMES };
export type { Side, Vec3 };
