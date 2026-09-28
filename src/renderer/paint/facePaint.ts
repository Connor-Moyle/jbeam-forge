import { BufferAttribute, BufferGeometry, type Material } from 'three';
import { create } from 'zustand';
import { brushFaces, connectedFaces, faceAssignment, faceData, groupFaces, smoothFaces, toEntries, type FaceData } from '@shared/paints/faceMaterials';
import { makeWeave, WEAVES } from '@shared/paints/weave';
import { MATERIAL_PRESETS } from '@shared/materials/presets';
import { defaultLayer, type MaterialDef } from '@shared/materials/schema';
import type { Project } from '@shared/project/schema';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { createMaterial, updateLayer } from '@renderer/materials/commands';
import { overlayMaterialFor, useTextureVersion } from '@renderer/materials/runtime';
import type { BrushHit } from '@renderer/panels/viewport/viewportRuntime';
import { canvasPng } from './commands';
import { flat, usePainter } from './painter';

/**
 * Material painting in the viewport: drag over the car to give its
 * triangles another material (carbon fibre, chrome, matte black…). Brush,
 * smooth-area fill (stops at folds), whole piece, whole mesh, and erase
 * (back to the mesh's own). A stroke is one undo step. The painted triangles
 * are drawn in their material over the mesh, and exported as their own
 * material group of it, so the game shows the real material.
 */

