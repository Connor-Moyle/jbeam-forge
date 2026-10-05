import { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import type { AiProviderId, Settings, SettingsPatch } from '@shared/settings-schema';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Select } from '@renderer/ui/components/Select';
import { call } from '@renderer/diagnostics/ipc';
import { useUiStore } from '@renderer/app/stores/ui';
import styles from './SettingsModal.module.css';

type Status = Awaited<ReturnType<typeof call<'ai:status'>>>;

/**
 * Settings → AI mode. Copy and paste works with any AI and needs nothing here. Connecting sends
 * the request with the modder's own key (or to a model on this computer); no account with us.
 */
export function AiSettings({ d, set }: { d: Settings; set: (patch: SettingsPatch) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState('');
  const refresh = () => void call('ai:status', undefined).then(setStatus).catch(() => setStatus(null));
  useEffect(refresh, []);
  const provider = status?.providers.find((p) => p.id === d.aiProvider);
  const saveKey = (value: string | null) =>
    call('ai:setKey', { provider: d.aiProvider, key: value })
      .then(() => {
        setKey('');
        refresh();
        useUiStore.getState().pushStatus(value ? 'Key saved (encrypted, on this computer only).' : 'Key forgotten.', 'success');
      })
      .catch((err: Error) => useUiStore.getState().pushStatus(err.message, 'danger', 8000));

  return (
    <FieldGroup title="AI mode">
      <p className={styles.help}>
        AI mode hands finishing work (names, prices, weights, hinges, configurations, engine tune…) to an AI. Every change it suggests is checked and shown to you before anything is applied, and one Ctrl+Z undoes a whole round. There’s no account and nothing to sign in to here.
      </p>
      <Field label="How to ask" hint="Copy and paste works with any AI chat, free accounts included. Connected sends the request for you.">
        <Select value={d.aiMode} onChange={(aiMode) => set({ aiMode })} options={[{ value: 'paste', label: 'Copy and paste into any AI chat' }, { value: 'connected', label: 'Connected: send with my own key' }]} aria-label="How to ask the AI" data-testid="ai-mode-setting" />
      </Field>
      {d.aiMode === 'connected' && status && (
        <>
          <Field label="Service">
            <Select value={d.aiProvider} onChange={(aiProvider: AiProviderId) => set({ aiProvider, aiModel: '', aiBaseUrl: '' })} options={status.providers.map((p) => ({ value: p.id as AiProviderId, label: p.label }))} aria-label="AI service" />
          </Field>
          <Field label="Model" hint={provider?.defaultModel ? `Empty uses ${provider.defaultModel}.` : 'The model’s name at that service.'}>
            <Input mono value={d.aiModel} onChange={(e) => set({ aiModel: e.target.value.trim() })} placeholder={provider?.defaultModel ?? ''} aria-label="Model" />
          </Field>
          {(d.aiProvider === 'local' || d.aiProvider === 'custom') && (
            <Field label="Address" hint={d.aiProvider === 'local' ? 'Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1' : 'The service’s OpenAI-compatible address, ending in /v1.'}>
              <Input mono value={d.aiBaseUrl} onChange={(e) => set({ aiBaseUrl: e.target.value.trim() })} placeholder={provider?.defaultBaseUrl ?? 'https://…/v1'} aria-label="Service address" />
            </Field>
          )}
          {provider?.needsKey && (
            <Field label="Your key" hint="Stored encrypted on this computer and sent only to this service. You pay the service for what you use (usually cents per request).">
              {status.keys[d.aiProvider] ? (
                <>
                  <span className={styles.readonly}>Saved</span>
                  <Button icon={Trash2} onClick={() => void saveKey(null)}>
                    Forget
                  </Button>
                </>
              ) : (
                <>
                  <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key" aria-label="API key" />
                  <Button icon={KeyRound} variant="primary" disabled={key.trim().length < 8} onClick={() => void saveKey(key.trim())}>
                    Save
                  </Button>
                </>
              )}
              {provider.keyUrl && (
                <Button icon={ExternalLink} variant="ghost" onClick={() => window.open(provider.keyUrl!, '_blank')}>
                  Get a key
                </Button>
              )}
            </Field>
          )}
        </>
      )}
    </FieldGroup>
  );
}
