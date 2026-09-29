import { useDialogStore } from '@renderer/app/stores/dialogs';
import { Button } from '@renderer/ui/components/Button';
import { Modal } from '@renderer/ui/components/Modal';
import { NewModWizard } from '@renderer/home/NewModWizard';
import { SettingsModal } from '@renderer/settings/SettingsModal';
import { DownloadsWindow } from '@renderer/downloads/DownloadsWindow';
import { ConfigsManager } from '@renderer/configs/ConfigsManager';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useProjectStore } from '@renderer/app/stores/project';
import styles from './DialogHost.module.css';

/** Renders the app-level blocking dialogs requested through useDialogStore. */
export function DialogHost() {
  const unsaved = useDialogStore((s) => s.unsaved);
  const alert = useDialogStore((s) => s.alert);
  const folders = useDialogStore((s) => s.folders);
  const answerFolders = useDialogStore((s) => s.answerFolders);
  const newModOpen = useDialogStore((s) => s.newModOpen);
  const answerUnsaved = useDialogStore((s) => s.answerUnsaved);
  const dismissAlert = useDialogStore((s) => s.dismissAlert);
  const setNewModOpen = useDialogStore((s) => s.setNewModOpen);
  const settingsOpen = useDialogStore((s) => s.settingsOpen);
  const setSettingsOpen = useDialogStore((s) => s.setSettingsOpen);
  const settings = useSettingsStore((s) => s.settings);
  const downloads = useDialogStore((s) => s.downloads);
  const setDownloads = useDialogStore((s) => s.setDownloads);
  const configsOpen = useDialogStore((s) => s.configsOpen);
  const hasDoc = useProjectStore((s) => !!s.doc);

  return (
    <>
      {settingsOpen && settings && <SettingsModal settings={settings} onClose={() => setSettingsOpen(false)} />}
      {downloads && <DownloadsWindow tab={downloads} onTab={setDownloads} onClose={() => setDownloads(null)} />}
      {configsOpen && hasDoc && <ConfigsManager onClose={() => useDialogStore.getState().setConfigsOpen(false)} />}
      {unsaved && (
        <Modal
          open
          size="sm"
          onOpenChange={(o) => {
            if (!o) answerUnsaved('cancel');
          }}
          title="Save changes?"
          description={`"${unsaved.projectName}" has unsaved changes.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => answerUnsaved('discard')} data-testid="unsaved-discard">
                Don’t save
              </Button>
              <Button onClick={() => answerUnsaved('cancel')}>Cancel</Button>
              <Button variant="primary" onClick={() => answerUnsaved('save')} data-testid="unsaved-save">
                Save
              </Button>
            </>
          }
        />
      )}
      {folders && (
        <Modal
          open
          size="md"
          onOpenChange={(o) => {
            if (!o) answerFolders(false);
          }}
          title="Allow this project to read these folders?"
          description="Its models or textures live outside the project's own folder. JBeam Forge only reads model and image files from folders you allow."
          footer={
            <>
              <Button onClick={() => answerFolders(false)}>Not now</Button>
              <Button variant="primary" onClick={() => answerFolders(true)} data-testid="folders-allow">
                Allow
              </Button>
            </>
          }
        >
          <ul className={styles.folders}>
            {folders.folders.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Modal>
      )}
      {alert && (
        <Modal
          open
          size="sm"
          onOpenChange={(o) => {
            if (!o) dismissAlert();
          }}
          title={alert.title}
          footer={
            <Button variant="primary" onClick={dismissAlert}>
              OK
            </Button>
          }
        >
          <p className={styles.message} data-testid="alert-message">
            {alert.message}
          </p>
        </Modal>
      )}
      {newModOpen && <NewModWizard onClose={() => setNewModOpen(false)} />}
    </>
  );
}
