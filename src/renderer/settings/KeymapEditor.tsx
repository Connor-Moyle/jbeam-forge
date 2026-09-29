import { useMemo, useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { KEYMAP, effectiveKeymap, keyOfEvent, keymapConflicts, normaliseKey, type KeymapGroup } from '@shared/keymap';
import { call } from '@renderer/diagnostics/ipc';
import { useUiStore } from '@renderer/app/stores/ui';
import { Button } from '@renderer/ui/components/Button';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import styles from './SettingsModal.module.css';

const GROUPS: KeymapGroup[] = ['File', 'Edit', 'View', 'Workspaces', 'Viewport', 'Nodes & beams'];

/**
 * Settings → Keymap: every action and its key, Blender-style. Click a key
 * and press the new one (Esc cancels, Backspace clears); changed keys can be
 * reset one by one or all together, and a keymap saved to share.
 */
export function KeymapEditor({ value, onChange }: { value: Readonly<Record<string, string>>; onChange: (keymap: Record<string, string>) => void }) {
  const [q, setQ] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const keys = useMemo(() => effectiveKeymap(value), [value]);
  const conflicts = useMemo(() => keymapConflicts(keys), [keys]);
  const clashing = new Set(conflicts.flatMap((c) => c.actions));
  const needle = q.trim().toLowerCase();

  const setKey = (id: string, key: string) => {
    const def = KEYMAP.find((a) => a.id === id)!.default;
    const next = { ...value };
    if (normaliseKey(key) === normaliseKey(def)) delete next[id];
    else next[id] = normaliseKey(key);
    onChange(next);
  };

  const save = () =>
    void call('file:saveText', { kind: 'jbkeys', suggestedName: 'keymap.jbkeys', text: `${JSON.stringify({ format: 'jbforge-keymap', keys: value }, null, 2)}\n` }).then((p) => p && useUiStore.getState().pushStatus(`Saved ${p}`, 'success'));
  const load = () =>
    void call('file:openText', { kind: 'jbkeys' }).then((files) => {
      const f = files[0];
      if (!f) return;
      try {
        const raw = JSON.parse(f.text) as { keys?: Record<string, unknown> };
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw.keys ?? {})) if (typeof v === 'string' && KEYMAP.some((a) => a.id === k)) next[k] = normaliseKey(v).slice(0, 40);
        onChange(next);
      } catch {
        useUiStore.getState().pushStatus(`${f.name} isn't a keymap file.`, 'danger');
      }
    });

  return (
    <div className={styles.keymap} data-testid="keymap-editor">
      <div className={styles.row}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions or keys" aria-label="Search keys" className={styles.grow} />
        <Button size="sm" icon={RotateCcw} variant="ghost" onClick={() => onChange({})} disabled={!Object.keys(value).length}>
          Reset all
        </Button>
        <IconButton icon={Download} label="Save this keymap to a file" onClick={save} />
        <IconButton icon={Upload} label="Load a keymap file" onClick={load} />
      </div>
      {conflicts.length > 0 && (
        <p className={styles.errorText}>
          {conflicts.map((c) => `${c.key}: ${c.actions.map((id) => KEYMAP.find((a) => a.id === id)!.label).join(' and ')}`).join(' · ')}
        </p>
      )}
      {GROUPS.map((group) => {
        const rows = KEYMAP.filter((a) => a.group === group && (!needle || a.label.toLowerCase().includes(needle) || (keys[a.id] ?? '').toLowerCase().includes(needle)));
        if (!rows.length) return null;
        return (
          <div key={group} className={styles.keyGroup}>
            <h4 className={styles.keyGroupTitle}>{group}</h4>
            {rows.map((a) => {
              const changed = a.id in value;
              return (
                <div key={a.id} className={styles.keyRow}>
                  <span className={styles.grow}>{a.label}</span>
                  <button
                    type="button"
                    className={recording === a.id ? styles.keyRecording : clashing.has(a.id) ? styles.keyClash : styles.keyButton}
                    onClick={() => setRecording(a.id)}
                    onBlur={() => setRecording((r) => (r === a.id ? null : r))}
                    onKeyDown={(e) => {
                      if (recording !== a.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.key === 'Escape') return setRecording(null);
                      if (e.key === 'Backspace' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                        setKey(a.id, '');
                        return setRecording(null);
                      }
                      const k = keyOfEvent(e.nativeEvent);
                      if (!k) return;
                      setKey(a.id, k);
                      setRecording(null);
                    }}
                    aria-label={`${a.label} key`}
                    data-testid={`key-${a.id}`}
                  >
                    {recording === a.id ? 'Press a key…' : keys[a.id] || 'None'}
                  </button>
                  <IconButton icon={RotateCcw} size="sm" label={`Back to ${a.default}`} disabled={!changed} onClick={() => setKey(a.id, a.default)} />
                </div>
              );
            })}
          </div>
        );
      })}
      <p className={styles.help}>Painting and vinyl keys (B, E, F, [ ], arrows…) work only while those tools are open and aren&rsquo;t listed here.</p>
    </div>
  );
}
