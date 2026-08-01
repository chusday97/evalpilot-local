import type { ZodType } from 'zod';
import type { AiProviderInfo, AiStructuredRequest } from '../../types.js';
import { aiStructuredRequestSchema } from './schemas.js';
import { AiProviderError, type AiProvider } from './provider.js';

export type MockAiResponder = (request: AiStructuredRequest, attempt: number) => unknown | Promise<unknown>;

export class MockAiProvider implements AiProvider {
  readonly info: AiProviderInfo;
  readonly requests: AiStructuredRequest[] = [];

  constructor(private readonly responder: MockAiResponder, private readonly maxRetries = 1, model = 'evalpilot-mock-v1') {
    this.info = { providerId: 'mock', model, remote: false, structuredOutput: true, screenshotInput: true };
  }

  async generateStructured<T>(request: AiStructuredRequest, schema: ZodType<T>): Promise<T> {
    const validatedRequest = aiStructuredRequestSchema.parse(request);
    this.requests.push(validatedRequest);
    let lastError = '输出不符合 Schema';
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const parsed = schema.safeParse(await this.responder(validatedRequest, attempt));
        if (parsed.success) return parsed.data;
        lastError = parsed.error.message;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new AiProviderError(`Mock Provider 输出无效：${lastError}`, 'INVALID_OUTPUT');
  }
}