const status = (text: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info', ms?: number) => useUiStore.getState().pushStatus(text, tone, ms);

// ---- mesh data ----

const dataCache = new WeakMap<BufferGeometry, FaceData>();

function indexOf(g: BufferGeometry): ArrayLike<number> {
  if (g.index) return g.index.array;
  const n = g.getAttribute('position').count;
  return Uint32Array.from({ length: n - (n % 3) }, (_, i) => i);
}

function dataOf(g: BufferGeometry): FaceData {
  let d = dataCache.get(g);
  if (!d) {
    d = faceData(flat(g.getAttribute('position'), 3), indexOf(g));
    dataCache.set(g, d);
  }
  return d;
}

const triangleCount = (g: BufferGeometry) => Math.floor((g.index ? g.index.count : g.getAttribute('position').count) / 3);

/** A mesh's geometry as the scene has it (split pieces included). */
function geometryOf(key: string): BufferGeometry | null {
  const sourceId = key.slice(0, key.indexOf(':'));
  return useSceneStore.getState().sources[sourceId]?.meshes.find((m) => m.key === key)?.geometry ?? null;
}

// ---- the stroke being painted ----

/** Faces changed by the stroke under way, per mesh (committed to the project when it ends). */
const live = new Map<string, { ids: string[]; face: Int32Array }>();

function working(key: string, tris: number): { ids: string[]; face: Int32Array } {
  let w = live.get(key);
  if (!w) {
    const a = faceAssignment(projectStore.getState().doc?.faceMaterials[key], tris);
    w = { ids: a.ids, face: a.face };
    live.set(key, w);
  }
  return w;
}

function applyAt(hit: BrushHit, first: boolean): number {
  const p = usePainter.getState();
  const g = geometryOf(hit.meshKey);
  if (!g || hit.face < 0) return 0;
  const d = dataOf(g);
  const mode = p.faceMode;
  if (!first && mode !== 'brush' && mode !== 'erase') return 0;
  const faces =
    mode === 'brush' || mode === 'erase'
      ? hit.point
        ? brushFaces(d, hit.face, hit.point, p.size / 200)
        : [hit.face]
      : mode === 'smooth'
        ? smoothFaces(d, hit.face, p.faceAngle)
        : mode === 'piece'
          ? connectedFaces(d, hit.face)
          : Array.from({ length: d.count }, (_, i) => i);
  const w = working(hit.meshKey, d.count);
  let k = -1;
  if (mode !== 'erase') {
    k = w.ids.indexOf(p.faceMaterialId!);
    if (k < 0) k = w.ids.push(p.faceMaterialId!) - 1;
  }
  for (const f of faces) w.face[f] = k;
  return faces.length;
}

let stroking = false;

/** Viewport callback while the material tool is on. */
export function facePointer(hit: BrushHit | null, phase: 'start' | 'move' | 'end'): void {
  const p = usePainter.getState();
  if (phase === 'end') {
    if (stroking) commit();
    stroking = false;
    return;
  }
  if (phase === 'start') {
    if (!hit?.meshKey) return;
    if (p.faceMode !== 'erase' && !p.faceMaterialId) {
      status('Choose the material to paint with first (carbon fibre, chrome…).', 'warning', 5000);
      return;
    }
    stroking = true;
  }
  if (!stroking || !hit?.meshKey) return;
  const first = phase === 'start';
  let n = applyAt(hit, first);
  if (p.mirror && hit.mirror?.meshKey) n += applyAt(hit.mirror, first);
  if (n) scheduleOverlays([...live.keys()]);
}

/** The stroke into the project: one undo step. */
function commit(): void {
  if (!live.size) return;
  const changes = [...live.entries()].map(([key, w]) => [key, toEntries(w.ids, w.face)] as const);
  live.clear();
  projectStore.getState().execute({
    label: usePainter.getState().faceMode === 'erase' ? 'Erase painted material' : 'Paint material',
    apply: (d) => {
      for (const [key, entries] of changes) {
        if (entries.length) d.faceMaterials[key] = entries;
        else delete d.faceMaterials[key];
      }
    },
  });
}

/** Give every painted face of a material back to its meshes (e.g. before deleting the material). */
export function clearMaterialFaces(materialId: string): void {
  projectStore.getState().execute({
    label: 'Remove painted material',
    apply: (d) => {
      for (const [key, entries] of Object.entries(d.faceMaterials)) {
        const rest = entries.filter((e) => e.materialId !== materialId);
        if (rest.length) d.faceMaterials[key] = rest;
        else delete d.faceMaterials[key];
      }
    },
  });
}

/** How many triangles each material has painted on it (for the panel). */
export function paintedCounts(doc: Pick<Project, 'faceMaterials'>): Map<string, number> {
  const out = new Map<string, number>();
  for (const entries of Object.values(doc.faceMaterials)) for (const e of entries) {
    let n = 0;
    for (let i = 1; i < e.runs.length; i += 2) n += e.runs[i]!;
    out.set(e.materialId, (out.get(e.materialId) ?? 0) + n);
  }
  return out;
}

// ---- drawing the painted faces ----

interface Overlay {
  geometry: BufferGeometry;
  source: BufferGeometry;
  index: BufferAttribute;
}

const overlays = new Map<string, Overlay>();

/** What the viewport draws over each mesh: its painted triangles, per material. */
export const useFaceOverlays = create<{ map: ReadonlyMap<string, { geometry: BufferGeometry; materials: Material[] }> }>()(() => ({ map: new Map() }));

function buildOverlay(key: string, doc: Project, defs: ReadonlyMap<string, MaterialDef>): { geometry: BufferGeometry; materials: Material[] } | null {
  const g = geometryOf(key);
  if (!g) return null;
  const tris = triangleCount(g);
  const a = live.get(key) ?? faceAssignment(doc.faceMaterials[key], tris);
  const present = a.ids.map((id) => defs.get(id));
  // One overlay geometry per mesh, sharing its vertex buffers; only the index changes as it's painted.
  let o = overlays.get(key);
  if (!o || o.source !== g) {
    const geometry = new BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) geometry.setAttribute(name, attr);
    const index = new BufferAttribute(new Uint32Array(tris * 3), 1);
    geometry.setIndex(index);
    o = { geometry, source: g, index };
    overlays.set(key, o);
  }
  const src = indexOf(g);
  const arr = o.index.array as Uint32Array;
  let at = 0;
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  present.forEach((def, k) => {
    if (!def) return;
    const start = at;
    for (let t = 0; t < tris; t++) {
      if (a.face[t] !== k) continue;
      arr[at++] = src[t * 3]!;
      arr[at++] = src[t * 3 + 1]!;
      arr[at++] = src[t * 3 + 2]!;
    }
    if (at > start) groups.push({ start, count: at - start, materialIndex: k });
  });
  if (!groups.length) return null;
  o.geometry.clearGroups();
  for (const gr of groups) o.geometry.addGroup(gr.start, gr.count, gr.materialIndex);
  o.index.needsUpdate = true;
  const materials = present.map((def) => (def ? overlayMaterialFor(def) : overlayMaterialFor(present.find(Boolean)!)));
  return { geometry: o.geometry, materials };
}

