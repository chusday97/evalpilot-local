import type { EvalCase, EvalCaseResult, PassAnalysis, ProductModel } from '../../types.js';
import { generateChallengeCandidates } from './challenge-generator.js';
import { analyzeCoverage } from './coverage-analyzer.js';
import { passAnalysisSchema } from './schemas.js';

export function analyzePassingCase(input: { evalCase: EvalCase; result: EvalCaseResult; model: ProductModel; existingCases: EvalCase[]; generatedAt?: string }): PassAnalysis {
  if (input.result.verdict !== 'pass' || input.result.failureSource !== null) throw new Error('只有可信 PASS 可以触发覆盖与 Challenge 分析。');
  if (input.result.caseId !== input.evalCase.caseId) throw new Error('PASS 分析必须使用对应案例的运行结果。');
  const matrix = analyzeCoverage(input.model, input.existingCases, input.generatedAt);
  return passAnalysisSchema.parse({
    confirmedConditions: input.evalCase.coverageDimensions,
    remainingGaps: matrix.gaps,
    challengeCandidates: generateChallengeCandidates(input.evalCase, input.model, matrix.gaps, input.generatedAt),
  });
}
