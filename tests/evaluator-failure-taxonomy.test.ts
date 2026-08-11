import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiTestAgentRun, EvalCase, EvalCaseResult, EvaluatorFailureCategory, EvidencePacket } from '../types.js';
import { classifyEvaluatorFailure, EVALUATOR_FAILURE_POSSIBLE_REASONS, EVALUATOR_FAILURE_USER_SUMMARY, evaluatorBadcaseFrom, evaluatorFailureResult } from '../src/evaluator-errors/classifier.js';
import { evaluatorBadcaseSchema } from '../src/evaluator-errors/schemas.js';
import { listEvaluatorBadcases, loadEvaluatorBadcase, saveEvaluatorBadcase } from '../src/evaluator-errors/store.js';
import { evaluatorBadcaseDocumentPath } from '../src/documentation/asset-documents.js';
import { triageEvalCaseFinding } from '../src/findings/finding-triage.js';

const now = '2026-08-11T08:00:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-taxonomy', projectId: 'project-demo', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'taxonomy fixture' }, capabilityId: 'cap-taxonomy', taskId: null, title: '完成主要任务', hypothesis: '任务可以完成',
    persona: { personaId: 'new-user', name: '新用户', knowledgeLevel: 'low', patienceTurns: 3, retryTolerance: 1, privacySensitivity: 'high', behaviorPolicy: ['只使用可见入口'], exitConditions: ['证据不足时退出'] }, goal: '完成主要任务', knownInformation: {}, preconditions: [],
    oracle: { expectedOutcome: ['结果可见'], mustObserve: [], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['用户能确认完成'], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] }, coverageDimensions: [{ dimension: 'capability', value: 'cap-taxonomy' }], riskLevel: 'P1', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function result(failureSource: EvalCaseResult['failureSource'] = 'evaluator'): EvalCaseResult {
  return {
    runId: 'run-taxonomy', caseId: 'case-taxonomy', verdict: 'inconclusive', failureSource, severity: null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['screenshots/after.png'] },
    semantic: { verdict: 'inconclusive', taskCompletion: 'unknown', summary: '无法判断', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: [], evidenceRefs: ['screenshots/after.png'], confidence: 0 },
    evidencePacketPath: 'runs/run-taxonomy/evidence-packet.json', createdAt: now,
  };
}

function packet(overrides: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    runId: 'run-taxonomy', caseId: 'case-taxonomy', targetAppCommit: null, actorModel: 'mock', actorPromptVersion: '1', startedAt: now, completedAt: now,
    actions: [], observations: [{ observationId: 'observation-1', pageUrl: 'http://127.0.0.1/', pagePurpose: '任务页', visibleStateSummary: '页面显示处理中', primaryAreas: [], visibleProblems: [], interactableElements: [{ elementId: 'E001', role: 'button', tagName: 'button', label: '继续', text: '继续', placeholder: null, disabled: false, risk: 'safe', locatorHint: 'grounded-index:0' }], formFields: [], evidenceRefs: ['screenshots/after.png'], confidence: 1 }],
    stepVerifications: [], stepEvidence: [], screenshots: ['screenshots/before.png', 'screenshots/after.png'], tracePath: 'runs/run-taxonomy/trace.zip', evidenceCompleteness: { complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] }, consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://127.0.0.1/', visibleTextSummary: '页面显示处理中' },
    versions: { targetAppGitSha: null, productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: 'test', actorModel: 'mock', judgeModel: 'mock', actorPromptVersion: '1', judgePromptVersion: '1', toolSchemaVersion: '1', timestamp: now },
    ...overrides,
  };
}

function run(overrides: Partial<AiTestAgentRun> = {}): AiTestAgentRun {
  return { runId: 'run-taxonomy', caseId: 'case-taxonomy', mode: 'task', status: 'inconclusive', failureSource: 'evaluator', decisions: [], actionResults: [], reflections: [], evidencePacketPath: 'runs/run-taxonomy/evidence-packet.json', startedAt: now, completedAt: now, error: null, ...overrides };
}

function category(agentRun: AiTestAgentRun, evidence = packet(), judged = result()): EvaluatorFailureCategory | null {
  return classifyEvaluatorFailure({ agentRun, packet: evidence, result: judged })?.category ?? null;
}

