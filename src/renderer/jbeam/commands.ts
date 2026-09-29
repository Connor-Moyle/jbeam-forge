import { projectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';
import { useEditStore } from '@renderer/structure/editStore';
import * as wb from '@shared/jbeam/workbench';
import type { Project } from '@shared/project/schema';

/**
 * The JBeam workspace's commands (fork): each change is one undo step with a
 * plain label, and says what it did in the status bar.
 */

type Vec3 = [number, number, number];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const status = (text: string, tone: 'info' | 'success' | 'warning' = 'info') => useUiStore.getState().pushStatus(text, tone);

function run(label: string, apply: (d: Project) => void): boolean {
  if (!projectStore.getState().doc) return false;
  return projectStore.getState().execute({ label, apply });
}

export function checkThresholds(): wb.CheckThresholds {
  const s = useSettingsStore.getState().settings;
  if (!s) return wb.DEFAULT_THRESHOLDS;
  return { shortBeam: s.jbeamShortBeamMm / 1000, longBeam: s.jbeamLongBeamM, minBeams: s.jbeamMinBeams, overlap: s.jbeamOverlapMm / 1000, heavyFactor: s.jbeamHeavyFactor };
}

export function namingOptions(prefixes?: Record<string, string>): wb.NamingOptions {
  const s = useSettingsStore.getState().settings;
  return { order: s?.jbeamNamingOrder ?? 'front-back', sides: s?.jbeamNamingSides ?? true, start: s?.jbeamNamingStart ?? 1, ...(prefixes ? { prefixes } : {}) };
}

// ---------------------------------------------------------------- names

/** Apply a batch of renames; the selection follows. Returns a problem, or null. */
export function applyRenames(map: ReadonlyMap<string, string>, label: string): string | null {
  const doc = projectStore.getState().doc;
  if (!doc || !map.size) return null;
  const problem = wb.renameProblem(doc, map);
  if (problem) return problem;
  run(label, (d) => void wb.renameNodes(d, map));
  const e = useEditStore.getState();
  e.select(
    e.nodes.map((id) => map.get(id) ?? id),
    e.beams.map((k) => {
      const [a, b] = k.split('|') as [string, string];
      const x = map.get(a) ?? a;
      const y = map.get(b) ?? b;
      return x < y ? `${x}|${y}` : `${y}|${x}`;
    }),
  );
  status(`Renamed ${plural(map.size, 'node')}`, 'success');
  return null;
}

export function renameLogically(partIds: readonly string[], prefixes?: Record<string, string>): string | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const map = wb.logicalNames(doc, partIds, namingOptions(prefixes));
  if (!map.size) {
    status('The nodes already have those names');
    return null;
  }
  return applyRenames(map, `Name ${plural(map.size, 'node')} logically`);
}

// ---------------------------------------------------------------- properties

export function setOption(target: wb.RowTarget, keys: readonly string[], key: string, value: number | string | boolean | null): void {
  if (!keys.length) return;
  let n = 0;
  run(value === null ? `Reset ${key}` : `Set ${key}`, (d) => void (n = wb.setRowOption(d, target, keys, key, value)));
  if (keys.length > 1) status(`${value === null ? 'Reset' : 'Set'} ${key} on ${plural(n, target === 'tri' ? 'triangle' : target)}`);
}

export function scaleOption(target: wb.RowTarget, keys: readonly string[], key: string, factor: number, base: (row: unknown) => number | undefined): void {
  let n = 0;
  run(`Scale ${key} × ${factor}`, (d) => void (n = wb.scaleRowOption(d, target, keys, key, factor, base)));
  status(`Scaled ${key} on ${plural(n, target === 'tri' ? 'triangle' : target)}`);
}

export function clearOptions(target: wb.RowTarget, keys: readonly string[]): void {
  let n = 0;
  run('Reset to the preset', (d) => void (n = wb.clearRowOptions(d, target, keys)));
  status(n ? `${plural(n, target === 'tri' ? 'triangle' : target)} back to the part’s preset` : 'Nothing was set by hand');
}

export function setBeamKind(keys: readonly string[], kind: Project['beams'][number]['kind']): void {
  run(`Make ${plural(keys.length, 'beam')} ${kind}`, (d) => void wb.setBeamKind(d, keys, kind));
}

// ---------------------------------------------------------------- triangles

/** T: a triangle through the three selected nodes. */
export function addTriangleFromSelection(): void {
  const ids = useEditStore.getState().nodes;
  if (ids.length !== 3) {
    status('Pick exactly three nodes to make a triangle (in order: the outside is where they turn anticlockwise).');
    return;
  }
  let key: string | null = null;
  run('Add triangle', (d) => void (key = wb.addTriangle(d, ids)));
  if (key) useEditStore.getState().selectTris([key]);
  else status('Those three already make a triangle');
}

export function flipTriangles(keys: readonly string[]): void {
  run(`Flip ${plural(keys.length, 'triangle')}`, (d) => void wb.flipTriangles(d, keys));
}

export function deleteTriangles(keys: readonly string[]): void {
  let n = 0;
  run(`Delete ${plural(keys.length, 'triangle')}`, (d) => void (n = wb.deleteTriangles(d, keys)));
  useEditStore.getState().selectTris([]);
  status(`Deleted ${plural(n, 'triangle')}`);
}

