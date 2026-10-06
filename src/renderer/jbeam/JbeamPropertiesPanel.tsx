import { useMemo, useState } from 'react';
import { AlignCenterVertical, CircleDot, FlipHorizontal2, Grid3x3, Move3d, Scale, Spline, Tag, Trash2, Triangle, Wand2 } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { call } from '@renderer/diagnostics/ipc';
import { useEditStore } from '@renderer/structure/editStore';
import { deleteSelection, setAxis, setWeight } from '@renderer/structure/editCommands';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { centroid, beamKey } from '@shared/structure/edit';
import { nodePrefix } from '@shared/proxy/generate';
import { logicalNames, replaceInNames, triKey } from '@shared/jbeam/workbench';
import { BEAM_KINDS, type Project } from '@shared/project/schema';
import { Button } from '@renderer/ui/components/Button';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Toggle } from '@renderer/ui/components/Toggle';
import * as cmd from './commands';
import { PropertyEditor } from './PropertyEditor';
import { presetBeamValue, presetNodeValue, presetTriValue } from './presetValues';
import styles from './Jbeam.module.css';

/**
 * JBeam workspace, right: exact values for whatever is picked (nodes, beams
 * or triangles) and the tools that go with them. Nothing picked: naming and
 * a summary for each part.
 */
