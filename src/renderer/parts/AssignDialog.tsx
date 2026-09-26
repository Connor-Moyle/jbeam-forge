import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { Field } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { cx } from '@renderer/ui/cx';
import { fuzzyFilter } from '@shared/fuzzy';
import { positionLabel } from '@shared/parts/ops';
import { POSITIONS_BY_AXIS, type TaxonomyEntry } from '@shared/taxonomy/schema';
import type { Part } from '@shared/project/schema';
import { EMPTY_ARR } from '@shared/empty';
import { assignDistributed, assignToNewPart, assignToPart } from './commands';
import { useAssignUi } from './assignUi';
import { categoryColor, useTaxonomy } from './taxonomy';
import styles from './AssignDialog.module.css';

type Result = { type: 'part'; part: Part } | { type: 'kind'; entry: TaxonomyEntry };

const AUTO = '__auto__';
const NONE = '__none__';

/** Search-first assignment: type to find an existing part or a part type, Enter to pick. */
export function AssignDialog() {
  const meshKeys = useAssignUi((s) => s.meshKeys);
  const close = useAssignUi((s) => s.closeAssign);
  const custom = useAssignUi((s) => s.custom);
  if (!meshKeys || custom) return null;
  return <AssignDialogBody meshKeys={meshKeys} onClose={close} />;
}

function AssignDialogBody({ meshKeys, onClose }: { meshKeys: readonly string[]; onClose: () => void }) {
  const tax = useTaxonomy();
  const parts = useProjectStore(useShallow((s) => s.doc?.parts ?? EMPTY_ARR));
  const preselect = useAssignUi((s) => s.preselectKind);
  const openCustom = useAssignUi((s) => s.openCustom);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [kind, setKind] = useState<TaxonomyEntry | null>(() => (preselect ? (tax.entry(preselect) ?? null) : null));
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Result[]>(() => {
    const matchedParts = fuzzyFilter(parts, query, (p) => [p.displayName, p.name]).slice(0, query ? 6 : 0);
    const kinds = fuzzyFilter(tax.entries, query, (e) => [e.label, e.id.replace(/_/g, ' '), e.category, ...e.nameHints]).slice(0, 40);
    return [...matchedParts.map((part) => ({ type: 'part' as const, part })), ...kinds.map((entry) => ({ type: 'kind' as const, entry }))];
  }, [parts, tax, query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const pick = (r: Result | undefined) => {
    if (!r) return;
    if (r.type === 'part') {
      assignToPart(meshKeys, r.part.id);
      onClose();
    } else setKind(r.entry);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[highlight]);
    }
  };

  const title = `Assign ${meshKeys.length} mesh${meshKeys.length === 1 ? '' : 'es'}`;
  if (kind) return <KindStep kind={kind} meshKeys={meshKeys} title={title} onBack={() => setKind(null)} onClose={onClose} />;

  let lastType: Result['type'] | null = null;
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
      footer={
        <Button variant="ghost" icon={Plus} onClick={() => openCustom(true)} data-testid="assign-add-custom">
          Add custom part…
        </Button>
      }
    >
      <div className={styles.search}>
        <Input
          autoFocus
          placeholder="Search parts (door glass, bumper, …)"
          aria-label="Search parts"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          data-testid="assign-search"
        />
      </div>
      <ScrollArea className={styles.results}>
        <div ref={listRef} role="listbox" aria-label="Matching parts">
          {results.length === 0 && <p className={styles.empty}>No match. Try another word, or add a custom part.</p>}
          {results.map((r, i) => {
            const header = r.type !== lastType ? (r.type === 'part' ? 'Existing parts' : 'Part types') : null;
            lastType = r.type;
            const entry = r.type === 'kind' ? r.entry : tax.entry(r.part.taxonomyId);
            return (
              <div key={r.type === 'part' ? `p:${r.part.id}` : `k:${r.entry.id}`}>
                {header && <div className={styles.groupHeader}>{header}</div>}
                <div
                  role="option"
                  aria-selected={i === highlight}
                  data-index={i}
                  data-testid={r.type === 'kind' ? `assign-kind-${r.entry.id}` : `assign-part-${r.part.id}`}
                  className={cx(styles.option, i === highlight && styles.highlighted)}
                  onMouseMove={() => setHighlight(i)}
                  onClick={() => pick(r)}
                >
                  <span className={styles.dot} style={{ background: categoryColor(entry?.category) }} aria-hidden />
                  <span className={styles.optionLabel}>{r.type === 'part' ? r.part.displayName : r.entry.label}</span>
                  <span className={styles.optionMeta}>{r.type === 'part' ? r.part.name : `${r.entry.category} › ${r.entry.subcategory}`}</span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Modal>
  );
}

function KindStep({ kind, meshKeys, title, onBack, onClose }: { kind: TaxonomyEntry; meshKeys: readonly string[]; title: string; onBack: () => void; onClose: () => void }) {
  const positions = POSITIONS_BY_AXIS[kind.positionAxis];
  const [position, setPosition] = useState<string>(positions.length ? AUTO : NONE);
  const [variant, setVariant] = useState('');
  const cleanVariant = variant.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  const confirm = () => {
    if (position === AUTO) assignDistributed(meshKeys, kind.id, cleanVariant);
    else assignToNewPart(meshKeys, { taxonomyId: kind.id, position: position === NONE ? null : position, variant: cleanVariant });
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
      description={`${kind.label} · ${kind.category} › ${kind.subcategory}`}
      footer={
        <>
          <Button onClick={onBack}>Back</Button>
          <Button variant="primary" onClick={confirm} data-testid="assign-confirm">
            Assign
          </Button>
        </>
      }
    >
      <div className={styles.step}>
        {positions.length > 0 && (
          <Field label="Position" hint={position === AUTO ? 'Each mesh gets the position its location on the model implies (one part per position).' : undefined}>
            <div className={styles.positions} role="radiogroup" aria-label="Position">
              {[AUTO, ...positions, NONE].map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={position === p}
                  className={cx(styles.position, position === p && styles.positionOn)}
                  onClick={() => setPosition(p)}
                  data-testid={`assign-pos-${p}`}
                >
                  {p === AUTO ? 'Auto' : p === NONE ? 'None' : `${p} · ${positionLabel(kind.positionAxis, p)}`}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Variant" hint="Optional, e.g. race or widebody. Parts of the same type and position become variants of one slot." htmlFor="assign-variant">
          <Input id="assign-variant" value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="(base part)" onKeyDown={(e) => e.key === 'Enter' && confirm()} />
        </Field>
      </div>
    </Modal>
  );
}
