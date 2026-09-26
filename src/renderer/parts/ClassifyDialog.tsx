import { useMemo } from 'react';
import { useProjectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { Badge } from '@renderer/ui/components/Badge';
import { Modal } from '@renderer/ui/components/Modal';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { applyPendingClassification, pendingStillValid, useClassifyUi, type PendingClassification } from './commands';
import { categoryColor, useTaxonomy } from './taxonomy';
import styles from './ClassifyDialog.module.css';

/** Summary shown after an import: what auto-classification found, before it touches the document. */
export function ClassifyDialog() {
  const pending = useClassifyUi((s) => s.pending);
  const setPending = useClassifyUi((s) => s.setPending);
  useProjectStore((s) => s.doc?.sources); // re-check validity when sources change (undo of the import)
  if (!pending || !pendingStillValid(pending)) return null;
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) setPending(null);
      }}
      title="Auto-classify parts"
      description={`Sorted the meshes of ${pending.fileName} into parts by name. You can change any of it later in the Scene tree (Ctrl+Z undoes it in one step).`}
      footer={
        <>
          <Button onClick={() => setPending(null)} data-testid="classify-skip">
            Leave unassigned
          </Button>
          <Button variant="primary" onClick={applyPendingClassification} data-testid="classify-apply">
            Create {pending.proposal.parts.length} parts
          </Button>
        </>
      }
    >
      <Summary pending={pending} />
    </Modal>
  );
}

function Summary({ pending }: { pending: PendingClassification }) {
  const tax = useTaxonomy();
  const { proposal, meshCount } = pending;
  const assigned = Object.keys(proposal.assignments).length;
  const confident = assigned - proposal.lowConfidence.length;

  // Per-category counts of proposed base parts.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of proposal.parts) {
      const cat = tax.entry(p.taxonomyId)?.category ?? 'Other';
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [proposal, tax]);

  return (
    <div className={styles.summary} data-testid="classify-summary">
      <dl className={styles.stats}>
        <div>
          <dt>Detected</dt>
          <dd data-testid="classify-detected">{confident}</dd>
        </div>
        <div>
          <dt>Low confidence</dt>
          <dd data-testid="classify-low">{proposal.lowConfidence.length}</dd>
        </div>
        <div>
          <dt>Unassigned</dt>
          <dd data-testid="classify-unassigned">{proposal.unassigned.length}</dd>
        </div>
        <div>
          <dt>Meshes</dt>
          <dd>{meshCount}</dd>
        </div>
      </dl>
      <ul className={styles.categories}>
        {categories.map(([cat, n]) => (
          <li key={cat}>
            <span className={styles.dot} style={{ background: categoryColor(cat) }} aria-hidden />
            {cat}
            <span className={styles.count}>{n}</span>
          </li>
        ))}
      </ul>
      {proposal.unassigned.length > 0 && (
        <>
          <p className={styles.heading}>
            Not recognised <Badge>{proposal.unassigned.length}</Badge>
          </p>
          <ScrollArea className={styles.names}>
            <ul>
              {proposal.unassigned.map((k) => (
                <li key={k}>{k.slice(k.indexOf(':') + 1)}</li>
              ))}
            </ul>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
