import { beamKey } from '@shared/structure/edit';
import { triKey } from '@shared/jbeam/workbench';
import { create } from 'zustand';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { rlog } from '@renderer/diagnostics/logger';
import type { ImportedMesh } from '@renderer/import/normalize';
import type { PartProxy, Project } from '@shared/project/schema';
import type { ProxyMesh } from '@shared/proxy/mesh';
import { buildProxy, type ProxyMode } from '@shared/proxy/build';
import { meshoptReady } from '@shared/proxy/shapes';
import { edges, reduceDense } from '@shared/proxy/mesh';
import { defaultProxySettings, generateStructure, massNodeCap, partMass, partSettings, removePartStructure, type PartGeometry, type PartReport } from '@shared/proxy/generate';
import { braces } from '@shared/proxy/derive';
import { wheelSpaceOf, type WheelSpace } from '@shared/proxy/wheelSpace';
import { kindDefaults, targetVertices } from '@shared/proxy/presets';

const logger = rlog('generate');

/**
 * Proxy generation in the editor (SPEC §4.4): gathers each part's render
 * geometry from the scene, runs the pure generator inside one undoable
 * command, and keeps the latest per-part reports for the Inspector.
 */

interface StructureUiState {
  reports: Record<string, PartReport>;
  busy: boolean;
  setReports: (r: PartReport[]) => void;
  setBusy: (b: boolean) => void;
}

export const useStructureUi = create<StructureUiState>()((set) => ({
  reports: {},
  busy: false,
  setReports: (list) => set((s) => ({ reports: { ...s.reports, ...Object.fromEntries(list.map((r) => [r.partId, r])) } })),
  setBusy: (busy) => set({ busy }),
}));

/** Merge a part's meshes (split results included) into one BeamNG-space mesh. */
export function partGeometry(partId: string): ProxyMesh {
  const doc = projectStore.getState().doc;
  if (!doc) return { positions: new Float32Array(), index: new Uint32Array() };
  const keys = new Set(Object.keys(doc.assignments).filter((k) => doc.assignments[k] === partId));
  const meshes: ImportedMesh[] = [];
  for (const s of Object.values(useSceneStore.getState().sources)) for (const m of s.meshes) if (keys.has(m.key)) meshes.push(m);
  // Typed arrays sized up front: a dense part has millions of vertices.
  let total = 0;
  for (const m of meshes) total += m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count - (m.geometry.getAttribute('position').count % 3);
  const positions = new Float32Array(total * 3);
  const index = new Uint32Array(total);
  let nv = 0;
  let ni = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const idx = m.geometry.index;
    const count = idx ? idx.count : pos.count - (pos.count % 3);
    // Only the vertices this mesh actually uses (split results share their source's buffer).
    const remap = idx ? new Map<number, number>() : null;
    for (let i = 0; i < count; i++) {
      const v = idx ? idx.getX(i) : i;
      let out = remap?.get(v);
      if (out === undefined) {
        out = nv++;
        remap?.set(v, out);
        positions[out * 3] = pos.getX(v);
        positions[out * 3 + 1] = pos.getY(v);
        positions[out * 3 + 2] = pos.getZ(v);
      }
      index[ni++] = out;
    }
  }
  // A very dense part (a million-triangle model) is brought down first: its structure has a few hundred nodes.
  return reduceDense({ positions: positions.slice(0, nv * 3), index });
}

function partsWithMeshes(): string[] {
  const doc = projectStore.getState().doc;
  if (!doc) return [];
  const assigned = new Set(Object.values(doc.assignments));
  return doc.parts.filter((p) => assigned.has(p.id)).map((p) => p.id);
}

