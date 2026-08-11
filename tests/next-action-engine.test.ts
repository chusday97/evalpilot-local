import { describe, expect, it } from 'vitest';
import type { Badcase, CandidateFinding, EvalCase, EvalCaseResult, EvidencePacket, FixTask } from '../types.js';
import { decideEvaluationNextAction } from '../src/decision/next-action-engine.js';
import type { EvaluationDecisionInput } from '../src/decision/types.js';

const now = '2026-08-11T08:00:00.000Z';

function evalCase(id: string, overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    caseId: id, projectId: 'project-next', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'fixture' }, capabilityId: `cap-${id}`, taskId: null, title: id, hypothesis: '任务可完成',
    persona: { personaId: 'persona-new', name: '新用户', behaviorPolicy: ['只使用可见控件'] }, goal: '完成任务', knownInformation: {}, preconditions: [],
    oracle: { expectedOutcome: ['完成'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] }, coverageDimensions: [{ dimension: 'capability', value: `cap-${id}` }], riskLevel: 'P1', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now, ...overrides,
  };
}

function result(caseId: string, verdict: EvalCaseResult['verdict'] = 'pass', failureSource: EvalCaseResult['failureSource'] = null): EvalCaseResult {
  return {
    runId: `run-${caseId}`, caseId, verdict, failureSource, severity: verdict === 'fail' ? 'P1' : null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: [] },
    semantic: { verdict, taskCompletion: verdict === 'pass' ? 'complete' : 'unknown', summary: 'fixture', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: verdict === 'inconclusive' ? ['业务规则未知'] : [], evidenceRefs: [], confidence: 1 },
    evidencePacketPath: `runs/run-${caseId}/evidence-packet.json`, createdAt: now,
  };
}

function finding(status: CandidateFinding['status'], caseId = 'case-a'): CandidateFinding {
  return { findingId: `finding-${status}`, projectId: 'project-next', caseId, runId: `run-${caseId}`, title: '候选问题', summary: '页面没有形成可判断结果', status, semanticConfidence: 0.8, deterministicSupport: false, independentEvidenceTypes: ['screenshot'], confirmedFacts: ['操作已执行'], hypotheses: [], unknowns: ['原因未知'], evidenceRefs: ['after.png'], createdAt: now, updatedAt: now };
}

function badcase(overrides: Partial<Badcase> = {}): Badcase {
  return { badcaseId: 'badcase-a', projectId: 'project-next', caseId: 'case-a', runId: 'run-case-a', category: 'functional', title: '保存失败', observedFailure: '没有保存', userImpact: '用户无法完成任务', severity: 'P1', confirmedFacts: ['保存未发生'], rootCauseHypotheses: [], unknowns: [], evidenceRefs: ['after.png'], fixStatus: 'open', regressionCaseId: null, createdAt: now, updatedAt: now, ...overrides };
}

function fixTask(overrides: Partial<FixTask> = {}): FixTask {
  return { fixTaskId: 'fix-a', projectId: 'project-next', sourceType: 'confirmed_finding', evaluationId: 'evaluation-a', issueId: null, findingId: 'finding-confirmed_product_failure', badcaseId: null, sourceSnapshotPath: '/tmp/source.json', status: 'authorized', taskDirectory: '/tmp/fix-a', baselineCommit: 'abc', allowedScope: ['src/**'], verificationCommands: ['npm test'], retestCaseId: 'case-a', createdAt: now, authorizedAt: now, error: null, ...overrides };
}

function packetWithState(state: 'pending' | 'progressing'): EvidencePacket {
  return {
    runId: 'run-case-a', caseId: 'case-a', targetAppCommit: null, actorModel: 'mock', actorPromptVersion: '1', startedAt: now, completedAt: now, actions: [], observations: [], stepVerifications: [],
    stepEvidence: [{ stepIndex: 1, beforeObservationId: 'before', afterObservationId: 'after', beforeScreenshotPath: 'before.png', afterScreenshotPath: 'after.png', decisionId: 'decision-1', verificationId: 'verification-1', actionStatus: 'executed', taskState: { state, progressSignals: [], completionSignals: [], failureSignals: [], loadingSignals: ['处理中'], networkActivity: 'active', elapsedMs: 100, lastProgressAtMs: state === 'progressing' ? 100 : null, confidence: 1, evidenceRefs: ['after.png'] }, taskWait: null }],
    screenshots: [], tracePath: null, evidenceCompleteness: { complete: false, hasInitialObservation: true, hasFinalObservation: false, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: false, missing: ['任务尚未完成'] }, consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://127.0.0.1/', visibleTextSummary: '处理中' }, versions: { targetAppGitSha: null, productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: 'test', actorModel: 'mock', judgeModel: 'mock', actorPromptVersion: '1', judgePromptVersion: '1', toolSchemaVersion: '1', timestamp: now },
  };
}

