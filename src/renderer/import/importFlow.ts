import { useEffect } from 'react';
import { IDENTITY_PLACEMENT } from '@shared/project/schema';
import { samePlacement } from '@shared/placement';
import { applyPlacement } from './placement';
import { applyMeshEdits, editsKey } from './meshEdits';
import { planSeed, seedMaterials } from '@renderer/materials/seed';
import type { MaterialDef } from '@shared/materials/schema';
import { registerImportedTextures } from '@renderer/materials/runtime';
import { produce } from 'immer';
import { legacyKeyMap, remapMeshKeys } from '@shared/mesh/legacyKeys';
import { create } from 'zustand';
import type { Project, Source } from '@shared/project/schema';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { textureCaps } from '@renderer/panels/viewport/registry';
import type { ImportSettings } from './normalize';
import { dirOf, fileNameOf, finishImport, stageImport, type StagedImport } from './pipeline';
import { disposeImported } from './dispose';
import { applySplits, splitsForSource } from './applySplits';
import type { ImportedMesh } from './normalize';
import { EMPTY_ARR } from '@shared/empty';
import { offerAutoClassify } from '@renderer/parts/commands';

const logger = rlog('import');

/** Import UI state: the staged file awaiting the settings dialog, and a busy label. */
interface ImportUiState {
  staged: StagedImport | null;
  busy: string | null;
  setStaged: (s: StagedImport | null) => void;
  setBusy: (b: string | null) => void;
}

export const useImportUi = create<ImportUiState>()((set) => ({
  staged: null,
  busy: null,
  setStaged: (staged) => set({ staged }),
  setBusy: (busy) => set({ busy }),
}));

function errorText(err: unknown): string {
  if (err instanceof IpcCallError) return err.ipcError.message;
  return err instanceof Error ? err.message : String(err);
}

export function fingerprint(s: Pick<Source, 'absolutePath' | 'import' | 'textureDirs'>): string {
  return JSON.stringify([s.absolutePath, s.import, s.textureDirs]);
}

function newSourceId(): string {
  return `src_${crypto.randomUUID().slice(0, 8)}`;
}

/** Store the path relative to the saved project's folder when it lives inside it. */
function storedPath(absolutePath: string): string {
  const projectPath = projectStore.getState().filePath;
  if (!projectPath) return absolutePath;
  const dir = dirOf(projectPath);
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  if (dir && norm(absolutePath).startsWith(`${norm(dir)}/`)) return absolutePath.slice(dir.length + 1).replace(/\\/g, '/');
  return absolutePath;
}

/** The source's meshes with the open document's splits applied (problems are logged and surfaced once). */
/** What a source's derived meshes depend on (splits, per-mesh edits and copies). */
function deriveKey(doc: Project | null, sourceId: string, meshKeys: ReadonlySet<string>): string {
  return `${JSON.stringify(splitsForSource(doc?.splits ?? EMPTY_ARR, sourceId))}|${editsKey(meshKeys, doc?.meshEdits ?? {}, doc?.meshCopies ?? EMPTY_ARR)}`;
}

/** The meshes a source shows: its raw import with splits, then per-mesh edits and copies, applied. */
export function deriveMeshes(sourceId: string, raw: ImportedMesh[]): { meshes: ImportedMesh[]; splitsKey: string } {
  const doc = projectStore.getState().doc;
  const splits = splitsForSource(doc?.splits ?? EMPTY_ARR, sourceId);
  let meshes = raw;
  if (splits.length) {
    const result = applySplits(raw, splits);
    meshes = result.meshes;
    if (result.problems.length) {
      logger.warn(`${result.problems.length} split(s) could not be applied:`, result.problems.join('; '));
      useUiStore.getState().pushStatus(`${result.problems.length} split${result.problems.length === 1 ? '' : 's'} could not be re-applied: ${result.problems[0]}`, 'warning', 10000);
    }
  }
  const keys = new Set(meshes.map((m) => m.key));
  meshes = applyMeshEdits(meshes, doc?.meshEdits ?? {}, doc?.meshCopies ?? EMPTY_ARR);
  return { meshes, splitsKey: deriveKey(doc, sourceId, keys) };
}

/** Toolbar / Scene panel / wizard entry point. */
export async function startImport(): Promise<void> {
  if (!projectStore.getState().doc) return;
  const ui = useImportUi.getState();
  try {
    const picked = await call('import:pickSource');
    if (!picked) return;
    ui.setBusy(`Reading ${fileNameOf(picked.path)} (${(picked.bytes / 1e6).toFixed(1)} MB)…`);
    const staged = await stageImport(picked.path, picked.format);
    ui.setStaged(staged);
  } catch (err) {
    logger.error('import failed:', errorText(err));
    void useDialogStore.getState().showAlert('Could not import model', errorText(err));
  } finally {
    ui.setBusy(null);
  }
}

/**
 * Import dialog confirmed: finish, show, then record the source (undoable).
 * `material` puts one ready-made material on every mesh (objects from the
 * library) instead of importing the file's own. Returns the new source id.
 */
