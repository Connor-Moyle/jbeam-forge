import { create } from 'zustand';
import { current, isDraft } from 'immer';
import type { BufferGeometry } from 'three';
import { projectStore } from '@renderer/app/stores/project';
import { allMeshes, useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { slotsOf } from '@renderer/materials/seed';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { fittedSourceIds } from '@renderer/scene/placeFitted';
import { IDENTITY_EDIT } from '@shared/mesh/meshEdit';
import type { MaterialDef } from '@shared/materials/schema';
import type { Project, Skin } from '@shared/project/schema';
import { buildTemplate, partColor, templateSvg, type TemplateDrawing, type TemplatePiece } from '@shared/uv/skinTemplate';
import { carBox, DEFAULT_SKIN_OPTIONS, planSkinLayout, skinStats, skinUvs, triangleFacing, triangleShade, type SkinLayout, type SkinOptions, type SkinStats, type SkinView } from '@shared/uv/skinUnwrap';

/**
 * The Skin studio (fork): lay the car's body panels out as a skin template,
 * save the template to paint on, and turn a painted one into a skin.
 */

export interface SkinUi {
  /** Mesh key → laid out or not; null = the meshes already laid out, else the body panels. */
  include: Record<string, boolean> | null;
  opts: SkinOptions;
  /** Options changed since the layout was made (else the layout's own are shown). */
  optsTouched: boolean;
  size: 2048 | 4096 | 8192;
  view: 'parts' | 'stretch';
  /** Shade the panels on the template (a guide for painting). */
  shading: boolean;
  /** The skin shown on the car in the viewport, or 'template' for the template itself. */
  preview: string | null;
  /** Which step of the studio is open: pick the panels, lay them out, make the template and skins. */
  step: 1 | 2 | 3;
  set: (patch: Partial<Omit<SkinUi, 'set'>>) => void;
}

export const useSkinUi = create<SkinUi>()((set) => ({ include: null, opts: DEFAULT_SKIN_OPTIONS, optsTouched: false, size: 4096, view: 'parts', shading: true, preview: null, step: 1, set: (patch) => set(patch) }));

/** Kinds of part that carry the paint: the shell, its panels, bumpers and aero, mirrors. */
const BODY_KINDS = new Set(['body', 'roof']);
const BODY_CATEGORIES = new Set(['Panels', 'Bumpers & Aero']);
const NOT_PAINTED = new Set(['bumper_reinforcement']);

export interface SkinMesh {
  key: string;
  name: string;
  partId: string | null;
  partName: string;
  /** Triangle corners, three floats each (BeamNG space). */
  pos: Float32Array;
}

function positionsOf(g: BufferGeometry): Float32Array {
  const flat = g.index ? g.toNonIndexed() : g;
  return Float32Array.from(flat.getAttribute('position').array as ArrayLike<number>);
}

/** Every mesh that's in the mod (not ignored), with its part. */
/**
 * Meshes from the game itself: fitted engines, gearboxes and suspensions, a
 * panel mod's stock guide, parts cut from the BeamNG install, and anything
 * wearing only the game's own materials. Their textures are the game's: a
 * skin layout must never touch them.
 */
export function gameMeshKeys(doc: Project): Set<string> {
  const sources = new Set(fittedSourceIds(doc));
  if (doc.panel?.guideSourceId) sources.add(doc.panel.guideSourceId);
  const byId = new Map(doc.materials.map((m) => [m.id, m]));
  const out = new Set<string>();
  for (const m of allMeshes(useSceneStore.getState().sources)) {
    const ids = slotsOf(doc, m.key) ?? [];
    const allGame = ids.length > 0 && ids.every((id) => !!byId.get(id)?.gameMaterial);
    if (sources.has(m.sourceId) || allGame) out.add(m.key);
  }
  return out;
}

export function skinMeshes(): SkinMesh[] {
  const doc = projectStore.getState().doc;
  if (!doc) return [];
  const ignored = new Set(doc.ignoredMeshes);
  const game = gameMeshKeys(doc);
  const parts = new Map(doc.parts.map((p) => [p.id, p]));
  return allMeshes(useSceneStore.getState().sources)
    .filter((m) => !ignored.has(m.key) && !game.has(m.key))
    .map((m) => {
      const partId = doc.assignments[m.key] ?? null;
      return { key: m.key, name: m.name, partId, partName: (partId && parts.get(partId)?.displayName) || 'Not in a part', pos: positionsOf(m.geometry) };
    });
}

/** Whether a part is painted bodywork (the default for the layout). */
export function isBodyPart(doc: Pick<Project, 'parts'>, partId: string | null): boolean {
  const part = partId ? doc.parts.find((p) => p.id === partId) : undefined;
  if (!part) return false;
  const entry = currentTaxonomy().entry(part.taxonomyId);
  if (!entry || NOT_PAINTED.has(entry.id)) return false;
  return BODY_KINDS.has(entry.id) || BODY_CATEGORIES.has(entry.category) || entry.id === 'mirror';
}

/** The meshes laid out for skins now, and the layout they share. */
export function currentSkinLayout(doc: Pick<Project, 'meshEdits'> | null): { keys: string[]; layout: SkinLayout | null } {
  const keys: string[] = [];
  let layout: SkinLayout | null = null;
  for (const [key, e] of Object.entries(doc?.meshEdits ?? {}))
    if (e.uv.project?.kind === 'skin') {
      keys.push(key);
      layout ??= e.uv.project.layout ?? null;
    }
  return { keys, layout };
}

/** The meshes the studio lays out: the user's picks, else the ones laid out now, else the body panels. */
export function chosenKeys(meshes: readonly SkinMesh[], ui: Pick<SkinUi, 'include'>): Set<string> {
  const doc = projectStore.getState().doc;
  if (!doc) return new Set();
  if (ui.include) return new Set(meshes.filter((m) => ui.include![m.key]).map((m) => m.key));
  const now = currentSkinLayout(doc).keys;
  if (now.length) return new Set(now);
  return new Set(meshes.filter((m) => isBodyPart(doc, m.partId)).map((m) => m.key));
}

export interface SkinPlan {
  layout: SkinLayout;
  pieces: TemplatePiece[];
  stats: SkinStats;
  /** Per piece, how squarely each triangle faces its view. */
  facing: Float32Array[];
}

/** The layout and where every chosen mesh lands on it (nothing is changed). */
export function planSkin(meshes: readonly SkinMesh[], keys: ReadonlySet<string>, opts: SkinOptions): SkinPlan | null {
  const doc = projectStore.getState().doc;
  const chosen = meshes.filter((m) => keys.has(m.key));
  const box = carBox(chosen.map((m) => m.pos));
  if (!doc || !box) return null;
  const layout = planSkinLayout(box, opts);
  const partIndex = new Map(doc.parts.map((p, i) => [p.id, i]));
  const pieces: TemplatePiece[] = [];
  const facing: Float32Array[] = [];
  const perView = { left: 0, right: 0, top: 0, front: 0, rear: 0, bottom: 0 };
  let triangles = 0;
  let stretchedArea = 0;
  for (const m of chosen) {
    const { uv, views } = skinUvs(m.pos, layout);
    pieces.push({ part: m.partName, color: partColor(m.partId ? (partIndex.get(m.partId) ?? 0) : doc.parts.length), uv, views, shade: triangleShade(m.pos) });
    facing.push(triangleFacing(m.pos, views));
    const st = skinStats(m.pos, views);
    for (const v of Object.keys(perView) as SkinView[]) perView[v] += st.perView[v];
    triangles += st.triangles;
    stretchedArea += st.stretched * st.triangles;
  }
  return { layout, pieces, facing, stats: { triangles, perView, stretched: triangles ? stretchedArea / triangles : 0 } };
}

/** The plan with each triangle coloured by how much it stretches (green flat, amber slanted, red stretched). */
export function stretchPieces(plan: SkinPlan): TemplatePiece[] {
  const buckets: { part: string; color: string; test: (f: number) => boolean }[] = [
    { part: 'Flat to its view', color: '#6cc070', test: (f) => f >= 0.7 }, /* token-lint-ignore: template colours */
    { part: 'Slanted', color: '#e6b84a', test: (f) => f >= 0.5 && f < 0.7 }, /* token-lint-ignore: template colours */
    { part: 'Stretched (over 2×)', color: '#e0605a', test: (f) => f < 0.5 }, /* token-lint-ignore: template colours */
  ];
  return plan.pieces.flatMap((p, i) =>
    buckets.map((b) => {
      const uv: number[] = [];
      const views: SkinView[] = [];
      const facing = plan.facing[i]!;
      for (let t = 0; t < p.views.length; t++) {
        if (!b.test(facing[t]!)) continue;
        for (let k = 0; k < 6; k++) uv.push(p.uv[t * 6 + k]!);
        views.push(p.views[t]!);
      }
      return { part: b.part, color: b.color, uv, views };
    }),
  );
}

/** Lay the chosen meshes out for skins (one undoable step); meshes no longer chosen get their own UVs back. */
export function applySkinLayout(picked: ReadonlySet<string>, opts: SkinOptions): number {
  const meshes = skinMeshes();
  // Only meshes the studio may lay out (never the game's own).
  const allowed = new Set(meshes.map((m) => m.key));
  const keys = new Set([...picked].filter((k) => allowed.has(k)));
  const plan = planSkin(meshes, keys, opts);
  if (!plan) return 0;
  const layout = plan.layout;
  let split: string[] = [];
  projectStore.getState().execute({
    label: `Lay out ${keys.size} mesh${keys.size === 1 ? '' : 'es'} for skins`,
    apply: (d) => {
      split = splitSharedMaterials(d, keys, meshes.map((m) => m.key));
      for (const [key, e] of Object.entries(d.meshEdits)) if (e.uv.project?.kind === 'skin' && !keys.has(key)) delete e.uv.project;
      for (const key of keys) {
        const e = d.meshEdits[key] ?? structuredClone(IDENTITY_EDIT);
        // The layout decides where everything goes: tiling, offset and turn would only move it off its place.
        e.uv = { scale: [1, 1], offset: [0, 0], rotation: 0, project: { kind: 'skin', size: 1, layout } };
        d.meshEdits[key] = e;
      }
    },
  });
  useSkinUi.getState().set({ include: null, opts, optsTouched: false });
  const copies = split.length ? ` (${split.join(', ')} ${split.length === 1 ? 'was' : 'were'} shared with other parts: the laid-out panels got their own copy)` : '';
  useUiStore.getState().pushStatus(`Laid out ${keys.size} mesh${keys.size === 1 ? '' : 'es'} for skins: save the template to paint on${copies}`, 'success', copies ? 10000 : undefined);
  return keys.size;
}

/**
 * A skin replaces a material's colour everywhere it's used, so a material the
 * laid-out panels share with other meshes (trim on the bumpers and the
 * grille) is copied for the panels: the skin then shows only where the
 * layout puts it. Returns the names of the materials copied.
 */
export function splitSharedMaterials(d: Pick<Project, 'materials' | 'materialSlots' | 'meshCopies'>, inside: ReadonlySet<string>, all: readonly string[]): string[] {
  const outside = new Set(all.filter((k) => !inside.has(k)).flatMap((k) => slotsOf(d, k) ?? []));
  const shared = new Set([...inside].flatMap((k) => slotsOf(d, k) ?? []).filter((id) => outside.has(id)));
  const names = new Set(d.materials.map((m) => m.name.toLowerCase()));
  const copied: string[] = [];
  const copyOf = new Map<string, string>();
  for (const id of shared) {
    const src = d.materials.find((m) => m.id === id);
    if (!src) continue;
    let name = `${src.name}_skin`;
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${src.name}_skin${i}`;
    names.add(name.toLowerCase());
    // Inside an undoable command the material is a draft: copy what it holds now.
    const copy = { ...structuredClone(isDraft(src) ? current(src) : src), id: `mat_${crypto.randomUUID().slice(0, 8)}`, name, origin: null };
    d.materials.push(copy);
    copyOf.set(id, copy.id);
    copied.push(src.name);
  }
  if (copyOf.size)
    for (const k of inside) {
      const slots = slotsOf(d, k);
      if (slots?.some((id) => copyOf.has(id))) d.materialSlots[k] = slots.map((id) => copyOf.get(id) ?? id);
    }
  return copied;
}

/** Give every laid-out mesh its own UVs back. */
export function clearSkinLayout(): void {
  projectStore.getState().execute({
    label: 'Remove the skin layout',
    apply: (d) => {
      for (const e of Object.values(d.meshEdits)) if (e.uv.project?.kind === 'skin') delete e.uv.project;
    },
  });
}

/** The template at a size, as a drawing (for the canvas and the SVG). */
export function templateDrawing(plan: SkinPlan, size: number, view: SkinUi['view'] = 'parts', shading = useSkinUi.getState().shading): TemplateDrawing {
  return buildTemplate(plan.layout, view === 'stretch' ? stretchPieces(plan) : plan.pieces, size, { shading: shading && view === 'parts' });
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The template could not be drawn');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Save the template as a PNG (drawn with `draw`) and, if asked, a layered SVG next to it. */
export async function saveTemplate(plan: SkinPlan, size: number, kind: 'png' | 'svg', draw: (canvas: HTMLCanvasElement, d: TemplateDrawing) => void): Promise<string | null> {
  const doc = projectStore.getState().doc;
  const base = `${doc?.meta.slug ?? 'car'}_skin_template`;
  const d = templateDrawing(plan, size);
  if (kind === 'svg') return call('file:saveText', { kind: 'svg', suggestedName: `${base}.svg`, text: templateSvg(d, `${doc?.meta.name ?? 'Car'}: skin template`) });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas, d);
  return call('paint:saveImage', { suggestedName: `${base}.png`, bytes: await canvasPng(canvas) });
}

/** The materials on the laid-out meshes, and any of them also used on meshes outside the layout. */
export function skinMaterials(doc: Pick<Project, 'materials' | 'materialSlots' | 'meshEdits' | 'meshCopies'>): { materials: MaterialDef[]; shared: MaterialDef[] } {
  const { keys } = currentSkinLayout(doc);
  const inside = new Set(keys);
  const ids = new Set(keys.flatMap((k) => slotsOf(doc, k) ?? []));
  const outside = new Set(Object.keys(doc.materialSlots).filter((k) => !inside.has(k)).flatMap((k) => slotsOf(doc, k) ?? []));
  const materials = doc.materials.filter((m) => ids.has(m.id));
  return { materials, shared: materials.filter((m) => outside.has(m.id)) };
}

/**
 * A skin from a painted template: a paint design whose laid-out materials
 * take the image as their colour. Shown on the car straight away.
 */
export async function newSkinFromImage(): Promise<string | null> {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const { materials, shared } = skinMaterials(doc);
  if (!materials.length) {
    useUiStore.getState().pushStatus('Lay the car out for skins first: the skin goes on the laid-out panels.', 'warning');
    return null;
  }
  const path = await call('materials:pickTexture');
  if (!path) return null;
  const file = path.split(/[\\/]/).pop() ?? 'Skin';
  const taken = new Set(doc.features.skins.map((s) => s.name.toLowerCase()));
  const stem = file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Skin';
  let name = stem;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${stem} ${i}`;
  const skin: Skin = { id: `skin_${crypto.randomUUID().slice(0, 8)}`, name, overrides: Object.fromEntries(materials.map((m) => [m.id, { baseColor: null, baseColorMap: path }])) };
  projectStore.getState().execute({ label: `New skin: ${name}`, apply: (d) => void d.features.skins.push(skin) });
  useSkinUi.getState().set({ preview: skin.id });
  if (shared.length)
    useUiStore.getState().pushStatus(`${shared.map((m) => m.name).join(', ')} ${shared.length === 1 ? 'is' : 'are'} also on meshes outside the layout: the skin shows there too, out of place. Give those meshes their own material.`, 'warning', 10000);
  else useUiStore.getState().pushStatus(`Skin "${name}" made from ${file}: it's on the car now, and exports as a paint design`, 'success');
  return skin.id;
}
