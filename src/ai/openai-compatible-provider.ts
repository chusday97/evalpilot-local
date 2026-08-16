import { z, type ZodType } from 'zod';
import type { AiProviderInfo, AiProviderName, AiStructuredRequest } from '../../types.js';
import { aiStructuredRequestSchema } from './schemas.js';
import { redactSensitiveText } from './openai-provider.js';
import { AiProviderError, type AiProvider } from './provider.js';

interface OpenAiCompatibleProviderOptions {
  providerId: Exclude<AiProviderName, 'openai'>;
  displayName: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  screenshotInput?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImplementation?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly info: AiProviderInfo;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleProviderOptions) {
    if (!options.apiKey.trim()) throw new AiProviderError(`${options.displayName} API Key 不能为空。`, 'REQUEST_FAILED');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.info = { providerId: options.providerId, model: options.model, remote: true, structuredOutput: true, screenshotInput: options.screenshotInput ?? false };
  }

  async generateStructured<T>(request: AiStructuredRequest, schema: ZodType<T>): Promise<T> {
    const validated = aiStructuredRequestSchema.parse(request);
    if (!validated.privacy.allowRemoteModel) throw new AiProviderError('当前隐私设置不允许调用远程模型。', 'PRIVACY_BLOCKED');
    if (validated.imageDataUrls.length && !validated.privacy.allowScreenshot) throw new AiProviderError('当前隐私设置不允许发送截图。', 'PRIVACY_BLOCKED');
    if (validated.imageDataUrls.length && !this.info.screenshotInput) throw new AiProviderError(`${this.options.displayName} 当前连接未声明支持截图输入，请关闭截图后重试。`, 'REQUEST_FAILED');

    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    let invalidOutput = false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const userContent: string | Array<Record<string, unknown>> = validated.imageDataUrls.length
          ? [
              { type: 'text', text: redactSensitiveText(validated.userPrompt) },
              ...validated.imageDataUrls.map((imageUrl) => ({ type: 'image_url', image_url: { url: imageUrl, detail: 'low' } })),
            ]
          : redactSensitiveText(validated.userPrompt);
        const response = await this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.options.model,
            messages: [
              { role: 'system', content: `${redactSensitiveText(validated.systemPrompt)}\nReturn only one valid JSON object matching this JSON Schema:\n${jsonSchema}` },
              { role: 'user', content: userContent },
            ],
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new AiProviderError(`${this.options.displayName} 请求失败（HTTP ${response.status}）。`, 'REQUEST_FAILED');
        const body = await response.json() as ChatCompletionResponse;
        const content = body.choices?.[0]?.message?.content;
        if (!content?.trim()) { invalidOutput = true; continue; }
        try {
          const parsed = schema.safeParse(JSON.parse(content));
          if (parsed.success) return parsed.data;
        } catch {
          // The local schema gate below owns invalid model output classification.
        }
        invalidOutput = true;
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt >= this.maxRetries) throw new AiProviderError(`${this.options.displayName} 请求超时，请稍后重试。`, 'REQUEST_FAILED');
          continue;
        }
        if (attempt >= this.maxRetries) throw new AiProviderError(`${this.options.displayName} 暂时无法完成请求，请检查网络和模型设置。`, 'REQUEST_FAILED');
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new AiProviderError(invalidOutput ? `${this.options.displayName} 返回的内容不符合评测结构，已停止本次判断。` : `${this.options.displayName} 暂时无法完成请求。`, invalidOutput ? 'INVALID_OUTPUT' : 'REQUEST_FAILED');
  }
}
