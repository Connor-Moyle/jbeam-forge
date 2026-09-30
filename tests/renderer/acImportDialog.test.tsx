import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AcImportDialog } from '../../src/renderer/import/AcImportDialog';
import { useAcImportUi } from '../../src/renderer/import/acImport';
import { TooltipProvider } from '../../src/renderer/ui/components/Tooltip';

const car = {
  folder: '/ac/content/cars/ks_old_coupe',
  carId: 'ks_old_coupe',
  kn5: '/ac/content/cars/ks_old_coupe/old_coupe.kn5',
  models: [
    { path: '/ac/content/cars/ks_old_coupe/old_coupe.kn5', label: 'Detailed (old_coupe)', bytes: 20_000_000 },
    { path: '/ac/content/cars/ks_old_coupe/old_coupe_lod_b.kn5', label: 'Medium detail, LOD B (old_coupe_lod_b)', bytes: 6_000_000 },
    { path: '/ac/content/cars/ks_old_coupe/collider.kn5', label: 'Collider (the game’s collision shape)', bytes: 50_000 },
  ],
  skins: ['red'],
  files: { 'ui/ui_car.json': '{"name":"Old Coupe","brand":"Kunos"}' },
  warnings: [],
};

describe('Assetto Corsa import dialog', () => {
  it('offers every model and waits for the porting declaration before importing the model', async () => {
    useAcImportUi.getState().setCar(car);
    render(
      <TooltipProvider>
        <AcImportDialog />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('ac-import-model')).toBeInTheDocument();
    const confirm = screen.getByTestId('ac-import-confirm');
    expect(confirm).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByText('I own Assetto Corsa'));
    expect(confirm).toBeDisabled();
    await user.click(screen.getByText(/The mod will be free/));
    expect(confirm).toBeEnabled();
    // Data only (no model): nothing is ported, nothing to declare.
    await user.click(screen.getByText('Import the model with its materials and textures'));
    expect(screen.queryByTestId('ac-import-declare')).not.toBeInTheDocument();
    expect(confirm).toBeEnabled();
    useAcImportUi.getState().setCar(null);
  });
});
