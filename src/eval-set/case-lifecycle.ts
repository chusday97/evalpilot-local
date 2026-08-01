import type { EvalCase, EvalCaseResult } from '../../types.js';
import { evalCaseSchema } from './schemas.js';

export function recordCaseResult(evalCase: EvalCase, result: EvalCaseResult): EvalCase {
  if (result.caseId !== evalCase.caseId) throw new Error('不能把其他案例的结果写入当前案例统计。');
  return evalCaseSchema.parse({
    ...evalCase,
    stats: {
      ...evalCase.stats,
      passCount: evalCase.stats.passCount + (result.verdict === 'pass' ? 1 : 0),
      failCount: evalCase.stats.failCount + (result.verdict === 'fail' ? 1 : 0),
      inconclusiveCount: evalCase.stats.inconclusiveCount + (result.verdict === 'inconclusive' ? 1 : 0),
      latestResult: result.verdict,
      latestRunId: result.runId,
      lastExecutedAt: result.createdAt,
    },
    updatedAt: result.createdAt,
  });
}
