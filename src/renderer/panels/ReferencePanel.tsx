import { useMemo, useState } from 'react';
import { CarFront, FileInput } from 'lucide-react';
import { summarizeAcCar, type AcCarSummary } from '@shared/ac/car';
import { useProjectStore, projectStore } from '@renderer/app/stores/project';
import { startAcImport, skinDir } from '@renderer/import/acImport';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Tabs } from '@renderer/ui/components/Tabs';
import type { ReferenceCar } from '@shared/project/schema';
import styles from './ReferencePanel.module.css';

const fmt = (v: number | null | undefined, unit: string, digits = 0) => (v === null || v === undefined ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`.trim());
const mm = (m: number | null) => (m === null ? '—' : `${Math.round(m * 1000).toLocaleString()} mm`);

/** The specs of a brought-over car, grouped the way a spec sheet reads. */
export function AcSpecs({ s }: { s: AcCarSummary }) {
  const groups: [string, [string, string][]][] = [
    [
      'Car',
      [
        ['Mass', fmt(s.massKg, 'kg')],
        ['Weight on front', s.frontWeight === null ? '—' : `${Math.round(s.frontWeight * 100)} %`],
        ['Wheelbase', mm(s.wheelbase)],
        ['Track front / rear', `${mm(s.trackFront)} / ${mm(s.trackRear)}`],
        ['Fuel tank', fmt(s.maxFuelL, 'L')],
      ],
    ],
    [
      'Engine',
      [
        ['Peak power', s.engine.peakPower ? `${Math.round(s.engine.peakPower.kw)} kW (${Math.round(s.engine.peakPower.kw * 1.341)} hp) @ ${Math.round(s.engine.peakPower.rpm)} rpm` : '—'],
        ['Peak torque', s.engine.peakTorque ? `${Math.round(s.engine.peakTorque.nm)} Nm @ ${Math.round(s.engine.peakTorque.rpm)} rpm` : '—'],
        ['Idle / limiter', `${fmt(s.engine.idle, '')} / ${fmt(s.engine.limiter, 'rpm')}`],
        ['Turbo', s.engine.turbo ? 'Yes (figures before boost)' : 'No'],
      ],
    ],
    [
      'Drivetrain',
      [
        ['Layout', s.drivetrain.layout ?? '—'],
        ['Gears', s.drivetrain.gears.length ? s.drivetrain.gears.map((g) => g.toFixed(2)).join(' · ') : '—'],
        ['Final drive', fmt(s.drivetrain.finalDrive, '', 2)],
        ['Diff lock power / coast', `${fmt(s.drivetrain.diffPower === null ? null : s.drivetrain.diffPower * 100, '%')} / ${fmt(s.drivetrain.diffCoast === null ? null : s.drivetrain.diffCoast * 100, '%')}`],
      ],
    ],
    [
      'Chassis',
      [
        ['Suspension front', s.suspensionFront ?? '—'],
        ['Suspension rear', s.suspensionRear ?? '—'],
        ['Tyres front', s.tyresFront.width ? `${mm(s.tyresFront.width)} wide, ${mm(s.tyresFront.radius && s.tyresFront.radius * 2)} tall on ${fmt(s.tyresFront.rimRadius && (s.tyresFront.rimRadius * 2) / 0.0254, '″')}` : '—'],
        ['Tyres rear', s.tyresRear.width ? `${mm(s.tyresRear.width)} wide, ${mm(s.tyresRear.radius && s.tyresRear.radius * 2)} tall on ${fmt(s.tyresRear.rimRadius && (s.tyresRear.rimRadius * 2) / 0.0254, '″')}` : '—'],
        ['Brakes', s.brakes.maxTorque ? `${fmt(s.brakes.maxTorque, 'Nm')}, ${Math.round((s.brakes.frontShare ?? 0) * 100)} % front` : '—'],
        ['Steering lock', s.steering.lock ? `${s.steering.lock}° at the wheel, ratio ${s.steering.ratio ?? '—'}` : '—'],
      ],
    ],
  ];
  return (
    <div className={styles.specs} data-testid="ac-specs">
      {groups.map(([title, rows]) => (
        <section key={title}>
          <h4 className={styles.groupTitle}>{title}</h4>
          <dl className={styles.rows}>
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** The car a project was brought over from: its spec sheet, skin and the data files kept with it. */
export function ReferencePanel() {
  const reference = useProjectStore((s) => s.doc?.reference ?? null);
  const sources = useProjectStore((s) => s.doc?.sources);
  const [tab, setTab] = useState('specs');
  const [file, setFile] = useState<string | null>(null);
  const summary = useMemo(() => (reference?.kind === 'assettocorsa' ? summarizeAcCar(reference.files) : null), [reference]);
  const fileNames = useMemo(() => Object.keys(reference?.files ?? {}).sort(), [reference]);

  if (reference?.kind === 'game') return <GameReference reference={reference} fileNames={fileNames} />;
  if (!reference || !summary) {
    return <EmptyState icon={CarFront} message="No reference car. Bring one over from Assetto Corsa (or another game, with an importer extension) to keep its specs and data files with the project." action={{ label: 'Import Assetto Corsa car', icon: FileInput, onClick: () => void startAcImport() }} />;
  }
  const model = sources?.find((s) => s.format === 'kn5' && s.absolutePath.toLowerCase().startsWith(reference.folder.toLowerCase()));
  const skins = [...new Set([reference.skin, ...(model?.textureDirs ?? []).map((d) => d.split(/[\\/]/).pop() ?? '')].filter((x): x is string => !!x))];
  const setSkin = (skin: string) =>
    projectStore.getState().execute({
      label: `Use the ${skin} skin`,
      apply: (d) => {
        if (d.reference) d.reference.skin = skin;
        const s = d.sources.find((x) => x.id === model?.id);
        if (s) s.textureDirs = [skinDir(reference, skin)];
      },
    });
  const shown = file && reference.files[file] !== undefined ? file : fileNames[0];

  return (
    <div className={styles.panel} data-testid="reference-panel">
      <header className={styles.head}>
        <div>
          <div className={styles.title}>{summary.name ?? reference.carId}</div>
          <div className={styles.sub}>{[summary.brand, summary.year, summary.carClass, summary.author && `by ${summary.author}`].filter(Boolean).join(' · ') || reference.carId}</div>
        </div>
        {model && skins.length > 0 && <Select value={reference.skin ?? ''} onChange={setSkin} options={skins.map((s) => ({ value: s, label: s }))} aria-label="Skin" className={styles.skin} />}
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'specs', label: 'Specs' },
          { value: 'files', label: `Files (${fileNames.length})` },
        ]}
      />
      {tab === 'specs' ? (
        <ScrollArea className={styles.scroll}>
          <AcSpecs s={summary} />
          {summary.description && <p className={styles.description}>{summary.description}</p>}
        </ScrollArea>
      ) : (
        <div className={styles.files}>
          <Select value={shown ?? ''} onChange={setFile} options={fileNames.map((f) => ({ value: f, label: f }))} aria-label="Data file" />
          <ScrollArea className={styles.scroll}>
            <pre className={styles.code} data-testid="reference-file">
              {shown ? reference.files[shown] : ''}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

/** A car an importer extension brought over from another game: the specs it read and the files it kept. */
function GameReference({ reference, fileNames }: { reference: ReferenceCar; fileNames: string[] }) {
  const [tab, setTab] = useState('specs');
  const [file, setFile] = useState<string | null>(null);
  const specs = Object.entries(reference.specs ?? {});
  const shown = file && reference.files[file] !== undefined ? file : fileNames[0];
  return (
    <div className={styles.panel} data-testid="reference-panel">
      <header className={styles.head}>
        <div>
          <div className={styles.title}>{reference.carId}</div>
          <div className={styles.sub}>From {reference.game ?? 'another game'}</div>
        </div>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'specs', label: 'Specs' },
          { value: 'files', label: `Files (${fileNames.length})` },
        ]}
      />
      {tab === 'specs' ? (
        <ScrollArea className={styles.scroll}>
          {specs.length ? (
            <dl className={styles.rows}>
              {specs.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={styles.description}>The importer kept no specs; see the files.</p>
          )}
        </ScrollArea>
      ) : (
        <div className={styles.files}>
          <Select value={shown ?? ''} onChange={setFile} options={fileNames.map((f) => ({ value: f, label: f }))} aria-label="Data file" />
          <ScrollArea className={styles.scroll}>
            <pre className={styles.code} data-testid="reference-file">
              {shown ? reference.files[shown] : ''}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