/** Generate (or regenerate) the given parts as one undoable step. */
export async function generateParts(partIds: readonly string[], label?: string, choice?: GenerateChoice): Promise<PartReport[]> {
  const ui = useStructureUi.getState();
  if (!partIds.length || ui.busy) return [];
  ui.setBusy(true);
  try {
    await meshoptReady;
    const started = performance.now();
    const geometries: PartGeometry[] = partIds.map((partId) => ({ partId, mesh: partGeometry(partId) }));
    // Generate on a plain working copy (thousands of immer draft proxies would make this ~100× slower),
    // then commit it as one undoable assignment.
    const base = projectStore.getState().doc;
    if (!base) return [];
    const work = { parts: base.parts, hinges: base.hinges, nodes: [...base.nodes], beams: [...base.beams], tris: [...base.tris], proxy: { parts: { ...base.proxy.parts }, refNodes: base.proxy.refNodes } };
    const tax = currentTaxonomy();
    if (choice) {
      // The toolbar's choice goes onto each part (the Inspector shows it, and a part can still be changed on its own after).
      for (const id of partIds) {
        const part = base.parts.find((p) => p.id === id);
        const entry = part && tax.entry(part.taxonomyId);
        if (!part || !entry) continue;
        const own = partSettings(work, part, entry);
        work.proxy.parts[id] = { ...own, ...(choice.mode === 'auto' ? {} : { mode: choice.mode }), detail: choice.detail };
      }
    }
    // Where the car's wheels are (from its own wheel and tyre models), so nothing is built in their room.
    const wheels = base.parts
      .filter((p) => p.taxonomyId === 'tire' || p.taxonomyId === 'wheel')
      .map((p) => wheelSpaceOf(partGeometry(p.id)))
      .filter((w): w is WheelSpace => w !== null);
    const r = generateStructure(work, tax, geometries, wheels);
    const genMs = Math.round(performance.now() - started);
    projectStore.getState().execute({
      label: label ?? (partIds.length === 1 ? 'Generate part' : `Generate ${partIds.length} parts`),
      apply: (d) => {
        keepRowOptions(d, work);
        d.nodes = work.nodes;
        d.beams = work.beams;
        d.tris = work.tris;
        d.proxy = work.proxy;
      },
    });
    logger.debug(`generation ${genMs} ms, commit ${Math.round(performance.now() - started) - genMs} ms`);
    useStructureUi.getState().setReports(r.reports);
    const doc = projectStore.getState().doc!;
    const ms = Math.round(performance.now() - started);
    const unstable = r.reports.filter((x) => x.stability.verdict === 'unstable').length;
    logger.info(`generated ${r.reports.length} parts in ${ms} ms (${doc.nodes.length} nodes, ${doc.beams.length} beams); skipped ${r.skipped.length}`);
    useUiStore
      .getState()
      .pushStatus(
        `Generated ${r.reports.length} part${r.reports.length === 1 ? '' : 's'} in ${ms} ms · ${doc.nodes.length.toLocaleString()} nodes, ${doc.beams.length.toLocaleString()} beams${r.notProxies.length ? ` · ${r.notProxies.length} ride on their parent or wait for suspension` : ''}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}${unstable ? ` · ${unstable} unstable` : ''}`,
        unstable ? 'warning' : 'success',
        8000,
      );
    return r.reports;
  } catch (err) {
    logger.error('generation failed:', err instanceof Error ? err.message : String(err));
    useUiStore.getState().pushStatus(`Generation failed: ${err instanceof Error ? err.message : String(err)}`, 'danger', 10000);
    return [];
  } finally {
    useStructureUi.getState().setBusy(false);
  }
}

/** Properties set by hand in the JBeam workspace stay on the nodes, beams and triangles that are regenerated with the same names. */
function keepRowOptions(from: Pick<Project, 'nodes' | 'beams' | 'tris'>, to: Pick<Project, 'nodes' | 'beams' | 'tris'>): void {
  const nodes = new Map(from.nodes.filter((n) => n.options).map((n) => [n.id, n.options]));
  const beams = new Map(from.beams.filter((b) => b.options).map((b) => [`${beamKey(b.id1, b.id2)}|${b.kind}`, b.options]));
  const tris = new Map(from.tris.filter((t) => t.options).map((t) => [triKey(t.ids), t.options]));
  if (!nodes.size && !beams.size && !tris.size) return;
  to.nodes = to.nodes.map((n) => (!n.options && nodes.has(n.id) ? { ...n, options: nodes.get(n.id) } : n));
  to.beams = to.beams.map((b) => {
    const o = beams.get(`${beamKey(b.id1, b.id2)}|${b.kind}`);
    return !b.options && o ? { ...b, options: o } : b;
  });
  to.tris = to.tris.map((t) => {
    const o = tris.get(triKey(t.ids));
    return !t.options && o ? { ...t, options: o } : t;
  });
}

/** How Generate builds every part: one proxy mode for all ('auto' keeps each part's own), and the detail. */
export interface GenerateChoice {
  mode: 'auto' | ProxyMode;
  detail: number;
}

export function generateAll(choice?: GenerateChoice): Promise<PartReport[]> {
  return generateParts(partsWithMeshes(), 'Generate all parts', choice);
}

/** Change a part's generation settings (undoable), without regenerating. */
export function updateProxySettings(partId: string, patch: Partial<PartProxy>): void {
  const doc = projectStore.getState().doc;
  const part = doc?.parts.find((p) => p.id === partId);
  const entry = part && currentTaxonomy().entry(part.taxonomyId);
  if (!doc || !part || !entry) return;
  projectStore.getState().execute({
    label: 'Change generation settings',
    apply: (d) => {
      d.proxy.parts[partId] = { ...(d.proxy.parts[partId] ?? defaultProxySettings(entry)), ...patch };
    },
  });
}

export function clearStructure(partId: string): void {
  projectStore.getState().execute({
    label: 'Clear structure',
    apply: (d) => {
      removePartStructure(d, partId);
      delete d.proxy.parts[partId];
    },
  });
}

/** Live counts for the Detail slider (runs the proxy build without touching the document). */
export async function previewCounts(partId: string, settings: PartProxy): Promise<{ vertices: number; beams: number; triangles: number } | null> {
  const doc = projectStore.getState().doc;
  const part = doc?.parts.find((p) => p.id === partId);
  const entry = part && currentTaxonomy().entry(part.taxonomyId);
  if (!part || !entry) return null;
  await meshoptReady;
  const mesh = partGeometry(partId);
  if (mesh.index.length < 3) return null;
  const cap = massNodeCap(entry, partMass(part, entry, settings));
  const target = Math.min(targetVertices(kindDefaults(entry).budget, settings.detail), cap);
  const built = buildProxy(mesh, { maxVertices: cap, mode: settings.mode, targetVertices: target, symmetry: settings.symmetry, maxEdge: settings.maxEdge, minEdge: settings.minEdge, inset: settings.inset });
  return { vertices: built.stats.vertices, triangles: built.stats.triangles, beams: edges(built.mesh).length + braces(built.mesh, settings.bracing).length };
}

export { partSettings };
