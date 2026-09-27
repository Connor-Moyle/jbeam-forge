import { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { create } from 'zustand';
import { fuzzyScore } from '@shared/fuzzy';
import type { ObjectItem } from '@shared/ipc-contract';
import type { SourceFormat } from '@shared/project/schema';
import { useProjectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { confirmImport } from '@renderer/import/importFlow';
import { defaultSettings, stageImport } from '@renderer/import/pipeline';
import { objectThumbnail } from '@renderer/materials/preview';
import { isCornerObject, placeAtCorner, usePlaceUi } from '@renderer/objects/placeObject';
import { Button } from '@renderer/ui/components/Button';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Input } from '@renderer/ui/components/Input';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import styles from './ObjectsPanel.module.css';

/** The bundled objects plus your scanned folders (loaded once, again after a library scan). */
export const useObjects = create<{ items: ObjectItem[] | null; load: () => Promise<void>; reload: () => Promise<void> }>()((set, get) => ({
  items: null,
  load: async () => {
    if (get().items) return;
    set({ items: await call('objects:list') });
  },
  reload: async () => set({ items: await call('objects:list') }),
}));

const ALL = '__all__';

/** Add a library object to the project: its mesh comes in as a model with the object's material on it. */
export async function addObject(item: ObjectItem, announce = true, classify = true): Promise<string | null> {
  const format = item.mesh.slice(item.mesh.lastIndexOf('.') + 1).toLowerCase() as SourceFormat;
  const staged = await stageImport(item.mesh, format);
  const slug = `${item.category} ${item.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  // Objects with their own materials (kn5) keep them; the rest get the pack's ready-made one.
  const id = await confirmImport(staged, defaultSettings(format), item.material ? { material: { ...item.material, name: slug }, classify } : { gameMaterials: item.gameMaterials, classify });
  if (id && announce) useUiStore.getState().pushStatus(`Added ${item.name} (${item.category}). Move it with the arrows (M) or the Inspector’s Mesh section.`, 'success', 8000);
  return id;
}

/** Ready-made parts to drop into any car: brake calipers, discs, gauges… */
export function ObjectsPanel() {
  const items = useObjects((s) => s.items);
  const load = useObjects((s) => s.load);
  const hasProject = useProjectStore((s) => s.doc !== null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  useEffect(() => void load().catch(() => undefined), [load]);

  const categories = useMemo(() => [...new Set((items ?? []).map((i) => `${i.group} › ${i.category}`))].sort(), [items]);
  // Best matches first while searching (fuzzy matching is forgiving: "800-Series" also finds "T-Series").
  const shown = useMemo(() => {
    const scored = (items ?? []).filter((i) => category === ALL || `${i.group} › ${i.category}` === category).map((i) => ({ i, score: fuzzyScore(query, `${i.name} ${i.category} ${i.group}`) }));
    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => (query ? b.score - a.score : 0))
      .map((x) => x.i);
  }, [items, category, query]);

  if (items && !items.length) return <EmptyState icon={Package} message="The objects pack isn’t installed with this copy." />;
  return (
    <div className={styles.panel} data-testid="objects-panel">
      <div className={styles.head}>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${items?.length ?? ''} objects`} aria-label="Search objects" />
        <Select value={category} onChange={setCategory} options={[{ value: ALL, label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))]} aria-label="Object category" className={styles.category} />
      </div>
      <ScrollArea className={styles.scroll}>
        <ul className={styles.grid}>
          {shown.map((item) => (
            <li key={item.id} className={styles.card} data-testid="object-card">
              <Thumb item={item} />
              <span className={styles.name} title={item.name}>
                {item.name}
              </span>
              <span className={styles.category}>{item.credit ? `${item.category} · by ${item.credit}` : item.category}</span>
              <Button size="sm" icon={Plus} disabled={!hasProject} onClick={() => (isCornerObject(item) ? usePlaceUi.getState().ask(item) : void addObject(item, false).then((id) => id && placeAtCorner(id, 'unsure')))} data-testid="object-add">
                Add
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

function Thumb({ item }: { item: ObjectItem }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      void objectThumbnail(item).then((url) => alive && setSrc(url));
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [item]);
  return (
    <span ref={ref} className={styles.thumb} aria-hidden>
      {src && <img src={src} alt="" />}
    </span>
  );
}