/** The triangles made only of the selected nodes. */
export function selectTrianglesOfSelection(): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const keys = wb.trianglesOf(doc, useEditStore.getState().nodes);
  useEditStore.getState().selectTris(keys);
  status(keys.length ? `${plural(keys.length, 'triangle')} selected` : 'No triangle is made only of the selected nodes');
}

export function selectBeamsOfSelection(): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const e = useEditStore.getState();
  const keys = wb.beamsOf(doc, e.nodes);
  e.select(e.nodes, keys);
  status(`${plural(keys.length, 'beam')} between the selected nodes`);
}

// ---------------------------------------------------------------- nodes

export function moveToPart(ids: readonly string[], partId: string, partName: string): void {
  let n = 0;
  run(`Move ${plural(ids.length, 'node')} to ${partName}`, (d) => void (n = wb.moveToPart(d, ids, partId)));
  status(`Moved ${plural(n, 'node')} to ${partName}`);
}

export function offset(ids: readonly string[], d: Vec3): void {
  run(`Move ${plural(ids.length, 'node')}`, (doc) => wb.offsetNodes(doc, ids, d));
}

export function scale(ids: readonly string[], f: Vec3): void {
  run(`Scale ${plural(ids.length, 'node')}`, (doc) => wb.scaleNodes(doc, ids, f));
}

export function align(ids: readonly string[], axis: 0 | 1 | 2, value?: number): void {
  run(`Line up ${plural(ids.length, 'node')} on ${'XYZ'[axis]}`, (doc) => wb.alignNodes(doc, ids, axis, value));
}

export function snap(ids: readonly string[], gridMm: number): void {
  run(`Snap ${plural(ids.length, 'node')} to ${gridMm} mm`, (doc) => wb.snapNodes(doc, ids, gridMm / 1000));
}

export function symmetrise(ids: readonly string[]): void {
  let n = 0;
  run('Make symmetric', (doc) => void (n = wb.symmetrise(doc, ids)));
  status(n ? `Evened out ${plural(n, 'pair')}` : 'Already symmetric', n ? 'success' : 'info');
}

export function distribute(ids: readonly string[], totalKg: number, keepRatio: boolean): void {
  run(`Share ${totalKg} kg over ${plural(ids.length, 'node')}`, (doc) => wb.distributeWeight(doc, ids, totalKg, keepRatio));
}

export function scaleWeights(ids: readonly string[], factor: number): void {
  run(`Scale ${plural(ids.length, 'node')}’s weight × ${factor}`, (doc) => wb.scaleWeights(doc, ids, factor));
}

// ---------------------------------------------------------------- selection helpers

export function selectIssue(issue: wb.Issue): void {
  const e = useEditStore.getState();
  if (!e.active) e.setActive(true);
  if (issue.tris.length) e.selectTris(issue.tris);
  else e.select(issue.nodes, issue.beams);
}

/** Every node of these parts. */
export function selectPartNodes(partIds: readonly string[]): void {
  const doc = projectStore.getState().doc;
  const want = new Set(partIds);
  const e = useEditStore.getState();
  if (!e.active) e.setActive(true);
  e.select((doc?.nodes ?? []).filter((n) => want.has(n.partId)).map((n) => n.id), []);
}

/** Quick fixes for the checks. */
export function fixIssues(kind: wb.IssueKind, issues: readonly wb.Issue[]): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const of = issues.filter((i) => i.kind === kind);
  if (kind === 'duplicate-beam') {
    run(`Remove ${plural(of.length, 'doubled beam')}`, (d) => {
      const seen = new Set<string>();
      d.beams = d.beams.filter((b) => {
        const k = `${b.id1 < b.id2 ? `${b.id1}|${b.id2}` : `${b.id2}|${b.id1}`}|${b.kind}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    });
  } else if (kind === 'duplicate-triangle' || kind === 'bad-triangle') {
    const ids = new Set(doc.nodes.map((n) => n.id));
    run('Remove broken and doubled triangles', (d) => {
      const seen = new Set<string>();
      d.tris = d.tris.filter((t) => {
        const k = wb.triKey(t.ids);
        if (seen.has(k) || new Set(t.ids).size < 3 || t.ids.some((id) => !ids.has(id))) return false;
        seen.add(k);
        return true;
      });
    });
  } else if (kind === 'missing-node') {
    const ids = new Set(doc.nodes.map((n) => n.id));
    run('Remove beams to missing nodes', (d) => void (d.beams = d.beams.filter((b) => ids.has(b.id1) && ids.has(b.id2))));
  } else if (kind === 'zero-beam') {
    const pos = new Map(doc.nodes.map((n) => [n.id, n.pos]));
    run('Remove beams with no length', (d) => {
      d.beams = d.beams.filter((b) => {
        const a = pos.get(b.id1);
        const c = pos.get(b.id2);
        return !a || !c || Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) >= 1e-5;
      });
    });
  } else if (kind === 'asymmetric') {
    symmetrise(of.flatMap((i) => i.nodes));
    return;
  } else return;
  status('Fixed', 'success');
}
