import type { AppCommand } from '@shared/ipc-contract';
import { projectStore } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { closeProject, openProject, redo, saveProject, saveProjectAs, undo } from './actions';

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
    case 'close':
      if (projectStore.getState().doc) void closeProject();
      break;
    case 'undo':
      // Text fields keep their own undo; everything else undoes document edits.
      if (isEditableTarget(document.activeElement)) document.execCommand('undo');
      else undo();
      break;
    case 'redo':
      if (isEditableTarget(document.activeElement)) document.execCommand('redo');
      else redo();
      break;
  }
}
