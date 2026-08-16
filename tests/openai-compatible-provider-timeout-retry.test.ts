import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AiStructuredRequest } from '../types.js';
import { OpenAiCompatibleProvider } from '../src/ai/openai-compatible-provider.js';

const request: AiStructuredRequest = {
  requestId: 'timeout-retry-fixture',
  task: 'actor',
  systemPrompt: 'Return a structured result.',
  userPrompt: 'Complete the fixture.',
  schemaName: 'timeout_retry_fixture',
  imageDataUrls: [],
  privacy: {
    allowRemoteModel: true,
    allowScreenshot: false,
    visibleTextOnly: true,
    redactionApplied: true,
  },
  metadata: { caseId: 'provider-timeout-regression' },
};

const resultSchema = z.object({ ok: z.boolean() }).strict();

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function successfulResponse(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function provider(fetchImplementation: typeof fetch, maxRetries = 1): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    baseUrl: 'https://example.invalid',
    timeoutMs: 10,
    maxRetries,
    fetchImplementation,
  });
}

describe('OpenAiCompatibleProvider timeout retry budget', () => {
  it('retries an AbortError while retry budget remains and can recover on the next attempt', async () => {
    let calls = 0;
    const fetchImplementation = (async () => {
      calls += 1;
      if (calls === 1) throw abortError();
      return successfulResponse();
    }) as typeof fetch;

    await expect(provider(fetchImplementation).generateStructured(request, resultSchema)).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('reports the timeout only after the configured retry budget is exhausted', async () => {
    let calls = 0;
    const fetchImplementation = (async () => {
      calls += 1;
      throw abortError();
    }) as typeof fetch;

    const promise = provider(fetchImplementation).generateStructured(request, resultSchema);
    await expect(promise).rejects.toMatchObject({
      name: 'AiProviderError',
      code: 'REQUEST_FAILED',
      message: 'DeepSeek 请求超时，请稍后重试。',
    });
    expect(calls).toBe(2);
  });

  it('does not retry a timeout when maxRetries is zero', async () => {
    let calls = 0;
    const fetchImplementation = (async () => {
      calls += 1;
      throw abortError();
    }) as typeof fetch;

    await expect(provider(fetchImplementation, 0).generateStructured(request, resultSchema)).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
    });
    expect(calls).toBe(1);
  });
});
