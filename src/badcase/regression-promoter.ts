import type { Badcase, EvalCase, EvalCaseResult } from '../../types.js';
import { saveEvalCase } from '../eval-set/eval-set-store.js';
import { evalCaseSchema } from '../eval-set/schemas.js';
import { saveBadcase } from './badcase-store.js';
import { badcaseSchema } from './schemas.js';

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

export async function promoteFixedBadcaseToRegression(input: {
  outputDir: string;
  badcase: Badcase;
  sourceCase: EvalCase;
  passingRetest: EvalCaseResult;
  fixedAt: string;
  fixTaskId?: string | null;
}): Promise<{ regressionCase: EvalCase; badcase: Badcase }> {
  if (input.badcase.fixStatus !== 'fixed') throw new Error('Badcase 必须先明确标记为 fixed。');
  if (input.passingRetest.verdict !== 'pass' || input.passingRetest.failureSource !== null) throw new Error('只有通过的复测结果可以晋升 Regression。');
  if (input.sourceCase.caseId !== input.badcase.caseId || input.passingRetest.caseId !== input.badcase.caseId) throw new Error('Regression 晋升必须复测同一个原始案例。');
  const regressionCase = evalCaseSchema.parse({
    ...input.sourceCase,
    caseId: `case-regression-${safeId(input.badcase.badcaseId)}`,
    setType: 'regression',
    status: 'stable',
    origin: { type: 'badcase', issueId: `issue-${input.badcase.badcaseId}`, badcaseId: input.badcase.badcaseId, firstFailedRunId: input.badcase.runId },
    generationReason: `Badcase ${input.badcase.badcaseId} 修复后，同一案例复测通过并晋升回归。`,
    version: 1,
    stats: { passCount: 1, failCount: 0, inconclusiveCount: 0, latestResult: 'pass', latestRunId: input.passingRetest.runId, uniqueCoverageContribution: input.sourceCase.stats.uniqueCoverageContribution, lastExecutedAt: input.passingRetest.createdAt },
    regressionMetadata: { badcaseId: input.badcase.badcaseId, issueId: `issue-${input.badcase.badcaseId}`, firstFailedAt: input.badcase.createdAt, fixedAt: input.fixedAt, originalFailure: input.badcase.observedFailure, sourceRunId: input.badcase.runId, fixTaskId: input.fixTaskId ?? null },
    retirementReason: null,
    updatedAt: input.fixedAt,
  });
  await saveEvalCase(input.outputDir, regressionCase);
  const updatedBadcase = badcaseSchema.parse({ ...input.badcase, regressionCaseId: regressionCase.caseId, updatedAt: input.fixedAt });
  await saveBadcase(input.outputDir, updatedBadcase);
  return { regressionCase, badcase: updatedBadcase };
}
