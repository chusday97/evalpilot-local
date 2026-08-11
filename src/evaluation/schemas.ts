import { z } from 'zod';
import { badcaseSchema } from '../badcase/schemas.js';
import { coverageMatrixSchema, storageIdSchema } from '../eval-set/schemas.js';
import { candidateFindingSchema } from '../findings/schemas.js';
import { evalCaseResultSchema } from '../judge/schemas.js';

export const evaluationOrchestratorInputSchema = z.object({
  projectId: storageIdSchema,
  evaluationId: storageIdSchema,
  depth: z.enum(['quick', 'core', 'full']),
  capabilityIds: z.array(storageIdSchema),
  allowRemoteModel: z.literal(true),
  allowScreenshot: z.boolean(),
  // @deprecated legacy evaluation runtime compatibility marker; normal evaluation always uses false.
  legacyFallback: z.literal(false).optional(),
}).strict();

export const evaluationOrchestratorResultSchema = z.object({
  evaluationId: storageIdSchema,
  selectedCaseIds: z.array(storageIdSchema),
  runIds: z.array(storageIdSchema),
  results: z.array(evalCaseResultSchema),
  findings: z.array(candidateFindingSchema),
  badcases: z.array(badcaseSchema),
  coverage: coverageMatrixSchema,
}).strict();

export const evaluationFoundationStateSchema = z.object({
  schemaVersion: z.literal(1),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  productModelVersion: z.number().int().positive(),
  evalSetVersion: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
}).strict();
