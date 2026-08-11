import type { AiProviderConnectionRequest, AiProviderConnectionStatus } from '../../types.js';
import { aiProviderConnectionRequestSchema } from '../schemas/workspace.js';
import { EvalPilotError } from '../utils/errors.js';

interface OpenAiCredential {
  apiKey: string;
  model: string;
  source: 'environment' | 'session';
  connectedAt: string | null;
}

let sessionCredential: OpenAiCredential | null = null;

function testBaseUrl(): string | undefined {
  if (process.env.NODE_ENV !== 'test') return undefined;
  const value = process.env.EVALPILOT_TEST_OPENAI_BASE_URL?.trim();
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); }
  catch { throw new EvalPilotError('测试 Provider 地址无效。', 'AI_PROVIDER_INVALID'); }
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new EvalPilotError('测试 Provider 只能连接本机 loopback 地址。', 'AI_PROVIDER_INVALID');
  return value.replace(/\/$/, '');
}

export function currentOpenAiCredential(): OpenAiCredential | null {
  if (sessionCredential) return { ...sessionCredential };
  const apiKey = process.env.EVALPILOT_OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: process.env.EVALPILOT_OPENAI_MODEL?.trim() || 'gpt-5-mini', source: 'environment', connectedAt: null };
}

export function openAiConnectionStatus(): AiProviderConnectionStatus {
  const credential = currentOpenAiCredential();
  return { provider: 'openai', configured: credential !== null, source: credential?.source ?? null, model: credential?.model ?? null, connectedAt: credential?.connectedAt ?? null };
}

export function openAiProviderBaseUrl(): string | undefined {
  return testBaseUrl();
}

export async function connectOpenAiSession(rawInput: AiProviderConnectionRequest, fetchImplementation: typeof fetch = fetch): Promise<AiProviderConnectionStatus> {
  const input = aiProviderConnectionRequestSchema.parse(rawInput);
  const baseUrl = testBaseUrl() ?? 'https://api.openai.com/v1';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImplementation(`${baseUrl}/models/${encodeURIComponent(input.model)}`, {
      headers: { authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401) throw new EvalPilotError('这个 API Key 无法通过验证，请检查后重新输入。', 'AI_PROVIDER_AUTH_FAILED');
      if (response.status === 403) throw new EvalPilotError('这个账号暂时无权使用所选模型，请检查 OpenAI 项目权限。', 'AI_PROVIDER_ACCESS_DENIED');
      if (response.status === 404) throw new EvalPilotError('当前账号找不到所选模型，请检查模型权限后再试。', 'AI_PROVIDER_MODEL_UNAVAILABLE');
      if (response.status === 429) throw new EvalPilotError('OpenAI 暂时限制了连接检查，请稍后再试。', 'AI_PROVIDER_RATE_LIMITED');
      throw new EvalPilotError('OpenAI 连接检查暂时失败，请稍后重试。', 'AI_PROVIDER_CHECK_FAILED');
    }
    sessionCredential = { apiKey: input.apiKey, model: input.model, source: 'session', connectedAt: new Date().toISOString() };
    return openAiConnectionStatus();
  } catch (error) {
    if (error instanceof EvalPilotError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new EvalPilotError('连接 OpenAI 超时，请检查网络后重试。', 'AI_PROVIDER_TIMEOUT');
    throw new EvalPilotError('连接不到 OpenAI，请检查网络后重试。', 'AI_PROVIDER_UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export function disconnectOpenAiSession(): AiProviderConnectionStatus {
  sessionCredential = null;
  return openAiConnectionStatus();
}
