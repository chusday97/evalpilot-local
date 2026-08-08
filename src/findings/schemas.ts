import { z } from 'zod';
import { storageIdSchema } from '../eval-set/schemas.js';
import { rootCauseHypothesisSchema } from '../judge/schemas.js';

export const findingStatusSchema = z.enum(['candidate', 'confirmed_product_failure', 'evaluator_failure', 'dismissed', 'needs_human_review']);

export const candidateFindingSchema = z.object({
  findingId: storageIdSchema,
  projectId: storageIdSchema,
  caseId: storageIdSchema,
  runId: storageIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  status: findingStatusSchema,
  semanticConfidence: z.number().min(0).max(1),
  deterministicSupport: z.boolean(),
  independentEvidenceTypes: z.array(z.string().min(1)),
  confirmedFacts: z.array(z.string().min(1)),
  hypotheses: z.array(rootCauseHypothesisSchema),
  unknowns: z.array(z.string().min(1)),
  evidenceRefs: z.array(z.string().min(1)),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