export function JbeamPropertiesPanel() {
  const doc = useProjectStore((s) => s.doc);
  const nodes = useEditStore((s) => s.nodes);
  const beams = useEditStore((s) => s.beams);
  const tris = useEditStore((s) => s.tris);
  const advanced = useSettingsStore((s) => s.settings?.jbeamAdvanced ?? false);

  if (!doc || !doc.nodes.length) return <EmptyState icon={Spline} message="Generate the structure first; then pick nodes, beams or triangles to set their exact values." />;

  return (
    <div className={styles.panel} data-testid="jbeam-properties">
      <div className={styles.modeBar}>
        <span className={styles.modeTitle}>{nodes.length ? `${nodes.length} node${nodes.length === 1 ? '' : 's'}` : beams.length ? `${beams.length} beam${beams.length === 1 ? '' : 's'}` : tris.length ? `${tris.length} triangle${tris.length === 1 ? '' : 's'}` : 'Parts'}</span>
        <Toggle checked={advanced} onChange={(jbeamAdvanced) => void call('settings:update', { jbeamAdvanced })} label="Advanced" />
      </div>
      <ScrollArea className={styles.scroll}>
        <div className={styles.body}>
          {nodes.length > 0 ? <NodesSection doc={doc} ids={nodes} advanced={advanced} /> : beams.length > 0 ? <BeamsSection doc={doc} keys={beams} /> : tris.length > 0 ? <TrisSection doc={doc} keys={tris} /> : <PartsSection doc={doc} />}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------- nodes

const AXES = [
  { axis: 0, label: 'X', hint: 'left +' },
  { axis: 1, label: 'Y', hint: 'rear +' },
  { axis: 2, label: 'Z', hint: 'up +' },
] as const;

function NodesSection({ doc, ids, advanced }: { doc: Project; ids: readonly string[]; advanced: boolean }) {
  const want = useMemo(() => new Set(ids), [ids]);
  const picked = useMemo(() => doc.nodes.filter((n) => want.has(n.id)), [doc.nodes, want]);
  if (!picked.length) return null;
  const single = picked.length === 1 ? picked[0]! : null;
  const at = single ? single.pos : centroid(picked);
  const total = picked.reduce((s, n) => s + n.weight, 0);
  const partIds = [...new Set(picked.map((n) => n.partId))];
  const partNames = partIds.map((id) => doc.parts.find((p) => p.id === id)?.displayName ?? id);

  return (
    <>
      <p className={styles.sub}>{partNames.length > 2 ? `${partNames.length} parts` : partNames.join(', ')}</p>
      <CollapsibleSection id="jbeam-name" title="Name" defaultOpen>
        {single ? <NodeName key={single.id} id={single.id} /> : <Rename ids={ids} />}
        <Button size="sm" icon={Wand2} onClick={() => cmd.renameLogically(partIds, prefixesFor(doc, partIds))} data-testid="jbeam-name-logically">
          {partNames.length === 1 ? `Name every ${partNames[0]} node logically` : 'Name these parts’ nodes logically'}
        </Button>
      </CollapsibleSection>

      <CollapsibleSection id="jbeam-position" title={single ? 'Position' : 'Position (centre of the selection)'} defaultOpen>
        <div className={styles.row3}>
          {AXES.map(({ axis, label, hint }) => (
            <Field key={axis} label={`${label} (${hint})`}>
              <NumberInput value={at[axis]} onChange={(v) => setAxis(ids, axis, v)} step={0.001} precision={4} unit="m" aria-label={`${label} position`} />
            </Field>
          ))}
        </div>
        <MoveBy ids={ids} />
        {!single && (
          <div className={styles.buttons}>
            {AXES.map(({ axis, label }) => (
              <Button key={axis} size="sm" icon={AlignCenterVertical} onClick={() => cmd.align(ids, axis)}>
                Line up on {label}
              </Button>
            ))}
          </div>
        )}
        <div className={styles.buttons}>
          <Button size="sm" icon={FlipHorizontal2} onClick={() => cmd.symmetrise(ids)}>
            Make symmetric
          </Button>
          <SnapButton ids={ids} />
        </div>
        {advanced && !single && <ScaleBy ids={ids} />}
      </CollapsibleSection>

      <CollapsibleSection id="jbeam-mass" title="Weight" defaultOpen>
        <Field label={single ? 'Weight' : 'Weight of each'} hint={single ? undefined : `Total ${total.toFixed(2)} kg`}>
          <NumberInput value={picked[0]!.weight} onChange={(v) => setWeight(ids, v)} min={0.01} max={1000} step={0.1} precision={3} unit="kg" aria-label="Node weight" />
        </Field>
        {!single && <Distribute ids={ids} total={total} />}
      </CollapsibleSection>

      {advanced && (
        <CollapsibleSection id="jbeam-part" title="Part" defaultOpen={false}>
          <Field label="Belongs to" hint="Moving nodes to another part takes the beams and triangles only they make up with them.">
            <Select
              value={partIds.length === 1 ? partIds[0]! : ''}
              onChange={(partId) => cmd.moveToPart(ids, partId, doc.parts.find((p) => p.id === partId)?.displayName ?? partId)}
              options={[...(partIds.length > 1 ? [{ value: '', label: 'Several parts' }] : []), ...doc.parts.map((p) => ({ value: p.id, label: p.displayName }))]}
              aria-label="Part"
            />
          </Field>
        </CollapsibleSection>
      )}

      <CollapsibleSection id="jbeam-node-props" title="Properties" defaultOpen>
        <PropertyEditor target="node" keys={ids} rows={picked} preset={(k) => presetNodeValue(doc, picked[0]!, k)} />
      </CollapsibleSection>

      <CollapsibleSection id="jbeam-node-select" title="Select" defaultOpen={false}>
        <div className={styles.buttons}>
          <Button size="sm" icon={Spline} onClick={cmd.selectBeamsOfSelection}>
            Their beams
          </Button>
          <Button size="sm" icon={Triangle} onClick={cmd.selectTrianglesOfSelection}>
            Their triangles
          </Button>
          <Button size="sm" icon={CircleDot} onClick={() => cmd.selectPartNodes(partIds)}>
            All of {partNames.length === 1 ? partNames[0] : 'their parts'}
          </Button>
          <Button size="sm" icon={Move3d} onClick={() => useEditStore.getState().frameNodes(ids)}>
            Show in 3D
          </Button>
        </div>
      </CollapsibleSection>

      <Button size="sm" variant="danger" icon={Trash2} onClick={deleteSelection}>
        Delete {single ? 'node' : `${picked.length} nodes`}
      </Button>
    </>
  );
}

function prefixesFor(doc: Project, partIds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of partIds) {
    const part = doc.parts.find((p) => p.id === id);
    const entry = part && currentTaxonomy().entry(part.taxonomyId);
    if (part && entry) out[id] = nodePrefix(part, entry);
  }
  return out;
}

function NodeName({ id }: { id: string }) {
  const [draft, setDraft] = useState(id);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    const next = draft.trim();
    if (next === id) return;
    const err = cmd.applyRenames(new Map([[id, next]]), `Rename node ${id} → ${next}`);
    setProblem(err);
    if (err) setDraft(id);
  };
  return (
    <Field label="Name" hint={problem ?? 'Beams, triangles and everything else that uses it follow.'}>
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} mono data-testid="jbeam-node-name" />
    </Field>
  );
}