function rebuild(keys?: readonly string[]): void {
  const doc = projectStore.getState().doc;
  if (!doc) {
    useFaceOverlays.setState({ map: new Map() });
    return;
  }
  const defs = new Map(doc.materials.map((m) => [m.id, m]));
  const map = new Map(keys ? useFaceOverlays.getState().map : []);
  for (const key of keys ?? [...new Set([...Object.keys(doc.faceMaterials), ...live.keys()])]) {
    const o = buildOverlay(key, doc, defs);
    if (o) map.set(key, o);
    else map.delete(key);
  }
  useFaceOverlays.setState({ map });
}

let frame = 0;
let pendingKeys: Set<string> | null = null;

function scheduleOverlays(keys: string[]): void {
  pendingKeys = pendingKeys ?? new Set();
  for (const k of keys) pendingKeys.add(k);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const k = pendingKeys;
    pendingKeys = null;
    rebuild(k ? [...k] : undefined);
  });
}

let started = false;

/** Keep the painted faces on screen in step with the project, the scene and the materials. */
export function startFacePaintSync(): void {
  if (started) return;
  started = true;
  let last: unknown[] = [];
  const check = () => {
    const doc = projectStore.getState().doc;
    const now = [doc?.faceMaterials, doc?.materials, useSceneStore.getState().sources, useTextureVersion.getState().version];
    if (now.every((x, i) => x === last[i])) return;
    last = now;
    rebuild();
  };
  projectStore.subscribe(check);
  useSceneStore.subscribe(check);
  useTextureVersion.subscribe(check);
  check();
}

// ---- materials to paint with ----

/** How many texture units a metre of the car spans (median over meshes with UVs), for sizing a repeating weave. */
export function uvPerMetre(keys?: readonly string[]): number {
  const vals: number[] = [];
  for (const src of Object.values(useSceneStore.getState().sources)) {
    for (const m of src.meshes) {
      if (keys && !keys.includes(m.key)) continue;
      const g = m.geometry;
      const uv = g.getAttribute('uv');
      const pos = g.getAttribute('position');
      if (!uv || !pos) continue;
      const idx = indexOf(g);
      let uvArea = 0;
      let area = 0;
      const step = Math.max(1, Math.floor(idx.length / 3 / 2000)) * 3;
      for (let t = 0; t + 2 < idx.length; t += step) {
        const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        const e1 = [pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a)];
        const e2 = [pos.getX(c) - pos.getX(a), pos.getY(c) - pos.getY(a), pos.getZ(c) - pos.getZ(a)];
        area += Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!) / 2;
        uvArea += Math.abs((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getX(c) - uv.getX(a)) * (uv.getY(b) - uv.getY(a))) / 2;
      }
      if (area > 1e-6 && uvArea > 1e-9) vals.push(Math.sqrt(uvArea / area));
    }
  }
  vals.sort((x, y) => x - y);
  return vals.length ? vals[Math.floor(vals.length / 2)]! : 0.25;
}

/** Repeats of the weave picture per texture unit, so one picture (4 tows) covers `tileCm` on the car. */
export const weaveScale = (tileCm: number, perMetre = uvPerMetre()) => Math.max(1, Math.round((1 / (perMetre * (tileCm / 100))) * 10) / 10);

/** A woven material (carbon fibre, Kevlar…): its weave made and saved, the material added and chosen. */
export async function addWeaveMaterial(weaveId: string): Promise<string | null> {
  const w = WEAVES.find((x) => x.id === weaveId);
  const doc = projectStore.getState().doc;
  if (!w || !doc) return null;
  const weave = makeWeave(256, w.tint);
  const c = document.createElement('canvas');
  c.width = c.height = weave.size;
  const img = c.getContext('2d')!.createImageData(weave.size, weave.size);
  img.data.set(weave.normal);
  c.getContext('2d')!.putImageData(img, 0, 0);
  const normal = await call('materials:saveTexture', { name: `${doc.meta.slug}_${w.id}_weave_n.png`, bytes: await canvasPng(c) });
  const s = weaveScale(3);
  const id = createMaterial(
    {
      name: w.name.toLowerCase().replace(/\s+/g, '_'),
      layers: [defaultLayer({ baseColor: [...w.base, 1], metallic: w.metallic, roughness: 0.28, clearCoat: 1, clearCoatRoughness: 0.03, useAnisotropic: true, maps: { detailNormalMap: normal }, detailScale: [s, s], detailNormalStrength: 1.6 })],
    },
    w.name,
  );
  usePainter.getState().set({ faceMaterialId: id, tool: 'material', on: true });
  status(`${w.name} added: drag over the car to lay it on.`, 'success');
  return id;
}

