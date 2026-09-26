import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsService } from '../../src/main/services/settings';
import { NULL_LOGGER } from '../../src/shared/logger';

vi.mock('../../src/main/services/atomicWrite', () => ({
  atomicWrite: vi.fn(() => Promise.reject(Object.assign(new Error('locked by AV'), { code: 'EPERM' }))),
}));

describe('SettingsService.update when the write fails', () => {
  it('keeps the saved value in memory and does not notify listeners', async () => {
    const svc = new SettingsService(join(tmpdir(), 'jbf-never-written', 'settings.json'), NULL_LOGGER);
    await svc.load();
    const listener = vi.fn();
    svc.onChange(listener);

    await expect(svc.update({ debugLogging: true })).rejects.toThrow('locked by AV');

    expect(svc.get().debugLogging).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
