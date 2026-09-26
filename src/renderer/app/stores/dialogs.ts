import { create } from 'zustand';

/**
 * App-level blocking dialogs driven by async code (e.g. "save changes?"
 * before opening another project). `ask*` returns a promise the dialog host
 * resolves when the user answers.
 */
export type UnsavedChoice = 'save' | 'discard' | 'cancel';

interface PendingUnsaved {
  projectName: string;
  resolve: (choice: UnsavedChoice) => void;
}

interface PendingAlert {
  title: string;
  message: string;
  resolve: () => void;
}

interface PendingFolders {
  folders: string[];
  resolve: (allow: boolean) => void;
}

interface DialogState {
  unsaved: PendingUnsaved | null;
  folders: PendingFolders | null;
  askFolders: (folders: string[]) => Promise<boolean>;
  answerFolders: (allow: boolean) => void;
  alert: PendingAlert | null;
  newModOpen: boolean;
  askUnsaved: (projectName: string) => Promise<UnsavedChoice>;
  answerUnsaved: (choice: UnsavedChoice) => void;
  showAlert: (title: string, message: string) => Promise<void>;
  dismissAlert: () => void;
  setNewModOpen: (open: boolean) => void;
}

export const useDialogStore = create<DialogState>()((set, get) => ({
  unsaved: null,
  folders: null,
  alert: null,
  askFolders: (folders) =>
    new Promise<boolean>((resolve) => {
      get().folders?.resolve(false);
      set({ folders: { folders, resolve } });
    }),
  answerFolders: (allow) => {
    const pending = get().folders;
    set({ folders: null });
    pending?.resolve(allow);
  },
  newModOpen: false,
  askUnsaved: (projectName) =>
    new Promise<UnsavedChoice>((resolve) => {
      get().unsaved?.resolve('cancel'); // never leave an earlier caller hanging
      set({ unsaved: { projectName, resolve } });
    }),
  answerUnsaved: (choice) => {
    const pending = get().unsaved;
    set({ unsaved: null });
    pending?.resolve(choice);
  },
  showAlert: (title, message) =>
    new Promise<void>((resolve) => {
      get().alert?.resolve();
      set({ alert: { title, message, resolve } });
    }),
  dismissAlert: () => {
    const pending = get().alert;
    set({ alert: null });
    pending?.resolve();
  },
  setNewModOpen: (newModOpen) => set({ newModOpen }),
}));
