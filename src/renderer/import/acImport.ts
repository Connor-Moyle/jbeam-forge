import { create } from 'zustand';
import { summarizeAcCar } from '@shared/ac/car';
import type { AcCarInfo } from '@shared/ipc-contract';
import { projectStore } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useUiStore } from '@renderer/app/stores/ui';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { confirmImport, useImportUi } from './importFlow';
import { defaultSettings, joinRef, stageImport } from './pipeline';

/**
 * Bring an Assetto Corsa car over: its kn5 model (with a skin's paint), and
 * its data files kept with the project as the reference car, so its specs
 * (mass, wheelbase, engine, gearing…) are on hand while building the mod.
 */

export const useAcImportUi = create<{ car: AcCarInfo | null; setCar: (car: AcCarInfo | null) => void }>()((set) => ({
  car: null,
  setCar: (car) => set({ car }),
}));

function errorText(err: unknown): string {
  if (err instanceof IpcCallError) return err.ipcError.message;
  return err instanceof Error ? err.message : String(err);
}

export async function startAcImport(): Promise<void> {
  if (!projectStore.getState().doc) return;
  try {
    const car = await call('ac:pickCar');
    if (car) useAcImportUi.getState().setCar(car);
  } catch (err) {
    void useDialogStore.getState().showAlert('Could not read the car folder', errorText(err));
  }
}

export function skinDir(car: Pick<AcCarInfo, 'folder'>, skin: string): string {
  return joinRef(joinRef(car.folder, 'skins'), skin);
}

export interface AcImportChoices {
  skin: string | null;
  importModel: boolean;
  /** Which of the folder's models (defaults to the main one). */
  model?: string;
  /** Offer to sort the meshes into parts after importing. */
  classify?: boolean;
  /** Use the car's name, brand and description for the mod. */
  useDetails: boolean;
  /** The modder's declaration: owns Assetto Corsa, and the mod is free. */
  owned: boolean;
  free: boolean;
}

export async function confirmAcImport(car: AcCarInfo, choices: AcImportChoices): Promise<void> {
  useAcImportUi.getState().setCar(null);
  const summary = summarizeAcCar(car.files);
  projectStore.getState().execute({
    label: `Bring over ${summary.name ?? car.carId}`,
    apply: (d) => {
      d.reference = { kind: 'assettocorsa', carId: car.carId, folder: car.folder, skin: choices.skin, files: car.files, importedAt: new Date().toISOString() };
      // A car brought over from Assetto Corsa is a port: record where it came from and the declaration.
      if (choices.importModel) d.meta.portedFrom = { game: 'Assetto Corsa', credit: summary.author ?? d.meta.portedFrom?.credit, owned: choices.owned, free: choices.free };
      if (choices.useDetails) {
        if (summary.name) d.meta.name = summary.name;
        if (summary.brand) d.meta.brand = summary.brand;
        if (summary.description) d.meta.description = summary.description;
      }
    },
  });
  const model = choices.model ?? car.kn5;
  if (!choices.importModel || !model) {
    useUiStore.getState().pushStatus(`Kept ${Object.keys(car.files).length} data files from ${summary.name ?? car.carId}`, 'success');
    return;
  }
  const ui = useImportUi.getState();
  try {
    ui.setBusy(`Reading ${model.split(/[\\/]/).pop() ?? 'the model'}…`);
    const staged = await stageImport(model, 'kn5');
    await confirmImport(staged, defaultSettings('kn5'), { textureDirs: choices.skin ? [skinDir(car, choices.skin)] : [], classify: choices.classify ?? true });
  } catch (err) {
    ui.setBusy(null);
    void useDialogStore.getState().showAlert('Could not import the car model', errorText(err));
  }
}
