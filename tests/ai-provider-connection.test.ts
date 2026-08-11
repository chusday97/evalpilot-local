import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiConnectionStatus, connectAiSession, currentAiCredential, disconnectAiSession } from '../src/ai/provider-connection.js';
import { dispatchDashboardApi } from '../src/dashboard/server.js';
import { configuredEvaluationProvider } from '../src/evaluation/evaluation-orchestrator.js';

const secret = 'sk-test-connection-secret-value';

afterEach(() => {
  disconnectAiSession();
  delete process.env.EVALPILOT_TEST_AI_BASE_URL;
  vi.unstubAllGlobals();
});

describe('in-process multi-provider connection', () => {
  it('stores a verified OpenAI credential only in process memory and never returns the key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] }), { status: 200 }));
    const status = await connectAiSession({ provider: 'openai', apiKey: secret, model: 'gpt-5-mini', confirmed: true }, fetchMock);

    expect(status).toEqual(expect.objectContaining({ provider: 'openai', displayName: 'OpenAI', protocol: 'responses', apiHost: 'api.openai.com', configured: true, source: 'session', model: 'gpt-5-mini' }));
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(currentAiCredential()).toEqual(expect.objectContaining({ apiKey: secret, source: 'session' }));
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({ headers: { authorization: `Bearer ${secret}` } }));
  });

  it.each([
    ['deepseek', 'https://api.deepseek.com/models', 'deepseek-v4-flash', 'DeepSeek'],
    ['kimi', 'https://api.moonshot.cn/v1/models', 'kimi-k2.6', 'Kimi'],
  ] as const)('uses the fixed official host for %s', async (provider, endpoint, model, displayName) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: model }] }), { status: 200 }));
    const status = await connectAiSession({ provider, apiKey: secret, confirmed: true }, fetchMock);
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.any(Object));
    expect(status).toEqual(expect.objectContaining({ provider, displayName, model, protocol: 'chat_completions' }));
    expect(configuredEvaluationProvider().info).toEqual(expect.objectContaining({ providerId: provider, model, structuredOutput: true }));
  });

  it('accepts an explicit HTTPS compatible endpoint and rejects unsafe remote HTTP', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'custom-model' }] }), { status: 200 }));
    await expect(connectAiSession({ provider: 'openai_compatible', apiKey: secret, baseUrl: 'https://models.example.com/v1', model: 'custom-model', confirmed: true }, fetchMock)).resolves.toEqual(expect.objectContaining({ provider: 'openai_compatible', apiHost: 'models.example.com' }));
    expect(fetchMock).toHaveBeenCalledWith('https://models.example.com/v1/models', expect.any(Object));
    const unsafe = await dispatchDashboardApi(process.cwd(), 'POST', '/api/ai-provider/connect', '', { provider: 'openai_compatible', apiKey: secret, baseUrl: 'http://models.example.com/v1', model: 'custom-model', confirmed: true });
    expect(unsafe.status).toBe(422);
  });

  it('returns a safe authentication error and preserves the previous valid connection', async () => {
    await connectAiSession({ provider: 'deepseek', apiKey: secret, confirmed: true }, vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 })));
    const invalid = 'sk-invalid-do-not-echo';

    await expect(connectAiSession({ provider: 'kimi', apiKey: invalid, confirmed: true }, vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream response', { status: 401 })))).rejects.toMatchObject({ code: 'AI_PROVIDER_AUTH_FAILED' });
    expect(currentAiCredential()).toEqual(expect.objectContaining({ provider: 'deepseek', apiKey: secret }));
    await expect(connectAiSession({ provider: 'kimi', apiKey: invalid, confirmed: true }, vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })))).rejects.not.toThrow(invalid);
  });

  it('exposes connect, status and disconnect APIs without exposing the credential', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 })));
    const connected = await dispatchDashboardApi(process.cwd(), 'POST', '/api/ai-provider/connect', '', { provider: 'kimi', apiKey: secret, confirmed: true });
    const status = await dispatchDashboardApi(process.cwd(), 'GET', '/api/ai-provider', '', null);
    const disconnected = await dispatchDashboardApi(process.cwd(), 'POST', '/api/ai-provider/disconnect', '', { confirmed: true });

    expect(connected.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ provider: 'kimi', configured: true, source: 'session' }) }));
    expect(status.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ configured: true }) }));
    expect(disconnected.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ provider: null, configured: false, source: null }) }));
    expect(JSON.stringify([connected, status, disconnected])).not.toContain(secret);
  });

  it('requires explicit confirmation and a plausible key', async () => {
    const result = await dispatchDashboardApi(process.cwd(), 'POST', '/api/ai-provider/connect', '', { provider: 'openai', apiKey: 'short', confirmed: false });
    expect(result.status).toBe(422);
    expect(result.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'AI_PROVIDER_CONNECTION_INVALID' }) }));
    expect(aiConnectionStatus().configured).toBe(false);
  });
});
