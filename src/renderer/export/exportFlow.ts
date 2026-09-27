import { create } from 'zustand';
import { withMeshNames } from '@shared/parts/meshNames';
import { slotsOf } from '@renderer/materials/seed';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { capturePreview } from '@renderer/panels/viewport/registry';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import type { ExportBundle } from '@shared/ipc-contract';
import { buildJbeamFiles, damagedMaterialName } from '@shared/export/jbeam';
import { buildGlowMap, lightFunction, onMaterialName } from '@shared/export/lights';
import { loadFittedSets, useSetData } from '@renderer/suspension/commands';
import { configInfo, DEFAULT_CONFIG, defaultConfig, exportMeshNames, infoJson, materialsJson } from '@shared/export/files';
import { validateExport, type ValidationReport } from '@shared/export/validate';
import { writeDae, type DaeMesh } from './dae';
import { collectMaterials, createTextureNamer, projectMaterialExport } from './materials';

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
  const allMeshes = withMeshNames(doc, sources.flatMap((s) => s.meshes));
  const meshNames = exportMeshNames(doc, allMeshes);
  const exported = allMeshes.filter((m) => meshNames.has(m.key));

  // Project materials first; a mesh without any (shouldn't happen after import) keeps its imported one.
  const namer = createTextureNamer(slug);
  const takenNames = new Set<string>();
  const usedIds = new Set(exported.flatMap((m) => slotsOf(doc, m.key) ?? []));
  const project = projectMaterialExport(slug, doc.materials.filter((d) => usedIds.has(d.id)), namer, takenNames);
  const unslotted = exported.filter((m) => !slotsOf(doc, m.key)?.length);
  const mats = collectMaterials(
    slug,
    unslotted.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])),
    namer,
    takenNames,
  );
  const daeMeshes: DaeMesh[] = exported.map((m) => {
    const imported = Array.isArray(m.material) ? m.material : [m.material];
    const ids = slotsOf(doc, m.key);
    return {
      name: meshNames.get(m.key)!,
      geometry: m.geometry,
      materials: ids?.length ? ids.map((id) => project.names.get(id) ?? `${slug}_missing`) : imported.map((mat) => mats.names.get(mat)!),
      flipV: formatOf.get(m.sourceId) === 'gltf' || formatOf.get(m.sourceId) === 'glb',
    };
  });
  const dae = writeDae(daeMeshes, [...project.colors, ...mats.materials.map((m) => ({ name: m.name, color: m.baseColor }))]);
  // Lights: materials used only by light parts glow with their signal (an "on" twin of each).
  const partOf = (key: string) => doc.parts.find((p) => p.id === doc.assignments[key]);
  const { glowMap, shared: sharedLights } = buildGlowMap(
    daeMeshes.flatMap((dm, i) => {
      const part = partOf(exported[i]!.key);
      const light = part ? lightFunction(part.taxonomyId, part.position) : null;
      return dm.materials.map((material) => ({ material, light }));
    }),
  );
  const materialJsonAll: Record<string, unknown> = { ...project.json, ...materialsJson(slug, mats.materials) };
  for (const name of Object.keys(glowMap)) {
    const off = materialJsonAll[name] as { Stages?: Record<string, unknown>[] } | undefined;
    if (!off) {
      delete glowMap[name]; // a game material: its own glow is the game's business
      continue;
    }
    const on = structuredClone(off) as { name?: string; mapTo?: string; Stages?: Record<string, unknown>[] };
    on.name = onMaterialName(name);
    on.mapTo = onMaterialName(name);
    const stage = on.Stages?.[0];
    if (stage) {
      const color = Array.isArray(stage.baseColorFactor) ? (stage.baseColorFactor as number[]).slice(0, 3) : [1, 1, 1];
      stage.emissiveFactor = color;
      stage.glow = true;
      if (typeof stage.baseColorMap === 'string') stage.emissiveMap = stage.baseColorMap;
    }
    materialJsonAll[onMaterialName(name)] = on;
  }
  // Glass: a frosted, cracked-looking twin of each glass material for when it shatters.
  for (const [i, dm] of daeMeshes.entries()) {
    const part = partOf(exported[i]!.key);
    if (!part || tax.entry(part.taxonomyId)?.beamPreset !== 'glass_brittle') continue;
    const name = dm.materials[0];
    const base = name ? (materialJsonAll[name] as { Stages?: Record<string, unknown>[] } | undefined) : undefined;
    if (!name || !base || materialJsonAll[damagedMaterialName(name)]) continue;
    const dmg = structuredClone(base) as { name?: string; mapTo?: string; Stages?: Record<string, unknown>[] };
    dmg.name = damagedMaterialName(name);
    dmg.mapTo = damagedMaterialName(name);
    const stage = dmg.Stages?.[0];
    if (stage) {
      stage.roughnessFactor = 0.85;
      stage.opacityFactor = Math.max(0.75, typeof stage.opacityFactor === 'number' ? stage.opacityFactor : 0);
    }
    materialJsonAll[damagedMaterialName(name)] = dmg;
  }
  const meshMaterials = new Map(daeMeshes.map((dm) => [dm.name, dm.materials]));
  const jbeams = buildJbeamFiles(doc, tax, { meshNames, author, suspensions: useSetData.getState().data, glowMap, meshMaterials });
  const pc = defaultConfig(doc, tax);
  const root = `vehicles/${slug}`;
  const files: ExportBundle['files'] = [
    { path: `${root}/${slug}.dae`, text: dae },
    ...jbeams.map((j) => ({ path: `${root}/${j.file}`, text: j.text })),
    { path: `${root}/main.materials.json`, text: `${JSON.stringify(materialJsonAll, null, 2)}\n` },
    { path: `${root}/info.json`, text: `${JSON.stringify(infoJson(doc, author), null, 2)}\n` },
    { path: `${root}/${DEFAULT_CONFIG}.pc`, text: `${JSON.stringify(pc, null, 2)}\n` },
    { path: `${root}/info_${DEFAULT_CONFIG}.json`, text: `${JSON.stringify(configInfo(doc, tax, pc), null, 2)}\n` },
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
  for (const m of sharedLights) report.warnings.push({ code: 'LIGHT_SHARED_MATERIAL', message: `Material ${m} is on a light and on other parts too, so it won't glow (or the other parts would). Give the light its own material.` });
  return {
    bundle: { slug, projectName: doc.meta.name, files, copies: mats.copies },
    report,
    summary: { parts: doc.parts.length, meshes: exported.length, nodes: doc.nodes.length, beams: doc.beams.length, textures: mats.copies.length, daeBytes: dae.length },
  };
}

export async function openExport(): Promise<void> {
  const ui = useExportUi.getState();
  ui.setOpen(true);
  await loadFittedSets().catch((err: unknown) => logger.warn('suspension jbeam not loaded:', errorText(err)));
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
