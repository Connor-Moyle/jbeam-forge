import { workspacesFor } from '@renderer/shell/presets';
import { useSuspensionCatalogue } from '@renderer/suspension/commands';
import { usePowertrainCatalogue } from '@renderer/powertrain/commands';
import { usePanelCatalogue } from '@renderer/panelmod/commands';
import { useTriggerUi } from '@renderer/triggers/commands';
import { useMovingUi } from '@renderer/moving/MovingPartsPanel';
import { useSkinUi } from '@renderer/skins/commands';
import { useAutoReimport } from '@renderer/import/autoReimport';
import { useEffect, useRef } from 'react';
import { TooltipProvider } from '@renderer/ui/components/Tooltip';
import { DockShell } from '@renderer/shell/DockShell';
import { ShellProvider, useShell } from '@renderer/shell/ShellContext';
import { StatusBar } from '@renderer/shell/StatusBar';
import { Toolbar } from '@renderer/shell/Toolbar';
import { CommandPalette } from '@renderer/shell/CommandPalette';
import { TourOverlay } from '@renderer/help/TourOverlay';
import { HelpCentre } from '@renderer/help/HelpCentre';
import { maybeStartFirstRun } from '@renderer/help/tutorial';
import { ShortcutsModal } from '@renderer/shell/ShortcutsModal';
import { HomeScreen } from '@renderer/home/HomeScreen';
import { DialogHost } from '@renderer/project/DialogHost';
import { ImportHost } from '@renderer/import/ImportHost';
import { useSourceSync } from '@renderer/import/importFlow';
import { installHistoryKeys, runAppCommand, runMenuCommand } from '@renderer/project/appCommands';
import { call } from '@renderer/diagnostics/ipc';
import { useSettingsStore, useSettingsSync } from './stores/settings';
import { startExtensions, stopExtensions } from '@renderer/extensions/host';
import { useUiStore } from './stores/ui';
import { isDirty, projectStore, useProjectStore } from './stores/project';
import { useSceneStore } from './stores/scene';
import { useEngineStage } from '@renderer/powertrain/engineStage';
import { GuideOverlay } from '@renderer/help/GuideOverlay';
import { registerTestHooks } from './testHooks';
import { commitTransform, useModelUi } from '@renderer/modelling/commands';
import { Box3, Matrix4, Vector3 } from 'three';
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
import { loadFittedSets } from '@renderer/suspension/commands';
import { startAutosave } from '@renderer/project/autosave';
import { finalBundle, prepareExport } from '@renderer/export/exportFlow';
import { transformMeshes } from '@renderer/scene/meshCommands';
import type { MeshGizmoTransform } from '@renderer/panels/viewport/viewportRuntime';
import { useLibrary } from '@renderer/materials/LibraryDialog';
import type { AppCommand } from '@shared/ipc-contract';
import { usePainter } from '@renderer/paint/painter';
import { currentSet, useVinylUi } from '@renderer/paint/vinyls';
import { paintedCounts } from '@renderer/paint/facePaint';
import styles from './App.module.css';

