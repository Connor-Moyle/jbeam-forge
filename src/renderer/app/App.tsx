import { useEffect } from 'react';
import { TooltipProvider } from '@renderer/ui/components/Tooltip';
import { DockShell } from '@renderer/shell/DockShell';
import { ShellProvider, useShell } from '@renderer/shell/ShellContext';
import { StatusBar } from '@renderer/shell/StatusBar';
import { Toolbar } from '@renderer/shell/Toolbar';
import { CommandPalette } from '@renderer/shell/CommandPalette';
import { ShortcutsModal } from '@renderer/shell/ShortcutsModal';
import { HomeScreen } from '@renderer/home/HomeScreen';
import { DialogHost } from '@renderer/project/DialogHost';
import { ImportHost } from '@renderer/import/ImportHost';
import { useSourceSync } from '@renderer/import/importFlow';
import { runAppCommand } from '@renderer/project/appCommands';
import { call } from '@renderer/diagnostics/ipc';
import { useSettingsSync } from './stores/settings';
import { useUiStore } from './stores/ui';
import { isDirty, projectStore, useProjectStore } from './stores/project';
import { useSceneStore } from './stores/scene';
import { registerTestHooks } from './testHooks';
import { emitTestSignal } from './testBus';
import { currentTaxonomy, loadUserTaxonomy } from '@renderer/parts/taxonomy';
import { buildSimModel } from '@shared/sim/model';
import { offerAutoClassify } from '@renderer/parts/commands';
import { useStructureUi } from '@renderer/structure/generate';
import { useEditStore } from '@renderer/structure/editStore';
import { splitCentreLine } from '@renderer/split/splitTool';
import { installNamingRules, renameFromParts } from '@renderer/parts/naming';
import { mirrorPartners } from '@shared/structure/edit';
import { useObjects } from '@renderer/panels/ObjectsPanel';
import { useLibrary } from '@renderer/materials/LibraryDialog';
import type { AppCommand } from '@shared/ipc-contract';
import styles from './App.module.css';

