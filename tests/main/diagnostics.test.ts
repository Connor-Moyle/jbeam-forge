import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, clipboard: {} }));

const { formatDiagnostics, logProblems } = await import('../../src/main/diagnostics');

describe('copied diagnostics', () => {
  it('keeps only recent warnings and errors from the log, one short line each', () => {
    const log = [
      '[2026-09-30 10:00:00.000] [info]  (app) started',
      '[2026-09-30 10:00:01.000] [warn]  (library) one zip unreadable',
      '    at someStackLine (x.js:1:1)',
      `[2026-09-30 10:00:02.000] [error] (renderer) boom ${'x'.repeat(5000)}`,
      ...Array.from({ length: 40 }, (_, i) => `[2026-09-30 10:01:${String(i).padStart(2, '0')}.000] [error] (r) e${i}`),
    ];
    const out = logProblems(log);
    expect(out).toHaveLength(12);
    expect(out.at(-1)).toContain('e39');
    expect(out.every((l) => l.length <= 245)).toBe(true);
    expect(out.join('\n')).not.toContain('someStackLine');
  });

  it('the whole report stays short', () => {
    const text = formatDiagnostics(
      {
        app: { name: 'JBeam Forge', version: '0.13.1' },
        versions: { electron: '44', chrome: '1', node: '22', v8: '1' },
        os: { platform: 'win32', release: '10.0', arch: 'x64' },
        gpu: { webgl: 'enabled' },
        logFile: 'C:/log/main.log',
        userData: 'C:/u',
        debugLogging: false,
        recentLog: Array.from({ length: 200 }, (_, i) => `[t] [info] line ${i}`),
      },
      'Where: Export\nError: bad',
    );
    expect(text).toContain('Where: Export');
    expect(text).not.toContain('line 199');
    expect(text.split('\n').length).toBeLessThan(15);
  });
});
