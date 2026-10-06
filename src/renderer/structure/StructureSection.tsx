import { useEffect, useMemo, useState } from 'react';
import { Eraser, Wand2 } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useTaxonomy } from '@renderer/parts/taxonomy';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { AutoHint, Field, FieldGroup } from '@renderer/ui/components/Field';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import type { Part, PartProxy } from '@shared/project/schema';
import { ATTACHMENT_VALUES, ATTACHMENT_STYLES, BRACING_DENSITIES, STRUCTURE_ROLES, GAME_SET_IDS, kindDefaults, targetVertices, type StructureRole } from '@shared/proxy/presets';
import { PROXY_MODES } from '@shared/proxy/build';
import { massNodeCap, partMass, partRole, partSettings } from '@shared/proxy/generate';
import { materialDefaults } from '@shared/parts/materials';
import { partReportCard } from '@shared/structure/reportCard';
import { clearStructure, generateParts, previewCounts, updateProxySettings, useStructureUi } from './generate';
import styles from './StructureSection.module.css';

const MODE_LABELS: Record<(typeof PROXY_MODES)[number], string> = { surface: 'Surface (even spacing)', decimate: 'Decimate (shell)', hull: 'Convex hull', box: 'Box (PCA fit)', cylinder: 'Cylinder (PCA fit)' };
const ROLE_LABELS: Record<StructureRole, string> = { own: 'Own nodes (generated proxy)', rides: 'Rides on parent part', suspension: 'Built by the suspension' };
const BRACING_LABELS: Record<(typeof BRACING_DENSITIES)[number], string> = { none: 'None', light: 'Light', standard: 'Standard', heavy: 'Heavy' };

