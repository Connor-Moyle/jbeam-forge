import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { EMPTY_ARR } from '@shared/empty';
import { findDuplicates, mergeMaterials } from '@shared/materials/duplicates';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { Button } from '@renderer/ui/components/Button';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { Modal } from '@renderer/ui/components/Modal';
import styles from './LibraryDialog.module.css';

export const useMergeUi = create<{ open: boolean; setOpen: (o: boolean) => void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** Find materials that are identical copies (Chrome, Chrome.001…) and fold them together. */
export function MergeDialog() {
  const open = useMergeUi((s) => s.open);
  const setOpen = useMergeUi((s) => s.setOpen);
  if (!open) return null;
  return <MergeBody close={() => setOpen(false)} />;
}

function MergeBody({ close }: { close: () => void }) {
  const materials = useProjectStore((s) => s.doc?.materials ?? EMPTY_ARR);
  const groups = useMemo(() => findDuplicates(materials), [materials]);
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const keyOf = (g: (typeof groups)[number]) => `${g.keep}${g.sameName ? '' : ':names'}`;
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(groups.filter((g) => g.sameName).map(keyOf)));
  const chosen = groups.filter((g) => ticked.has(keyOf(g)));
  const count = chosen.reduce((n, g) => n + g.merge.length, 0);

  const merge = () => {
    let merged = 0;
    projectStore.getState().execute({
      label: `Merge ${count} duplicate material${count === 1 ? '' : 's'}`,
      apply: (d) => {
        merged = mergeMaterials(d, chosen);
      },
    });
    useUiStore.getState().pushStatus(`Merged ${merged} duplicate material${merged === 1 ? '' : 's'}`, 'success');
    close();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Merge duplicate materials"
      description={groups.length ? 'These materials are identical: same settings, same textures. Merging keeps the first name and points every mesh at it.' : undefined}
      size="md"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={merge} disabled={!count} data-testid="merge-materials">
            Merge {count || ''}
          </Button>
        </>
      }
    >
      {!groups.length && <p className={styles.empty}>No duplicates: every material is different.</p>}
      <ul className={styles.grid} data-testid="duplicate-groups">
        {groups.map((g) => (
          <li key={keyOf(g)} className={styles.card}>
            <Checkbox
              checked={ticked.has(keyOf(g))}
              onChange={(on) => {
                const next = new Set(ticked);
                if (on) next.add(keyOf(g));
                else next.delete(keyOf(g));
                setTicked(next);
              }}
              label=""
              aria-label={`Merge into ${byId.get(g.keep)?.name}`}
            />
            <span className={styles.text}>
              <span className={styles.name}>{byId.get(g.keep)?.name}</span>
              <span className={styles.category}>
                ← {g.merge.map((id) => byId.get(id)?.name).join(', ')}
                {g.sameName ? '' : ' (different names: check they really are the same thing)'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