/** Several nodes: find and replace in their names. */
function Rename({ ids }: { ids: readonly string[] }) {
  const doc = useProjectStore((s) => s.doc);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const map = useMemo(() => (doc ? replaceInNames(doc, ids, find, replace) : new Map<string, string>()), [doc, ids, find, replace]);
  const example = [...map.entries()][0];
  return (
    <>
      <div className={styles.row2}>
        <Field label="Find">
          <Input value={find} onChange={(e) => setFind(e.target.value)} mono aria-label="Find in names" />
        </Field>
        <Field label="Replace with">
          <Input value={replace} onChange={(e) => setReplace(e.target.value)} mono aria-label="Replace in names" />
        </Field>
      </div>
      <p className={styles.sub}>{problem ?? (example ? `${map.size} name${map.size === 1 ? '' : 's'} change, e.g. ${example[0]} → ${example[1]}` : 'Type part of a name to change it in every picked node.')}</p>
      <Button size="sm" icon={Tag} disabled={!map.size} onClick={() => setProblem(cmd.applyRenames(map, `Rename ${map.size} nodes`))}>
        Rename
      </Button>
    </>
  );
}

function MoveBy({ ids }: { ids: readonly string[] }) {
  const [d, setD] = useState<[number, number, number]>([0, 0, 0]);
  return (
    <>
      <div className={styles.row3}>
        {AXES.map(({ axis, label }) => (
          <Field key={axis} label={`Move ${label} by`}>
            <NumberInput
              value={d[axis] * 1000}
              onChange={(v) =>
                setD((cur) => {
                  const next: [number, number, number] = [...cur];
                  next[axis] = v / 1000;
                  return next;
                })
              }
              step={1}
              precision={1}
              unit="mm"
              aria-label={`Move by ${label}`}
            />
          </Field>
        ))}
      </div>
      <div className={styles.buttons}>
        <Button size="sm" icon={Move3d} disabled={!d.some((v) => v !== 0)} onClick={() => cmd.offset(ids, d)} data-testid="jbeam-move-by">
          Move
        </Button>
      </div>
    </>
  );
}

function ScaleBy({ ids }: { ids: readonly string[] }) {
  const [f, setF] = useState<[number, number, number]>([1, 1, 1]);
  return (
    <>
      <div className={styles.row3}>
        {AXES.map(({ axis, label }) => (
          <Field key={axis} label={`Scale ${label}`}>
            <NumberInput
              value={f[axis]}
              onChange={(v) =>
                setF((cur) => {
                  const next: [number, number, number] = [...cur];
                  next[axis] = v;
                  return next;
                })
              }
              min={0.01}
              max={100}
              step={0.05}
              precision={3}
              unit="×"
              aria-label={`Scale ${label}`}
            />
          </Field>
        ))}
      </div>
      <div className={styles.buttons}>
        <Button size="sm" icon={Scale} disabled={f.every((v) => v === 1)} onClick={() => cmd.scale(ids, f)}>
          Scale about the centre
        </Button>
      </div>
    </>
  );
}

function SnapButton({ ids }: { ids: readonly string[] }) {
  const [grid, setGrid] = useState(5);
  return (
    <span className={styles.inline}>
      <Button size="sm" icon={Grid3x3} onClick={() => cmd.snap(ids, grid)}>
        Snap to
      </Button>
      <NumberInput value={grid} onChange={setGrid} min={0.1} max={500} step={1} precision={1} unit="mm" aria-label="Snap grid" />
    </span>
  );
}