/** Inspector section: how this part's jbeam structure is generated (SPEC §4.4). */
export function StructureSection({ part }: { part: Part }) {
  const tax = useTaxonomy();
  const entry = tax.entry(part.taxonomyId);
  const proxy = useProjectStore((s) => s.doc?.proxy);
  const nodeCount = useProjectStore((s) => s.doc?.nodes.reduce((n, x) => n + (x.partId === part.id ? 1 : 0), 0) ?? 0);
  const report = useStructureUi((s) => s.reports[part.id]);
  const doc = useProjectStore((s) => s.doc);
  const card = useMemo(() => {
    if (!doc || !entry) return [];
    const mine = <T extends { partId: string }>(rows: readonly T[]) => rows.filter((r) => r.partId === part.id);
    return partReportCard(mine(doc.nodes), mine(doc.beams), mine(doc.tris).length, materialDefaults(entry, part.constructionMaterial).beamPreset);
  }, [doc, entry, part]);
  const busy = useStructureUi((s) => s.busy);
  const settings = useMemo(() => (proxy && entry ? partSettings({ proxy }, part, entry) : null), [proxy, entry, part]);
  const [detail, setDetail] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ vertices: number; beams: number; triangles: number } | null>(null);

  const liveDetail = detail ?? settings?.detail ?? 0.5;
  // Live counts while the detail slider moves (debounced; runs the real proxy build, no document change).
  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewCounts(part.id, { ...settings, detail: liveDetail }).then((r) => {
        if (!cancelled) setPreview(r);
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [part.id, settings, liveDetail]);

  if (!entry || !settings) return null;
  const defaults = kindDefaults(entry);
  const set = (patch: Partial<PartProxy>) => updateProxySettings(part.id, patch);
  const role = partRole(entry, settings);
  const roleField = (
    <Field label="Structure" hint={role === defaults.role ? 'Default for this part type' : 'Changed from the type default'}>
      <Select value={role} onChange={(r) => set({ role: r === defaults.role ? undefined : r })} options={STRUCTURE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
    </Field>
  );
  if (GAME_SET_IDS.has(part.taxonomyId)) {
    return (
      <FieldGroup title="Structure">
        <p className={styles.note} data-testid="structure-role-note">
          From the game: its own nodes and beams go into the mod as they are, so there is nothing to generate.
        </p>
      </FieldGroup>
    );
  }
  if (role !== 'own') {
    return (
      <FieldGroup title="Structure">
        {roleField}
        <p className={styles.note} data-testid="structure-role-note">
          {role === 'rides'
            ? 'No nodes of its own: its mesh moves with its parent part’s nodes, like official badges, lights and gauges.'
            : 'Built by the suspension from this mesh: arms, hubs, struts, steering and brakes get a few heavy nodes there.'}
        </p>
      </FieldGroup>
    );
  }
  const mass = partMass(part, entry, settings);
  const target = Math.min(targetVertices(defaults.budget, liveDetail), massNodeCap(entry, mass));

  return (
    <FieldGroup title="Structure">
      <div className={styles.summary} data-testid="structure-summary">
        {nodeCount > 0 ? <Badge tone="success">{nodeCount} nodes generated</Badge> : <Badge>not generated</Badge>}
        {report && <StabilityBadge verdict={report.stability.verdict} />}
      </div>
      {roleField}
      <Field label="Proxy mode">
        <Select value={settings.mode} onChange={(mode) => set({ mode })} options={PROXY_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))} />
      </Field>
      <Field label="Detail" hint={`Target ${target} nodes (range ${defaults.budget[0]}–${defaults.budget[1]}) · ${preview ? `≈ ${preview.vertices} nodes, ${preview.beams} beams, ${preview.triangles} triangles` : 'measuring…'}`}>
        <Slider value={liveDetail} onChange={setDetail} onCommit={(v) => {
          setDetail(null);
          set({ detail: v });
        }} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} aria-label="Detail" />
      </Field>
      <div className={styles.row}>
        <Field label="Bracing">
          <Select value={settings.bracing} onChange={(bracing) => set({ bracing })} options={BRACING_DENSITIES.map((b) => ({ value: b, label: BRACING_LABELS[b] }))} />
        </Field>
        <Field label="Attachment" hint={entry.openable ? 'Opens: set up its hinge below.' : undefined}>
          <Select value={settings.attachment} onChange={(attachment) => set({ attachment })} options={ATTACHMENT_STYLES.map((a) => ({ value: a, label: ATTACHMENT_VALUES[a].label }))} disabled={entry.openable} />
        </Field>
      </div>
      <div className={styles.row}>
        <Field label="Target mass" hint={<AutoHint custom={settings.massKg !== null} auto="From type × material" onReset={() => set({ massKg: null })} />}>
          <NumberInput value={mass} onChange={(v) => set({ massKg: v })} min={0.05} max={5000} step={0.5} precision={2} unit="kg" />
        </Field>
        <Field label="Symmetry">
          <Toggle checked={settings.symmetry} onChange={(symmetry) => set({ symmetry })} label="Mirror l/r" />
        </Field>
      </div>
      <CollapsibleSection id="structure-advanced" title="Advanced" defaultOpen={false}>
        <div className={styles.row}>
          <Field label="Min feature" hint="Shorter beams collapse">
            <NumberInput value={settings.minEdge} onChange={(minEdge) => set({ minEdge })} min={0} max={0.5} step={0.01} precision={3} unit="m" />
          </Field>
          <Field label="Max beam" hint="Longer beams split">
            <NumberInput value={settings.maxEdge} onChange={(maxEdge) => set({ maxEdge })} min={0} max={3} step={0.05} precision={2} unit="m" />
          </Field>
        </div>
        <Field label="Shell inset" hint="Moves nodes inside the visual skin">
          <NumberInput value={settings.inset} onChange={(inset) => set({ inset })} min={0} max={0.1} step={0.005} precision={3} unit="m" />
        </Field>
      </CollapsibleSection>
      {report && report.warnings.length > 0 && (
        <Callout tone={report.stability.verdict === 'unstable' ? 'danger' : 'warning'} className={styles.warnings}>
          <ul>
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}
      {card.length > 0 && (
        <CollapsibleSection id="structure-card" title={`Against the game’s own parts${card.some((l) => l.verdict !== 'ok') ? ` · ${card.filter((l) => l.verdict !== 'ok').length} to look at` : ''}`} defaultOpen={false}>
          <table className={styles.card} data-testid="structure-card">
            <thead>
              <tr>
                <th>Measure</th>
                <th>This part</th>
                <th>Game median</th>
              </tr>
            </thead>
            <tbody>
              {card.map((l) => (
                <tr key={l.measure} data-verdict={l.verdict} title={l.verdict === 'ok' ? undefined : l.hint}>
                  <td>{l.measure}</td>
                  <td>
                    {l.value} {l.verdict !== 'ok' && <Badge tone="warning">{l.verdict}</Badge>}
                  </td>
                  <td>{l.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {card
            .filter((l) => l.verdict !== 'ok')
            .map((l) => (
              <p key={l.measure} className={styles.note}>
                {l.hint}
              </p>
            ))}
        </CollapsibleSection>
      )}
      <div className={styles.actions}>
        <Button icon={Wand2} variant="primary" onClick={() => void generateParts([part.id])} disabled={busy} data-testid="structure-generate">
          {nodeCount ? 'Regenerate' : 'Generate'}
        </Button>
        {nodeCount > 0 && (
          <Button icon={Eraser} variant="ghost" onClick={() => clearStructure(part.id)}>
            Clear
          </Button>
        )}
      </div>
    </FieldGroup>
  );
}

function StabilityBadge({ verdict }: { verdict: 'ok' | 'marginal' | 'unstable' }) {
  const tone = verdict === 'ok' ? 'success' : verdict === 'marginal' ? 'warning' : 'danger';
  return (
    <Badge tone={tone} title="Predicted from spring stiffness vs node mass at 2000 Hz (calibrated on official vehicles)">
      stability: {verdict}
    </Badge>
  );
}