/** App-lifetime subscriptions to the main process and the project store. */
function AppEffects() {
  useSettingsSync();
  const pushStatus = useUiStore((s) => s.pushStatus);

  useEffect(() => window.forge.on('status:message', ({ text, tone }) => pushStatus(text, tone, 8000)), [pushStatus]);
  useEffect(() => window.forge.on('menu:command', ({ command }) => runMenuCommand(command)), []);
  useEffect(() => installHistoryKeys(), []);
  // Your library folders were scanned: pick up what they added.
  useEffect(
    () =>
      window.forge.on('library:changed', ({ folders }) => {
        void useObjects.getState().reload();
        // The game's parts may have changed: the catalogues load afresh next time a picker opens (open ones reload themselves).
        useSuspensionCatalogue.setState({ sets: null });
        usePowertrainCatalogue.setState({ sets: null });
        usePanelCatalogue.setState({ sets: null });
        void call('materials:pack').then((pack) => useLibrary.getState().setPack(pack));
        const count = (kind: string) => folders.filter((f) => f.kind === kind).reduce((n, f) => n + f.count, 0);
        const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
        const failed = folders.filter((f) => f.error).length;
        const found = `${plural(count('materials'), 'material')}, ${plural(count('objects'), 'object')}`;
        if (folders.length) pushStatus(failed ? `Library folders: ${found}; ${plural(failed, 'folder')} could not be read` : `Library folders: ${found}`, failed ? 'warning' : 'success');
      }),
    [pushStatus],
  );
  // Textures or meshes downloaded or removed: reload the material pack and objects list.
  useEffect(
    () =>
      window.forge.on('content:changed', ({ kind }) => {
        if (kind === 'meshes') void useObjects.getState().reload();
        else void call('materials:pack').then((pack) => useLibrary.getState().setPack(pack));
      }),
    [],
  );
  useEffect(() => startAutosave(), []);
  // Extensions: started once settings are in, restarted when they're switched on or off.
  useEffect(() => {
    let last: string | null = null;
    const sync = () => {
      const s = useSettingsStore.getState().settings;
      if (!s) return;
      const key = `${s.extensionsEnabled}|${s.disabledExtensions.join(',')}`;
      if (key === last) return;
      last = key;
      void startExtensions();
    };
    sync();
    const off = useSettingsStore.subscribe(sync);
    return () => {
      off();
      stopExtensions();
    };
  }, []);
  useEffect(() => void loadUserTaxonomy(), []);
  // The first start opens the tour (once settings are known).
  useEffect(() => {
    maybeStartFirstRun();
    let started = false;
    return useSettingsStore.subscribe((s) => {
      if (started || !s.settings) return;
      started = true;
      maybeStartFirstRun();
    });
  }, []);
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
        projectDoc: () => projectStore.getState().doc,
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
        viewFrom: (dir: [number, number, number], only?: string) => emitTestSignal({ type: 'view-from', dir, only }),
        engineStage: () => ({ ...useEngineStage.getState(), focus: useSceneStore.getState().focus?.meshKeys.length ?? null }),
        /** Hide (or show again) every mesh whose name matches (visual checks). */
        hideMeshes: (pattern: string, hidden = true) => {
          const re = new RegExp(pattern, 'i');
          const keys = Object.values(useSceneStore.getState().sources).flatMap((s) => s.meshes.filter((m) => re.test(m.name)).map((m) => m.key));
          useSceneStore.getState().setHidden(keys, hidden);
          return keys.length;
        },
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
        faceState: () => {
          const doc = projectStore.getState().doc;
          return doc ? Object.fromEntries(paintedCounts(doc)) : {};
        },
        vinylState: () => {
          const set = currentSet();
          return { layers: (set?.layers ?? []).map((l) => ({ id: l.id, name: l.name, side: l.side, x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation, mirror: l.mirror, groupId: l.groupId })), groups: set?.groups ?? [], selected: useVinylUi.getState().selected };
        },
        painterState: () => {
          const p = usePainter.getState();
          return { on: p.on, tool: p.tool, target: p.target, materialId: p.materialId, mirror: p.mirror, rev: p.rev };
        },
        sceneStats: () => {
          const s = useSceneStore.getState();
          const sources = Object.values(s.sources);
          return {
            sources: sources.map((src) => ({ status: src.status, fileName: src.fileName, meshes: src.meshes.length, error: src.error, textures: src.textures, stats: src.stats })),
            meshes: sources.reduce((n, src) => n + src.meshes.length, 0),
            meshNames: sources.flatMap((src) => src.meshes.map((m) => m.name)).slice(0, 500),
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
        selectMeshes: (keys: string[]) => useSceneStore.getState().select(keys),
        /** Modelling: what is being reshaped and picked. */
        modelUi: () => {
          const m = useModelUi.getState();
          return { key: m.key, mode: m.mode, points: m.points.length, edges: m.edges.length, faces: m.faces.length, gizmo: m.gizmo };
        },
        /** Modelling: the gizmo dragged by `d` (BeamNG space) and let go. */
        modelMove: (d: [number, number, number]) => commitTransform(new Matrix4().makeTranslation(d[0], d[1], d[2])),
        clearEdit: () => useEditStore.getState().clear(),
        /** The export as it would be written (DDS conversion included): paths, and the first bytes of each converted file. */
        finalExport: async () => {
          await loadFittedSets();
          const p = prepareExport();
          if (!p) return null;
          const b = await finalBundle(p.bundle, () => undefined);
          return { files: b.files.map((f) => ({ path: f.path, head: f.base64 ? atob(f.base64.slice(0, 8)).slice(0, 4) : null })), copies: b.copies.map((c) => c.to), materials: b.files.find((f) => f.path.endsWith('main.materials.json'))?.text ?? '' };
        },
        gizmoTransform: (t: MeshGizmoTransform) => transformMeshes(useSceneStore.getState().selection, t),
        preparedJbeams: async () => {
          await loadFittedSets();
          const p = prepareExport();
          return p ? { files: p.bundle.files.filter((f) => f.path.endsWith('.jbeam')).map((f) => ({ path: f.path, text: f.text ?? '' })), errors: p.report.errors } : null;
        },
        frameMeshes: (pattern: string) => {
          const re = new RegExp(pattern, 'i');
          const keys = Object.values(useSceneStore.getState().sources).flatMap((s) => s.meshes.filter((m) => re.test(m.name)).map((m) => m.key));
          useSceneStore.getState().requestFrame(keys);
          return keys.length;
        },
        /** Centre of the meshes of the parts whose name matches (as drawn), or null. */
        partCentre: (pattern: string) => {
          const d = projectStore.getState().doc;
          const re = new RegExp(pattern, 'i');
          const ids = new Set((d?.parts ?? []).filter((p) => re.test(p.displayName)).map((p) => p.id));
          const box = new Box3();
          for (const src of Object.values(useSceneStore.getState().sources))
            for (const m of src.meshes) {
              if (!ids.has(d?.assignments[m.key] ?? '')) continue;
              if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
              if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
            }
          if (box.isEmpty()) return null;
          const c = box.getCenter(new Vector3());
          return [c.x, c.y, c.z];
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
  useSourceSync();
  useAutoReimport();
  // Another project: nothing picked in edit mode, triggers or moving parts carries over.
  const projectKey = useProjectStore((s) => s.doc?.meta.createdAt ?? null);
  useEffect(() => {
    useEditStore.getState().setActive(false);
    useTriggerUi.getState().select(null);
    useMovingUi.getState().pick(null);
    useSkinUi.getState().set({ include: null, optsTouched: false, preview: null });
  }, [projectKey]);
  // A tyre, wheel, engine or panel mod opens on its builder; a vehicle never on a part mod's workspace.
  const modKind = useProjectStore((s) => s.doc?.meta.modKind);
  const { ready, preset: current, applyPreset: apply } = useShell();
  const openedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const tabs = workspacesFor(modKind);
    // A part mod just opened starts on its builder, even if the workspace left open (Materials) is one of its tabs.
    const justOpened = openedKey.current !== projectKey;
    const partMod = !!modKind && modKind !== 'vehicle';
    // Settings → Interface: a project can always open on its first workspace (Parts, or a part mod's builder).
    const startFirst = partMod || useSettingsStore.getState().settings?.openOnWorkspace === 'parts';
    if (tabs.includes(current) && !(justOpened && startFirst && current !== tabs[0])) {
      openedKey.current = projectKey;
      return;
    }
    // After the dock has laid itself out, so the panels get their widths.
    const t = setTimeout(() => {
      openedKey.current = projectKey;
      apply(tabs[0]!);
    }, 50);
    return () => clearTimeout(t);
  }, [ready, projectKey, modKind, current, apply]);
  return (
    <div className={styles.app} data-testid={ready ? 'app-ready' : 'app-loading'} data-view="editor">
      <Toolbar />
      <DockShell />
      <StatusBar />
      <CommandPalette />
      <ShortcutsModal />
      <TourOverlay />
      <GuideOverlay />
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
      <HelpCentre />
      <ImportHost />
    </TooltipProvider>
  );
}
