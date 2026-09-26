import { useDialogStore } from '@renderer/app/stores/dialogs';
import { Button } from '@renderer/ui/components/Button';
import { Modal } from '@renderer/ui/components/Modal';
import { NewModWizard } from '@renderer/home/NewModWizard';
import styles from './DialogHost.module.css';

/** Renders the app-level blocking dialogs requested through useDialogStore. */
export function DialogHost() {
  const unsaved = useDialogStore((s) => s.unsaved);
  const alert = useDialogStore((s) => s.alert);
  const newModOpen = useDialogStore((s) => s.newModOpen);
  const answerUnsaved = useDialogStore((s) => s.answerUnsaved);
  const dismissAlert = useDialogStore((s) => s.dismissAlert);
  const setNewModOpen = useDialogStore((s) => s.setNewModOpen);

  return (
    <>
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
