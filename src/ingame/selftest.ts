import { projectStore } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { finalBundle, prepareExport } from '@renderer/export/exportFlow';
import { call } from '@renderer/diagnostics/ipc';
import { endTutorial, useTour } from '@renderer/help/tutorial';
import type { GameBridge } from './platform';
import { openCurrentCar } from './currentCar';

/**
 * The in-game self-test, for checking a build in the real game before it ships. It only runs when
 * settings/jbeamForge/selftest.json asks for screen steps; jbeamForge.lua writes what comes back to
 * selftest-result.json. Steps: "current-car" opens the car being driven, "export" installs it as a
 * mod, "drive" spawns it.
 */

type Plan = { steps?: string[] } | null;

export async function runSelftest(bridge: GameBridge): Promise<void> {
  const res = (await bridge.call('selftest:plan', null)) as { ok: boolean; value?: Plan };
  const steps = res.ok ? (res.value?.steps ?? []) : [];
  if (!steps.length) return;
  const report: Record<string, unknown> = { steps };
  const statuses: string[] = [];
  const send = (done: boolean) => bridge.call('selftest:report', { ...report, statuses: statuses.slice(-20), mounted: true, done }).catch(() => undefined);
  // Say yes to whatever is asked, as someone clicking through would.
  const unsubscribe = useDialogStore.subscribe((s) => {
    if (s.confirm) s.answerConfirm(true);
    if (s.unsaved) s.answerUnsaved('discard');
  });
  const unStatus = useUiStore.subscribe((s, prev) => {
    if (s.status !== prev.status && s.status) statuses.push(s.status.text);
  });
  try {
    if (useTour.getState().step !== null) endTutorial(true);
    if (steps.includes('current-car')) {
      report.stage = 'current-car';
      await send(false);
      const t = performance.now();
      await openCurrentCar();
      const doc = projectStore.getState().doc;
      const sources = Object.values(useSceneStore.getState().sources);
      report.currentCar = {
        seconds: Math.round((performance.now() - t) / 100) / 10,
        parts: doc?.parts.length ?? 0,
        nodes: doc?.nodes.length ?? 0,
        beams: doc?.beams.length ?? 0,
        meshes: sources.reduce((n, s) => n + (s?.meshes.length ?? 0), 0),
        assigned: Object.keys(doc?.assignments ?? {}).length,
        ignored: doc?.ignoredMeshes.length ?? 0,
        refNodes: doc?.proxy.refNodes ?? null,
      };
      await send(false);
    }
    if (steps.includes('export') && projectStore.getState().doc) {
      report.stage = 'export';
      await send(false);
      const prepared = prepareExport();
      report.export = { errors: prepared?.report.errors.slice(0, 10) ?? 'nothing to export', warnings: prepared?.report.warnings.length ?? 0 };
      // Where a part's mesh would bind: each failing part's chain of parents, with their node counts.
      const doc = projectStore.getState().doc!;
      report.chains = (prepared?.report.errors ?? []).slice(0, 5).map((e) => {
        const chain: string[] = [];
        for (let p = doc.parts.find((x) => x.id === e.partId), g = 0; p && g < 10; p = doc.parts.find((x) => x.id === p!.parentPartId), g++) {
          chain.push(`${p.displayName} [${p.name}, ${p.taxonomyId}${p.variantOf ? ', variant' : ''}] nodes=${doc.nodes.filter((n) => n.partId === p!.id).length}`);
        }
        return chain;
      });
      if (prepared && !prepared.report.errors.length) {
        const bundle = await finalBundle(prepared.bundle, () => undefined);
        const r = await call('export:install', bundle);
        report.export = { ...(report.export as object), path: r.path, files: bundle.files.length };
        if (steps.includes('drive')) {
          await (window.forge as typeof window.forge & { game?: { spawn: (m: string) => Promise<void> } }).game?.spawn(projectStore.getState().doc!.meta.slug);
          report.drive = 'spawned';
        }
      }
    }
  } catch (err) {
    report.error = err instanceof Error ? `${err.message}\n${err.stack ?? ''}`.slice(0, 2000) : String(err);
  } finally {
    unsubscribe();
    unStatus();
    await send(true);
  }
}
