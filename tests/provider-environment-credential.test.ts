import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentAiCredential } from '../src/ai/provider-connection.js';

function resetProviderEnvironment(): void {
  vi.stubEnv('EVALPILOT_AI_PROVIDER', '');
  vi.stubEnv('EVALPILOT_OPENAI_API_KEY', '');
  vi.stubEnv('EVALPILOT_OPENAI_MODEL', '');
  vi.stubEnv('EVALPILOT_DEEPSEEK_API_KEY', '');
  vi.stubEnv('EVALPILOT_DEEPSEEK_MODEL', '');
  vi.stubEnv('EVALPILOT_TEST_AI_BASE_URL', '');
  vi.stubEnv('EVALPILOT_TEST_OPENAI_BASE_URL', '');
}

describe('environment AI credential selection', () => {
  beforeEach(() => {
    resetProviderEnvironment();
  });

  it('uses DeepSeek when only a DeepSeek environment credential is configured', () => {
    vi.stubEnv('EVALPILOT_DEEPSEEK_API_KEY', 'deepseek-test-key');
    vi.stubEnv('EVALPILOT_DEEPSEEK_MODEL', 'deepseek-v4-flash');

    const credential = currentAiCredential();

    expect(credential).toEqual(expect.objectContaining({
      provider: 'deepseek',
      displayName: 'DeepSeek',
      protocol: 'chat_completions',
      apiKey: 'deepseek-test-key',
      model: 'deepseek-v4-flash',
      source: 'environment',
    }));
  });

  it('uses the DeepSeek preset model when the environment model is omitted', () => {
    vi.stubEnv('EVALPILOT_DEEPSEEK_API_KEY', 'deepseek-test-key');

    expect(currentAiCredential()).toEqual(expect.objectContaining({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    }));
  });

  it('requires explicit provider selection when multiple environment credentials exist', () => {
    vi.stubEnv('EVALPILOT_OPENAI_API_KEY', 'openai-test-key');
    vi.stubEnv('EVALPILOT_DEEPSEEK_API_KEY', 'deepseek-test-key');

    expect(() => currentAiCredential()).toThrow('检测到多个环境变量 AI Provider');
  });

  it('honors EVALPILOT_AI_PROVIDER when multiple credentials exist', () => {
    vi.stubEnv('EVALPILOT_AI_PROVIDER', 'deepseek');
    vi.stubEnv('EVALPILOT_OPENAI_API_KEY', 'openai-test-key');
    vi.stubEnv('EVALPILOT_DEEPSEEK_API_KEY', 'deepseek-test-key');
    vi.stubEnv('EVALPILOT_DEEPSEEK_MODEL', 'deepseek-v4-pro');

    expect(currentAiCredential()).toEqual(expect.objectContaining({
      provider: 'deepseek',
      apiKey: 'deepseek-test-key',
      model: 'deepseek-v4-pro',
    }));
  });

  it('rejects unsupported environment provider names instead of guessing', () => {
    vi.stubEnv('EVALPILOT_AI_PROVIDER', 'unknown-provider');
    vi.stubEnv('EVALPILOT_DEEPSEEK_API_KEY', 'deepseek-test-key');

    expect(() => currentAiCredential()).toThrow('EVALPILOT_AI_PROVIDER 仅支持 openai 或 deepseek');
  });
});
