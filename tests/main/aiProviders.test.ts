import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }));
const { sendToAi } = await import('../../src/main/ai/providers');

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function fake(reply: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchFn = (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    return Promise.resolve(new Response(JSON.stringify(reply), { status }));
  };
  return { calls, fetchFn };
}

describe('AI mode: sending to a service', () => {
  it('OpenAI and compatible services: chat completions with a bearer key', async () => {
    const f = fake({ choices: [{ message: { content: '{"changes": []}' } }] });
    const text = await sendToAi({ provider: 'openai', model: '', baseUrl: '', key: 'sk-test-key', prompt: 'hi' }, f.fetchFn);
    expect(text).toBe('{"changes": []}');
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(f.calls[0]!.headers.authorization).toBe('Bearer sk-test-key');
    expect(f.calls[0]!.body.model).toBe('gpt-4.1-mini');
  });

  it('Anthropic: the messages API with its own headers', async () => {
    const f = fake({ content: [{ type: 'text', text: 'ok' }] });
    expect(await sendToAi({ provider: 'anthropic', model: 'claude-x', baseUrl: '', key: 'k-123456789', prompt: 'hi' }, f.fetchFn)).toBe('ok');
    expect(f.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(f.calls[0]!.headers['x-api-key']).toBe('k-123456789');
    expect(f.calls[0]!.headers['anthropic-version']).toBeTruthy();
  });

  it('Gemini: generateContent asking for JSON', async () => {
    const f = fake({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
    expect(await sendToAi({ provider: 'gemini', model: '', baseUrl: '', key: 'g-123456789', prompt: 'hi' }, f.fetchFn)).toBe('{}');
    expect(f.calls[0]!.url).toMatch(/models\/gemini-2\.5-flash:generateContent$/);
  });

  it('a local model needs no key; a missing key or a refused one says what to do', async () => {
    const f = fake({ choices: [{ message: { content: 'local' } }] });
    expect(await sendToAi({ provider: 'local', model: '', baseUrl: '', key: null, prompt: 'hi' }, f.fetchFn)).toBe('local');
    expect(f.calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(f.calls[0]!.headers.authorization).toBeUndefined();
    await expect(sendToAi({ provider: 'openai', model: '', baseUrl: '', key: null, prompt: 'hi' }, f.fetchFn)).rejects.toThrow(/Add your OpenAI/);
    const refused = fake({ error: { message: 'Incorrect API key' } }, 401);
    await expect(sendToAi({ provider: 'openai', model: '', baseUrl: '', key: 'bad-key-123', prompt: 'hi' }, refused.fetchFn)).rejects.toThrow(/refused the key \(Incorrect API key\)/);
    const down = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(sendToAi({ provider: 'local', model: '', baseUrl: '', key: null, prompt: 'hi' }, down)).rejects.toThrow(/Is Ollama or LM Studio running/);
  });
});
