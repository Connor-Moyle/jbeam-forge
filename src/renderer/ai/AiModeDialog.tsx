import { useState } from 'react';
import { create } from 'zustand';
import { ClipboardCopy, ListChecks, RotateCw, Send, Sparkles, Square } from 'lucide-react';
import { checkReply, type CheckedChange } from '@shared/ai/check';
import { parseReply } from '@shared/ai/changes';
import { AI_JOBS } from '@shared/ai/jobs';
import { buildIterate, buildRequest } from '@shared/ai/prompt';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { Modal } from '@renderer/ui/components/Modal';
import { Textarea } from '@renderer/ui/components/Textarea';
import { applyChanges } from './apply';
import { buildAiContext } from './context';
import styles from './AiModeDialog.module.css';

/**
 * AI mode: pick jobs, ask any AI (copy and paste into the chat the modder already uses, or send
 * with their own key), check its answer, apply what's kept as one undo step, and iterate.
 */

interface AiState {
  open: boolean;
  jobs: string[];
  notes: string;
  setOpen: (open: boolean) => void;
  set: (patch: Partial<Pick<AiState, 'jobs' | 'notes'>>) => void;
}

export const useAiMode = create<AiState>()((set) => ({
  open: false,
  jobs: ['names', 'prices', 'weights'],
  notes: '',
  setOpen: (open) => set({ open }),
  set: (patch) => set(patch),
}));

export function AiModeDialog() {
  const open = useAiMode((s) => s.open);
  const setOpen = useAiMode((s) => s.setOpen);
  if (!open) return null;
  return (
    <Modal open onOpenChange={setOpen} title="AI mode" description="Hand the finishing work to an AI you already use. Nothing changes until you’ve checked its answer and pressed Apply." size="lg">
      <AiModeBody />
    </Modal>
  );
}

type Round = { kind: 'first' } | { kind: 'iterate'; applied: string[]; refused: string[] };

