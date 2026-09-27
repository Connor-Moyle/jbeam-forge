import { useState } from 'react';
import { CircleDot, Trash2 } from 'lucide-react';
import { EMPTY_ARR } from '@shared/empty';
import { centroid } from '@shared/structure/edit';
import { useProjectStore } from '@renderer/app/stores/project';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import styles from '@renderer/panels/InspectorPanel.module.css';
import { useEditStore } from './editStore';
import { deleteSelection, renameNode, setAxis, setWeight } from './editCommands';

const AXES = [
  { axis: 0, label: 'X', hint: 'left +' },
  { axis: 1, label: 'Y', hint: 'rear +' },
  { axis: 2, label: 'Z', hint: 'up +' },
] as const;

/** Inspector page for the edit-mode selection: exact position, weight, name. */
export function NodeInspector() {
  const ids = useEditStore((s) => s.nodes);
  const beams = useEditStore((s) => s.beams);
  const allNodes = useProjectStore((s) => s.doc?.nodes ?? EMPTY_ARR);
  const parts = useProjectStore((s) => s.doc?.parts ?? EMPTY_ARR);
  const want = new Set(ids);
  const nodes = allNodes.filter((n) => want.has(n.id));

  if (!nodes.length) {
    return (
      <ScrollArea className={styles.scroll}>
        <div className={styles.panel} data-testid="inspector-beams">
          <Header title={`${beams.length} beam${beams.length === 1 ? '' : 's'} selected`} subtitle="Beam values come from the part's preset." />
          <Button size="sm" variant="danger" icon={Trash2} onClick={deleteSelection}>
            Delete {beams.length === 1 ? 'beam' : 'beams'}
          </Button>
        </div>
      </ScrollArea>
    );
  }

  const single = nodes.length === 1 ? nodes[0]! : null;
  const at = single ? single.pos : centroid(nodes);
  const weights = new Set(nodes.map((n) => n.weight));
  const total = nodes.reduce((m, n) => m + n.weight, 0);
  const partNames = [...new Set(nodes.map((n) => n.partId))].map((id) => parts.find((p) => p.id === id)?.displayName ?? id);

  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.panel} data-testid="inspector-nodes">
        <Header title={single ? single.id : `${nodes.length} nodes`} subtitle={partNames.length > 2 ? `${partNames.length} parts` : partNames.join(', ')} manual={nodes.some((n) => n.manual)} />
        {single && <NodeName key={single.id} id={single.id} />}
        <FieldGroup title={single ? 'Position' : 'Centre of selection'}>
          <div className={styles.row3}>
            {AXES.map(({ axis, label, hint }) => (
              <Field key={axis} label={`${label} (${hint})`}>
                <NumberInput value={at[axis]} onChange={(v) => setAxis(ids, axis, v)} step={0.005} precision={3} unit="m" aria-label={`${label} position`} />
              </Field>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup title="Mass">
          <Field label={single ? 'Weight' : 'Weight of each'} hint={weights.size > 1 ? `Mixed; total ${total.toFixed(2)} kg. Typing a value sets them all.` : `Total ${total.toFixed(2)} kg`}>
            <NumberInput value={nodes[0]!.weight} onChange={(v) => setWeight(ids, v)} min={0.01} max={1000} step={0.1} precision={3} unit="kg" aria-label="Node weight" />
          </Field>
        </FieldGroup>
        <Button size="sm" variant="danger" icon={Trash2} onClick={deleteSelection} data-testid="inspector-delete-nodes">
          Delete {single ? 'node' : `${nodes.length} nodes`}
        </Button>
      </div>
    </ScrollArea>
  );
}

function Header({ title, subtitle, manual }: { title: string; subtitle: string; manual?: boolean }) {
  return (
    <header className={styles.header}>
      <CircleDot className={styles.headerIcon} aria-hidden />
      <div className={styles.titles}>
        <span className={styles.title}>{title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </div>
      {manual && <Badge>moved by hand</Badge>}
    </header>
  );
}

/** Node id with rename-on-commit; every beam, triangle and reference node follows. */
function NodeName({ id }: { id: string }) {
  const [draft, setDraft] = useState(id);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    const next = draft.trim();
    if (next === id) return;
    const err = renameNode(id, next);
    setProblem(err);
    if (err) setDraft(id);
  };
  return (
    <Field label="Node id" hint={problem ?? 'Renaming updates every beam and triangle that uses it.'}>
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} mono data-testid="inspector-node-id" />
    </Field>
  );
}
