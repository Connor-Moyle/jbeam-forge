import { Loader } from 'lucide-react';
import { MergeDialog } from '@renderer/materials/MergeDialog';
import { LibraryDialog } from '@renderer/materials/LibraryDialog';
import { RenameMeshDialog } from '@renderer/parts/RenameMeshDialog';
import { iconSize } from '@renderer/ui/tokens';
import { ImportDialog } from './ImportDialog';
import { PlacementDialog } from './PlacementDialog';
import { ClassifyDialog } from '@renderer/parts/ClassifyDialog';
import { AssignDialog } from '@renderer/parts/AssignDialog';
import { CustomPartDialog } from '@renderer/parts/CustomPartDialog';
import { ExportDialog } from '@renderer/export/ExportDialog';
import { confirmImport, useImportUi } from './importFlow';
import styles from './ImportHost.module.css';

/** Import settings dialog, the auto-classify summary, and a blocking busy indicator while a model is read/imported. */
export function ImportHost() {
  const staged = useImportUi((s) => s.staged);
  const busy = useImportUi((s) => s.busy);
  const setStaged = useImportUi((s) => s.setStaged);
  return (
    <>
      <ClassifyDialog />
      <AssignDialog />
      <RenameMeshDialog />
      <PlacementDialog />
      <LibraryDialog />
      <MergeDialog />
      <CustomPartDialog />
      <ExportDialog />
      {staged && <ImportDialog staged={staged} onCancel={() => setStaged(null)} onConfirm={(settings) => void confirmImport(staged, settings)} />}
      {busy && (
        <div className={styles.overlay} role="status" aria-live="polite" data-testid="import-busy">
          <div className={styles.card}>
            <Loader className={styles.spinner} size={iconSize('size-icon')} aria-hidden />
            <span>{busy}</span>
          </div>
        </div>
      )}
    </>
  );
}
