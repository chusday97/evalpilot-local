import { describe, expect, it } from 'vitest';
import type { EvalCaseResult, ExplorationHypothesis, ProductModel } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { createExplorationFinding, promoteExplorationFinding } from '../src/test-agent/exploration-finding.js';
import { planExploration } from '../src/test-agent/exploration-planner.js';

const now = '2026-08-01T15:00:00.000Z';
const evidence = [{ claim: '创建能力', sourceType: 'document' as const, source: 'README.md', status: 'declared' as const }];
const productModel: ProductModel = {
  projectId: 'project-demo', version: 1, generatedAt: now, productName: 'Demo', productType: 'Web',
  targetUsers: [{ userTypeId: 'user-new', name: '新用户', description: '首次用户', goals: ['创建'], evidenceStatus: 'declared', evidence, needsHumanReview: false }],
  capabilities: [{ capabilityId: 'cap-create', name: '创建', description: '创建项目', routes: ['/create'], entryPoints: ['/create'], userGoals: ['创建'], supportedTasks: ['task-create'], importance: 'critical', evidenceStatus: 'declared', evidence, needsHumanReview: false }],
  userTasks: [{ taskId: 'task-create', capabilityId: 'cap-create', name: '创建项目', goal: '创建项目', preconditions: [], successConditions: ['创建结果可见'], evidenceStatus: 'declared', evidence, needsHumanReview: false }],
  businessRules: [], knownRisks: [], unknowns: [], evidence,
};
const safeHypothesis: ExplorationHypothesis = {
  hypothesisId: 'hypothesis-create-retry', title: '失败后重新创建', rationale: '覆盖恢复路径', capabilityId: 'cap-create', goal: '从可恢复错误返回并完成创建', riskLevel: 'P1',
  coverageDimensions: [{ dimension: 'recovery', value: 'retry' }], safeActions: ['打开创建页', '填写合成名称', '重试'], status: 'proposed',
};
const result: EvalCaseResult = {
  runId: 'run-explore-1', caseId: 'transient-explore-1', verdict: 'fail', failureSource: 'product', severity: 'P1',
  deterministic: { checks: [], hardFailure: true, severity: 'P1', evidenceRefs: ['step-2.png'] },
  semantic: { verdict: 'fail', taskCompletion: 'failed', summary: '重试无反馈', whatWorked: [], whatFailed: ['重试无反馈'], whyItMatters: ['用户无法恢复'], confirmedFacts: ['点击后页面未变化'], hypotheses: [], unknowns: [], evidenceRefs: ['step-2.png'], confidence: 0.9 },
  evidencePacketPath: 'runs/run-explore-1/evidence-packet.json', createdAt: now,
};

describe('safe free exploration', () => {
  it('lets the provider formulate broad hypotheses without fixed paths', async () => {
    const provider = new MockAiProvider(() => ({ scopeSummary: '探索创建与恢复', hypotheses: [safeHypothesis], rejectedForSafety: [] }));
    const plan = await planExploration({ provider, productModel, gaps: [], scope: '公开页面与创建流程' });
    expect(plan.hypotheses).toEqual([safeHypothesis]);
    const prompt = provider.requests[0]!.userPrompt;
    expect(prompt).not.toContain('selector');
    expect(prompt).not.toContain('primaryPath');
    expect(prompt).toContain('公开页面与创建流程');
  });

  it('rejects destructive hypotheses before execution', async () => {
    const provider = new MockAiProvider(() => ({
      scopeSummary: '安全探索',
      hypotheses: [safeHypothesis, { ...safeHypothesis, hypothesisId: 'hypothesis-delete', title: '删除项目', goal: '删除项目', safeActions: ['点击删除'] }],
      rejectedForSafety: [],
    }));
    const plan = await planExploration({ provider, productModel, gaps: [], scope: '公开页面' });
    expect(plan.hypotheses).toHaveLength(1);
    expect(plan.rejectedForSafety[0]).toMatch(/高风险/);
  });

  it('promotes only an evidenced reusable finding to an exploratory candidate', () => {
    const finding = createExplorationFinding({ hypothesis: safeHypothesis, result, summary: '恢复入口无反馈', uniqueCoverageContribution: 1, reusable: true });
    expect(finding.promotionEligible).toBe(true);
    const candidate = promoteExplorationFinding({ projectModel: productModel, hypothesis: safeHypothesis, finding, createdAt: now });
    expect(candidate).toMatchObject({ setType: 'exploratory', status: 'candidate', needsHumanReview: true });
    expect(candidate.origin).toMatchObject({ type: 'human' });
  });

  it('keeps unsupported findings out of the Eval Set', () => {
    const finding = createExplorationFinding({ hypothesis: safeHypothesis, result: { ...result, deterministic: { ...result.deterministic, evidenceRefs: [] }, semantic: { ...result.semantic, evidenceRefs: [] } }, summary: '无证据', uniqueCoverageContribution: 0, reusable: false });
    expect(finding.promotionEligible).toBe(false);
    expect(() => promoteExplorationFinding({ projectModel: productModel, hypothesis: safeHypothesis, finding })).toThrow(/晋升门禁/);
  });
});
