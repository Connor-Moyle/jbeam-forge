import { describe, expect, it } from 'vitest';
import { beamngControl, controlLabel, controlWarning } from '../../src/shared/lua/keys';

const press = (key: string, code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, code, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe('script keys', () => {
  it('names key presses the way BeamNG input maps do', () => {
    expect(beamngControl(press('m', 'KeyM', { ctrlKey: true }))).toBe('lctrl m');
    expect(beamngControl(press('M', 'KeyM', { ctrlKey: true, shiftKey: true }))).toBe('lctrl lshift m');
    expect(beamngControl(press('5', 'Numpad5'))).toBe('numpad5');
    expect(beamngControl(press('F6', 'F6', { altKey: true }))).toBe('lalt f6');
    expect(beamngControl(press('ArrowUp', 'ArrowUp', { ctrlKey: true }))).toBe('lctrl up');
    expect(beamngControl(press('.', 'Period', { ctrlKey: true }))).toBe('lctrl period');
    expect(beamngControl(press('!', 'Digit1', { shiftKey: true }))).toBe('lshift 1');
    expect(beamngControl(press('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull();
  });

  it('shows them readably', () => {
    expect(controlLabel('lctrl m')).toBe('Ctrl + M');
    expect(controlLabel('lalt lshift f6')).toBe('Alt + Shift + F6');
    expect(controlLabel('numpad5')).toBe('Numpad 5');
    expect(controlLabel('lctrl apostrophe')).toBe("Ctrl + '");
  });

  it('warns about keys the game drives with', () => {
    expect(controlWarning('w')).toMatch(/driving keys/);
    expect(controlWarning('lctrl w')).toBeNull();
    expect(controlWarning('numpad5')).toBeNull();
    expect(controlWarning('')).toBeNull();
  });
});
