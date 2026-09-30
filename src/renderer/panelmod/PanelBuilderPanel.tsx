import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, FileInput, PanelTop, RotateCcw, Trash2 } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { startImport } from '@renderer/import/importFlow';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import type { SuspensionSet } from '@shared/ipc-contract';
import { EMPTY_ARR } from '@shared/empty';
import { importGuide, pickPanel, removeGuide, setGuideVisible, usePanelCatalogue } from './commands';
import styles from './PanelMod.module.css';

/**
 * The Panel builder (fork): a body panel mod for a car in the game. Pick the
 * car and the panel, bring the stock one in as a guide, import your model in
 * its place. The stock part's physics go with it, so it attaches, bends and
 * breaks the way the original does.
 */
export function PanelBuilderPanel() {
  const panel = useProjectStore((s) => s.doc?.panel);
  const sources = useProjectStore((s) => s.doc?.sources);
  const sets = usePanelCatalogue((s) => s.sets);
  const hidden = useSceneStore((s) => s.hidden);
  const guideMeshes = useSceneStore((s) => (panel?.guideSourceId ? (s.sources[panel.guideSourceId]?.meshes ?? EMPTY_ARR) : EMPTY_ARR));
  const [changing, setChanging] = useState(false);
  // Read again each time the builder opens and whenever the library changes (a rescan finishing).
  useEffect(() => {
    void usePanelCatalogue.getState().load(true);
    return window.forge.on('library:changed', () => void usePanelCatalogue.getState().load(true));
  }, []);

  if (!sets) return <EmptyState icon={PanelTop} message="Reading the game's panels…" />;
  if (!sets.length)
    return (
      <EmptyState
        icon={PanelTop}
        message="No body panels from the game yet. Set your BeamNG.drive install in Settings, then let the library read it (Settings → Library → Rescan): every car's hoods, bumpers, doors and more show up here."
        action={{ label: 'Open Settings', onClick: () => useDialogStore.getState().setSettingsOpen(true) }}
      />
    );
  if (!panel || changing) return <PanelPicker sets={sets} current={panel?.setId ?? null} onPicked={() => setChanging(false)} onCancel={panel ? () => setChanging(false) : undefined} />;

  const own = (sources ?? []).filter((s) => s.id !== panel.guideSourceId);
  const guideShown = guideMeshes.length > 0 && guideMeshes.some((m) => !hidden[m.key]);
  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.body} data-testid="panel-builder">
        <div className={styles.head}>
          <div>
            <div className={styles.title}>{panel.name}</div>
            <div className={styles.sub}>
              for the {panel.vehicleName} · <code>{panel.slotType}</code>
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setChanging(true)}>
            Change
          </Button>
        </div>
        <p className={styles.note}>Your model replaces this panel’s mesh. Its nodes and beams are the game’s own, so it attaches, bends and breaks like the original; it shows in the {panel.vehicleName}’s parts menu beside it.</p>

        <FieldGroup title="1 · Guide">
          {panel.guideSourceId ? (
            <div className={styles.row}>
              <Button size="sm" icon={guideShown ? EyeOff : Eye} onClick={() => setGuideVisible(!guideShown)} data-testid="panel-guide-toggle">
                {guideShown ? 'Hide the stock panel' : 'Show the stock panel'}
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={removeGuide}>
                Remove it
              </Button>
            </div>
          ) : (
            <Button size="sm" icon={FileInput} onClick={() => void importGuide()} data-testid="panel-guide">
              Bring in the stock panel as a guide
            </Button>
          )}
          <p className={styles.note}>The guide sits exactly where the panel goes on the car. It’s never exported.</p>
        </FieldGroup>

        <FieldGroup title="2 · Your model">
          {own.length ? <Badge tone="success">{own.length} model{own.length === 1 ? '' : 's'} in</Badge> : <Callout tone="info">Import your panel. Model it in the car’s place (the same coordinates as the car), lined up with the guide.</Callout>}
          <Button size="sm" icon={FileInput} onClick={() => void startImport()} data-testid="panel-import">
            Import {own.length ? 'another' : 'your'} model
          </Button>
          <p className={styles.note}>Split, name, move and give it materials in the Materials workspace as usual. Everything you import (but the guide) becomes the panel’s mesh.</p>
        </FieldGroup>
      </div>
    </ScrollArea>
  );
}

/** Choose the car, then the panel. */
function PanelPicker({ sets, current, onPicked, onCancel }: { sets: SuspensionSet[]; current: string | null; onPicked: () => void; onCancel?: () => void }) {
  // The game's names already carry the brand ("Gavril D-Series").
  const cars = useMemo(() => [...new Map(sets.map((s) => [s.vehicle, { vehicle: s.vehicle, label: s.vehicleName || s.vehicle }])).values()].sort((a, b) => a.label.localeCompare(b.label)), [sets]);
  const [vehicle, setVehicle] = useState(() => sets.find((s) => s.id === current)?.vehicle ?? cars[0]?.vehicle ?? '');
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mine = sets.filter((s) => s.vehicle === vehicle && (!q || `${s.name} ${s.type} ${s.slotType}`.toLowerCase().includes(q)));
    const by = new Map<string, SuspensionSet[]>();
    for (const s of mine) by.set(s.type, [...(by.get(s.type) ?? []), s]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [sets, vehicle, query]);
  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.body} data-testid="panel-picker">
        <p className={styles.note}>Which car, and which of its panels does your mod replace?</p>
        <Field label="Car">
          <Select value={vehicle} onChange={setVehicle} options={cars.map((c) => ({ value: c.vehicle, label: c.label }))} aria-label="Car" data-testid="panel-car" />
        </Field>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: hood, bumper, spoiler…" aria-label="Search panels" />
        {groups.map(([type, list]) => (
          <section key={type}>
            <h4 className={styles.group}>{type}</h4>
            <ul className={styles.list}>
              {list.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={s.id === current ? styles.itemOn : styles.item}
                    onClick={() => {
                      void pickPanel(s);
                      onPicked();
                    }}
                    data-testid={`panel-pick-${s.part}`}
                  >
                    <span>{s.name}</span>
                    <code className={styles.slot}>{s.slotType}</code>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!groups.length && <p className={styles.note}>No panels match.</p>}
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Keep the current one
          </Button>
        )}
      </div>
    </ScrollArea>
  );
}
