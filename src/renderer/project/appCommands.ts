import type { AppCommand } from '@shared/ipc-contract';
import { keyOfEvent, normaliseKey } from '@shared/keymap';
import { isKey } from '@renderer/app/keys';
import { projectStore } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { closeProject, openProject, redo, saveProject, saveProjectAs, undo } from './actions';
import { startImport } from '@renderer/import/importFlow';
import { startAcImport } from '@renderer/import/acImport';
import { exportModel } from '@renderer/export/modelExport';
import { startTutorial } from '@renderer/help/tutorial';
import { useEditStore } from '@renderer/structure/editStore';
import { selectAll } from '@renderer/structure/editCommands';
import { redoStroke, undoStroke, usePainter } from '@renderer/paint/painter';

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'range'].includes(el.type);
  return (el as HTMLElement).isContentEditable;
}

/**
 * Undo or redo typing in the focused text field. False when no field has focus
 * or it had nothing to take back (so a field left focused after an edit doesn't
 * swallow Ctrl+Z: the document's undo runs instead).
 */
function textHistory(which: 'undo' | 'redo'): boolean {
  const el = document.activeElement;
  if (!isEditableTarget(el)) return false;
  const read = () => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).textContent);
  const before = read();
  document.execCommand(which);
  return read() !== before;
}

/** When the page itself last handled an undo or redo key (see `installHistoryKeys`). */
let historyKeyAt = -Infinity;
const REDO_ALT = normaliseKey('Ctrl+Shift+Z');

/**
 * Undo and redo keys, handled in the page so they work wherever focus is and
 * whether or not the native menu sees the key (a hidden menu bar, some Linux
 * setups). Editors with their own history (the Lua editor) handle their keys
 * first. The menu's accelerator for the same press is ignored (`runMenuCommand`).
 */
export function installHistoryKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const which = isKey(e, 'undo') ? 'undo' : isKey(e, 'redo') || keyOfEvent(e) === REDO_ALT ? 'redo' : null;
    if (!which) return;
    e.preventDefault();
    historyKeyAt = performance.now();
    runAppCommand(which);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** A command from the native menu: undo/redo the page just ran for the same key press are not run twice. */
export function runMenuCommand(command: AppCommand): void {
  if ((command === 'undo' || command === 'redo') && performance.now() - historyKeyAt < 300) return;
  runAppCommand(command);
}

/** Commands from the native menu (and test hooks). */
export function runAppCommand(command: AppCommand): void {
  switch (command) {
    case 'new':
      useDialogStore.getState().setNewModOpen(true);
      break;
    case 'open':
      void openProject();
      break;
    case 'save':
      if (projectStore.getState().doc) void saveProject();
      break;
    case 'saveAs':
      if (projectStore.getState().doc) void saveProjectAs();
      break;
    case 'import':
      void startImport();
      break;
    case 'importAc':
      if (projectStore.getState().doc) void startAcImport();
      break;
    case 'close':
      if (projectStore.getState().doc) void closeProject();
      break;
    case 'undo':
      // Text fields keep their own undo; everything else undoes document edits.
      if (textHistory('undo')) break;
      // While painting on the car, undo takes back strokes (they aren't document edits).
      if (usePainter.getState().on && usePainter.getState().tool !== 'vinyl') undoStroke();
      else undo();
      break;
    case 'redo':
      if (textHistory('redo')) break;
      if (usePainter.getState().on && usePainter.getState().tool !== 'vinyl') redoStroke();
      else redo();
      break;
    case 'selectAll':
      if (!isEditableTarget(document.activeElement) && useEditStore.getState().active) selectAll();
      else document.execCommand('selectAll');
      break;
    case 'palette':
      useDialogStore.getState().setPaletteOpen(true);
      break;
    case 'shortcuts':
      useDialogStore.getState().setShortcutsOpen(true);
      break;
    case 'help':
      useDialogStore.getState().setHelpOpen(true);
      break;
    case 'tutorial':
      void startTutorial();
      break;
    case 'settings':
      useDialogStore.getState().setSettingsOpen(true);
      break;
    case 'downloads':
      useDialogStore.getState().setDownloads('app');
      break;
    case 'exportModelGlb':
      if (projectStore.getState().doc) void exportModel('glb');
      break;
    case 'exportModelDae':
      if (projectStore.getState().doc) void exportModel('dae');
      break;
  }
}
