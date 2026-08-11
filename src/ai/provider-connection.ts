import type { AiProviderConnectionRequest, AiProviderConnectionStatus, AiProviderName, AiProviderProtocol } from '../../types.js';
import { aiProviderConnectionRequestSchema } from '../schemas/workspace.js';
import { EvalPilotError } from '../utils/errors.js';
import { compatibleProvider, presetProvider } from './provider-presets.js';

export interface AiCredential {
  provider: AiProviderName;
  displayName: string;
  protocol: AiProviderProtocol;
  apiKey: string;
  model: string;
  baseUrl: string;
  screenshotInput: boolean;
  source: 'environment' | 'session';
  connectedAt: string | null;
}

let sessionCredential: AiCredential | null = null;

function testBaseUrl(provider: AiProviderName): string | undefined {
  if (process.env.NODE_ENV !== 'test') return undefined;
  const value = process.env.EVALPILOT_TEST_AI_BASE_URL?.trim()
    || (provider === 'openai' ? process.env.EVALPILOT_TEST_OPENAI_BASE_URL?.trim() : undefined);
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); }
  catch { throw new EvalPilotError('测试 Provider 地址无效。', 'AI_PROVIDER_INVALID'); }
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new EvalPilotError('测试 Provider 只能连接本机 loopback 地址。', 'AI_PROVIDER_INVALID');
  return value.replace(/\/$/, '');
}

export function currentAiCredential(): AiCredential | null {
  if (sessionCredential) return { ...sessionCredential };
  const apiKey = process.env.EVALPILOT_OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const preset = presetProvider('openai');
  return { ...preset, apiKey, model: process.env.EVALPILOT_OPENAI_MODEL?.trim() || preset.defaultModel, baseUrl: testBaseUrl('openai') ?? preset.baseUrl, source: 'environment', connectedAt: null };
}

export function aiConnectionStatus(): AiProviderConnectionStatus {
  const credential = currentAiCredential();
  if (!credential) return { provider: null, displayName: null, configured: false, source: null, protocol: null, apiHost: null, model: null, connectedAt: null };
  return { provider: credential.provider, displayName: credential.displayName, configured: true, source: credential.source, protocol: credential.protocol, apiHost: new URL(credential.baseUrl).host, model: credential.model, connectedAt: credential.connectedAt };
}

function providerError(displayName: string, status: number): EvalPilotError {
  if (status === 401) return new EvalPilotError(`这个 API Key 无法通过 ${displayName} 验证，请检查后重新输入。`, 'AI_PROVIDER_AUTH_FAILED');
  if (status === 403) return new EvalPilotError(`这个账号暂时无权使用所选 ${displayName} 模型。`, 'AI_PROVIDER_ACCESS_DENIED');
  if (status === 404) return new EvalPilotError(`${displayName} 没有找到模型读取接口，请检查 API 地址。`, 'AI_PROVIDER_MODEL_UNAVAILABLE');
  if (status === 429) return new EvalPilotError(`${displayName} 暂时限制了连接检查，请稍后再试。`, 'AI_PROVIDER_RATE_LIMITED');
  return new EvalPilotError(`${displayName} 连接检查暂时失败，请稍后重试。`, 'AI_PROVIDER_CHECK_FAILED');
}

export async function connectAiSession(rawInput: AiProviderConnectionRequest, fetchImplementation: typeof fetch = fetch): Promise<AiProviderConnectionStatus> {
  const input = aiProviderConnectionRequestSchema.parse(rawInput);
  const definition = input.provider === 'openai_compatible' ? compatibleProvider(input.baseUrl) : presetProvider(input.provider);
  const model = input.model?.trim() || definition.defaultModel;
  const baseUrl = testBaseUrl(input.provider) ?? definition.baseUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImplementation(`${baseUrl}/models`, { headers: { authorization: `Bearer ${input.apiKey}` }, signal: controller.signal });
    if (!response.ok) throw providerError(definition.displayName, response.status);
    const body = await response.json().catch(() => null) as { data?: Array<{ id?: string }> } | null;
    if (body?.data?.length && !body.data.some((item) => item.id === model)) throw new EvalPilotError(`当前账号没有找到模型“${model}”，请检查模型名称。`, 'AI_PROVIDER_MODEL_UNAVAILABLE');
    sessionCredential = { ...definition, apiKey: input.apiKey, model, baseUrl, source: 'session', connectedAt: new Date().toISOString() };
    return aiConnectionStatus();
  } catch (error) {
    if (error instanceof EvalPilotError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new EvalPilotError(`连接 ${definition.displayName} 超时，请检查网络后重试。`, 'AI_PROVIDER_TIMEOUT');
    throw new EvalPilotError(`连接不到 ${definition.displayName}，请检查网络和 API 地址后重试。`, 'AI_PROVIDER_UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export function disconnectAiSession(): AiProviderConnectionStatus {
  sessionCredential = null;
  return aiConnectionStatus();
}
