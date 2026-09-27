import { useDialogStore } from '@renderer/app/stores/dialogs';
import { Modal } from '@renderer/ui/components/Modal';
import styles from './ShortcutsModal.module.css';

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Everywhere',
    keys: [
      ['Ctrl+K', 'Command palette: find a part, panel or action'],
      ['Ctrl+S / Ctrl+Shift+S', 'Save / Save as'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Ctrl+I', 'Import a model'],
      ['F1', 'This sheet'],
    ],
  },
  {
    title: 'Viewport',
    keys: [
      ['F', 'Focus the selected part (or frame the selection)'],
      ['Double-click', 'Focus a part; on empty space, leave focus'],
      ['Esc', 'Clear the selection, then leave focus mode'],
      ['Home', 'Frame everything'],
      ['Left drag / right drag / wheel', 'Orbit / pan / zoom'],
      ['Tab', 'Edit nodes & beams on or off'],
    ],
  },
  {
    title: 'Editing nodes & beams',
    keys: [
      ['Click / drag a box', 'Select (Shift adds, Ctrl removes)'],
      ['Right drag / middle drag', 'Orbit / pan while editing'],
      ['Arrow keys', 'Nudge 5 mm (Shift 25 mm, Alt 1 mm)'],
      ['Ctrl+A / I / L', 'Select all / invert / connected'],
      ['Double-click a node', 'Select its whole part'],
      ['B', 'Connect the picked nodes with beams'],
      ['M', 'Merge nodes into the first one picked'],
      ['D', 'Split selected beams at the middle'],
      ['Delete', 'Delete the selection'],
    ],
  },
  {
    title: 'Splitting a mesh',
    keys: [
      ['Enter', 'Split off the selected faces'],
      ['Esc', 'Cancel'],
    ],
  },
];

export function ShortcutsModal() {
  const open = useDialogStore((s) => s.shortcutsOpen);
  const setOpen = useDialogStore((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <Modal open onOpenChange={setOpen} title="Keyboard shortcuts" size="md">
      <div className={styles.sections} data-testid="shortcuts">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h3 className={styles.title}>{s.title}</h3>
            <dl className={styles.list}>
              {s.keys.map(([k, what]) => (
                <div key={k} className={styles.row}>
                  <dt className={styles.key}>{k}</dt>
                  <dd className={styles.what}>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
