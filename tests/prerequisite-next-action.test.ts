import { describe, expect, it } from 'vitest';
import type { CandidateFinding, EvalCase, EvalCaseResult } from '../types.js';
import { decideEvaluationNextAction } from '../src/decision/next-action-engine.js';
import type { EvaluationDecisionInput, EvaluationPrerequisiteBlocker } from '../src/decision/types.js';

const now = '2026-08-12T10:00:00.000Z';

function evalCase(id: string): EvalCase {
  return {
    caseId: id,
    projectId: 'project-guidance',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'prerequisite guidance fixture' },
    capabilityId: `cap-${id}`,
    taskId: null,
    title: id,
    hypothesis: '任务可完成',
    persona: { personaId: 'persona', name: '测试用户', behaviorPolicy: ['只执行安全操作'] },
    goal: '完成任务',
    knownInformation: {},
    preconditions: [],
    oracle: { expectedOutcome: ['完成'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] },
    coverageDimensions: [],
    riskLevel: 'P1',
    generationReason: 'fixture',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function result(caseId: string, verdict: EvalCaseResult['verdict'] = 'pass', failureSource: EvalCaseResult['failureSource'] = null): EvalCaseResult {
  return {
    runId: `run-${caseId}`,
    caseId,
    verdict,
    failureSource,
    severity: verdict === 'fail' ? 'P1' : null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: [] },
    semantic: { verdict, taskCompletion: verdict === 'pass' ? 'complete' : 'unknown', summary: 'fixture', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: [], evidenceRefs: [], confidence: 1 },
    evidencePacketPath: `runs/run-${caseId}/evidence-packet.json`,
    createdAt: now,
  };
}

function blocker(caseId: string, type: EvaluationPrerequisiteBlocker['type']): EvaluationPrerequisiteBlocker {
  return { caseId, type, summary: `fixture ${type}`, sourceValue: `source ${type}`, reasons: [`reason ${type}`] };
}

function finding(caseId: string): CandidateFinding {
  return {
    findingId: `finding-${caseId}`,
    projectId: 'project-guidance',
    caseId,
    runId: `run-${caseId}`,
    title: '已确认产品问题',
    summary: '功能确实失败',
    status: 'confirmed_product_failure',
    semanticConfidence: 0.95,
    deterministicSupport: true,
    independentEvidenceTypes: ['screenshot', 'dom'],
    confirmedFacts: ['操作已执行且结果错误'],
    hypotheses: [],
    unknowns: [],
    evidenceRefs: ['after.png'],
    createdAt: now,
    updatedAt: now,
  };
}

function input(overrides: Partial<EvaluationDecisionInput> = {}): EvaluationDecisionInput {
  return {
    evaluationId: 'evaluation-guidance',
    evaluationStatus: 'completed',
    selectedCases: [evalCase('case-a')],
    results: [],
    findings: [],
    badcases: [],
    fixTasks: [],
    evidencePackets: [],
    prerequisiteBlockers: [],
    ...overrides,
  };
}

describe('prerequisite next action guidance', () => {
  it('explains missing auth instead of telling the user to run remaining cases', () => {
    const next = decideEvaluationNextAction(input({ prerequisiteBlockers: [blocker('case-a', 'needs_auth')] }));
    expect(next).toMatchObject({ type: 'provide_human_input', title: '先准备测试登录态', targetCaseIds: ['case-a'] });
    expect(next.explanation).toContain('不要生成代码修复任务');
    expect(next.explanation).toContain('EVALPILOT_AUTH_STATE');
    expect(next.type).not.toBe('run_remaining_cases');
  });

  it.each([
    ['needs_human_input', '先补充真实业务判断'],
    ['unsupported', '先修正不可执行的评测任务'],
    ['needs_setup', '先补齐可验证的前置状态'],
    ['needs_test_data', '先准备兼容的安全测试数据'],
  ] as const)('maps %s to one concrete non-fix next step', (type, title) => {
    const next = decideEvaluationNextAction(input({ prerequisiteBlockers: [blocker('case-a', type)] }));
    expect(next).toMatchObject({ type: 'provide_human_input', title, targetCaseIds: ['case-a'] });
    expect(next.explanation).toContain('不要生成代码修复任务');
    expect(['create_fix_task', 'retest_fix', 'add_to_regression']).not.toContain(next.type);
  });

  it('shows only the earliest actionable prerequisite category', () => {
    const next = decideEvaluationNextAction(input({
      selectedCases: [evalCase('case-a'), evalCase('case-b'), evalCase('case-c')],
      prerequisiteBlockers: [
        blocker('case-a', 'needs_test_data'),
        blocker('case-b', 'needs_auth'),
        blocker('case-c', 'needs_setup'),
      ],
    }));
    expect(next).toMatchObject({ title: '先准备测试登录态', targetCaseIds: ['case-b'] });
  });

  it('keeps a confirmed product failure ahead of prerequisites from another case', () => {
    const next = decideEvaluationNextAction(input({
      selectedCases: [evalCase('case-a'), evalCase('case-b')],
      results: [result('case-a', 'fail', 'product')],
      findings: [finding('case-a')],
      prerequisiteBlockers: [blocker('case-b', 'needs_auth')],
    }));
    expect(next.type).toBe('create_fix_task');
    expect(next.targetCaseIds).toContain('case-a');
  });
});
