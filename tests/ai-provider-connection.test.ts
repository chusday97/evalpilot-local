import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectOpenAiSession, currentOpenAiCredential, disconnectOpenAiSession, openAiConnectionStatus } from '../src/ai/provider-connection.js';
import { dispatchDashboardApi } from '../src/dashboard/server.js';

const secret = 'sk-test-connection-secret-value';

afterEach(() => {
  disconnectOpenAiSession();
  vi.unstubAllGlobals();
});

describe('in-process OpenAI connection', () => {
  it('stores a verified credential only in process memory and never returns the key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'gpt-5-mini' }), { status: 200 }));
    const status = await connectOpenAiSession({ provider: 'openai', apiKey: secret, model: 'gpt-5-mini', confirmed: true }, fetchMock);

    expect(status).toEqual(expect.objectContaining({ configured: true, source: 'session', model: 'gpt-5-mini' }));
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(currentOpenAiCredential()).toEqual(expect.objectContaining({ apiKey: secret, source: 'session' }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/models/gpt-5-mini'), expect.objectContaining({ headers: { authorization: `Bearer ${secret}` } }));
  });

  it('returns a safe authentication error and preserves the previous valid connection', async () => {
    await connectOpenAiSession({ provider: 'openai', apiKey: secret, confirmed: true }, vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 })));
    const invalid = 'sk-invalid-do-not-echo';

    await expect(connectOpenAiSession({ provider: 'openai', apiKey: invalid, confirmed: true }, vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream response', { status: 401 })))).rejects.toMatchObject({ code: 'AI_PROVIDER_AUTH_FAILED' });
    expect(currentOpenAiCredential()?.apiKey).toBe(secret);
    await expect(connectOpenAiSession({ provider: 'openai', apiKey: invalid, confirmed: true }, vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })))).rejects.not.toThrow(invalid);
  });

  it('exposes connect, status and disconnect APIs without exposing the credential', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 })));
    const connected = await dispatchDashboardApi(process.cwd(), 'POST', '/api/ai-provider/connect', '', { provider: 'openai', apiKey: secret, confirmed: true });
    const status = await dispatchDashboardApi(process.cwd(), 'GET', '/api/ai-provider', '', null);
    const disconnected = await dispatchDashboardApi(process.cwd(), 'POST', '/api/ai-provider/disconnect', '', { confirmed: true });

    expect(connected.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ configured: true, source: 'session' }) }));
    expect(status.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ configured: true }) }));
    expect(disconnected.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ configured: false, source: null }) }));
    expect(JSON.stringify([connected, status, disconnected])).not.toContain(secret);
  });

  it('requires explicit confirmation and a plausible key', async () => {
    const result = await dispatchDashboardApi(process.cwd(), 'POST', '/api/ai-provider/connect', '', { provider: 'openai', apiKey: 'short', confirmed: false });
    expect(result.status).toBe(422);
    expect(result.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'AI_PROVIDER_CONNECTION_INVALID' }) }));
    expect(openAiConnectionStatus().configured).toBe(false);
  });
});
