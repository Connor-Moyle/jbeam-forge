import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '@shared/lua/library';
import { KEYMAP } from '@shared/keymap';
import { GUIDE_GROUPS, GUIDES } from '@renderer/help/guides';
import { TUTORIAL_GROUPS, tutorialGuides } from '@renderer/help/tutorials';

describe('Help → Tutorials', () => {
  const tutorials = tutorialGuides();

  it('lists every tutorial in a known group, in step-by-step form', () => {
    for (const t of tutorials) {
      expect(TUTORIAL_GROUPS).toContain(t.group);
      expect(t.sections.some((s) => (s.steps?.length ?? 0) > 0)).toBe(true);
    }
    for (const g of TUTORIAL_GROUPS) {
      expect(GUIDE_GROUPS).toContain(g);
      expect(tutorials.some((t) => t.group === g)).toBe(true);
    }
  });

  it('has one per vehicle script, and the interactive lessons can be started', () => {
    for (const t of BUILT_IN_TEMPLATES) expect(tutorials.some((g) => g.id === `tutorial-script-${t.id}`)).toBe(true);
    for (const id of ['tutorial-tour', 'tutorial-jbeam', 'tutorial-moving', 'tutorial-triggers']) expect(tutorials.find((g) => g.id === id)?.start).toBeTruthy();
  });

  it('ids are unique across guides and tutorials, and every {key:…} is a real shortcut', () => {
    const ids = [...GUIDES, ...tutorials].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = new Set<string>(KEYMAP.map((k) => k.id));
    const text = JSON.stringify(tutorials.map((t) => t.sections));
    for (const [, id] of text.matchAll(/\{key:(\w+)\}/g)) expect(keys).toContain(id);
  });
});