export async function confirmImport(staged: StagedImport, settings: ImportSettings, opts: { material?: MaterialDef; classify?: boolean; textureDirs?: string[]; gameMaterials?: boolean } = {}): Promise<string | null> {
  const ui = useImportUi.getState();
  ui.setStaged(null);
  ui.setBusy(`Importing ${staged.fileName}…`);
  try {
    const sourceId = newSourceId();
    const source: Source = {
      id: sourceId,
      path: storedPath(staged.path),
      absolutePath: staged.path,
      format: staged.format,
      import: { scale: settings.scale, upAxis: settings.upAxis, forwardAxis: settings.forwardAxis },
      textureDirs: opts.textureDirs ?? [],
      placement: IDENTITY_PLACEMENT,
      addedAt: new Date().toISOString(),
    };
    const done = await finishImport(staged, sourceId, settings, opts.textureDirs ?? EMPTY_ARR, textureCaps());
    useSceneStore.getState().setSource({
      sourceId,
      status: 'ready',
      placement: IDENTITY_PLACEMENT,
      fingerprint: fingerprint(source),
      fileName: staged.fileName,
      raw: done.meshes,
      ...deriveMeshes(sourceId, done.meshes),
      textures: done.textures,
      error: null,
      stats: { triangles: staged.triangles, totalMs: done.totalMs },
    });
    registerImportedTextures(done.meshes);
    const doc = projectStore.getState().doc;
    let seed = opts.material ? objectSeed(doc?.materials ?? [], opts.material, done.meshes) : doc ? planSeed(doc, sourceId, done.meshes) : { materials: [], slots: {} };
    // Parts cut from the game's own vehicles use the game's materials: reference them by name.
    if (opts.gameMaterials) seed = { ...seed, materials: seed.materials.map((m) => ({ ...m, gameMaterial: m.name })) };
    projectStore.getState().execute({
      label: `Import ${staged.fileName}`,
      apply: (d) => {
        d.sources.push(source);
        d.materials.push(...seed.materials); // every material and texture comes along
        Object.assign(d.materialSlots, seed.slots);
      },
    });
    useSceneStore.getState().requestFrame();
    if (opts.classify !== false) offerAutoClassify(staged.fileName, done.meshes);
    const missing = done.textures.missing.length;
    useUiStore
      .getState()
      .pushStatus(
        `Imported ${staged.fileName}: ${done.meshes.length} meshes, ${staged.triangles.toLocaleString()} triangles in ${(done.totalMs / 1000).toFixed(1)} s${missing ? ` · ${missing} textures missing` : ''}`,
        missing ? 'warning' : 'success',
      );
    return sourceId;
  } catch (err) {
    logger.error('import failed:', errorText(err));
    void useDialogStore.getState().showAlert('Could not import model', errorText(err));
    return null;
  } finally {
    ui.setBusy(null);
  }
}

