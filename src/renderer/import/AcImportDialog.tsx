import { useMemo, useState } from 'react';
import { summarizeAcCar } from '@shared/ac/car';
import type { AcCarInfo } from '@shared/ipc-contract';
import { AcSpecs } from '@renderer/panels/ReferencePanel';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { Field } from '@renderer/ui/components/Field';
import { Modal } from '@renderer/ui/components/Modal';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { formatBytes } from '@renderer/downloads/format';
import { call } from '@renderer/diagnostics/ipc';
import type { Settings } from '@shared/settings-schema';
import { confirmAcImport, useAcImportUi } from './acImport';
import { acOption } from './kn5';
import styles from './AcImportDialog.module.css';

const NO_SKIN = '__none__';

/** What a picked Assetto Corsa car holds, and what to bring over. */
export function AcImportDialog() {
  const car = useAcImportUi((s) => s.car);
  if (!car) return null;
  return <Body key={car.folder} car={car} />;
}

function Body({ car }: { car: AcCarInfo }) {
  const close = () => useAcImportUi.getState().setCar(null);
  const summary = useMemo(() => summarizeAcCar(car.files), [car]);
  const [skin, setSkin] = useState(car.skins[0] ?? NO_SKIN);
  const [importModel, setImportModel] = useState(car.kn5 !== null);
  const [model, setModel] = useState(car.kn5 ?? car.models[0]?.path ?? '');
  const [useDetails, setUseDetails] = useState(() => acOption('acUseDetails'));
  const [classify, setClassify] = useState(() => acOption('acClassify'));
  const [owned, setOwned] = useState(false);
  const [free, setFree] = useState(false);
  const settings = useSettingsStore((st) => st.settings);
  const set = (patch: Partial<Pick<Settings, 'acIgnoreHelpers' | 'acSkipHidden' | 'acBakePaint'>>) => void call('settings:update', patch).catch(() => undefined);
  const declared = !importModel || (owned && free);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={`Import ${summary.name ?? car.carId}`}
      description={[summary.brand, summary.year, summary.carClass].filter(Boolean).join(' · ') || car.carId}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!declared} title={declared ? undefined : 'Tick both boxes of the declaration first'} onClick={() => void confirmAcImport(car, { skin: skin === NO_SKIN ? null : skin, importModel, model, classify, useDetails, owned, free })} data-testid="ac-import-confirm">
            Import
          </Button>
        </>
      }
    >
      <div className={styles.body} data-testid="ac-import-dialog">
        {car.warnings.map((w) => (
          <Callout key={w} tone="warning">
            {w}
          </Callout>
        ))}
        <ScrollArea className={styles.specs}>
          <AcSpecs s={summary} />
        </ScrollArea>
        <Checkbox checked={importModel} disabled={!car.models.length} onChange={setImportModel} label={car.models.length ? 'Import the model with its materials and textures' : 'No model in this folder'} />
        {car.models.length > 1 && (
          <Field label="Model" hint="The detailed model is the one to build a mod from; far LODs are lighter, the collider is the game's crash shape.">
            <Select value={model} onChange={setModel} disabled={!importModel} options={car.models.map((m) => ({ value: m.path, label: `${m.label} · ${formatBytes(m.bytes)}` }))} aria-label="Model" data-testid="ac-import-model" />
          </Field>
        )}
        {car.skins.length > 0 && (
          <Field label="Skin" hint="Its paint and liveries replace the textures inside the model. You can switch later in the Reference car panel.">
            <Select value={skin} onChange={setSkin} disabled={!importModel} options={[...car.skins.map((s) => ({ value: s, label: s })), { value: NO_SKIN, label: 'None (textures inside the model)' }]} aria-label="Skin" />
          </Field>
        )}
        <Checkbox checked={useDetails} onChange={setUseDetails} label="Use the car’s name, brand and description for this mod" />
        <Checkbox checked={classify} disabled={!importModel} onChange={setClassify} label="Sort the meshes into parts afterwards" />
        {settings && (
          <details className={styles.more}>
            <summary>Model options (also in Settings → Files)</summary>
            <Checkbox checked={settings.acIgnoreHelpers} onChange={(acIgnoreHelpers) => set({ acIgnoreHelpers })} label="Ignore the game’s effect meshes (blurred rims, damage glass, windscreen reflection)" />
            <Checkbox checked={settings.acSkipHidden} onChange={(acSkipHidden) => set({ acSkipHidden })} label="Leave out objects the car file marks hidden" />
            <Checkbox checked={settings.acBakePaint} onChange={(acBakePaint) => set({ acBakePaint })} label="Bake paint detail and gloss into the textures" />
          </details>
        )}
        {importModel && (
          <div className={styles.declare} data-testid="ac-import-declare">
            <strong>Porting a car from Assetto Corsa</strong>
            <Checkbox checked={owned} onChange={setOwned} label="I own Assetto Corsa" />
            <Checkbox checked={free} onChange={setFree} label="The mod will be free, and will say it was ported from Assetto Corsa" />
          </div>
        )}
        <p className={styles.note}>
          {Object.keys(car.files).length} data files ({summary.fileCount.data} car data, {summary.fileCount.extension} extension, {summary.fileCount.ui} UI) are kept with the project for reference.
        </p>
      </div>
    </Modal>
  );
}