function Distribute({ ids, total }: { ids: readonly string[]; total: number }) {
  const [kg, setKg] = useState(Math.round(total * 100) / 100);
  const [keep, setKeep] = useState(true);
  return (
    <>
      <Field label="Total weight" hint="Shared over the picked nodes.">
        <NumberInput value={kg} onChange={setKg} min={0.01} max={100000} step={1} precision={2} unit="kg" aria-label="Total weight" />
      </Field>
      <Toggle checked={keep} onChange={setKeep} label="Keep heavier nodes heavier" />
      <div className={styles.buttons}>
        <Button size="sm" onClick={() => cmd.distribute(ids, kg, keep)} data-testid="jbeam-distribute">
          Share {kg} kg
        </Button>
        <Button size="sm" variant="ghost" onClick={() => cmd.scaleWeights(ids, 0.9)}>
          −10%
        </Button>
        <Button size="sm" variant="ghost" onClick={() => cmd.scaleWeights(ids, 1.1)}>
          +10%
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- beams

function BeamsSection({ doc, keys }: { doc: Project; keys: readonly string[] }) {
  const want = useMemo(() => new Set(keys), [keys]);
  const picked = useMemo(() => doc.beams.filter((b) => want.has(beamKey(b.id1, b.id2))), [doc.beams, want]);
  const pos = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n.pos])), [doc.nodes]);
  if (!picked.length) return null;
  const lengths = picked.map((b) => {
    const a = pos.get(b.id1);
    const c = pos.get(b.id2);
    return a && c ? Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) : 0;
  });
  const kinds = [...new Set(picked.map((b) => b.kind))];
  const base = (key: string) => (row: unknown) => {
    const v = presetBeamValue(doc, row as Project['beams'][number], key);
    return typeof v === 'number' ? v : undefined;
  };
  const single = picked.length === 1 ? picked[0]! : null;
  return (
    <>
      <p className={styles.sub}>
        {single ? `${single.id1} – ${single.id2} · ` : ''}
        {lengths.length === 1 ? `${Math.round(lengths[0]! * 1000)} mm` : `${Math.round(Math.min(...lengths) * 1000)}–${Math.round(Math.max(...lengths) * 1000)} mm`}
      </p>
      <CollapsibleSection id="jbeam-beam-kind" title="Kind" defaultOpen>
        <Field label="Kind" hint="Which of the part’s preset values it takes: skin (edge), bracing, attachment to the parent, hinge…">
          <Select value={kinds.length === 1 ? kinds[0]! : ''} onChange={(k) => k && cmd.setBeamKind(keys, k as (typeof BEAM_KINDS)[number])} options={[...(kinds.length > 1 ? [{ value: '', label: 'Mixed' }] : []), ...BEAM_KINDS.map((k) => ({ value: k, label: k }))]} aria-label="Beam kind" />
        </Field>
      </CollapsibleSection>
      <CollapsibleSection id="jbeam-beam-props" title="Properties" defaultOpen>
        <PropertyEditor target="beam" keys={keys} rows={picked} preset={(k) => presetBeamValue(doc, picked[0]!, k)} />
      </CollapsibleSection>
      <CollapsibleSection id="jbeam-beam-scale" title="Stiffer or softer" defaultOpen>
        <p className={styles.sub}>Scales from the value set by hand, else the preset’s.</p>
        {(['beamSpring', 'beamDamp', 'beamDeform', 'beamStrength'] as const).map((k) => (
          <div key={k} className={styles.scaleRow}>
            <code className={styles.propKey}>{k}</code>
            {[0.5, 0.8, 1.25, 2].map((f) => (
              <Button key={f} size="sm" variant="ghost" onClick={() => cmd.scaleOption('beam', keys, k, f, base(k))}>
                ×{f}
              </Button>
            ))}
          </div>
        ))}
      </CollapsibleSection>
      <Button size="sm" variant="danger" icon={Trash2} onClick={deleteSelection}>
        Delete {single ? 'beam' : `${picked.length} beams`}
      </Button>
    </>
  );
}

// ---------------------------------------------------------------- triangles

function TrisSection({ doc, keys }: { doc: Project; keys: readonly string[] }) {
  const want = useMemo(() => new Set(keys), [keys]);
  const picked = useMemo(() => doc.tris.filter((t) => want.has(triKey(t.ids))), [doc.tris, want]);
  if (!picked.length) return null;
  return (
    <>
      <p className={styles.sub}>{picked.length === 1 ? picked[0]!.ids.join(' · ') : `${picked.length} triangles`}</p>
      <div className={styles.buttons}>
        <Button size="sm" icon={FlipHorizontal2} onClick={() => cmd.flipTriangles(keys)}>
          Flip
        </Button>
        <Button size="sm" icon={CircleDot} onClick={() => useEditStore.getState().select([...new Set(picked.flatMap((t) => t.ids))], [])}>
          Select their nodes
        </Button>
      </div>
      <CollapsibleSection id="jbeam-tri-props" title="Properties" defaultOpen>
        <PropertyEditor target="tri" keys={keys} rows={picked} preset={(k) => presetTriValue(doc, picked[0]!, k)} />
      </CollapsibleSection>
      <Button size="sm" variant="danger" icon={Trash2} onClick={() => cmd.deleteTriangles(keys)}>
        Delete {picked.length === 1 ? 'triangle' : `${picked.length} triangles`}
      </Button>
    </>
  );
}