/** One library material for every mesh (and every slot) of an added object. */
function objectSeed(existing: readonly MaterialDef[], material: MaterialDef, meshes: readonly ImportedMesh[]): { materials: MaterialDef[]; slots: Record<string, string[]> } {
  const taken = new Set(existing.map((m) => m.name.toLowerCase()));
  let name = material.name;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${material.name}_${i}`;
  const def: MaterialDef = { ...material, id: `mat_${crypto.randomUUID().slice(0, 8)}`, name, origin: null };
  const slots: Record<string, string[]> = {};
  for (const m of meshes) slots[m.key] = (Array.isArray(m.material) ? m.material : [m.material]).map(() => def.id);
  return { materials: [def], slots };
}

/** "Locate folder…" for a source's missing textures (undoable; re-runs the import). */
export async function locateTextures(sourceId: string): Promise<void> {
  const dir = await call('import:pickTextureDir').catch(() => null);
  if (!dir) return;
  projectStore.getState().execute({
    label: 'Add texture folder',
    apply: (d) => {
      const s = d.sources.find((x) => x.id === sourceId);
      if (s && !s.textureDirs.includes(dir)) s.textureDirs.push(dir);
    },
  });
}

const inFlight = new Map<string, string>(); // sourceId → fingerprint being loaded

/** Is this exact source (same settings) still part of the open project? */
function stillWanted(sourceId: string, fp: string): boolean {
  if (inFlight.get(sourceId) !== fp) return false; // superseded or cancelled
  const s = projectStore.getState().doc?.sources.find((x) => x.id === sourceId);
  return !!s && fingerprint(s) === fp;
}

async function loadFromDisk(source: Source): Promise<void> {
  const fp = fingerprint(source);
  inFlight.set(source.id, fp);
  const base = { sourceId: source.id, fingerprint: fp, fileName: fileNameOf(source.absolutePath), raw: [], meshes: [], splitsKey: '', textures: null, stats: null };
  // Every store write checks the source still exists: an undo or project close
  // while this load runs must not leave a ghost source behind.
  const store = (s: Parameters<ReturnType<typeof useSceneStore.getState>['setSource']>[0]) => {
    if (stillWanted(source.id, fp)) useSceneStore.getState().setSource(s);
  };
  store({ ...base, status: 'loading', error: null });
  try {
    const path = await call('import:locateSource', { projectPath: projectStore.getState().filePath, path: source.path, absolutePath: source.absolutePath });
    if (!path) {
      store({ ...base, status: 'missing', error: `Source file not found or not allowed: ${source.absolutePath}` });
      return;
    }
    const staged = await stageImport(path, source.format);
    const done = await finishImport(staged, source.id, source.import, source.textureDirs, textureCaps());
    if (!stillWanted(source.id, fp)) {
      disposeImported(done.meshes);
      return;
    }
    if (source.format === 'fbx') adoptLegacyFbxKeys(source.id, done.meshes);
    registerImportedTextures(done.meshes);
    applyPlacement(done.meshes, IDENTITY_PLACEMENT, source.placement);
    store({ ...base, status: 'ready', placement: source.placement, raw: done.meshes, ...deriveMeshes(source.id, done.meshes), textures: done.textures, error: null, stats: { triangles: staged.triangles, totalMs: done.totalMs } });
    seedMaterials(source.id, done.meshes); // projects from before materials existed
  } catch (err) {
    store({ ...base, status: 'error', error: errorText(err) });
  } finally {
    if (inFlight.get(source.id) === fp) inFlight.delete(source.id);
  }
}

/** After folder consent: retry every source that couldn't be read. */
export function reloadUnreadySources(): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const loaded = useSceneStore.getState().sources;
  for (const s of doc.sources) {
    const l = loaded[s.id];
    const ready = l?.status === 'ready' && !l.textures?.missing.length;
    if (!ready && !inFlight.has(s.id)) void loadFromDisk(s);
  }
}

/**
 * Keep loaded geometry in step with `doc.sources`: load new/changed sources
 * (project open, redo, texture folder added), drop removed ones (undo).
 */
export function useSourceSync(): void {
  const sources = useProjectStore((s) => s.doc?.sources ?? EMPTY_ARR);
  useEffect(() => {
    const scene = useSceneStore.getState();
    const wanted = new Set(sources.map((s) => s.id));
    for (const id of Object.keys(scene.sources)) {
      if (wanted.has(id)) continue;
      inFlight.delete(id); // cancel any load still running for it
      scene.removeSource(id);
    }
    for (const s of sources) {
      const loaded = useSceneStore.getState().sources[s.id];
      const fp = fingerprint(s);
      if ((loaded && loaded.fingerprint === fp) || inFlight.get(s.id) === fp) continue;
      void loadFromDisk(s);
    }
  }, [sources]);

  // Placement changed (moved in the Placement dialog, undo/redo): move the loaded geometry, no reload.
  useEffect(() => {
    const scene = useSceneStore.getState();
    for (const s of sources) {
      const loaded = scene.sources[s.id];
      if (loaded?.status !== 'ready' || !loaded.placement || samePlacement(loaded.placement, s.placement)) continue;
      applyPlacement(loaded.raw, loaded.placement, s.placement);
      scene.setSource({ ...loaded, placement: s.placement, ...deriveMeshes(s.id, loaded.raw) });
    }
  }, [sources]);

  // Splits changed (split, unsplit, undo/redo): re-derive the affected sources from their raw meshes.
  // Per-mesh edits and copies too: the same re-derive.
  const splits = useProjectStore((s) => s.doc?.splits ?? EMPTY_ARR);
  const meshEdits = useProjectStore((s) => s.doc?.meshEdits);
  const meshCopies = useProjectStore((s) => s.doc?.meshCopies);
  useEffect(() => {
    const scene = useSceneStore.getState();
    const doc = projectStore.getState().doc;
    for (const src of Object.values(scene.sources)) {
      if (src.status !== 'ready') continue;
      const splitKeys = new Set(applySplits(src.raw, splitsForSource(splits, src.sourceId)).meshes.map((m) => m.key));
      if (deriveKey(doc, src.sourceId, splitKeys) === src.splitsKey) continue;
      scene.setSource({ ...src, ...deriveMeshes(src.sourceId, src.raw) });
    }
  }, [splits, meshEdits, meshCopies]);

  // Leaving the editor (project closed) cancels loads and frees all geometry.
  useEffect(
    () => () => {
      inFlight.clear();
      useSceneStore.getState().clear();
    },
    [],
  );
}

/**
 * Projects saved before 0.7.1 knew FBX meshes by their sanitised names
 * ("Circle087" for "Circle.087"). Move those references to the real names
 * before the scene is built. It's a one-time upgrade of the document, so it
 * isn't an undo step; the project shows as unsaved, and any undo history
 * saved with the old names is dropped rather than replayed onto new keys.
 */
function adoptLegacyFbxKeys(sourceId: string, meshes: readonly { name: string }[]): void {
  const state = projectStore.getState();
  if (!state.doc) return;
  const map = legacyKeyMap(state.doc, sourceId, meshes.map((m) => m.name));
  if (!map.size) return;
  projectStore.setState((s) => ({
    doc: s.doc && produce(s.doc, (d) => remapMeshKeys(d, map)),
    undoStack: [],
    redoStack: [],
    savedStateId: null,
  }));
  logger.info(`updated ${map.size} mesh reference(s) from pre-0.7.1 FBX names`);
}
