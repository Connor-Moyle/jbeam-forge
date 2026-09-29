import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CloudDownload, FileCode, FolderOpen, LayoutTemplate, Plus, Search, Trash2, Upload } from 'lucide-react';
import { checkLua } from '@shared/lua/check';
import { TEMPLATE_CATEGORIES } from '@shared/lua/templates';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { call } from '@renderer/diagnostics/ipc';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Toggle } from '@renderer/ui/components/Toggle';
import { addBlankScript, addFromLibrary, addFromTemplate, deleteFromLibrary, importScripts, updateScript, useScriptLibrary, useScriptUi } from './commands';
import { allTemplates, templateById, useTemplates } from './registry';
import styles from './Scripts.module.css';

/**
 * The Scripts tab's list (fork): the car's scripts, the template gallery
 * (easy mode: pick a function, set it up with a form), and the library of
 * saved and downloaded scripts.
 */
export function ScriptsPanel() {
  const view = useScriptUi((s) => s.view);
  const hasDoc = useProjectStore((s) => !!s.doc);
  if (!hasDoc) return <EmptyState icon={FileCode} message="Open a project to add scripts to its car." />;
  return (
    <div className={styles.panel} data-testid="scripts-panel">
      <div className={styles.tabsRow} role="tablist" aria-label="Scripts">
        {(
          [
            ['list', 'On this car'],
            ['gallery', 'Templates'],
            ['library', 'Library'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? styles.tabOn : styles.tab} onClick={() => useScriptUi.getState().set({ view: id })} data-testid={`scripts-view-${id}`}>
            {label}
          </button>
        ))}
      </div>
      {view === 'list' && <CarScripts />}
      {view === 'gallery' && <Gallery />}
      {view === 'library' && <Library />}
    </div>
  );
}

