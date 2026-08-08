import { z } from 'zod';

export const aiPrivacyPolicySchema = z.object({
  allowRemoteModel: z.boolean(),
  allowScreenshot: z.boolean(),
  visibleTextOnly: z.boolean(),
  redactionApplied: z.boolean(),
}).strict();

export const aiStructuredRequestSchema = z.object({
  requestId: z.string().min(1),
  task: z.enum(['actor', 'semantic_verifier', 'semantic_reflector', 'semantic_judge', 'product_model', 'product_understanding', 'oracle_builder', 'challenge', 'exploration']),
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
  schemaName: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  imageDataUrls: z.array(z.string().startsWith('data:image/')),
  privacy: aiPrivacyPolicySchema,
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict();
