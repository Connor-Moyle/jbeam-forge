import { useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, FileUp, Plus, Trash2 } from 'lucide-react';
import { create } from 'zustand';
import { fuzzyScore } from '@shared/fuzzy';
import { MATERIAL_PRESETS } from '@shared/materials/presets';
import type { MaterialDef } from '@shared/materials/schema';
import type { LibraryItem } from '@shared/ipc-contract';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { Button } from '@renderer/ui/components/Button';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { Select } from '@renderer/ui/components/Select';
import { Tabs } from '@renderer/ui/components/Tabs';
import { previewLayer } from './runtime';
import { assignMaterial, createMaterial } from './commands';
import styles from './LibraryDialog.module.css';

/** Library state: the dialog and the user's saved materials (loaded from main). */
export const useLibrary = create<{ open: boolean; items: LibraryItem[]; pack: LibraryItem[]; setOpen: (o: boolean) => void; setItems: (i: LibraryItem[]) => void; setPack: (i: LibraryItem[]) => void }>()((set) => ({
  open: false,
  items: [],
  pack: [],
  setOpen: (open) => set({ open }),
  setItems: (items) => set({ items }),
  setPack: (pack) => set({ pack }),
}));

export async function refreshLibrary(): Promise<void> {
  useLibrary.getState().setItems(await call('materials:library'));
  if (!useLibrary.getState().pack.length) useLibrary.getState().setPack(await call('materials:pack'));
}

/** Texture thumbnails (PNG/JPG colour maps), read on demand and kept for the session. */
const thumbs = new Map<string, Promise<string | null>>();
function thumbnail(path: string): Promise<string | null> {
  let t = thumbs.get(path);
  if (!t) {
    t = /\.(png|jpe?g)$/i.test(path)
      ? call('import:readFile', { path })
          .then((bytes) => URL.createObjectURL(new Blob([bytes.slice()], { type: /\.png$/i.test(path) ? 'image/png' : 'image/jpeg' })))
          .catch(() => null)
      : Promise.resolve(null);
    thumbs.set(path, t);
  }
  return t;
}