// ---------------------------------------------------------------- nothing picked

function PartsSection({ doc }: { doc: Project }) {
  const parts = doc.parts.filter((p) => doc.nodes.some((n) => n.partId === p.id));
  const [prefixes, setPrefixes] = useState<Record<string, string>>(() => prefixesFor(doc, parts.map((p) => p.id)));
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(parts.map((p) => p.id)));
  const settings = useSettingsStore((s) => s.settings);
  const preview = useMemo(() => logicalNames(doc, [...picked], { ...cmd.namingOptions(prefixes) }), [doc, picked, prefixes]);
  void settings;
  const example = [...preview.entries()].slice(0, 3);
  return (
    <>
      <p className={styles.sub}>Pick nodes in the 3D view (Tab turns editing on) or in the tables. Nothing is picked, so here is naming for whole parts.</p>
      <CollapsibleSection id="jbeam-naming" title="Name nodes logically" defaultOpen>
        <p className={styles.sub}>Like the game’s own cars: a short prefix per part, a number that grows front to back, and l or r for the two sides (h1l, h1r; centre nodes h1).</p>
        <table className={styles.prefixTable}>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={picked.has(p.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      setPicked(next);
                    }}
                    aria-label={`Rename ${p.displayName}`}
                  />
                </td>
                <td className={styles.partName}>{p.displayName}</td>
                <td>
                  <Input value={prefixes[p.id] ?? ''} onChange={(e) => setPrefixes({ ...prefixes, [p.id]: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} mono aria-label={`Prefix for ${p.displayName}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <NamingOptions />
        <p className={styles.sub}>{preview.size ? `${preview.size} names change: ${example.map(([a, b]) => `${a} → ${b}`).join(', ')}${preview.size > 3 ? '…' : ''}` : 'The picked parts already have these names.'}</p>
        <Button variant="primary" size="sm" icon={Wand2} disabled={!preview.size} onClick={() => cmd.applyRenames(preview, `Name ${preview.size} nodes logically`)} data-testid="jbeam-apply-naming">
          Rename {preview.size} nodes
        </Button>
      </CollapsibleSection>
      <CollapsibleSection id="jbeam-summary" title="Parts" defaultOpen={false}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Part</th>
              <th className={styles.num}>Nodes</th>
              <th className={styles.num}>Beams</th>
              <th className={styles.num}>kg</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => {
              const ns = doc.nodes.filter((n) => n.partId === p.id);
              return (
                <tr key={p.id} onClick={() => cmd.selectPartNodes([p.id])}>
                  <td>{p.displayName}</td>
                  <td className={styles.num}>{ns.length}</td>
                  <td className={styles.num}>{doc.beams.filter((b) => b.partId === p.id).length}</td>
                  <td className={styles.num}>{ns.reduce((s, n) => s + n.weight, 0).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CollapsibleSection>
    </>
  );
}

function NamingOptions() {
  const s = useSettingsStore((st) => st.settings);
  if (!s) return null;
  return (
    <>
      <div className={styles.row2}>
        <Field label="Numbers grow">
          <Select value={s.jbeamNamingOrder} onChange={(jbeamNamingOrder) => void call('settings:update', { jbeamNamingOrder })} options={[{ value: 'front-back', label: 'Front to back' }, { value: 'bottom-top', label: 'Bottom to top' }]} aria-label="Numbers grow" />
        </Field>
        <Field label="Start at">
          <NumberInput value={s.jbeamNamingStart} onChange={(jbeamNamingStart) => void call('settings:update', { jbeamNamingStart })} min={0} max={1000} step={1} precision={0} aria-label="Start at" />
        </Field>
      </div>
      <Toggle checked={s.jbeamNamingSides} onChange={(jbeamNamingSides) => void call('settings:update', { jbeamNamingSides })} label="l and r for the two sides" />
    </>
  );
}
