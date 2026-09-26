import { createEmptyProject, parseProject, ProjectLoadError, serializeProject, type NewProjectMeta } from '@shared/project/io';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { currentStateId, isDirty, projectStore } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useUiStore } from '@renderer/app/stores/ui';
import { captureThumbnail } from '@renderer/panels/viewport/registry';

/**
 * Project lifecycle (SPEC §4.1): every entry point that could lose work goes
 * through `confirmDiscardOrSave()` first. Returns false when the user
 * cancelled or something failed (the failure is already shown to them).
 */

const logger = rlog('project');

function status(text: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info'): void {
  useUiStore.getState().pushStatus(text, tone);
}

function errorMessage(err: unknown): string {
  if (err instanceof IpcCallError) return err.ipcError.message;
  return err instanceof Error ? err.message : String(err);
}

/** Resolve unsaved changes before replacing/closing the document. True = proceed. */
export async function confirmDiscardOrSave(): Promise<boolean> {
  const state = projectStore.getState();
  if (!state.doc || !isDirty(state)) return true;
  const choice = await useDialogStore.getState().askUnsaved(state.doc.meta.name);
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  return saveProject();
}

export async function newProject(meta: NewProjectMeta): Promise<boolean> {
  if (!(await confirmDiscardOrSave())) return false;
  projectStore.getState().create(createEmptyProject(meta, __APP_VERSION__));
  status(`Created ${meta.name} — save it to choose where it lives`);
  return true;
}

function loadFromText(path: string, text: string): boolean {
  try {
    const { project, migratedFrom } = parseProject(text);
    projectStore.getState().load(project, path);
    status(migratedFrom === null ? `Opened ${project.meta.name}` : `Opened ${project.meta.name} (upgraded from format v${migratedFrom}; saving will write the new format)`, 'success');
    return true;
  } catch (err) {
    const detail = err instanceof ProjectLoadError ? err.message : errorMessage(err);
    logger.error('open failed:', path, detail);
    void useDialogStore.getState().showAlert('Could not open project', `${path}\n\n${detail}`);
    return false;
  }
}

export async function openProject(): Promise<boolean> {
  if (!(await confirmDiscardOrSave())) return false;
  try {
    const file = await call('project:open');
    return file ? loadFromText(file.path, file.text) : false;
  } catch (err) {
    void useDialogStore.getState().showAlert('Could not open project', errorMessage(err));
    return false;
  }
}

export async function openRecentProject(path: string): Promise<boolean> {
  if (!(await confirmDiscardOrSave())) return false;
  try {
    const file = await call('project:openRecent', { path });
    return loadFromText(file.path, file.text);
  } catch (err) {
    void useDialogStore.getState().showAlert('Could not open project', errorMessage(err));
    return false;
  }
}

/** Serialize now, remembering which history position the text represents. */
function prepareForSave(): { text: string; stamp: string; stateId: number } | null {
  const state = projectStore.getState();
  if (!state.doc) return null;
  const stamp = new Date().toISOString();
  return { text: serializeProject({ ...state.doc, meta: { ...state.doc.meta, modifiedAt: stamp } }), stamp, stateId: currentStateId(state) };
}

export async function saveProject(): Promise<boolean> {
  const { filePath } = projectStore.getState();
  if (!filePath) return saveProjectAs();
  const prepared = prepareForSave();
  if (!prepared) return false;
  try {
    await call('project:save', { path: filePath, text: prepared.text, thumbnail: captureThumbnail() });
    projectStore.getState().markSaved(filePath, prepared.stateId, (d) => void (d.meta.modifiedAt = prepared.stamp));
    status('Saved', 'success');
    return true;
  } catch (err) {
    void useDialogStore.getState().showAlert('Could not save project', errorMessage(err));
    return false;
  }
}

export async function saveProjectAs(): Promise<boolean> {
  const { doc } = projectStore.getState();
  const prepared = prepareForSave();
  if (!doc || !prepared) return false;
  try {
    const path = await call('project:saveAs', { text: prepared.text, suggestedName: `${doc.meta.slug}.jbforge`, thumbnail: captureThumbnail() });
    if (!path) return false;
    projectStore.getState().markSaved(path, prepared.stateId, (d) => void (d.meta.modifiedAt = prepared.stamp));
    status(`Saved as ${path}`, 'success');
    return true;
  } catch (err) {
    void useDialogStore.getState().showAlert('Could not save project', errorMessage(err));
    return false;
  }
}

export async function closeProject(): Promise<boolean> {
  if (!(await confirmDiscardOrSave())) return false;
  projectStore.getState().close();
  return true;
}

export function undo(): void {
  const label = projectStore.getState().undo();
  if (label) status(`Undo: ${label}`);
}

export function redo(): void {
  const label = projectStore.getState().redo();
  if (label) status(`Redo: ${label}`);
}
