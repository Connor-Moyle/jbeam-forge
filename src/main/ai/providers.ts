import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import type { AiProviderId } from '@shared/settings-schema';

/**
 * AI mode, connected: the request goes straight to the AI service the modder picked, with their
 * own key. No account with us, nothing in between. Keys are encrypted with the system's own
 * storage (Windows: DPAPI; Linux: the keyring) and never leave this computer except to that
 * service. Local models (Ollama, LM Studio) need no key and stay offline.
 */

export interface ProviderInfo {
  id: AiProviderId;
  label: string;
  /** Where its keys are made. */
  keyUrl: string | null;
  needsKey: boolean;
  defaultModel: string;
  defaultBaseUrl: string;
}

export const PROVIDERS: Record<AiProviderId, ProviderInfo> = {
  openai: { id: 'openai', label: 'OpenAI (ChatGPT models)', keyUrl: 'https://platform.openai.com/api-keys', needsKey: true, defaultModel: 'gpt-4.1-mini', defaultBaseUrl: 'https://api.openai.com/v1' },
  anthropic: { id: 'anthropic', label: 'Anthropic (Claude models)', keyUrl: 'https://console.anthropic.com/settings/keys', needsKey: true, defaultModel: 'claude-sonnet-5-5', defaultBaseUrl: 'https://api.anthropic.com/v1' },
  gemini: { id: 'gemini', label: 'Google (Gemini models)', keyUrl: 'https://aistudio.google.com/app/apikey', needsKey: true, defaultModel: 'gemini-2.5-flash', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  openrouter: { id: 'openrouter', label: 'OpenRouter (many models, one key)', keyUrl: 'https://openrouter.ai/keys', needsKey: true, defaultModel: 'openai/gpt-4.1-mini', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  local: { id: 'local', label: 'On this computer (Ollama or LM Studio, free)', keyUrl: null, needsKey: false, defaultModel: 'llama3.1', defaultBaseUrl: 'http://localhost:11434/v1' },
  custom: { id: 'custom', label: 'Another OpenAI-compatible service', keyUrl: null, needsKey: true, defaultModel: '', defaultBaseUrl: '' },
};

export class AiKeys {
  constructor(private readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'ai-keys.json');
  }

  private async all(): Promise<Partial<Record<AiProviderId, string>>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Partial<Record<AiProviderId, string>>;
    } catch {
      return {};
    }
  }

  async has(id: AiProviderId): Promise<boolean> {
    return !!(await this.all())[id];
  }

  async get(id: AiProviderId): Promise<string | null> {
    const stored = (await this.all())[id];
    if (!stored) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This system can’t decrypt the saved key. Enter it again in Settings → AI mode.');
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  }

  async set(id: AiProviderId, key: string | null): Promise<void> {
    const keys = await this.all();
    if (key) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This system has no secure storage for keys, so the key can’t be saved.');
      keys[id] = safeStorage.encryptString(key.trim()).toString('base64');
    } else delete keys[id];
    await writeFile(this.file, JSON.stringify(keys));
  }
}

export interface SendOptions {
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  key: string | null;
  prompt: string;
  signal?: AbortSignal;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;

const trimSlash = (u: string) => u.replace(/\/+$/, '');

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message);
    if (m) return m;
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || res.statusText;
}

/** Send one request and return the reply's text. */
export async function sendToAi(o: SendOptions, fetchFn: Fetch = fetch): Promise<string> {
  const info = PROVIDERS[o.provider];
  const base = trimSlash(o.baseUrl || info.defaultBaseUrl);
  const model = o.model || info.defaultModel;
  if (!base) throw new Error('Set the service’s address (base URL) in Settings → AI mode.');
  if (!model) throw new Error('Set a model name in Settings → AI mode.');
  if (info.needsKey && !o.key) throw new Error(`Add your ${info.label} key in Settings → AI mode first.`);
  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    let res: Response;
    try {
      res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), ...(o.signal ? { signal: o.signal } : {}) });
    } catch (err) {
      if (o.signal?.aborted) throw new Error('Cancelled');
      throw new Error(o.provider === 'local' ? `Nothing answered at ${base}. Is Ollama or LM Studio running?` : `Couldn’t reach ${info.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 401 || res.status === 403) throw new Error(`${info.label} refused the key (${await readError(res)}). Check it in Settings → AI mode.`);
    if (res.status === 429) throw new Error(`${info.label} says you’ve hit its limit or run out of credit (${await readError(res)}).`);
    if (!res.ok) throw new Error(`${info.label} answered ${res.status}: ${await readError(res)}`);
    return (await res.json()) as unknown;
  };

  if (o.provider === 'anthropic') {
    const j = (await post(`${base}/messages`, { 'x-api-key': o.key!, 'anthropic-version': '2023-06-01' }, { model, max_tokens: 16000, messages: [{ role: 'user', content: o.prompt }] })) as { content?: { type: string; text?: string }[] };
    return (j.content ?? []).map((c) => c.text ?? '').join('');
  }
  if (o.provider === 'gemini') {
    const j = (await post(`${base}/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': o.key! }, { contents: [{ role: 'user', parts: [{ text: o.prompt }] }], generationConfig: { responseMimeType: 'application/json' } })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  }
  // OpenAI and everything compatible with it (OpenRouter, Ollama, LM Studio, Groq, Mistral, DeepSeek…).
  const headers: Record<string, string> = o.key ? { authorization: `Bearer ${o.key}` } : {};
  if (o.provider === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://github.com/Connor-Moyle/jbeam-forge', 'X-Title': 'JBeam Forge' });
  const j = (await post(`${base}/chat/completions`, headers, { model, messages: [{ role: 'user', content: o.prompt }] })) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? '';
}
