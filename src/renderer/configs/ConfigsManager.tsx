import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Copy, FileDown, FileUp, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import type { Project, VehicleConfig } from '@shared/project/schema';
import { configDiff, configFileName, includedParts, resolveConfig, slotChoices } from '@shared/export/configs';
import { configStats, type ConfigStats } from '@shared/export/configStats';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { useTaxonomy } from '@renderer/parts/taxonomy';
import { useSetData, loadFittedSets } from '@renderer/suspension/commands';
import { capturePreviewOf } from '@renderer/export/exportFlow';
import { useUnits } from '@renderer/settings/useUnits';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { TabPanel, Tabs } from '@renderer/ui/components/Tabs';
import { Textarea } from '@renderer/ui/components/Textarea';
import { addConfig, deleteConfig, exportPcFile, importPcFiles, moveConfig, setDefaultConfig, updateConfig, updateConfigInfo, updateModelInfo, useConfigUi } from './commands';
import styles from './ConfigsManager.module.css';

type Tab = 'list' | 'compare' | 'vehicle';
const BASE = '__base__';
const AUTO = '__auto__';
const TYPES = ['Factory', 'Custom', 'Race', 'Police', 'Service', 'Prototype', 'Off-road', 'Drift', 'Rally', 'Drag'];
const BODY_STYLES = ['Sedan', 'Coupe', 'Hatchback', 'Wagon', 'Convertible', 'SUV', 'Crossover', 'Pickup', 'Van', 'Minivan', 'Bus', 'Truck', 'Roadster', 'Supercar', 'Kart', 'Other'];
const DRIVETRAINS = ['RWD', 'FWD', 'AWD', '4WD'];
const FUELS = ['Gasoline', 'Diesel', 'Electric', 'Hybrid'];
const INDUCTION = ['Naturally aspirated', 'Turbocharged', 'Supercharged', 'Twin-turbocharged'];

