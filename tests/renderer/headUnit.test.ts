import { describe, expect, it } from 'vitest';
import { headUnitConfig, headUnitHtml, mountHeadUnit } from '../../src/shared/lua/library/display';

describe('head unit page', () => {
  const ctx = { name: 'headunit', params: { theme: 'android', units: 'kmh', brand: 'Drive', tracks: 'Song A - Band B\nSong C - Band D' } };

  it('runs in a page: apps, speed, music and screen power follow the electrics', () => {
    const doc = new DOMParser().parseFromString(headUnitHtml(ctx, { script: false }), 'text/html');
    const hu = mountHeadUnit(doc, headUnitConfig(ctx));
    hu.render();
    expect(doc.getElementById('screen')!.className).toBe('off');
    hu.update({ ignitionLevel: 2, wheelspeed: 25, rpm: 3000, jbf_headunit_app: 4, jbf_headunit_track: 1, jbf_headunit_play: 1, fuel: 0.5 });
    hu.render();
    expect(doc.getElementById('screen')!.className).toBe('');
    expect(doc.getElementById('cSpeed')!.textContent).toBe('90');
    expect(doc.getElementById('cFuel')!.textContent).toBe('50%');
    expect(doc.querySelectorAll('.app')[4]!.className).toBe('app on');
    expect(doc.getElementById('title')!.textContent).toBe('Song C');
    expect(doc.getElementById('brand')!.textContent).toBe('Drive');
  });

  it('carries its script for the game, and the script compiles', () => {
    const html = headUnitHtml(ctx);
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- only compiles the page's script, as the game's browser would
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('window.updateData');
    expect(headUnitHtml(ctx, { script: false })).not.toContain('<script>');
  });
});
