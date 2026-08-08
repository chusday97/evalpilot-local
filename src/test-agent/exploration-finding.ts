import type { EvalCase, EvalCaseResult, ExplorationFinding, ExplorationHypothesis, ProductModel } from '../../types.js';
import { evalCaseSchema, explorationFindingSchema } from '../eval-set/schemas.js';
import { defaultPersonaRef } from '../eval-set/persona-policy.js';

export function createExplorationFinding(input: {
  hypothesis: ExplorationHypothesis;
  result: EvalCaseResult;
  summary: string;
  uniqueCoverageContribution: number;
  reusable: boolean;
}): ExplorationFinding {
  const evidenceRefs = [...new Set([...input.result.deterministic.evidenceRefs, ...input.result.semantic.evidenceRefs])];
  const promotionEligible = evidenceRefs.length > 0 && input.reusable && (input.result.verdict === 'fail' || input.uniqueCoverageContribution > 0);
  return explorationFindingSchema.parse({
    findingId: `finding-${input.result.runId}`,
    hypothesisId: input.hypothesis.hypothesisId,
    verdict: input.result.verdict,
    summary: input.summary,
    evidenceRefs,
    uniqueCoverageContribution: input.uniqueCoverageContribution,
    reusable: input.reusable,
    promotionEligible,
    promotionReason: promotionEligible ? '证据可复核，并且可形成可重复检查。' : '缺少直接证据、新覆盖或可复用检查条件。',
  });
}

export function promoteExplorationFinding(input: {
  projectModel: ProductModel;
  hypothesis: ExplorationHypothesis;
  finding: ExplorationFinding;
  createdAt?: string;
}): EvalCase {
  if (!input.finding.promotionEligible) throw new Error('该探索发现尚不满足候选案例晋升门禁。');
  const createdAt = input.createdAt ?? new Date().toISOString();
  const task = input.projectModel.userTasks.find((item) => item.capabilityId === input.hypothesis.capabilityId);
  const user = input.projectModel.targetUsers[0];
  return evalCaseSchema.parse({
    caseId: `case-exploratory-${input.finding.findingId.replace(/^finding-/, '')}`,
    projectId: input.projectModel.projectId,
    setType: 'exploratory',
    status: 'candidate',
    origin: { type: 'human', note: `由探索发现 ${input.finding.findingId} 显式晋升` },
    capabilityId: input.hypothesis.capabilityId,
    taskId: task?.taskId ?? null,
    title: input.hypothesis.title,
    hypothesis: input.hypothesis.rationale,
    persona: defaultPersonaRef(user?.userTypeId ?? 'user-general', user?.name ?? '普通用户', ['只使用页面可见信息', '遇到高风险操作立即停止'], { privacySensitivity: 'high', exitConditions: ['遇到高风险或敏感信息要求时退出', '证据不足时退出'] }),
    goal: input.hypothesis.goal,
    knownInformation: {},
    preconditions: task?.preconditions ?? [],
    oracle: {
      expectedOutcome: task?.successConditions.length ? task.successConditions : [input.hypothesis.goal],
      mustObserve: task?.successConditions.length ? task.successConditions : [input.hypothesis.goal],
      mustNotObserve: ['不可恢复错误', '未经确认的高风险操作'],
      businessRules: [],
      semanticRubric: ['目标是否在可见证据中完成', '用户是否得到明确反馈'],
      deterministicAssertions: [],
      inconclusiveWhen: ['页面证据不足', '测试前置条件不满足', '评测器或模型失败'],
    },
    coverageDimensions: input.hypothesis.coverageDimensions,
    riskLevel: input.hypothesis.riskLevel,
    generationReason: `探索发现 ${input.finding.findingId} 贡献 ${input.finding.uniqueCoverageContribution} 个新覆盖单元。`,
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: input.finding.uniqueCoverageContribution, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: true,
    createdAt,
    updatedAt: createdAt,
  });
}