/** Pictures of each configuration, captured in the studio (kept while the window is open). */
function usePictures(doc: Project | null, list: readonly (VehicleConfig | null)[]) {
  const tax = useTaxonomy();
  const sets = useSetData((s) => s.data);
  const [pics, setPics] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  const capture = () => {
    if (!doc) return;
    const token = ++run.current;
    setBusy(true);
    const queue = [...list];
    // One picture per frame, so the window stays responsive.
    const next = () => {
      if (token !== run.current) return;
      const config = queue.shift();
      if (config === undefined) {
        setBusy(false);
        return;
      }
      const pc = resolveConfig(doc, tax, config, sets);
      const pic = capturePreviewOf(doc, includedParts(doc, tax, pc, sets), config?.id ?? null, { previewSize: '500x281' });
      setPics((p) => ({ ...p, [config?.id ?? BASE]: pic }));
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  };
  useEffect(() => () => void run.current++, []);
  return { pics, busy, capture };
}

/**
 * Configurations manager (fork): every version of the car as a card with
 * its picture and figures; make one the game's default, reorder, copy,
 * import and export .pc files, compare two side by side, and fill in the
 * details the game's vehicle selector shows.
 */
export function ConfigsManager({ onClose }: { onClose: () => void }) {
  const doc = useProjectStore((s) => s.doc);
  const configs = useProjectStore((s) => s.doc?.configs ?? EMPTY_ARR);
  const tax = useTaxonomy();
  const sets = useSetData((s) => s.data);
  const [tab, setTab] = useState<Tab>('list');
  const selected = useConfigUi((s) => s.selected);
  const list = useMemo(() => [null, ...configs], [configs]);
  const { pics, busy, capture } = usePictures(doc, list);
  useEffect(() => {
    void loadFittedSets().catch(() => undefined);
  }, []);
  const stats = useMemo(() => {
    const out = new Map<string, ConfigStats>();
    if (!doc) return out;
    for (const c of list) out.set(c?.id ?? BASE, configStats(doc, tax, resolveConfig(doc, tax, c, sets), sets));
    return out;
  }, [doc, list, tax, sets]);
  if (!doc) return null;
  const current = configs.find((c) => c.id === selected) ?? null;

  const doImport = () => {
    void importPcFiles().then((r) => {
      if (!r) return;
      useUiStore.getState().pushStatus(`Imported ${r.added} configuration${r.added === 1 ? '' : 's'}${r.skipped.length ? `; skipped ${r.skipped.length} slot${r.skipped.length === 1 ? '' : 's'} this car doesn't have` : ''}.`, r.skipped.length ? 'warning' : 'success', 8000);
    });
  };

  return (
    <Modal open size="lg" onOpenChange={(o) => !o && onClose()} title="Configurations">
      <div className={styles.window} data-testid="configs-manager">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          className={styles.tabs}
          aria-label="Configurations"
          items={[
            { value: 'list', label: `Configurations (${list.length})` },
            { value: 'compare', label: 'Compare' },
            { value: 'vehicle', label: 'Vehicle details' },
          ]}
        >
          <TabPanel value="list" className={styles.tabs}>
            <div className={styles.toolbar}>
              <Button icon={Plus} size="sm" variant="primary" onClick={() => addConfig(null)} data-testid="cm-new">
                New
              </Button>
              <Button icon={FileUp} size="sm" onClick={doImport} data-testid="cm-import">
                Import .pc…
              </Button>
              <Button icon={Camera} size="sm" onClick={capture} disabled={busy} data-testid="cm-pictures">
                {busy ? 'Taking pictures…' : 'Take pictures'}
              </Button>
              <span className={styles.note}>Pictures come from the viewport in the export&rsquo;s studio (Settings → Export).</span>
            </div>
            <div className={styles.split}>
              <ScrollArea className={styles.cards}>
                <ul className={styles.grid} data-testid="cm-cards">
                  {list.map((c, i) => {
                    const id = c?.id ?? BASE;
                    const isDefault = c ? doc.defaultConfigId === c.id : !doc.defaultConfigId;
                    return (
                      <li key={id} className={(c ? selected === c.id : selected === null) ? styles.cardOn : styles.card} data-testid="cm-card">
                        <button type="button" className={styles.pick} onClick={() => useConfigUi.getState().select(c?.id ?? null)} aria-label={`Select ${c?.name ?? 'Base'}`}>
                          {pics[id] ? <img className={styles.pic} src={pics[id]} alt="" /> : <div className={styles.picEmpty}>{busy ? '…' : 'No picture'}</div>}
                          <div className={styles.cardTitle}>
                            <span className={styles.name}>{c?.name ?? 'Base'}</span>
                            {isDefault && <Badge tone="accent">Default</Badge>}
                          </div>
                          <StatLine stats={stats.get(id)} type={c?.type ?? 'Factory'} />
                        </button>
                        <div className={styles.cardActions}>
                          <IconButton icon={Star} label={isDefault ? 'The game spawns this one' : 'Make the game spawn this one'} active={isDefault} onClick={() => setDefaultConfig(c?.id ?? null)} />
                          <IconButton icon={Copy} label="Duplicate" onClick={() => addConfig(c)} />
                          <IconButton icon={FileDown} label="Save as .pc…" onClick={() => void exportPcFile(c)} />
                          {c && <IconButton icon={ArrowUp} label="Move up" disabled={i <= 1} onClick={() => moveConfig(c.id, -1)} />}
                          {c && <IconButton icon={ArrowDown} label="Move down" disabled={i === list.length - 1} onClick={() => moveConfig(c.id, 1)} />}
                          {c && <IconButton icon={Trash2} label="Delete" onClick={() => deleteConfig(c.id)} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
              <ScrollArea className={styles.details}>{current ? <Details config={current} stats={stats.get(current.id)} /> : <BaseDetails stats={stats.get(BASE)} />}</ScrollArea>
            </div>
          </TabPanel>
          <TabPanel value="compare" className={styles.tabs}>
            <Compare list={list} stats={stats} pics={pics} />
          </TabPanel>
          <TabPanel value="vehicle" className={styles.tabs}>
            <VehicleDetails meta={doc.meta} />
          </TabPanel>
        </Tabs>
      </div>
    </Modal>
  );
}

function StatLine({ stats, type }: { stats: ConfigStats | undefined; type: string }) {
  const u = useUnits();
  const bits = [type, stats?.powerKw ? u.power(stats.powerKw) : null, stats?.drivetrain, stats?.weightKg ? `${stats.weightKg.toLocaleString()} kg` : null].filter(Boolean);
  return <div className={styles.note}>{bits.join(' · ')}</div>;
}

function Figures({ stats }: { stats: ConfigStats | undefined }) {
  const u = useUnits();
  if (!stats) return null;
  const rows: [string, string | null][] = [
    ['Engine', stats.engine],
    ['Power', stats.powerKw ? u.power(stats.powerKw) : null],
    ['Torque', stats.torqueNm ? u.torque(stats.torqueNm) : null],
    ['Weight', stats.weightKg ? `${stats.weightKg.toLocaleString()} kg` : null],
    ['Power to weight', stats.kwPerTonne ? `${u.power(stats.kwPerTonne)} per tonne` : null],
    ['Drivetrain', stats.drivetrain],
    ['Transmission', stats.transmission],
    ['Fuel', stats.fuelType],
    ['Induction', stats.induction],
    ['Value', `$${stats.value.toLocaleString()}`],
  ];
  return (
    <dl className={styles.figures} data-testid="cm-figures">
      {rows
        .filter((r) => r[1])
        .map(([k, v]) => (
          <div key={k} className={styles.figure}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function BaseDetails({ stats }: { stats: ConfigStats | undefined }) {
  return (
    <div className={styles.detailsBody}>
      <FieldGroup title="Base">
        <p className={styles.note}>Every slot takes its default part. Exported as default.pc, with default.jpg as the model&rsquo;s picture.</p>
      </FieldGroup>
      <FieldGroup title="Figures">
        <Figures stats={stats} />
      </FieldGroup>
    </div>
  );
}

function Details({ config, stats }: { config: VehicleConfig; stats: ConfigStats | undefined }) {
  const info = config.info ?? {};
  const pick = (value: string | undefined, auto: string | null, options: string[], onChange: (v: string | undefined) => void, label: string) => (
    <Select value={value ?? AUTO} onChange={(v) => onChange(v === AUTO ? undefined : v)} options={[{ value: AUTO, label: auto ? `Auto (${auto})` : 'Auto' }, ...options.map((o) => ({ value: o, label: o }))]} aria-label={label} />
  );
  return (
    <div className={styles.detailsBody} data-testid="cm-details">
      <FieldGroup title="Configuration">
        <Field label="Name" hint={`Exported as ${configFileName(config)}.pc`}>
          <Input value={config.name} onChange={(e) => updateConfig(config.id, { name: e.target.value || 'Configuration' })} data-testid="cm-name" />
        </Field>
        <Field label="Type">
          <Select value={config.type} onChange={(type) => updateConfig(config.id, { type })} options={[...new Set([config.type, ...TYPES])].map((t) => ({ value: t, label: t }))} aria-label="Configuration type" />
        </Field>
        <Field label="Description">
          <Textarea value={config.description} onChange={(e) => updateConfig(config.id, { description: e.target.value })} rows={2} />
        </Field>
        <Button icon={Pencil} size="sm" onClick={() => useConfigUi.getState().setPreview(true)}>
          Preview it in the viewport
        </Button>
      </FieldGroup>
      <FieldGroup title="Vehicle selector">
        <Field label="Years">
          <div className={styles.row}>
            <NumberInput value={info.years?.min ?? 0} onChange={(min) => updateConfigInfo(config.id, { years: min ? { min, max: Math.max(min, info.years?.max ?? min) } : undefined })} min={0} max={2100} step={1} precision={0} aria-label="From year" />
            <span className={styles.note}>to</span>
            <NumberInput value={info.years?.max ?? 0} onChange={(max) => updateConfigInfo(config.id, { years: max ? { min: Math.min(info.years?.min ?? max, max), max } : undefined })} min={0} max={2100} step={1} precision={0} aria-label="To year" />
          </div>
        </Field>
        <Field label="Drivetrain">{pick(info.drivetrain, stats?.drivetrain ?? null, DRIVETRAINS, (drivetrain) => updateConfigInfo(config.id, { drivetrain }), 'Drivetrain')}</Field>
        <Field label="Transmission">
          <Input value={info.transmission ?? ''} placeholder={stats?.transmission ?? 'Auto'} onChange={(e) => updateConfigInfo(config.id, { transmission: e.target.value || undefined })} aria-label="Transmission" />
        </Field>
        <Field label="Fuel">{pick(info.fuelType, stats?.fuelType ?? null, FUELS, (fuelType) => updateConfigInfo(config.id, { fuelType }), 'Fuel')}</Field>
        <Field label="Induction">{pick(info.induction, stats?.induction ?? null, INDUCTION, (induction) => updateConfigInfo(config.id, { induction }), 'Induction')}</Field>
        <Field label="Population" hint="How common it is in traffic (0 = never spawns)">
          <NumberInput value={info.population ?? 0} onChange={(population) => updateConfigInfo(config.id, { population: population || undefined })} min={0} max={100000} step={100} precision={0} aria-label="Population" />
        </Field>
        <Field label="Value" hint={stats ? `Parts add up to $${stats.value.toLocaleString()}` : undefined}>
          <NumberInput value={info.value ?? stats?.value ?? 0} onChange={(value) => updateConfigInfo(config.id, { value })} min={0} max={10_000_000} step={100} precision={0} aria-label="Value" />
        </Field>
      </FieldGroup>
      <FieldGroup title="Figures">
        <Figures stats={stats} />
      </FieldGroup>
    </div>
  );
}

function Compare({ list, stats, pics }: { list: readonly (VehicleConfig | null)[]; stats: Map<string, ConfigStats>; pics: Record<string, string | null> }) {
  const doc = useProjectStore((s) => s.doc);
  const tax = useTaxonomy();
  const sets = useSetData((s) => s.data);
  const u = useUnits();
  const [a, setA] = useState(BASE);
  const [b, setB] = useState(list[1]?.id ?? BASE);
  const options = list.map((c) => ({ value: c?.id ?? BASE, label: c?.name ?? 'Base' }));
  const find = (id: string) => (id === BASE ? null : (list.find((c) => c?.id === id) ?? null));
  const rows = useMemo(() => {
    if (!doc) return [];
    const slots = slotChoices(doc, tax, sets);
    return configDiff(resolveConfig(doc, tax, find(a), sets), resolveConfig(doc, tax, find(b), sets), slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, tax, sets, a, b, list]);
  const sa = stats.get(a);
  const sb = stats.get(b);
  const num = (label: string, x: number | null | undefined, y: number | null | undefined, fmt: (n: number) => string) => (x || y ? { label, a: x ? fmt(x) : '–', b: y ? fmt(y) : '–', diff: x && y ? y - x : null } : null);
  const figures = [
    num('Power', sa?.powerKw, sb?.powerKw, (n) => u.power(n)),
    num('Torque', sa?.torqueNm, sb?.torqueNm, (n) => u.torque(n)),
    num('Weight', sa?.weightKg, sb?.weightKg, (n) => `${n.toLocaleString()} kg`),
    num('Value', sa?.value, sb?.value, (n) => `$${n.toLocaleString()}`),
  ].filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <div className={styles.compare} data-testid="cm-compare">
      <div className={styles.compareHead}>
        {[
          [a, setA],
          [b, setB],
        ].map(([id, set], i) => (
          <div key={i} className={styles.compareSide}>
            <Select value={id as string} onChange={set as (v: string) => void} options={options} aria-label={i ? 'Second configuration' : 'First configuration'} />
            {pics[id as string] ? <img className={styles.pic} src={pics[id as string]!} alt="" /> : null}
          </div>
        ))}
      </div>
      <ScrollArea className={styles.cards}>
        <table className={styles.table}>
          <tbody>
            {figures.map((f) => (
              <tr key={f.label}>
                <th>{f.label}</th>
                <td>{f.a}</td>
                <td>{f.b}</td>
              </tr>
            ))}
            {rows.map((r) => (
              <tr key={r.slot.slotType}>
                <th>{r.slot.label}</th>
                <td>{r.a}</td>
                <td>{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className={styles.note}>These two put the same part in every slot.</p>}
      </ScrollArea>
    </div>
  );
}

function VehicleDetails({ meta }: { meta: Project['meta'] }) {
  return (
    <ScrollArea className={styles.cards}>
      <div className={styles.detailsBody} data-testid="cm-vehicle">
        <FieldGroup title="Vehicle selector">
          <Field label="Body style">
            <Select value={meta.bodyStyle ?? AUTO} onChange={(bodyStyle) => updateModelInfo({ bodyStyle: bodyStyle === AUTO ? undefined : bodyStyle })} options={[{ value: AUTO, label: 'Not set' }, ...BODY_STYLES.map((b) => ({ value: b, label: b }))]} aria-label="Body style" />
          </Field>
          <Field label="Country">
            <Input value={meta.country ?? ''} onChange={(e) => updateModelInfo({ country: e.target.value || undefined })} placeholder="e.g. Germany" aria-label="Country" />
          </Field>
          <Field label="Years">
            <div className={styles.row}>
              <NumberInput value={meta.years?.min ?? 0} onChange={(min) => updateModelInfo({ years: min ? { min, max: Math.max(min, meta.years?.max ?? min) } : undefined })} min={0} max={2100} step={1} precision={0} aria-label="Model from year" />
              <span className={styles.note}>to</span>
              <NumberInput value={meta.years?.max ?? 0} onChange={(max) => updateModelInfo({ years: max ? { min: Math.min(meta.years?.min ?? max, max), max } : undefined })} min={0} max={2100} step={1} precision={0} aria-label="Model to year" />
            </div>
          </Field>
          <p className={styles.note}>Written to info.json with the name, brand and type from the project&rsquo;s properties. Each configuration can have its own years in its details.</p>
        </FieldGroup>
      </div>
    </ScrollArea>
  );
}