/** A swatch: the colour texture when there is one (loaded once it scrolls into view), else the colour. */
function Swatch({ layer }: { layer: MaterialDef['layers'][number] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const path = layer.maps.baseColorMap;
  useEffect(() => {
    const el = ref.current;
    if (!el || !path) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      void thumbnail(path).then((url) => alive && setSrc(url));
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [path]);
  return (
    <span ref={ref} className={styles.swatch} style={{ background: hex(layer.baseColor), opacity: 0.35 + 0.65 * layer.opacity }} aria-hidden>
      {src && <img src={src} alt="" className={styles.thumb} />}
    </span>
  );
}

export async function saveToLibrary(def: MaterialDef, category = 'Mine'): Promise<void> {
  useLibrary.getState().setItems(await call('materials:saveToLibrary', { name: def.name, category, def }));
  useUiStore.getState().pushStatus(`Saved ${def.name} to your library`, 'success');
}

export async function shareMaterial(def: MaterialDef): Promise<void> {
  const path = await call('materials:exportJbmat', { name: def.name, category: 'Shared', def });
  if (path) useUiStore.getState().pushStatus(`Saved ${path}`, 'success');
}

interface Entry {
  key: string;
  name: string;
  category: string;
  def: Omit<MaterialDef, 'id' | 'name' | 'origin'>;
  libraryId?: string;
}

const ALL = '__all__';

const hex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

/** Browse presets and your saved materials; put one on the selected meshes or add it to the project. */
export function LibraryDialog() {
  const open = useLibrary((s) => s.open);
  const setOpen = useLibrary((s) => s.setOpen);
  if (!open) return null;
  return <LibraryBody close={() => setOpen(false)} />;
}

function LibraryBody({ close }: { close: () => void }) {
  const items = useLibrary((s) => s.items);
  const pack = useLibrary((s) => s.pack);
  const selection = useSceneStore((s) => s.selection);
  const [tab, setTab] = useState<'presets' | 'pack' | 'mine'>('pack');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL);
  useEffect(() => void refreshLibrary().catch(() => undefined), []);

  const source = useMemo<Entry[]>(
    () =>
      tab === 'presets'
        ? MATERIAL_PRESETS.map((p) => ({ key: p.id, name: p.name, category: p.category, def: p.def }))
        : tab === 'pack'
          ? pack.map((i) => ({ key: i.id, name: i.name, category: i.category, def: i.def }))
          : items.map((i) => ({ key: i.id, name: i.name, category: i.category, def: i.def, libraryId: i.id })),
    [tab, items, pack],
  );
  const categories = useMemo(() => [...new Set(source.map((e) => e.category))].sort(), [source]);
  const entries = useMemo(
    () => source.filter((e) => (category === ALL || e.category === category) && fuzzyScore(query, `${e.name} ${e.category}`) > 0).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [source, category, query],
  );

  const use = (e: Entry, apply: boolean) => {
    const id = createMaterial({ ...e.def }, e.name.replace(/[^A-Za-z0-9_.-]+/g, '_').toLowerCase());
    if (apply) assignMaterial(id, selection);
    close();
  };

  return (
    <Modal open onOpenChange={(o) => !o && close()} title="Material library" size="md">
      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          setCategory(ALL);
        }}
        items={[
          { value: 'pack', label: `Materials pack (${pack.length})` },
          { value: 'presets', label: `Presets (${MATERIAL_PRESETS.length})` },
          { value: 'mine', label: `My library (${items.length})` },
        ]}
        aria-label="Library"
      />
      <div className={styles.head}>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search the library" autoFocus />
        <Select value={category} onChange={setCategory} options={[{ value: ALL, label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]} aria-label="Category" className={styles.category} />
        <IconButton
          icon={FileUp}
          label="Import a .jbmat or a material pack (.zip)"
          onClick={() =>
            void call('materials:importJbmat')
              .then((r) => {
                if (!r) return;
                useLibrary.getState().setItems(r.items);
                setTab('mine');
                useUiStore.getState().pushStatus(`Added ${r.added} material${r.added === 1 ? '' : 's'} to your library${r.skipped ? ` (${r.skipped} already there)` : ''}`, 'success');
              })
              .catch((err: unknown) => useUiStore.getState().pushStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'danger', 8000))
          }
          data-testid="library-import"
        />
      </div>
      <ul className={styles.grid} data-testid="library-items">
        {entries.map((e) => {
          const l = e.def.paint ? e.def.layers[0]! : previewLayer({ ...e.def, id: '', name: '', origin: null });
          return (
            <li key={e.key} className={styles.card}>
              <Swatch layer={l} />
              <span className={styles.text}>
                <span className={styles.name}>{e.name}</span>
                <span className={styles.category}>{e.category}</span>
              </span>
              <Button size="sm" variant="primary" disabled={!selection.length} onClick={() => use(e, true)} data-testid="library-apply">
                Apply
              </Button>
              <IconButton icon={Plus} label="Add to project" size="sm" onClick={() => use(e, false)} />
              {e.libraryId && (
                <>
                  <IconButton icon={FileDown} label="Share as .jbmat" size="sm" onClick={() => void shareMaterial({ ...e.def, id: e.libraryId!, name: e.name, origin: null })} />
                  <IconButton icon={Trash2} label="Remove from library" size="sm" onClick={() => void call('materials:removeFromLibrary', { id: e.libraryId! }).then((next) => useLibrary.getState().setItems(next))} />
                </>
              )}
            </li>
          );
        })}
        {!entries.length && <li className={styles.empty}>{tab === 'mine' && !items.length ? 'Nothing saved yet. Use "Save to library" on any material.' : tab === 'pack' && !pack.length ? 'The materials pack isn’t installed with this copy.' : 'Nothing matches.'}</li>}
      </ul>
      <p className={styles.hint}>{selection.length ? `Apply puts it on the ${selection.length} selected mesh${selection.length === 1 ? '' : 'es'}.` : 'Select meshes first to apply a material straight to them.'}</p>
    </Modal>
  );
}
