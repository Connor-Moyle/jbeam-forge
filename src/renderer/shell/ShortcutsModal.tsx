import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { effectiveKeymap, KEYMAP, keyLabel, type KeymapGroup } from '@shared/keymap';
import { Button } from '@renderer/ui/components/Button';
import { Modal } from '@renderer/ui/components/Modal';
import styles from './ShortcutsModal.module.css';

/** Mouse moves and fixed keys that aren't in the keymap. */
const EXTRA: Partial<Record<KeymapGroup, [string, string][]>> = {
  Viewport: [
    ['Double-click', 'Focus a part; on empty space, leave focus'],
    ['Left drag / right drag / wheel', 'Orbit / pan / zoom'],
  ],
  'Nodes & beams': [
    ['Click / drag a box', 'Select (Shift adds, Ctrl removes)'],
    ['Right drag / middle drag', 'Orbit / pan while editing'],
    ['Arrow keys', 'Nudge the selection (Shift ×5, Alt ÷5; size in Settings → Editing)'],
    ['Double-click a node', 'Select its whole part'],
  ],
};
const GROUPS: KeymapGroup[] = ['File', 'Edit', 'View', 'Workspaces', 'Viewport', 'Nodes & beams'];

export function ShortcutsModal() {
  const open = useDialogStore((s) => s.shortcutsOpen);
  const setOpen = useDialogStore((s) => s.setShortcutsOpen);
  const overrides = useSettingsStore((s) => s.settings?.keymap);
  if (!open) return null;
  const keys = effectiveKeymap(overrides);
  const mac = navigator.platform.toLowerCase().includes('mac');
  return (
    <Modal
      open
      onOpenChange={setOpen}
      title="Keyboard shortcuts"
      size="md"
      footer={
        <Button
          onClick={() => {
            setOpen(false);
            useDialogStore.getState().setSettingsOpen(true);
          }}
        >
          Change keys…
        </Button>
      }
    >
      <div className={styles.sections} data-testid="shortcuts">
        {GROUPS.map((g) => (
          <section key={g}>
            <h3 className={styles.title}>{g}</h3>
            <dl className={styles.list}>
              {KEYMAP.filter((a) => a.group === g).map((a) => (
                <div key={a.id} className={styles.row}>
                  <dt className={styles.key}>{keyLabel(keys[a.id] ?? '', mac)}</dt>
                  <dd className={styles.what}>{a.label}</dd>
                </div>
              ))}
              {(EXTRA[g] ?? []).map(([k, what]) => (
                <div key={k} className={styles.row}>
                  <dt className={styles.key}>{k}</dt>
                  <dd className={styles.what}>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section>
          <h3 className={styles.title}>Splitting a mesh</h3>
          <dl className={styles.list}>
            <div className={styles.row}>
              <dt className={styles.key}>Enter</dt>
              <dd className={styles.what}>Split off the selected faces</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.key}>Esc</dt>
              <dd className={styles.what}>Cancel</dd>
            </div>
          </dl>
        </section>
      </div>
    </Modal>
  );
}