function AiModeBody() {
  const { jobs, notes, set } = useAiMode();
  const hasDoc = useProjectStore((s) => !!s.doc);
  const settings = useSettingsStore((s) => s.settings);
  const connected = settings?.aiMode === 'connected';
  const push = useUiStore((s) => s.pushStatus);
  const [round, setRound] = useState<Round>({ kind: 'first' });
  const [feedback, setFeedback] = useState('');
  const [reply, setReply] = useState('');
  const [checked, setChecked] = useState<CheckedChange[] | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [summary, setSummary] = useState<{ text: string; notes: string[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'apply' | null>(null);
  const [result, setResult] = useState<{ applied: string[]; failed: string[] } | null>(null);

  const request = async (): Promise<string | null> => {
    const doc = projectStore.getState().doc;
    if (!doc) return null;
    const ctx = await buildAiContext(doc);
    return round.kind === 'first' ? buildRequest(ctx, jobs, notes) : buildIterate(ctx, jobs, [notes, feedback].filter((x) => x.trim()).join('\n'), round);
  };

  const copy = async () => {
    const text = await request();
    if (!text) return;
    await call('clipboard:writeText', { text });
    push(`Copied the request (${text.length.toLocaleString()} characters). Paste it into your AI’s chat, then paste its whole answer below.`, 'success', 9000);
  };

  const send = async () => {
    const text = await request();
    if (!text) return;
    setBusy('send');
    setProblem(null);
    try {
      const answer = await call('ai:send', { prompt: text });
      setReply(answer);
      void check(answer);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const check = async (text = reply) => {
    setProblem(null);
    setResult(null);
    const doc = projectStore.getState().doc;
    if (!doc) return;
    try {
      const parsed = parseReply(text);
      const ctx = await buildAiContext(doc);
      const list = checkReply(ctx, jobs, parsed);
      setChecked(list);
      setKeep(list.map((c) => c.ok));
      setSummary({ text: parsed.summary, notes: parsed.notes });
    } catch (err) {
      setChecked(null);
      setSummary(null);
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };

  const apply = async () => {
    if (!checked) return;
    setBusy('apply');
    const chosen = checked.filter((c, i) => c.ok && keep[i]);
    const r = await applyChanges(chosen, AI_JOBS.filter((j) => jobs.includes(j.id)).map((j) => j.label.toLowerCase()).join(', '));
    setResult(r);
    setBusy(null);
    push(`Applied ${r.applied.length} change${r.applied.length === 1 ? '' : 's'}${r.failed.length ? `, ${r.failed.length} couldn’t be` : ''}. Ctrl+Z undoes them all.`, r.failed.length ? 'warning' : 'success', 8000);
    // The next round tells the AI how this one went.
    const refused = [...checked.filter((c) => !c.ok).map((c) => `${c.text}: ${c.problem ?? ''}`), ...checked.filter((c, i) => c.ok && !keep[i]).map((c) => `${c.text}: the modder didn't want this`), ...r.failed];
    setRound({ kind: 'iterate', applied: r.applied, refused });
  };

  const startIteration = () => {
    // Keep what was checked visible until the next answer comes in.
    setReply('');
    setChecked(null);
    setSummary(null);
    setResult(null);
    if (round.kind === 'first' && checked) setRound({ kind: 'iterate', applied: [], refused: checked.filter((c) => !c.ok).map((c) => `${c.text}: ${c.problem ?? ''}`) });
  };

  if (!hasDoc) return <Callout tone="info">Open or make a project first: AI mode works on the car you have open.</Callout>;

  const okCount = checked?.filter((c, i) => c.ok && keep[i]).length ?? 0;
  return (
    <div className={styles.body}>
      <section>
        <h3 className={styles.step}>1. What should it do?</h3>
        <div className={styles.jobs}>
          {AI_JOBS.map((j) => (
            <label key={j.id} className={styles.job}>
              <Checkbox checked={jobs.includes(j.id)} onChange={(on) => set({ jobs: on ? [...jobs, j.id] : jobs.filter((x) => x !== j.id) })} aria-label={j.label} />
              <span>
                <strong>{j.label}</strong>
                <span className={styles.muted}>{j.description}</span>
              </span>
            </label>
          ))}
        </div>
        <Textarea rows={2} value={notes} onChange={(e) => set({ notes: e.target.value })} placeholder="About the car, in your words: “1990s Japanese sports coupe, light and cheap; trims: base, SE, Turbo; race version with carbon parts”" aria-label="Notes for the AI" />
      </section>

      <section>
        <h3 className={styles.step}>{round.kind === 'first' ? '2. Ask the AI' : '2. Ask again (iterate)'}</h3>
        {round.kind === 'iterate' && <Textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What to do differently: “prices are too high”, “the race config should have the carbon hood”…" aria-label="What to change" />}
        <div className={styles.row}>
          <Button icon={ClipboardCopy} variant={connected ? 'default' : 'primary'} onClick={() => void copy()} disabled={!jobs.length} data-testid="ai-copy">
            Copy the request
          </Button>
          {connected && (
            <>
              <Button icon={Send} variant="primary" onClick={() => void send()} disabled={!jobs.length || busy === 'send'} data-testid="ai-send">
                {busy === 'send' ? 'Waiting for the answer…' : `Send to ${providerName(settings?.aiProvider)}`}
              </Button>
              {busy === 'send' && (
                <Button icon={Square} onClick={() => void call('ai:cancel', undefined)}>
                  Stop
                </Button>
              )}
            </>
          )}
        </div>
        <p className={styles.muted}>
          {connected
            ? 'Or copy it into any AI chat. The connection is set in Settings → AI mode.'
            : 'Paste it into any AI chat (ChatGPT, Microsoft Copilot, Gemini, Claude, DeepSeek…; free accounts work), then copy its whole answer into the box below. To send it directly instead, connect a service in Settings → AI mode.'}
        </p>
      </section>

      <section>
        <h3 className={styles.step}>3. Check the answer</h3>
        <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste the AI’s whole answer here" aria-label="The AI’s answer" className={styles.mono} />
        <div className={styles.row}>
          <Button icon={ListChecks} onClick={() => void check()} disabled={!reply.trim()} data-testid="ai-check">
            Check it
          </Button>
        </div>
        {problem && <Callout tone="warning">{problem}</Callout>}
        {summary && (summary.text || summary.notes.length > 0) && (
          <Callout tone="info">
            {summary.text}
            {summary.notes.length > 0 && (
              <ul className={styles.notes}>
                {summary.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </Callout>
        )}
        {checked && (
          <ul className={styles.changes} data-testid="ai-changes">
            {checked.map((c, i) => (
              <li key={i} className={c.ok ? styles.change : styles.refused}>
                <Checkbox checked={c.ok && !!keep[i]} disabled={!c.ok} onChange={(on) => setKeep(keep.map((k, j) => (j === i ? on : k)))} aria-label={c.text} />
                <span>
                  {c.text}
                  {c.problem && <span className={styles.why}>Refused: {c.problem}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className={styles.row}>
        {checked && (
          <Button icon={Sparkles} variant="primary" onClick={() => void apply()} disabled={!okCount || busy === 'apply' || !!result} data-testid="ai-apply">
            {result ? 'Applied' : `Apply ${okCount} change${okCount === 1 ? '' : 's'}`}
          </Button>
        )}
        {(result || checked || problem) && (
          <Button icon={RotateCw} onClick={startIteration} data-testid="ai-iterate">
            Iterate
          </Button>
        )}
        {result && (
          <span className={styles.muted}>
            {result.applied.length} applied{result.failed.length ? `, ${result.failed.length} couldn’t be` : ''}. Ctrl+Z undoes the whole round. Not right? Iterate, say what to change, and ask again.
          </span>
        )}
      </footer>
    </div>
  );
}

function providerName(id: string | undefined): string {
  return { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', openrouter: 'OpenRouter', local: 'the local model', custom: 'the service' }[id ?? ''] ?? 'the AI';
}
