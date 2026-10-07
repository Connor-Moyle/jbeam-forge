import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { MODEL_FORMATS, type ModelFormat } from '@shared/export/modelFormatList';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { Button } from '@renderer/ui/components/Button';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { Field } from '@renderer/ui/components/Field';
import { Modal } from '@renderer/ui/components/Modal';
import { Select } from '@renderer/ui/components/Select';
import { DEFAULT_MODEL_EXPORT, exportedMeshes, exportModel } from './modelExport';
import styles from './ModelExportDialog.module.css';

export const useModelExportUi = create<{ open: boolean; format: ModelFormat; show: (format?: ModelFormat) => void; close: () => void }>()((set) => ({
  open: false,
  format: DEFAULT_MODEL_EXPORT.format,
  show: (format) => set((s) => ({ open: true, format: format ?? s.format })),
  close: () => set({ open: false }),
}));

/** File → Export Model: the format, and what goes into the file. */
export function ModelExportDialog() {
  const open = useModelExportUi((s) => s.open);
  if (!open) return null;
  return <Body />;
}

function Body() {
  const close = useModelExportUi((s) => s.close);
  const [format, setFormat] = useState<ModelFormat>(useModelExportUi.getState().format);
  const [gameParts, setGameParts] = useState(DEFAULT_MODEL_EXPORT.gameParts);
  const [hidden, setHidden] = useState(DEFAULT_MODEL_EXPORT.hidden);
  const selection = useSceneStore((s) => s.selection);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  // Counted again when the project or what's hidden changes under the dialog.
  const doc = useProjectStore((s) => s.doc);
  const hiddenKeys = useSceneStore((s) => s.hidden);
  const sources = useSceneStore((s) => s.sources);
  const counts = useMemo(() => {
    const with_ = exportedMeshes({ gameParts: true, hidden, selectionOnly });
    const taken = exportedMeshes({ gameParts, hidden, selectionOnly });
    return { game: with_?.fromGame ?? 0, meshes: taken?.meshes.length ?? 0, triangles: taken?.meshes.reduce((s, m) => s + m.triangles, 0) ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stores are read inside exportedMeshes
  }, [doc, hiddenKeys, sources, selection, gameParts, hidden, selectionOnly]);
  const info = MODEL_FORMATS.find((f) => f.value === format)!;
  const run = async () => {
    setBusy(true);
    useModelExportUi.setState({ format });
    await exportModel(format, { gameParts, hidden, selectionOnly });
    setBusy(false);
    close();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Export model"
      size="sm"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy || !counts.meshes} data-testid="model-export-save">
            Export…
          </Button>
        </>
      }
    >
      <div className={styles.body} data-testid="model-export-dialog">
        <Field label="Format" hint={info.note}>
          <Select value={format} onChange={setFormat} options={MODEL_FORMATS.map((f) => ({ value: f.value, label: f.label }))} aria-label="Format" data-testid="model-export-format" />
        </Field>
        <div className={styles.options}>
          <Checkbox checked={gameParts} onChange={setGameParts} disabled={!counts.game} label={counts.game ? `Suspensions, engine and gearbox fitted from the game (${counts.game} meshes)` : 'Suspensions, engine and gearbox fitted from the game (none fitted)'} />
          <Checkbox checked={hidden} onChange={setHidden} label="Meshes hidden in the viewport" />
          <Checkbox checked={selectionOnly} onChange={setSelectionOnly} disabled={!selection.length} label={selection.length ? `Only the selection (${selection.length})` : 'Only the selection (nothing is selected)'} />
        </div>
        <p className={styles.summary} data-testid="model-export-summary">
          {counts.meshes ? `${counts.meshes} meshes, ${counts.triangles.toLocaleString()} triangles, each named after its part and standing where it is on the car.` : 'Nothing to export with these choices.'}
        </p>
      </div>
    </Modal>
  );
}
