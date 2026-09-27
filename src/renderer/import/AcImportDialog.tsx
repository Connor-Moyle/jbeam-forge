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
import { confirmAcImport, useAcImportUi } from './acImport';
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
  const [useDetails, setUseDetails] = useState(true);
  const model = car.kn5?.split(/[\\/]/).pop();
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={`Import ${summary.name ?? car.carId}`}
      description={[summary.brand, summary.year, summary.carClass].filter(Boolean).join(' · ') || car.carId}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => void confirmAcImport(car, { skin: skin === NO_SKIN ? null : skin, importModel, useDetails })} data-testid="ac-import-confirm">
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
        <Checkbox checked={importModel} disabled={!car.kn5} onChange={setImportModel} label={model ? `Import the model (${model}) with its materials and textures` : 'No model in this folder'} />
        {car.skins.length > 0 && (
          <Field label="Skin" hint="Its paint and liveries replace the textures inside the model. You can switch later in the Reference car panel.">
            <Select value={skin} onChange={setSkin} disabled={!importModel} options={[...car.skins.map((s) => ({ value: s, label: s })), { value: NO_SKIN, label: 'None (textures inside the model)' }]} aria-label="Skin" />
          </Field>
        )}
        <Checkbox checked={useDetails} onChange={setUseDetails} label="Use the car’s name, brand and description for this mod" />
        <p className={styles.note}>
          {Object.keys(car.files).length} data files ({summary.fileCount.data} car data, {summary.fileCount.extension} extension, {summary.fileCount.ui} UI) are kept with the project for reference.
        </p>
      </div>
    </Modal>
  );
}