describe('Evaluator Failure taxonomy', () => {
  it('classifies every required evaluator-failure category from current-run evidence', () => {
    expect(category(run({ status: 'abandoned', decisions: [{ intentSummary: '没有下一步安全操作', action: 'abandon', targetElementId: null, value: null, expectedResult: '退出', confidence: 1 }] }), packet(), result('unknown'))).toBe('no_next_action');
    expect(category(run({ status: 'blocked_by_safety', actionResults: [{ status: 'blocked_by_safety', action: 'click', targetElementId: 'E001', summary: '高风险控件不支持自动操作', evidenceRefs: [] }] }))).toBe('unsupported_control');
    expect(category(run({ error: '模型输出无效：invalid JSON' }))).toBe('model_output_invalid');
    expect(category(run({ status: 'abandoned' }), packet({ observations: [{ ...packet().observations[0]!, interactableElements: [], formFields: [] }] }), result('unknown'))).toBe('insufficient_context');
    expect(category(run({ status: 'abandoned' }), packet(), result('unknown'))).toBe('ambiguous_page_state');
    expect(category(run(), packet({ stepEvidence: [{ stepIndex: 1, beforeObservationId: 'before', afterObservationId: 'after', beforeScreenshotPath: 'screenshots/before.png', afterScreenshotPath: 'screenshots/after.png', decisionId: 'decision-1', verificationId: 'verification-1', actionStatus: 'executed', taskState: { state: 'stalled', progressSignals: [], completionSignals: [], failureSignals: [], loadingSignals: [], networkActivity: 'idle', elapsedMs: 30_000, lastProgressAtMs: null, confidence: 1, evidenceRefs: ['screenshots/after.png'] }, taskWait: { operationType: 'unknown_async', policy: { initialObservationMs: 0, pollIntervalMs: 1000, softTimeoutMs: 8000, hardTimeoutMs: 30000, progressExtensionMs: 5000, maxProgressExtensions: 2 }, observations: [], extensionsUsed: 0, finalReason: 'hard_timeout', consumedPersonaAttempt: true } }] }))).toBe('wait_policy_exhausted');
    expect(category(run(), packet({ evidenceCompleteness: { complete: false, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: false, hasStepVerifications: false, hasTrace: true, missing: ['缺少动作前后截图'] } }))).toBe('evidence_missing');
    expect(category(run({ error: '导航不匹配：预期 URL 未到达' }))).toBe('navigation_mismatch');
    expect(category(run({ actionResults: [{ status: 'failed', action: 'click', targetElementId: 'E001', summary: 'Playwright click failed', evidenceRefs: [] }] }))).toBe('tool_execution_error');
    expect(category(run())).toBe('unknown');
  });

  it('uses novice copy and keeps evaluator failures out of Product Badcase', async () => {
    const classification = classifyEvaluatorFailure({ agentRun: run(), packet: packet(), result: result() })!;
    const normalized = evaluatorFailureResult(result(), classification);
    expect(normalized).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator', severity: null, semantic: { summary: EVALUATOR_FAILURE_USER_SUMMARY, unknowns: expect.arrayContaining([...EVALUATOR_FAILURE_POSSIBLE_REASONS]) } });
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-evaluator-failure-'));
    const triage = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result: normalized, packet: packet(), createdAt: now });
    expect(triage).toMatchObject({ finding: { status: 'evaluator_failure', title: EVALUATOR_FAILURE_USER_SUMMARY }, badcase: null });
  });

  it('stores schema-validated Evaluator Badcases in their own versioned lineage', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-evaluator-badcase-'));
    const classification = { category: 'no_next_action' as const, technicalReason: '没有找到安全下一步。' };
    const badcase = evaluatorBadcaseFrom({ evalCase: evalCase(), agentRun: run({ decisions: [{ intentSummary: '寻找继续入口', action: 'abandon', targetElementId: null, value: null, expectedResult: '找到下一步', confidence: 0.6 }] }), packet: packet(), classification });
    expect(evaluatorBadcaseSchema.parse(badcase)).toMatchObject({ resolved: false, regressionFixtureId: null, observedState: '页面显示处理中' });
    await saveEvaluatorBadcase(outputDir, badcase);
    expect(await loadEvaluatorBadcase(outputDir, badcase.evaluatorBadcaseId)).toEqual(badcase);
    expect(await listEvaluatorBadcases(outputDir)).toEqual([badcase]);
    const document = await readFile(evaluatorBadcaseDocumentPath(outputDir), 'utf8');
    expect(document).toContain(badcase.evaluatorBadcaseId);
    expect(document).toContain('它们不属于产品问题');
  });
});