/** Set a woven material's weave size (centimetres per 4 tows on the car). */
export function setWeaveSize(def: MaterialDef, tileCm: number): void {
  const keys = Object.entries(projectStore.getState().doc?.faceMaterials ?? {})
    .filter(([, e]) => e.some((x) => x.materialId === def.id))
    .map(([k]) => k);
  const s = weaveScale(tileCm, uvPerMetre(keys.length ? keys : undefined));
  updateLayer(def.id, 0, { detailScale: [s, s] });
}

/** Materials from the preset library to paint with in one click. */
export const QUICK_PRESETS = ['chrome', 'plastic_black_gloss', 'plastic_black_textured', 'aluminium_brushed', 'anodised_gold', 'titanium_burnt', 'alcantara', 'leather_black'] as const;

export function addPresetMaterial(presetId: string): string | null {
  const preset = MATERIAL_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const have = projectStore.getState().doc?.materials.find((m) => m.name === preset.id);
  const id = have?.id ?? createMaterial({ ...structuredClone(preset.def), name: preset.id }, preset.id);
  usePainter.getState().set({ faceMaterialId: id, tool: 'material', on: true });
  return id;
}


// ---- export ----

/**
 * A mesh with painted faces as the DAE writer wants it: triangles regrouped
 * so each material (the mesh's own ones, then each painted one) is a group,
 * sharing the mesh's vertices. Painted materials that no longer exist are
 * left as the mesh's own.
 */
export function withPaintedFaces(
  g: BufferGeometry,
  entries: readonly { materialId: string; runs: number[] }[] | undefined,
  own: { materials: readonly string[]; back?: readonly (string | null)[] },
  exportName: (materialId: string) => { name: string; back: string | null } | null,
): { geometry: BufferGeometry; materials: string[]; backMaterials?: (string | null)[] } {
  const tris = triangleCount(g);
  const a = faceAssignment(entries, tris);
  const names = a.ids.map(exportName);
  for (let t = 0; t < tris; t++) if (a.face[t]! >= 0 && !names[a.face[t]!]) a.face[t] = -1;
  if (!a.face.some((f) => f >= 0)) return { geometry: g, materials: [...own.materials], ...(own.back ? { backMaterials: [...own.back] } : {}) };
  // Each triangle's own group material.
  const ownOf = new Int32Array(tris);
  for (const gr of g.groups) for (let i = gr.start / 3; i < Math.min(tris, (gr.start + gr.count) / 3); i++) ownOf[i] = gr.materialIndex ?? 0;
  // Painted groups come after every group number the mesh itself uses.
  const base = Math.max(own.materials.length, 1, ...g.groups.map((gr) => (gr.materialIndex ?? 0) + 1));
  const { order, groups } = groupFaces(tris, (t) => ownOf[t]!, a.face, base);
  const src = indexOf(g);
  const index = new Uint32Array(tris * 3);
  order.forEach((t, i) => index.set([src[t * 3]!, src[t * 3 + 1]!, src[t * 3 + 2]!], i * 3));
  const geometry = new BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) geometry.setAttribute(name, attr);
  geometry.setIndex(new BufferAttribute(index, 1));
  for (const gr of groups) geometry.addGroup(gr.start, gr.count, gr.materialIndex);
  const padded = Array.from({ length: base }, (_, i) => own.materials[i] ?? own.materials[0] ?? '');
  const materials = [...padded, ...names.map((n) => n?.name ?? padded[0]!)];
  const anyBack = !!own.back?.some(Boolean) || names.some((n) => n?.back);
  return { geometry, materials, ...(anyBack ? { backMaterials: [...Array.from({ length: base }, (_, i) => own.back?.[i] ?? null), ...names.map((n) => n?.back ?? null)] } : {}) };
}
