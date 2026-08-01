import { z } from 'zod';
import { evalVerdictSchema, storageIdSchema } from '../eval-set/schemas.js';

export const rootCauseHypothesisSchema = z.object({
  hypothesis: z.string().min(1),
  confidence: z.number().min(0).max(1),
  supportingEvidence: z.array(z.string().min(1)),
  contradictingEvidence: z.array(z.string().min(1)),
  howToVerify: z.array(z.string().min(1)).min(1),
}).strict();

export const deterministicCheckResultSchema = z.object({
  assertionId: storageIdSchema,
  verdict: evalVerdictSchema,
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
}).strict();

export const deterministicJudgeResultSchema = z.object({
  checks: z.array(deterministicCheckResultSchema),
  hardFailure: z.boolean(),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']).nullable(),
  evidenceRefs: z.array(z.string().min(1)),
}).strict();

export const semanticJudgeResultSchema = z.object({
  verdict: evalVerdictSchema,
  taskCompletion: z.enum(['complete', 'partial', 'failed', 'unknown']),
  summary: z.string().min(1),
  whatWorked: z.array(z.string().min(1)),
  whatFailed: z.array(z.string().min(1)),
  whyItMatters: z.array(z.string().min(1)),
  confirmedFacts: z.array(z.string().min(1)),
  hypotheses: z.array(rootCauseHypothesisSchema),
  unknowns: z.array(z.string().min(1)),
  evidenceRefs: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
}).strict();

export const evalCaseResultSchema = z.object({
  runId: storageIdSchema,
  caseId: storageIdSchema,
  verdict: evalVerdictSchema,
  failureSource: z.enum(['product', 'evaluator', 'unknown']).nullable(),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']).nullable(),
  deterministic: deterministicJudgeResultSchema,
  semantic: semanticJudgeResultSchema,
  evidencePacketPath: z.string().min(1),
  createdAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if (value.verdict === 'pass' && (value.failureSource !== null || value.severity !== null)) {
    context.addIssue({ code: 'custom', path: ['failureSource'], message: 'PASS 不能包含失败来源或严重度。' });
  }
  if (value.failureSource === 'evaluator' && value.verdict !== 'inconclusive') {
    context.addIssue({ code: 'custom', path: ['failureSource'], message: 'Evaluator Failure 必须返回 inconclusive。' });
  }
});
