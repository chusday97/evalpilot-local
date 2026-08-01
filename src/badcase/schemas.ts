import { z } from 'zod';
import { storageIdSchema } from '../eval-set/schemas.js';
import { rootCauseHypothesisSchema } from '../judge/schemas.js';

export const badcaseCategorySchema = z.enum(['functional', 'navigation', 'interaction', 'ux', 'state', 'api', 'data', 'auth', 'ai_output', 'prompt', 'rag', 'tool', 'safety', 'performance', 'evaluator', 'unknown']);

export const badcaseSchema = z.object({
  badcaseId: storageIdSchema,
  projectId: storageIdSchema,
  caseId: storageIdSchema,
  runId: storageIdSchema,
  category: badcaseCategorySchema,
  title: z.string().min(1),
  observedFailure: z.string().min(1),
  userImpact: z.string().min(1),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  confirmedFacts: z.array(z.string().min(1)),
  rootCauseHypotheses: z.array(rootCauseHypothesisSchema),
  unknowns: z.array(z.string().min(1)),
  evidenceRefs: z.array(z.string().min(1)),
  fixStatus: z.enum(['open', 'in_progress', 'fixed', 'wont_fix']),
  regressionCaseId: storageIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
