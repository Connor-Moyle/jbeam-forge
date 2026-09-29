import { isDirty, projectStore, setUndoLimit } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { saveProject } from './actions';

/**
 * Settings → General, the project side: autosave every N minutes (only a
 * project that has a file, only when it has changes, never while a dialog
 * is asking something) and the undo limit.
 */
let timer: ReturnType<typeof setInterval> | null = null;
let minutes = -1;
let saving = false;

async function tick(): Promise<void> {
  const s = projectStore.getState();
  const dialogs = useDialogStore.getState();
  if (saving || !s.doc || !s.filePath || !isDirty(s) || dialogs.unsaved || dialogs.alert || dialogs.folders) return;
  saving = true;
  try {
    await saveProject();
  } finally {
    saving = false;
  }
}

function apply(): void {
  const st = useSettingsStore.getState().settings;
  if (!st) return;
  setUndoLimit(st.undoLimit);
  if (st.autosaveMinutes === minutes) return;
  minutes = st.autosaveMinutes;
  if (timer) clearInterval(timer);
  timer = minutes > 0 ? setInterval(() => void tick(), minutes * 60_000) : null;
}

/** Start following the settings (once per app). */
export function startAutosave(): () => void {
  apply();
  const off = useSettingsStore.subscribe(apply);
  return () => {
    off();
    if (timer) clearInterval(timer);
    timer = null;
    minutes = -1;
  };
}
