import { useEffect } from 'react';
import { create } from 'zustand';
import type { Source } from '@shared/project/schema';
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
export function deriveMeshes(sourceId: string, raw: ImportedMesh[]): { meshes: ImportedMesh[]; splitsKey: string } {
  const splits = splitsForSource(projectStore.getState().doc?.splits ?? EMPTY_ARR, sourceId);
  const splitsKey = JSON.stringify(splits);
  if (splits.length === 0) return { meshes: raw, splitsKey };
  const { meshes, problems } = applySplits(raw, splits);
  if (problems.length) {
    logger.warn(`${problems.length} split(s) could not be applied:`, problems.join('; '));
    useUiStore.getState().pushStatus(`${problems.length} split${problems.length === 1 ? '' : 's'} could not be re-applied: ${problems[0]}`, 'warning', 10000);
  }
  return { meshes, splitsKey };
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

/** Import dialog confirmed: finish, show, then record the source (undoable). */
export async function confirmImport(staged: StagedImport, settings: ImportSettings): Promise<void> {
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
      textureDirs: [],
      addedAt: new Date().toISOString(),
    };
    const done = await finishImport(staged, sourceId, settings, EMPTY_ARR, textureCaps());
    useSceneStore.getState().setSource({
      sourceId,
      status: 'ready',
      fingerprint: fingerprint(source),
      fileName: staged.fileName,
      raw: done.meshes,
      ...deriveMeshes(sourceId, done.meshes),
      textures: done.textures,
      error: null,
      stats: { triangles: staged.triangles, totalMs: done.totalMs },
    });
    projectStore.getState().execute({ label: `Import ${staged.fileName}`, apply: (d) => void d.sources.push(source) });
    useSceneStore.getState().requestFrame();
    offerAutoClassify(staged.fileName, done.meshes);
    const missing = done.textures.missing.length;
    useUiStore
      .getState()
      .pushStatus(
        `Imported ${staged.fileName}: ${done.meshes.length} meshes, ${staged.triangles.toLocaleString()} triangles in ${(done.totalMs / 1000).toFixed(1)} s${missing ? ` · ${missing} textures missing` : ''}`,
        missing ? 'warning' : 'success',
      );
  } catch (err) {
    logger.error('import failed:', errorText(err));
    void useDialogStore.getState().showAlert('Could not import model', errorText(err));
  } finally {
    ui.setBusy(null);
  }
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
    store({ ...base, status: 'ready', raw: done.meshes, ...deriveMeshes(source.id, done.meshes), textures: done.textures, error: null, stats: { triangles: staged.triangles, totalMs: done.totalMs } });
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

  // Splits changed (split, unsplit, undo/redo): re-derive the affected sources from their raw meshes.
  const splits = useProjectStore((s) => s.doc?.splits ?? EMPTY_ARR);
  useEffect(() => {
    const scene = useSceneStore.getState();
    for (const src of Object.values(scene.sources)) {
      if (src.status !== 'ready') continue;
      const key = JSON.stringify(splitsForSource(splits, src.sourceId));
      if (key === src.splitsKey) continue;
      scene.setSource({ ...src, ...deriveMeshes(src.sourceId, src.raw) });
    }
  }, [splits]);

  // Leaving the editor (project closed) cancels loads and frees all geometry.
  useEffect(
    () => () => {
      inFlight.clear();
      useSceneStore.getState().clear();
    },
    [],
  );
}
