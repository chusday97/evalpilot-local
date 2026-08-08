import type { Badcase, CandidateFinding, EvalCase, EvalCaseResult } from '../../types.js';
import { classifyEvalFailure } from './classifier.js';
import { rootCauseHypothesesFromResult } from './root-cause-analyzer.js';
import { saveBadcase } from './badcase-store.js';
import { badcaseSchema } from './schemas.js';
import { loadFinding } from '../findings/finding-store.js';

export function badcaseFromProductFailure(input: { evalCase: EvalCase; result: EvalCaseResult; finding: CandidateFinding; createdAt?: string }): Badcase {
  if (input.finding.status !== 'confirmed_product_failure'
    || input.finding.projectId !== input.evalCase.projectId
    || input.finding.caseId !== input.evalCase.caseId
    || input.finding.runId !== input.result.runId) {
    throw new Error('不能创建 Product Badcase：缺少与本次运行匹配的已确认 Finding。');
  }
  const classification = classifyEvalFailure(input.evalCase, input.result);
  if (classification.kind !== 'product' || !classification.category || input.result.verdict !== 'fail') {
    throw new Error(`不能创建 Product Badcase：${classification.reason}`);
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  return badcaseSchema.parse({
    badcaseId: `badcase-${input.result.runId}`,
    projectId: input.evalCase.projectId,
    caseId: input.evalCase.caseId,
    runId: input.result.runId,
    category: classification.category,
    title: input.result.semantic.summary,
    observedFailure: input.result.semantic.whatFailed.join('；') || input.result.deterministic.checks.filter((item) => item.verdict === 'fail').map((item) => item.summary).join('；'),
    userImpact: input.result.semantic.whyItMatters.join('；') || `用户无法完成：${input.evalCase.goal}`,
    severity: input.result.severity ?? input.evalCase.riskLevel,
    confirmedFacts: input.result.semantic.confirmedFacts,
    rootCauseHypotheses: rootCauseHypothesesFromResult(input.result),
    unknowns: input.result.semantic.unknowns,
    evidenceRefs: [...new Set([...input.result.deterministic.evidenceRefs, ...input.result.semantic.evidenceRefs, input.result.evidencePacketPath])],
    fixStatus: 'open',
    regressionCaseId: null,
    createdAt,
    updatedAt: createdAt,
  });
}

export async function createAndSaveBadcase(outputDir: string, input: { evalCase: EvalCase; result: EvalCaseResult; finding: CandidateFinding; createdAt?: string }): Promise<Badcase> {
  const persistedFinding = await loadFinding(outputDir, input.finding.findingId);
  if (persistedFinding.status !== 'confirmed_product_failure' || persistedFinding.updatedAt !== input.finding.updatedAt) {
    throw new Error('不能创建 Product Badcase：Finding 尚未以已确认状态原子保存。');
  }
  return saveBadcase(outputDir, badcaseFromProductFailure({ ...input, finding: persistedFinding }));
}

export async function markBadcaseFixed(outputDir: string, badcase: Badcase, fixedAt = new Date().toISOString()): Promise<Badcase> {
  return saveBadcase(outputDir, badcaseSchema.parse({ ...badcase, fixStatus: 'fixed', updatedAt: fixedAt }));
}
