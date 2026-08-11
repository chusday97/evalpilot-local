import { z } from 'zod';
import { storageIdSchema } from '../eval-set/schemas.js';

export const evaluatorFailureCategorySchema = z.enum([
  'no_next_action',
  'unsupported_control',
  'model_output_invalid',
  'insufficient_context',
  'ambiguous_page_state',
  'wait_policy_exhausted',
  'evidence_missing',
  'navigation_mismatch',
  'tool_execution_error',
  'unknown',
]);

export const evaluatorBadcaseSchema = z.object({
  evaluatorBadcaseId: storageIdSchema,
  projectId: storageIdSchema,
  caseId: storageIdSchema,
  runId: storageIdSchema,
  category: evaluatorFailureCategorySchema,
  observedState: z.string(),
  attemptedActions: z.array(z.string().min(1)),
  evidenceRefs: z.array(z.string().min(1)),
  resolved: z.boolean(),
  regressionFixtureId: storageIdSchema.nullable(),
}).strict();
