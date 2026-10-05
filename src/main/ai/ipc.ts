import { z } from 'zod';
import { AI_PROVIDERS, type AiProviderId } from '@shared/settings-schema';
import type { Logger } from '@shared/logger';
import { registerInvoke } from '../ipc/register';
import type { SettingsService } from '../services/settings';
import { type AiKeys, PROVIDERS, sendToAi } from './providers';

/** AI mode, connected: keys and sending. The request text is built in the renderer. */
export function registerAiHandlers(settings: SettingsService, keys: AiKeys, logger: Logger): void {
  let running: AbortController | null = null;
  const Provider = z.enum(AI_PROVIDERS);

  registerInvoke('ai:status', async () => {
    const has: Record<string, boolean> = {};
    for (const id of AI_PROVIDERS) has[id] = await keys.has(id);
    return { keys: has, providers: AI_PROVIDERS.map((id) => PROVIDERS[id]) };
  });
  registerInvoke('ai:setKey', async ({ provider, key }) => {
    await keys.set(provider as AiProviderId, key);
    return undefined;
  }, z.object({ provider: Provider, key: z.string().min(8).max(500).nullable() }));
  registerInvoke(
    'ai:send',
    async ({ prompt }) => {
      const s = settings.get();
      running?.abort();
      running = new AbortController();
      const started = Date.now();
      try {
        const text = await sendToAi({ provider: s.aiProvider, model: s.aiModel, baseUrl: s.aiBaseUrl, key: await keys.get(s.aiProvider), prompt, signal: AbortSignal.any([running.signal, AbortSignal.timeout(300_000)]) });
        logger.info(`AI mode: ${PROVIDERS[s.aiProvider].label} answered in ${((Date.now() - started) / 1000).toFixed(1)} s (${text.length} characters)`);
        return text;
      } finally {
        running = null;
      }
    },
    z.object({ prompt: z.string().min(1).max(2_000_000) }),
  );
  registerInvoke('ai:cancel', () => {
    running?.abort();
    return undefined;
  });
}
