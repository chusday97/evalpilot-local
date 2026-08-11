import { z } from 'zod';
import { storageIdSchema } from '../eval-set/schemas.js';

export const evaluationNextActionTypeSchema = z.enum(['no_action', 'run_remaining_cases', 'rerun_case', 'wait_and_resume', 'provide_human_input', 'review_candidate_finding', 'confirm_product_failure', 'create_fix_task', 'retest_fix', 'add_to_regression']);
const nextActionCtaSchema = z.object({ label: z.string().min(1), route: z.string().startsWith('/') }).strict();
export const evaluationNextActionSchema = z.object({
  type: evaluationNextActionTypeSchema,
  title: z.string().min(1),
  explanation: z.string().min(1),
  targetCaseIds: z.array(storageIdSchema),
  targetFindingIds: z.array(storageIdSchema),
  targetBadcaseIds: z.array(storageIdSchema),
  primaryCta: nextActionCtaSchema.nullable(),
  secondaryCtas: z.array(nextActionCtaSchema),
}).strict();
