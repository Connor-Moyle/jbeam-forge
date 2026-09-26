import { create } from 'zustand';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { rlog } from '@renderer/diagnostics/logger';
import type { ImportedMesh } from '@renderer/import/normalize';
import type { PartProxy } from '@shared/project/schema';
import type { ProxyMesh } from '@shared/proxy/mesh';
import { buildProxy } from '@shared/proxy/build';
import { meshoptReady } from '@shared/proxy/shapes';
import { edges } from '@shared/proxy/mesh';
import { defaultProxySettings, generateStructure, massNodeCap, partMass, partSettings, removePartStructure, type PartGeometry, type PartReport } from '@shared/proxy/generate';
import { braces } from '@shared/proxy/derive';
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
  const positions: number[] = [];
  const index: number[] = [];
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const idx = m.geometry.index;
    const count = idx ? idx.count : pos.count - (pos.count % 3);
    // Only the vertices this mesh actually uses (split results share their source's buffer).
    const remap = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const v = idx ? idx.getX(i) : i;
      let out = remap.get(v);
      if (out === undefined) {
        out = positions.length / 3;
        remap.set(v, out);
        positions.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      }
      index.push(out);
    }
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

function partsWithMeshes(): string[] {
  const doc = projectStore.getState().doc;
  if (!doc) return [];
  const assigned = new Set(Object.values(doc.assignments));
  return doc.parts.filter((p) => assigned.has(p.id)).map((p) => p.id);
}

/** Generate (or regenerate) the given parts as one undoable step. */
export async function generateParts(partIds: readonly string[], label?: string): Promise<PartReport[]> {
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
    const work = { parts: base.parts, nodes: [...base.nodes], beams: [...base.beams], tris: [...base.tris], proxy: { parts: { ...base.proxy.parts }, refNodes: base.proxy.refNodes } };
    const r = generateStructure(work, currentTaxonomy(), geometries);
    const genMs = Math.round(performance.now() - started);
    projectStore.getState().execute({
      label: label ?? (partIds.length === 1 ? 'Generate part' : `Generate ${partIds.length} parts`),
      apply: (d) => {
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

export function generateAll(): Promise<PartReport[]> {
  return generateParts(partsWithMeshes(), 'Generate all parts');
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
