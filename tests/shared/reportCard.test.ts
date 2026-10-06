import { describe, expect, it } from 'vitest';
import { partReportCard } from '../../src/shared/structure/reportCard';

// A 3×3 grid of nodes 0.3 m apart, braced like a panel.
function panel(weight: number, spacing = 0.3) {
  const nodes = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) nodes.push({ id: `n${i}${j}`, pos: [i * spacing, j * spacing, 0] as [number, number, number], weight });
  const beams = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      if (i < 2) beams.push({ id1: `n${i}${j}`, id2: `n${i + 1}${j}` });
      if (j < 2) beams.push({ id1: `n${i}${j}`, id2: `n${i}${j + 1}` });
      if (i < 2 && j < 2) beams.push({ id1: `n${i}${j}`, id2: `n${i + 1}${j + 1}` }, { id1: `n${i + 1}${j}`, id2: `n${i}${j + 1}` });
    }
  return { nodes, beams };
}

describe('a part compared with the game’s own', () => {
  it('passes a panel like the game’s', () => {
    const { nodes, beams } = panel(0.75);
    const card = partReportCard(nodes, beams, 8, 'panel_metal');
    expect(card.map((l) => l.verdict)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('flags light nodes, coarse beams and a part nothing can hit, saying why', () => {
    const { nodes, beams } = panel(0.05, 0.9);
    const card = partReportCard(nodes, beams, 1, 'panel_metal');
    const by = (m: string) => card.find((l) => l.measure.startsWith(m))!;
    expect(by('Node weight').verdict).toBe('low');
    expect(by('Node weight').hint).toMatch(/shake or explode/);
    expect(by('Beam length').verdict).toBe('high');
    expect(by('Collision').verdict).toBe('low');
  });

  it('says nothing about a part with no structure', () => {
    expect(partReportCard([], [], 0, 'panel_metal')).toEqual([]);
  });
});
