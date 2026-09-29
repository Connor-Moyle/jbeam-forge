import { Fragment, useMemo, useState } from 'react';
import { BookOpen, Compass, FilePlus, FileInput, FolderOpen, Keyboard, Settings } from 'lucide-react';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { keyFor } from '@renderer/app/keys';
import { call } from '@renderer/diagnostics/ipc';
import { startImport } from '@renderer/import/importFlow';
import { effectiveKeymap, KEYMAP } from '@shared/keymap';
import { Button } from '@renderer/ui/components/Button';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { GUIDE_GROUPS, GUIDES, type Guide } from './guides';
import { startTutorial } from './tutorial';
import styles from './Help.module.css';

const KEY_IDS = new Set<string>(KEYMAP.map((a) => a.id));

/** "{key:save}" → the key for Save (as set in Settings → Keymap). */
function withKeys(text: string, keys: Record<string, string>): string {
  return text.replace(/\{key:(\w+)\}/g, (_, id: string) => (KEY_IDS.has(id) ? keys[id] || '(no key)' : id));
}

function guideText(g: Guide): string {
  return [g.title, g.summary, ...g.sections.flatMap((s) => [s.heading, s.text, s.tip, s.example, ...(s.steps ?? [])])].filter(Boolean).join(' ').toLowerCase();
}

/** Help → Help and Guides: guides, a walkthrough of a first mod, examples, and the tour. */
export function HelpCentre() {
  const open = useDialogStore((s) => s.helpOpen);
  if (!open) return null;
  return <HelpBody />;
}

function HelpBody() {
  const setOpen = useDialogStore((s) => s.setHelpOpen);
  const overrides = useSettingsStore((s) => s.settings?.keymap);
  const hasProject = useProjectStore((s) => s.doc !== null);
  const keys = useMemo(() => effectiveKeymap(overrides), [overrides]);
  const [id, setId] = useState(GUIDES[0]!.id);
  const [query, setQuery] = useState('');
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = GUIDES.filter((g) => words.every((w) => guideText(g).includes(w)));
  const guide = shown.find((g) => g.id === id) ?? shown[0] ?? null;
  const close = () => setOpen(false);

  const action = (a: NonNullable<Guide['actions']>[number]) => {
    switch (a) {
      case 'tutorial':
        return (
          <Button key={a} variant="primary" icon={Compass} onClick={() => void startTutorial()} data-testid="help-tutorial">
            Start the tutorial
          </Button>
        );
      case 'newMod':
        return (
          <Button
            key={a}
            icon={FilePlus}
            onClick={() => {
              close();
              useDialogStore.getState().setNewModOpen(true);
            }}
          >
            New mod ({keyFor('new')})
          </Button>
        );
      case 'import':
        return (
          <Button
            key={a}
            icon={FileInput}
            disabled={!hasProject}
            onClick={() => {
              close();
              void startImport();
            }}
          >
            Import a model
          </Button>
        );
      case 'shortcuts':
        return (
          <Button
            key={a}
            icon={Keyboard}
            onClick={() => {
              close();
              useDialogStore.getState().setShortcutsOpen(true);
            }}
          >
            Keyboard shortcuts
          </Button>
        );
      case 'settings':
        return (
          <Button
            key={a}
            icon={Settings}
            onClick={() => {
              close();
              useDialogStore.getState().setSettingsOpen(true);
            }}
          >
            Settings
          </Button>
        );
      case 'extensionsFolder':
        return (
          <Button key={a} icon={FolderOpen} onClick={() => void call('extensions:reveal')}>
            Extensions folder
          </Button>
        );
    }
  };

  return (
    <Modal open onOpenChange={setOpen} title="Help and guides" size="lg">
      <div className={styles.layout} data-testid="help-centre">
        <nav className={styles.nav} aria-label="Guides">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the guides" aria-label="Search the guides" data-testid="help-search" />
          <Button variant="primary" icon={Compass} onClick={() => void startTutorial()} className={styles.tourButton}>
            Take the tour
          </Button>
          {GUIDE_GROUPS.map((group) => {
            const list = shown.filter((g) => g.group === group);
            if (!list.length) return null;
            return (
              <Fragment key={group}>
                <div className={styles.group}>{group}</div>
                {list.map((g) => (
                  <button key={g.id} type="button" className={g.id === guide?.id ? styles.itemOn : styles.item} onClick={() => setId(g.id)} data-testid={`guide-${g.id}`}>
                    {g.title}
                  </button>
                ))}
              </Fragment>
            );
          })}
          {!shown.length && <p className={styles.none}>No guide mentions that.</p>}
        </nav>
        <article className={styles.article} data-testid="help-article">
          {guide ? (
            <>
              <h2 className={styles.title}>
                <BookOpen aria-hidden />
                {guide.title}
              </h2>
              <p className={styles.summary}>{guide.summary}</p>
              {guide.sections.map((s, i) => (
                <section key={i} className={styles.section}>
                  {s.heading && <h3 className={styles.heading}>{s.heading}</h3>}
                  {s.text && <p>{withKeys(s.text, keys)}</p>}
                  {s.steps && (
                    <ol className={styles.steps}>
                      {s.steps.map((step, j) => (
                        <li key={j}>{withKeys(step, keys)}</li>
                      ))}
                    </ol>
                  )}
                  {s.example && <pre className={styles.example}>{s.example}</pre>}
                  {s.tip && <p className={styles.tip}>{withKeys(s.tip, keys)}</p>}
                </section>
              ))}
              {guide.actions && <div className={styles.actions}>{guide.actions.map(action)}</div>}
            </>
          ) : null}
        </article>
      </div>
    </Modal>
  );
}

