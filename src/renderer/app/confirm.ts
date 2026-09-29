import { useDialogStore } from './stores/dialogs';
import { useSettingsStore } from './stores/settings';

/**
 * Before deleting something that took work to make: ask (Settings →
 * Interface → Ask before deleting). Undo still brings it back either way.
 */
export async function confirmDelete(what: string, detail = 'You can undo this with Ctrl+Z.'): Promise<boolean> {
  if (!(useSettingsStore.getState().settings?.confirmDeletes ?? true)) return true;
  return useDialogStore.getState().askConfirm(`Delete ${what}?`, detail);
}