/** App-lifetime subscriptions to the main process and the project store. */
function AppEffects() {
  useSettingsSync();
  const pushStatus = useUiStore((s) => s.pushStatus);

  useEffect(() => window.forge.on('status:message', ({ text, tone }) => pushStatus(text, tone, 8000)), [pushStatus]);
  useEffect(() => window.forge.on('menu:command', ({ command }) => runAppCommand(command)), []);
  // Your library folders were scanned: pick up what they added.
  useEffect(
    () =>
      window.forge.on('library:changed', ({ folders }) => {
        void useObjects.getState().reload();
        void call('materials:pack').then((pack) => useLibrary.getState().setPack(pack));
        const count = (kind: string) => folders.filter((f) => f.kind === kind).reduce((n, f) => n + f.count, 0);
        const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
        const failed = folders.filter((f) => f.error).length;
        const found = `${plural(count('materials'), 'material')}, ${plural(count('objects'), 'object')}`;
        if (folders.length) pushStatus(failed ? `Library folders: ${found}; ${plural(failed, 'folder')} could not be read` : `Library folders: ${found}`, failed ? 'warning' : 'success');
      }),
    [pushStatus],
  );
  useEffect(() => void loadUserTaxonomy(), []);
  useEffect(() => installNamingRules(), []);

  // run-desktop harness hooks available on every screen (home and editor).
  useEffect(
    () =>
      registerTestHooks({
        renameProject: (name: string) => projectStore.getState().execute({ label: 'Rename project', apply: (d) => void (d.meta.name = name) }),
        projectState: () => {
          const s = projectStore.getState();
          return { name: s.doc?.meta.name ?? null, dirty: isDirty(s), filePath: s.filePath, undo: s.undoStack.length, redo: s.redoStack.length, undoLabels: s.undoStack.map((e) => e.label).slice(-5) };
        },
        runCommand: (command: AppCommand) => runAppCommand(command),
        queueDialog: (answers: (string | null)[]) => call('harness:queueDialog', { answers }),
        partsState: () => {
          const d = projectStore.getState().doc;
          return {
            parts: (d?.parts ?? []).map((p) => ({ id: p.id, taxonomyId: p.taxonomyId, name: p.name, displayName: p.displayName, position: p.position, parentPartId: p.parentPartId, variantOf: p.variantOf })),
            assigned: Object.keys(d?.assignments ?? {}).length,
            ignored: d?.ignoredMeshes.length ?? 0,
            activePart: useSceneStore.getState().activePart,
            focus: useSceneStore.getState().focus,
          };
        },
        editState: () => {
          const e = useEditStore.getState();
          return { active: e.active, nodes: e.nodes, beams: e.beams };
        },
        editSelect: (ids: string[]) => useEditStore.getState().select(ids, []),
        nodeInfo: (ids: string[]) => (projectStore.getState().doc?.nodes ?? []).filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, pos: n.pos, manual: !!n.manual, weight: n.weight })),
        /** The first `n` node ids in the document, for topology checks. */
        firstNodes: (n: number) => (projectStore.getState().doc?.nodes ?? []).slice(0, n).map((x) => x.id),
        /** A left/right node pair (by position) to exercise symmetry; [some node, null] when nothing is mirrored. */
        mirrorPair: () => {
          const nodes = projectStore.getState().doc?.nodes ?? [];
          const first = [...mirrorPartners(nodes)][0];
          return first ?? (nodes[0] ? [nodes[0].id, null] : null);
        },
        structureState: () => {
          const d = projectStore.getState().doc;
          if (!d) return null;
          const ids = new Set(d.nodes.map((n) => n.id));
          const dangling = d.beams.filter((b) => !ids.has(b.id1) || !ids.has(b.id2)).length + d.tris.filter((t) => t.ids.some((id) => !ids.has(id))).length;
          const reports = Object.values(useStructureUi.getState().reports);
          return {
            nodes: d.nodes.length,
            beams: d.beams.length,
            tris: d.tris.length,
            massKg: Math.round(d.nodes.reduce((m, n) => m + n.weight, 0) * 10) / 10,
            // Unique vehicle-wide, except variants of one slot, which share names (only one is ever installed).
            uniqueIds: (() => {
              const slot = (partId: string) => d.parts.find((p) => p.id === partId)?.variantOf ?? partId;
              const owner = new Map<string, string>();
              for (const n of d.nodes) {
                const s2 = slot(n.partId);
                if (owner.has(n.id) && owner.get(n.id) !== s2) return false;
                owner.set(n.id, s2);
              }
              return true;
            })(),
            dangling,
            refNodes: d.proxy.refNodes,
            byKind: { edge: d.beams.filter((b) => b.kind === 'edge').length, brace: d.beams.filter((b) => b.kind === 'brace').length, attach: d.beams.filter((b) => b.kind === 'attach').length },
            stability: { ok: reports.filter((r) => r.stability.verdict === 'ok').length, marginal: reports.filter((r) => r.stability.verdict === 'marginal').length, unstable: reports.filter((r) => r.stability.verdict === 'unstable').length },
            generatedParts: reports.length,
            unstableKinds: Object.entries(
              reports
                .filter((r) => r.stability.verdict !== 'ok')
                .reduce<Record<string, number>>((acc, r) => {
                  const p = d.parts.find((x) => x.id === r.partId);
                  const k = `${p?.taxonomyId ?? '?'}:${r.stability.verdict}:${r.vertices}n:${r.massKg}kg:${r.stability.worst.toFixed(1)}`;
                  acc[k] = (acc[k] ?? 0) + 1;
                  return acc;
                }, {}),
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 40),
          };
        },
        viewFrom: (dir: [number, number, number]) => emitTestSignal({ type: 'view-from', dir }),
        setReferenceStructure: (ref: { nodes: { id: string; pos: [number, number, number] }[]; beams: [string, string][] } | null) =>
          emitTestSignal({ type: 'reference-structure', nodes: ref?.nodes ?? null, beams: ref?.beams ?? [] }),
        /** Keep only the given parts' base parts (by taxonomy id), dropping everything else (visual checks). */
        keepOnlyKinds: (kinds: string[]) =>
          projectStore.getState().execute({
            label: 'Keep only kinds',
            apply: (d) => {
              const keep = new Set(d.parts.filter((p) => kinds.includes(p.taxonomyId) && !p.variantOf).map((p) => p.id));
              d.parts = d.parts.filter((p) => keep.has(p.id));
              for (const k of Object.keys(d.assignments)) if (!keep.has(d.assignments[k]!)) delete d.assignments[k];
              for (const p of d.parts) if (p.parentPartId && !keep.has(p.parentPartId)) p.parentPartId = null;
              d.nodes = d.nodes.filter((n) => keep.has(n.partId));
              d.beams = d.beams.filter((b) => keep.has(b.partId));
              d.tris = d.tris.filter((t) => keep.has(t.partId));
            },
          }),
        hideUnassigned: () => {
          const s = useSceneStore.getState();
          const d = projectStore.getState().doc;
          const keys = Object.values(s.sources).flatMap((src) => src.meshes.map((m) => m.key)).filter((k) => !d?.assignments[k]);
          s.setHidden(keys, true);
        },
        /** Debug: the simulated model as plain arrays (for offline solver investigation). */
        dumpSimModel: () => {
          const d = projectStore.getState().doc;
          if (!d) return null;
          const m = buildSimModel(d, currentTaxonomy());
          const plain: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(m)) plain[k] = ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>, (x) => (Number.isFinite(x) ? x : 1e30)) : v;
          plain.partNames = Object.fromEntries(d.parts.map((p) => [p.id, p.displayName]));
          return plain;
        },
        offerAutoClassify: () => {
          const meshes = Object.values(useSceneStore.getState().sources).flatMap((s) => s.meshes);
          offerAutoClassify('harness', meshes);
        },
        sceneStats: () => {
          const s = useSceneStore.getState();
          const sources = Object.values(s.sources);
          return {
            sources: sources.map((src) => ({ status: src.status, fileName: src.fileName, meshes: src.meshes.length, error: src.error, textures: src.textures, stats: src.stats })),
            meshes: sources.reduce((n, src) => n + src.meshes.length, 0),
            meshNames: sources.flatMap((src) => src.meshes.map((m) => m.name)).slice(0, 50),
            selection: s.selection,
          };
        },
        splitCentreLine: (keys: string[]) => splitCentreLine(keys),
        renameFromParts: () => renameFromParts(),
        /** meshKey → the names of the project materials it uses. */
        meshMaterials: () => {
          const d = projectStore.getState().doc;
          const names = new Map((d?.materials ?? []).map((m) => [m.id, m.name]));
          return Object.fromEntries(Object.entries(d?.materialSlots ?? {}).map(([k, ids]) => [k, ids.map((id) => names.get(id) ?? id)]));
        },
        materialCount: () => projectStore.getState().doc?.materials.length ?? 0,
        meshNameList: () => Object.values(projectStore.getState().doc?.meshNames ?? {}).map((e) => e.name),
        partNames: () => (projectStore.getState().doc?.parts ?? []).map((p) => p.displayName),
        /** Every mesh's name, triangle count and BeamNG-space bounds (for studying real models). */
        meshBounds: () =>
          Object.values(useSceneStore.getState().sources).flatMap((src) =>
            src.meshes.map((m) => {
              const g = m.geometry;
              if (!g.boundingBox) g.computeBoundingBox();
              const b = g.boundingBox!;
              return { key: m.key, name: m.name, triangles: m.triangles, min: b.min.toArray(), max: b.max.toArray() };
            }),
          ),
        measureFps: (ms: number) =>
          new Promise<number>((resolve) => {
            let frames = 0;
            const start = performance.now();
            const tick = () => {
              frames++;
              if (performance.now() - start < ms) requestAnimationFrame(tick);
              else resolve((frames * 1000) / (performance.now() - start));
            };
            requestAnimationFrame(tick);
          }),
      }),
    [],
  );

  // Window title + unsaved-changes flag for main's close guard.
  useEffect(() => {
    let lastDirty: boolean | null = null;
    const sync = () => {
      const s = projectStore.getState();
      const dirty = isDirty(s);
      document.title = s.doc ? `${s.doc.meta.name}${dirty ? ' •' : ''} — JBeam Forge` : 'JBeam Forge';
      if (dirty !== lastDirty) {
        lastDirty = dirty;
        call('window:setDirty', { dirty }).catch(() => undefined);
      }
    };
    sync();
    return projectStore.subscribe(sync);
  }, []);

  return null;
}

function Editor() {
  const { ready } = useShell();
  useSourceSync();
  return (
    <div className={styles.app} data-testid={ready ? 'app-ready' : 'app-loading'} data-view="editor">
      <Toolbar />
      <DockShell />
      <StatusBar />
      <CommandPalette />
      <ShortcutsModal />
    </div>
  );
}

function Root() {
  const hasProject = useProjectStore((s) => s.doc !== null);
  if (!hasProject) return <HomeScreen />;
  return (
    <ShellProvider>
      <Editor />
    </ShellProvider>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <AppEffects />
      <Root />
      <DialogHost />
      <ImportHost />
    </TooltipProvider>
  );
}
