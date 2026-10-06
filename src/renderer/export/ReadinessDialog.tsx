import { create } from 'zustand';
import { CircleCheck, CircleDashed, CircleAlert, RefreshCw } from 'lucide-react';
import { projectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { call } from '@renderer/diagnostics/ipc';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { Button } from '@renderer/ui/components/Button';
import { Modal } from '@renderer/ui/components/Modal';
import { GAME_SET_IDS } from '@shared/proxy/presets';
import { partRole, partSettings } from '@shared/proxy/generate';
import { readiness, type ReadinessInput, type ReadinessItem } from '@shared/readiness';
import { loadFittedSets } from '@renderer/suspension/commands';
import { openGameLog } from './GameLogDialog';
import { prepareExport } from './exportFlow';
import styles from './GameLogDialog.module.css';

/** Ready to share? The checklist, ticked off from the project and what the game said. */

interface ReadinessState {
  open: boolean;
  loading: boolean;
  items: ReadinessItem[];
  set: (patch: Partial<Omit<ReadinessState, 'set'>>) => void;
}

export const useReadiness = create<ReadinessState>()((set) => ({ open: false, loading: false, items: [], set: (patch) => set(patch) }));

async function gather(): Promise<ReadinessInput | null> {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const tax = currentTaxonomy();
  const ungenerated: string[] = [];
  const openable = { total: 0, hinged: 0 };
  let lights = 0;
  for (const part of doc.parts) {
    const entry = tax.entry(part.taxonomyId);
    if (!entry || GAME_SET_IDS.has(part.taxonomyId) || part.variantOf) continue;
    if (partRole(entry, partSettings(doc, part, entry)) === 'own' && !doc.nodes.some((n) => n.partId === part.id)) ungenerated.push(part.displayName);
    if (entry.openable) {
      openable.total++;
      if (doc.hinges.some((h) => h.partId === part.id)) openable.hinged++;
    }
    if (/light|lamp/i.test(part.taxonomyId)) lights++;
  }
  await loadFittedSets();
  const prepared = prepareExport();
  const log = await call('beamng:logReport', { vehicle: doc.meta.slug }).catch(() => null);
  const measured = await call('beamng:measuredFigures', { vehicle: doc.meta.slug }).catch((): Record<string, Record<string, unknown>> => ({}));
  const every = useSettingsStore.getState().settings?.previewEveryConfig ?? true;
  return {
    ungenerated,
    exportErrors: prepared?.report.errors.length ?? 0,
    exportWarnings: prepared?.report.warnings.length ?? 0,
    game: log ? { found: log.found, errors: log.issues.filter((i) => i.severity === 'error').length, noController: log.issues.some((i) => i.kind === 'no-controller'), unstable: log.issues.some((i) => i.kind === 'unstable') } : null,
    openable,
    lights,
    configs: doc.configs.length,
    previews: { with: every ? doc.configs.length + 1 : 1, of: doc.configs.length + 1 },
    measured: Object.keys(measured).length > 0,
  };
}

export async function openReadiness(): Promise<void> {
  const r = useReadiness.getState();
  r.set({ open: true, loading: true });
  const input = await gather().catch(() => null);
  r.set({ loading: false, items: input ? readiness(input) : [] });
}

const ICON = { done: CircleCheck, todo: CircleAlert, unknown: CircleDashed } as const;

export function ReadinessDialog() {
  const { open, loading, items, set } = useReadiness();
  if (!open) return null;
  const done = items.filter((i) => i.state === 'done').length;
  return (
    <Modal open onOpenChange={(o) => set({ open: o })} title="Ready to share?" size="md">
      <div className={styles.body} data-testid="readiness">
        <p className={styles.note}>{loading ? 'Checking…' : `${done} of ${items.length} done. Items about the game come from its log and figures: spawn the car (and measure it) to tick them off.`}</p>
        {items.map((i) => {
          const Icon = ICON[i.state];
          return (
            <section key={i.id} className={styles.issue} data-testid={`readiness-${i.id}`} data-state={i.state}>
              <header className={styles.head}>
                <Icon aria-hidden className={styles.icon} />
                <strong>{i.label}</strong>
              </header>
              <p className={styles.note}>{i.detail}</p>
            </section>
          );
        })}
        <div className={styles.row}>
          <Button icon={RefreshCw} onClick={() => void openReadiness()} disabled={loading}>
            Check again
          </Button>
          <Button variant="ghost" onClick={() => void openGameLog()}>
            What the game said
          </Button>
        </div>
      </div>
    </Modal>
  );
}
