import { useEffect } from 'react';
import { Pentagon, RotateCcw } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { Button } from '@renderer/ui/components/Button';
import { FieldGroup } from '@renderer/ui/components/Field';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import styles from '@renderer/workshop/Workshop.module.css';
import own from './Modelling.module.css';
import { cannotModel, enterModelling, resetMesh, sceneMesh, useModelUi } from './commands';

const KEYS: [string, string][] = [
  ['1 · 2 · 3', 'Pick points, edges or faces'],
  ['Click · Shift+click', 'Pick one · add or remove'],
  ['A · L', 'Pick everything · everything joined on'],
  ['G · R · S', 'Move, turn or resize with the arrows'],
  ['E', 'Extrude: pull faces out, or grow a face from edges'],
  ['F', 'Fill: a new face through 3 or 4 points'],
  ['Alt+N', 'Flip normals (the side a face shows)'],
  ['X · Delete', 'Delete faces'],
  ['Ctrl+Z', 'Undo, one step at a time'],
  ['Esc · Tab', 'Drop the pick · finish'],
];

/**
 * Modelling workspace (fork): pick a mesh and reshape it, Blender-style.
 * The changes live in the project, not in the model file; if the file is
 * saved again from Blender you're asked which version to keep.
 */
export function ModellingPanel() {
  const key = useModelUi((s) => s.key);
  const selection = useSceneStore((s) => s.selection);
  const models = useProjectStore((s) => s.doc?.meshModels);
  const names = useProjectStore((s) => s.doc?.meshNames);
  // Leaving the workspace finishes reshaping.
  useEffect(() => () => enterModelling(null), []);
  const nameOf = (k: string) => names?.[k]?.name ?? sceneMesh(k)?.name ?? k;
  const picked = selection.length === 1 ? selection[0]! : null;
  const why = picked ? cannotModel(picked) : null;
  const reshaped = Object.keys(models ?? {});

  return (
    <div className={styles.panel} data-testid="modelling-panel">
      <ScrollArea className={styles.scroll}>
        <FieldGroup title="Reshape a mesh">
          {key ? (
            <>
              <p className={styles.note}>
                Reshaping <strong>{nameOf(key)}</strong>. Use the bar over the 3D view, or the keys below. Everything you change stays in this mod; the model file is never touched.
              </p>
              <div className={styles.row}>
                <Button size="sm" variant="primary" onClick={() => enterModelling(null)} data-testid="model-finish">
                  Done
                </Button>
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={resetMesh} disabled={!models?.[key]} data-testid="model-reset">
                  Back to the file&rsquo;s shape
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.note}>Click one mesh on the car (or in the Scene), then reshape it: move its points, pull faces out, fill holes and flip faces that show inside out.</p>
              <div className={styles.row}>
                <Button size="sm" variant="primary" icon={Pentagon} onClick={() => picked && enterModelling(picked)} disabled={!picked || !!why} data-testid="model-start">
                  {picked ? `Reshape ${nameOf(picked)}` : selection.length > 1 ? 'Pick just one mesh' : 'Pick a mesh first'}
                </Button>
              </div>
              {why && <p className={styles.note}>{why}</p>}
            </>
          )}
        </FieldGroup>
        <FieldGroup title="Keys">
          <dl className={own.keyList}>
            {KEYS.map(([k, what]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </FieldGroup>
        {reshaped.length > 0 && (
          <FieldGroup title="Reshaped in this mod">
            <ul className={styles.rideList}>
              {reshaped.map((k) => (
                <li key={k}>
                  <button type="button" className={own.linkButton} onClick={() => enterModelling(k)}>
                    {nameOf(k)}
                  </button>
                </li>
              ))}
            </ul>
          </FieldGroup>
        )}
      </ScrollArea>
    </div>
  );
}
