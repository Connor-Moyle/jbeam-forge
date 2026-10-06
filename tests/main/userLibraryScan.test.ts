import { describe, expect, it, vi } from 'vitest';
import { UserLibrary } from '../../src/main/library/userLibrary';

const quiet = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } as never;

describe('library scans', () => {
  it('a change of folders during a scan is scanned once that one ends; the same request is shared', async () => {
    const lib = new UserLibrary('unused', quiet, () => undefined);
    const ran: (string | null)[] = [];
    let release: (() => void) | null = null;
    vi.spyOn(lib as unknown as { scanAll: (f: { beamngInstall: string | null }) => Promise<void> }, 'scanAll').mockImplementation((f) => {
      ran.push(f.beamngInstall);
      return new Promise<void>((r) => (release = r));
    });
    const folders = (install: string) => ({ materials: [], objects: [], beamngInstall: install });
    const first = lib.scan(folders('fake'));
    const same = lib.scan(folders('fake'));
    expect(same).toBe(first);
    const second = lib.scan(folders('real'));
    const third = lib.scan(folders('newest'));
    expect(ran).toEqual(['fake']);
    release!();
    await first;
    await vi.waitFor(() => expect(ran).toEqual(['fake', 'newest']));
    release!();
    await Promise.all([second, third]);
    expect(lib.items.scanning).toBe(false);
  });
});