function input(overrides: Partial<EvaluationDecisionInput> = {}): EvaluationDecisionInput {
  return { evaluationId: 'evaluation-a', evaluationStatus: 'completed', selectedCases: [evalCase('case-a')], results: [result('case-a')], findings: [], badcases: [], fixTasks: [], evidencePackets: [], ...overrides };
}

describe('single evaluation next action', () => {
  it('returns no action when every critical case passed', () => {
    expect(decideEvaluationNextAction(input())).toMatchObject({ type: 'no_action', primaryCta: null });
  });

  it('runs selected cases that have no result', () => {
    expect(decideEvaluationNextAction(input({ selectedCases: [evalCase('case-a'), evalCase('case-b')], results: [result('case-a')] }))).toMatchObject({ type: 'run_remaining_cases', targetCaseIds: ['case-b'] });
  });

  it('reruns evaluator failures instead of treating them as product failures', () => {
    expect(decideEvaluationNextAction(input({ results: [result('case-a', 'inconclusive', 'evaluator')] }))).toMatchObject({ type: 'rerun_case', targetCaseIds: ['case-a'] });
  });

  it('offers recovery when the evaluation runtime failed before a case result was saved', () => {
    expect(decideEvaluationNextAction(input({ evaluationStatus: 'failed', results: [] }))).toMatchObject({ type: 'rerun_case', primaryCta: { label: '重新评测' } });
  });

  it.each(['pending', 'progressing'] as const)('waits and resumes a %s task', (state) => {
    expect(decideEvaluationNextAction(input({ evidencePackets: [packetWithState(state)] }))).toMatchObject({ type: 'wait_and_resume', targetCaseIds: ['case-a'] });
  });

  it('requests human input for an unknown business rule', () => {
    expect(decideEvaluationNextAction(input({ selectedCases: [evalCase('case-a', { needsHumanReview: true })], results: [result('case-a', 'inconclusive', 'unknown')] }))).toMatchObject({ type: 'provide_human_input', targetCaseIds: ['case-a'] });
  });

  it('asks the user to review a candidate finding', () => {
    expect(decideEvaluationNextAction(input({ findings: [finding('candidate')] }))).toMatchObject({ type: 'review_candidate_finding', targetFindingIds: ['finding-candidate'] });
  });

  it('asks the user to confirm a finding that needs human review', () => {
    expect(decideEvaluationNextAction(input({ findings: [finding('needs_human_review')] }))).toMatchObject({ type: 'confirm_product_failure', targetFindingIds: ['finding-needs_human_review'] });
  });

  it('creates a fix task only after product failure is confirmed', () => {
    expect(decideEvaluationNextAction(input({ findings: [finding('confirmed_product_failure')], results: [result('case-a', 'fail', 'product')] }))).toMatchObject({ type: 'create_fix_task' });
  });

  it('retests an existing fix for a confirmed product failure', () => {
    expect(decideEvaluationNextAction(input({ findings: [finding('confirmed_product_failure')], fixTasks: [fixTask()], results: [result('case-a', 'fail', 'product')] }))).toMatchObject({ type: 'retest_fix' });
  });

  it('adds a fixed and retested badcase to regression', () => {
    expect(decideEvaluationNextAction(input({ badcases: [badcase({ fixStatus: 'fixed' })], results: [result('case-a')] }))).toMatchObject({ type: 'add_to_regression', targetBadcaseIds: ['badcase-a'] });
  });

  it('does not add a fixed badcase to regression before a passing retest exists', () => {
    expect(decideEvaluationNextAction(input({ badcases: [badcase({ fixStatus: 'fixed' })], results: [result('case-a', 'fail', 'product')] }))).toMatchObject({ type: 'retest_fix' });
  });

  it('never recommends code repair first when there is no confirmed product failure', () => {
    const next = decideEvaluationNextAction(input({ results: [result('case-a', 'inconclusive', 'evaluator')], fixTasks: [fixTask({ sourceType: 'evaluation_issue', findingId: null, issueId: 'legacy-issue' })] }));
    expect(next.type).toBe('rerun_case');
    expect(['create_fix_task', 'retest_fix', 'add_to_regression']).not.toContain(next.type);
  });
});
