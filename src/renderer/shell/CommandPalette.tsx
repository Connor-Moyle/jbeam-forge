import { useMemo, useState, type KeyboardEvent } from 'react';
import { fuzzyScore } from '@shared/fuzzy';
import { PRESET_IDS } from '@shared/layout-schema';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { redo, saveProject, undo } from '@renderer/project/actions';
import { startImport } from '@renderer/import/importFlow';
import { startAcImport } from '@renderer/import/acImport';
import { openExport } from '@renderer/export/exportFlow';
import { exportModel } from '@renderer/export/modelExport';
import { generateAll } from '@renderer/structure/generate';
import { startTestMode } from '@renderer/sim/simSession';
import { useEditStore } from '@renderer/structure/editStore';
import { exitFocus, focusPart } from '@renderer/parts/focus';
import { renameFromParts } from '@renderer/parts/naming';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { cx } from '@renderer/ui/cx';
import { PANELS, type PanelId } from './panelRegistry';
import { useShell } from './ShellContext';
import { PRESET_LABELS } from './presets';
import styles from './CommandPalette.module.css';

interface Item {
  id: string;
  label: string;
  group: 'Part' | 'Action' | 'Panel' | 'Layout';
  hint?: string;
  run: () => void;
}

const MAX_RESULTS = 40;

/** Ctrl+K: type a part name to focus it, or find any panel or action. */
export function CommandPalette() {
  const open = useDialogStore((s) => s.paletteOpen);
  const setOpen = useDialogStore((s) => s.setPaletteOpen);
  if (!open) return null;
  return <PaletteBody close={() => setOpen(false)} />;
}

function PaletteBody({ close }: { close: () => void }) {
  const shell = useShell();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const items = useMemo<Item[]>(() => {
    const doc = projectStore.getState().doc;
    const view = useUiStore.getState().view;
    const edit = useEditStore.getState();
    const hasParts = (doc?.parts.length ?? 0) > 0;
    const hasStructure = (doc?.nodes.length ?? 0) > 0;
    const actions: (Item | false)[] = [
      { id: 'save', label: 'Save project', group: 'Action', hint: 'Ctrl+S', run: () => void saveProject() },
      { id: 'import', label: 'Import model…', group: 'Action', hint: 'Ctrl+I', run: () => void startImport() },
      { id: 'import-ac', label: 'Import Assetto Corsa car…', group: 'Action', run: () => void startAcImport() },
      hasParts && { id: 'generate', label: 'Generate structure for all parts', group: 'Action', run: () => void generateAll() },
      hasStructure && { id: 'edit', label: edit.active ? 'Stop editing nodes & beams' : 'Edit nodes & beams', group: 'Action', hint: 'Tab', run: () => edit.setActive(!edit.active) },
      hasStructure && {
        id: 'test',
        label: 'Enter Test Mode',
        group: 'Action',
        run: () => {
          if (startTestMode()) shell.showPanel('test-results');
        },
      },
      { id: 'export', label: 'Export mod…', group: 'Action', run: () => openExport() },
      { id: 'export-glb', label: 'Export model as .glb (for Blender)…', group: 'Action', run: () => void exportModel('glb') },
      { id: 'export-dae', label: 'Export model as .dae…', group: 'Action', run: () => void exportModel('dae') },
      { id: 'settings', label: 'Settings…', group: 'Action', hint: 'Ctrl+,', run: () => useDialogStore.getState().setSettingsOpen(true) },
      { id: 'mesh', label: view.mesh ? 'Hide mesh' : 'Show mesh', group: 'Action', run: () => useUiStore.getState().toggleView('mesh') },
      { id: 'structure', label: view.structure ? 'Hide nodes & beams' : 'Show nodes & beams', group: 'Action', run: () => useUiStore.getState().toggleView('structure') },
      { id: 'xray', label: view.xray ? 'X-ray off' : 'X-ray on', group: 'Action', run: () => useUiStore.getState().toggleView('xray') },
      !!useSceneStore.getState().focus && { id: 'unfocus', label: 'Leave focus mode', group: 'Action', hint: 'Esc', run: () => void exitFocus() },
      hasParts && { id: 'rename-meshes', label: 'Rename meshes from their parts', group: 'Action', run: renameFromParts },
      { id: 'undo', label: 'Undo', group: 'Action', hint: 'Ctrl+Z', run: undo },
      { id: 'redo', label: 'Redo', group: 'Action', hint: 'Ctrl+Y', run: redo },
      { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Action', hint: 'F1', run: () => useDialogStore.getState().setShortcutsOpen(true) },
    ];
    const panels: Item[] = (Object.keys(PANELS) as PanelId[])
      .filter((id) => !('devOnly' in PANELS[id]))
      .map((id) => ({ id: `panel:${id}`, label: `Show ${PANELS[id].title} panel`, group: 'Panel', run: () => shell.showPanel(id) }));
    const layouts: Item[] = PRESET_IDS.map((p) => ({ id: `layout:${p}`, label: `${PRESET_LABELS[p]} layout`, group: 'Layout', run: () => shell.applyPreset(p) }));
    const parts: Item[] = (doc?.parts ?? []).map((p) => ({ id: `part:${p.id}`, label: p.displayName, group: 'Part', hint: 'focus', run: () => focusPart(p.id) }));
    return [...actions.filter((a): a is Item => !!a), ...parts, ...panels, ...layouts];
  }, [shell]);

  const results = useMemo(() => {
    if (!query.trim()) return items.filter((i) => i.group !== 'Part').slice(0, MAX_RESULTS);
    return items
      .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.item);
  }, [items, query]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') setCursor((c) => Math.min(results.length - 1, c + 1));
    else if (e.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1));
    else if (e.key === 'Enter') run(results[cursor]);
    else return;
    e.preventDefault();
  };

  return (
    <Modal open onOpenChange={(o) => !o && close()} title="Go to…" size="md">
      <Input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Part name, action or panel"
        aria-label="Search parts, actions and panels"
        data-testid="palette-input"
      />
      <ul className={styles.list} role="listbox" data-testid="palette-results">
        {results.map((item, i) => (
          <li
            key={item.id}
            role="option"
            aria-selected={i === cursor}
            className={cx(styles.item, i === cursor && styles.active)}
            onMouseEnter={() => setCursor(i)}
            onClick={() => run(item)}
          >
            <span className={styles.group}>{item.group}</span>
            <span className={styles.label}>{item.label}</span>
            {item.hint && <span className={styles.hint}>{item.hint}</span>}
          </li>
        ))}
        {results.length === 0 && <li className={styles.empty}>Nothing matches “{query}”.</li>}
      </ul>
    </Modal>
  );
}
