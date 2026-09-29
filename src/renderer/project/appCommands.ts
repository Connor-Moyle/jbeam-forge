import type { AppCommand } from '@shared/ipc-contract';
import { projectStore } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { closeProject, openProject, redo, saveProject, saveProjectAs, undo } from './actions';
import { startImport } from '@renderer/import/importFlow';
import { startAcImport } from '@renderer/import/acImport';
import { exportModel } from '@renderer/export/modelExport';
import { useEditStore } from '@renderer/structure/editStore';
import { selectAll } from '@renderer/structure/editCommands';
import { redoStroke, undoStroke, usePainter } from '@renderer/paint/painter';

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'range'].includes(el.type);
  return (el as HTMLElement).isContentEditable;
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
      if (isEditableTarget(document.activeElement)) document.execCommand('undo');
      // While painting on the car, undo takes back strokes (they aren't document edits).
      else if (usePainter.getState().on && usePainter.getState().tool !== 'vinyl') undoStroke();
      else undo();
      break;
    case 'redo':
      if (isEditableTarget(document.activeElement)) document.execCommand('redo');
      else if (usePainter.getState().on && usePainter.getState().tool !== 'vinyl') redoStroke();
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
      useDialogStore.getState().setTutorialOpen(true);
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
