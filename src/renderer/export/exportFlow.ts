import { create } from 'zustand';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { capturePreview } from '@renderer/panels/viewport/registry';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import type { ExportBundle } from '@shared/ipc-contract';
import { buildJbeamFiles } from '@shared/export/jbeam';
import { configInfo, DEFAULT_CONFIG, defaultConfig, exportMeshNames, infoJson, materialsJson } from '@shared/export/files';
import { validateExport, type ValidationReport } from '@shared/export/validate';
import { writeDae, type DaeMesh } from './dae';
import { collectMaterials } from './materials';

const logger = rlog('export');

/**
 * Export Mod (SPEC §4.15): builds the complete `vehicles/<slug>/` folder in
 * the renderer (DAE, jbeam per part, materials, info, default config, preview)
 * and hands it to main, which installs it unpacked into BeamNG's mods folder
 * or writes a zip.
 */

export interface PreparedExport {
  bundle: ExportBundle;
  report: ValidationReport;
  summary: { parts: number; meshes: number; nodes: number; beams: number; textures: number; daeBytes: number };
}

interface ExportUiState {
  open: boolean;
  prepared: PreparedExport | null;
  busy: string | null;
  result: { path: string; bytes: number; mode: 'install' | 'zip' } | null;
  error: string | null;
  setOpen: (open: boolean) => void;
  set: (patch: Partial<Omit<ExportUiState, 'setOpen' | 'set'>>) => void;
}

export const useExportUi = create<ExportUiState>()((set) => ({
  open: false,
  prepared: null,
  busy: null,
  result: null,
  error: null,
  setOpen: (open) => set({ open, ...(open ? {} : { prepared: null, result: null, error: null, busy: null }) }),
  set: (patch) => set(patch),
}));

function errorText(err: unknown): string {
  if (err instanceof IpcCallError) return err.ipcError.message;
  return err instanceof Error ? err.message : String(err);
}

function base64FromDataUrl(url: string): string {
  return url.slice(url.indexOf(',') + 1);
}

/** Build everything (no side effects) and validate it. */
export function prepareExport(): PreparedExport | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const slug = doc.meta.slug;
  const tax = currentTaxonomy();
  const author = useSettingsStore.getState().settings?.author || doc.meta.author;
  const sources = Object.values(useSceneStore.getState().sources);
  const formatOf = new Map(doc.sources.map((s) => [s.id, s.format]));
  const allMeshes = sources.flatMap((s) => s.meshes);
  const meshNames = exportMeshNames(doc, allMeshes);
  const exported = allMeshes.filter((m) => meshNames.has(m.key));

  const mats = collectMaterials(
    slug,
    exported.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])),
  );
  const daeMeshes: DaeMesh[] = exported.map((m) => ({
    name: meshNames.get(m.key)!,
    geometry: m.geometry,
    materials: (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => mats.names.get(mat)!),
    flipV: formatOf.get(m.sourceId) === 'gltf' || formatOf.get(m.sourceId) === 'glb',
  }));
  const dae = writeDae(
    daeMeshes,
    mats.materials.map((m) => ({ name: m.name, color: m.baseColor })),
  );
  const jbeams = buildJbeamFiles(doc, tax, { meshNames, author });
  const pc = defaultConfig(doc, tax);
  const root = `vehicles/${slug}`;
  const files: ExportBundle['files'] = [
    { path: `${root}/${slug}.dae`, text: dae },
    ...jbeams.map((j) => ({ path: `${root}/${j.file}`, text: j.text })),
    { path: `${root}/main.materials.json`, text: `${JSON.stringify(materialsJson(slug, mats.materials), null, 2)}\n` },
    { path: `${root}/info.json`, text: `${JSON.stringify(infoJson(doc, author), null, 2)}\n` },
    { path: `${root}/${DEFAULT_CONFIG}.pc`, text: `${JSON.stringify(pc, null, 2)}\n` },
    { path: `${root}/info_${DEFAULT_CONFIG}.json`, text: `${JSON.stringify(configInfo(doc, pc), null, 2)}\n` },
  ];
  const preview = capturePreview();
  if (preview) files.push({ path: `${root}/${DEFAULT_CONFIG}.jpg`, base64: base64FromDataUrl(preview) });

  const exportedSources = new Set(exported.map((m) => m.sourceId));
  const missingTextures = sources.filter((s) => exportedSources.has(s.sourceId)).flatMap((s) => (s.textures?.missing ?? []).map((ref) => ({ material: s.fileName, ref })));
  const report = validateExport(doc, tax, {
    meshNames,
    daeNodes: new Set(daeMeshes.map((m) => m.name)),
    missingTextures,
    loadedMeshKeys: allMeshes.map((m) => m.key),
  });
  return {
    bundle: { slug, projectName: doc.meta.name, files, copies: mats.copies },
    report,
    summary: { parts: doc.parts.length, meshes: exported.length, nodes: doc.nodes.length, beams: doc.beams.length, textures: mats.copies.length, daeBytes: dae.length },
  };
}

export function openExport(): void {
  const ui = useExportUi.getState();
  ui.setOpen(true);
  try {
    ui.set({ prepared: prepareExport(), error: null, result: null });
  } catch (err) {
    logger.error('export preparation failed:', errorText(err));
    ui.set({ error: `Could not prepare the export: ${errorText(err)}` });
  }
}

/** Refresh after fixing problems (e.g. generating missing structure). */
export function refreshExport(): void {
  const ui = useExportUi.getState();
  try {
    ui.set({ prepared: prepareExport(), error: null });
  } catch (err) {
    ui.set({ error: errorText(err) });
  }
}

export async function runExport(mode: 'install' | 'zip'): Promise<void> {
  const ui = useExportUi.getState();
  const prepared = ui.prepared;
  if (!prepared || prepared.report.errors.length) return;
  ui.set({ busy: mode === 'install' ? 'Installing into BeamNG…' : 'Writing zip…', error: null });
  try {
    const r = mode === 'install' ? await call('export:install', prepared.bundle) : await call('export:zip', prepared.bundle);
    if (r) {
      ui.set({ result: { ...r, mode } });
      logger.info(`export ${mode}: ${r.path}`);
    }
  } catch (err) {
    ui.set({ error: errorText(err) });
  } finally {
    useExportUi.getState().set({ busy: null });
  }
}
