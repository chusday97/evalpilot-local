import type { ZodType } from 'zod';
import type { AiProviderInfo, AiStructuredRequest } from '../../types.js';

export class AiProviderError extends Error {
  constructor(message: string, readonly code: 'INVALID_OUTPUT' | 'REQUEST_FAILED' | 'PRIVACY_BLOCKED') {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiProvider {
  readonly info: AiProviderInfo;
  generateStructured<T>(request: AiStructuredRequest, schema: ZodType<T>): Promise<T>;
}