function CarScripts() {
  const scripts = useProjectStore((s) => s.doc?.scripts ?? EMPTY_ARR);
  const selected = useScriptUi((s) => s.selected);
  const status = useMemo(
    () =>
      new Map(
        scripts.map((s) => {
          const code = s.code ?? (s.templateId ? templateById(s.templateId)?.lua : '') ?? '';
          const d = checkLua(code, { controller: true }).diagnostics;
          return [s.id, d.some((x) => x.severity === 'error') ? 'error' : d.some((x) => x.severity === 'warning') ? 'warning' : 'ok'] as const;
        }),
      ),
    [scripts],
  );
  return (
    <>
      <div className={styles.row}>
        <Button icon={LayoutTemplate} size="sm" variant="primary" onClick={() => useScriptUi.getState().set({ view: 'gallery' })} data-testid="scripts-add-template">
          Add from templates
        </Button>
        <Button icon={Plus} size="sm" onClick={addBlankScript} data-testid="scripts-add-blank">
          Write one
        </Button>
        <IconButton icon={Upload} label="Import .lua files" onClick={() => void importScripts('lua')} />
        <IconButton icon={BookOpen} label="Import .jbscript files" onClick={() => void importScripts('jbscript')} />
      </div>
      <ScrollArea className={styles.scroll}>
        {!scripts.length ? (
          <p className={styles.note}>No scripts yet. Scripts give the car working functions in game: wipers, windows, a folding roof, an infotainment screen… Start from a template, or write your own.</p>
        ) : (
          <ul className={styles.list} data-testid="scripts-list">
            {scripts.map((s) => {
              const t = s.templateId ? templateById(s.templateId) : undefined;
              const st = status.get(s.id);
              return (
                <li key={s.id} className={selected === s.id ? styles.itemOn : styles.item}>
                  <Toggle checked={s.enabled} onChange={(enabled) => updateScript(s.id, { enabled }, enabled ? 'Turn script on' : 'Turn script off')} aria-label={`${s.label} on`} />
                  <button type="button" className={styles.itemMain} onClick={() => useScriptUi.getState().set({ selected: s.id, result: null, playT: null })} data-testid="script-item">
                    <span className={styles.itemTitle}>{s.label}</span>
                    <span className={styles.note}>
                      {s.name}.lua · {t ? (s.code === null ? t.name : `${t.name} (edited)`) : 'hand-written'}
                    </span>
                  </button>
                  {st === 'error' && <Badge tone="danger">Error</Badge>}
                  {st === 'warning' && <Badge tone="warning">Check</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </>
  );
}

function Gallery() {
  const extra = useTemplates((s) => s.extra);
  const [q, setQ] = useState('');
  const templates = useMemo(() => {
    void extra;
    const needle = q.trim().toLowerCase();
    return allTemplates().filter((t) => !needle || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(needle));
  }, [q, extra]);
  const cats = [...new Set([...TEMPLATE_CATEGORIES, ...templates.map((t) => t.category)])].filter((c) => templates.some((t) => t.category === c));
  return (
    <>
      <div className={styles.row}>
        <Search className={styles.icon} aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" className={styles.grow} />
      </div>
      <ScrollArea className={styles.scroll}>
        <div data-testid="template-gallery">
          {cats.map((c) => (
            <section key={c} className={styles.group}>
              <h3 className={styles.groupTitle}>{c}</h3>
              {templates
                .filter((t) => t.category === c)
                .map((t) => (
                  <article key={t.id} className={styles.card} data-testid="template-card">
                    <div className={styles.cardHead}>
                      <strong>{t.name}</strong>
                      <Button size="sm" icon={Plus} variant="primary" onClick={() => addFromTemplate(t.id)} aria-label={`Add ${t.name}`}>
                        Add
                      </Button>
                    </div>
                    <p className={styles.cardText}>{t.description}</p>
                    {t.needs && <p className={styles.note}>Needs: {t.needs}</p>}
                  </article>
                ))}
            </section>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

function Library() {
  const { scripts, errors, loaded, load } = useScriptLibrary();
  const [q, setQ] = useState('');
  useEffect(() => {
    void load();
    const off = window.forge.on('content:changed', (e) => {
      if (e.kind === 'scripts') void load();
    });
    return off;
  }, [load]);
  const needle = q.trim().toLowerCase();
  const shown = scripts.filter((s) => !needle || `${s.entry.label} ${s.entry.description} ${s.entry.category}`.toLowerCase().includes(needle));
  return (
    <>
      <div className={styles.row}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your scripts" aria-label="Search library" className={styles.grow} />
        <IconButton icon={FolderOpen} label="Show the library folder" onClick={() => void call('scripts:reveal')} />
        <IconButton icon={CloudDownload} label="Download more scripts" onClick={() => useDialogStore.getState().setDownloads('scripts')} />
      </div>
      <ScrollArea className={styles.scroll}>
        {loaded && !scripts.length && <p className={styles.note}>Save a car&rsquo;s script here (Save to library) to use it on your other cars, or download scripts from the scripts repository.</p>}
        <ul className={styles.list} data-testid="script-library">
          {shown.map((s) => (
            <li key={s.path} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemTitle}>{s.entry.label}</span>
                <span className={styles.note}>
                  {s.entry.category} · {s.source === 'mine' ? 'yours' : 'downloaded'}
                  {s.entry.author ? ` · ${s.entry.author}` : ''}
                </span>
              </div>
              <Button size="sm" icon={Plus} onClick={() => addFromLibrary(s.entry)} aria-label={`Add ${s.entry.label}`}>
                Add
              </Button>
              {s.source === 'mine' && <IconButton icon={Trash2} label="Delete from the library" onClick={() => void deleteFromLibrary(s.path)} />}
            </li>
          ))}
        </ul>
        {errors.length > 0 && <p className={styles.note}>{errors.length} file(s) couldn&rsquo;t be read: {errors.slice(0, 3).join('; ')}</p>}
      </ScrollArea>
    </>
  );
}
