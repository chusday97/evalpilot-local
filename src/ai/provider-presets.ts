import type { AiProviderName, AiProviderProtocol } from '../../types.js';

export interface AiProviderDefinition {
  provider: AiProviderName;
  displayName: string;
  protocol: AiProviderProtocol;
  baseUrl: string;
  defaultModel: string;
  screenshotInput: boolean;
}

const PRESETS: Record<Exclude<AiProviderName, 'openai_compatible'>, AiProviderDefinition> = {
  openai: { provider: 'openai', displayName: 'OpenAI', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5-mini', screenshotInput: true },
  deepseek: { provider: 'deepseek', displayName: 'DeepSeek', protocol: 'chat_completions', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-v4-flash', screenshotInput: false },
  kimi: { provider: 'kimi', displayName: 'Kimi', protocol: 'chat_completions', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.6', screenshotInput: false },
};

export function presetProvider(provider: Exclude<AiProviderName, 'openai_compatible'>): AiProviderDefinition {
  return { ...PRESETS[provider] };
}

export function compatibleProvider(baseUrl: string): AiProviderDefinition {
  return { provider: 'openai_compatible', displayName: '其他兼容服务', protocol: 'chat_completions', baseUrl: baseUrl.replace(/\/$/, ''), defaultModel: '', screenshotInput: false };
}
