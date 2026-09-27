import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '../../src/renderer/settings/SettingsModal';
import { TooltipProvider } from '../../src/renderer/ui/components/Tooltip';
import type { Settings } from '../../src/shared/settings-schema';

const SETTINGS: Settings = { version: 1, debugLogging: false, beamngInstallDir: 'C:\\Game', beamngUserDir: 'C:\\User', author: null, focusGhostOpacity: 0.12 };

const valid = (dir: string) => ({ ok: true, dir, version: '0.39.1.0', build: null, vehicleCount: 3, problems: [] });

afterEach(() => {
  vi.useRealTimers();
});

describe('SettingsModal', () => {
  it('never lets a stale validation enable Save for a new path', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const invoke = vi.mocked(window.forge.invoke);
    invoke.mockImplementation(((channel: string, req?: { dir?: string }) =>
      Promise.resolve(channel === 'beamng:validate' ? { ok: true, value: valid(req?.dir ?? '') } : { ok: true, value: undefined })) as never);

    render(
      <TooltipProvider>
        <SettingsModal settings={SETTINGS} onClose={() => undefined} />
      </TooltipProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(await screen.findByTestId('beamng-status')).toHaveTextContent('0.39.1 · 3 vehicles');

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const input = screen.getByTestId('beamng-dir');
    await user.clear(input);
    await user.type(input, 'D:\\Other');
    // Before the debounce fires, the old "valid" answer must not count.
    expect(screen.getByTestId('settings-save')).toBeDisabled();
    expect(screen.queryByTestId('beamng-status')).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(await screen.findByTestId('beamng-status')).toBeInTheDocument();
    expect(screen.getByTestId('settings-save')).toBeEnabled();
    invoke.mockReset();
  });
});
