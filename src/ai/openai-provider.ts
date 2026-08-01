import { z, type ZodType } from 'zod';
import type { AiProviderInfo, AiStructuredRequest } from '../../types.js';
import { aiStructuredRequestSchema } from './schemas.js';
import { AiProviderError, type AiProvider } from './provider.js';

interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImplementation?: typeof fetch;
}

interface OpenAiResponse {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
}

function responseText(value: OpenAiResponse): string | null {
  if (typeof value.output_text === 'string') return value.output_text;
  for (const item of value.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return null;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(?:password|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
}

export class OpenAiProvider implements AiProvider {
  readonly info: AiProviderInfo;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenAiProviderOptions) {
    if (!options.apiKey.trim()) throw new AiProviderError('OpenAI API Key 不能为空。', 'REQUEST_FAILED');
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.info = { providerId: 'openai', model: options.model, remote: true, structuredOutput: true, screenshotInput: true };
  }

  async generateStructured<T>(request: AiStructuredRequest, schema: ZodType<T>): Promise<T> {
    const validated = aiStructuredRequestSchema.parse(request);
    if (!validated.privacy.allowRemoteModel) throw new AiProviderError('当前隐私设置不允许调用远程模型。', 'PRIVACY_BLOCKED');
    if (validated.imageDataUrls.length && !validated.privacy.allowScreenshot) throw new AiProviderError('当前隐私设置不允许发送截图。', 'PRIVACY_BLOCKED');
    let lastError = '未知错误';
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const userContent: Array<Record<string, unknown>> = [{ type: 'input_text', text: redactSensitiveText(validated.userPrompt) }];
        if (validated.privacy.allowScreenshot) {
          for (const imageUrl of validated.imageDataUrls) userContent.push({ type: 'input_image', image_url: imageUrl, detail: 'low' });
        }
        const response = await this.fetchImplementation(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.options.model,
            instructions: redactSensitiveText(validated.systemPrompt),
            input: [{ role: 'user', content: userContent }],
            text: { format: { type: 'json_schema', name: validated.schemaName, strict: true, schema: z.toJSONSchema(schema) } },
          }),
          signal: controller.signal,
        });
        const body = await response.json() as OpenAiResponse;
        if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
        const text = responseText(body);
        if (!text) throw new Error('响应没有结构化文本。');
        const parsed = schema.safeParse(JSON.parse(text));
        if (parsed.success) return parsed.data;
        lastError = parsed.error.message;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new AiProviderError(`OpenAI Provider 调用失败：${lastError}`, lastError.includes('Schema') ? 'INVALID_OUTPUT' : 'REQUEST_FAILED');
  }
}
