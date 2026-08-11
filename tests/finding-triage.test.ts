import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalCaseResult, EvidencePacket } from '../types.js';
import { listBadcases } from '../src/badcase/badcase-store.js';
import { saveEvalCase } from '../src/eval-set/eval-set-store.js';
import { confirmProductFailure, dismissFinding, triageEvalCaseFinding } from '../src/findings/finding-triage.js';
import { listFindings } from '../src/findings/finding-store.js';

const now = '2026-08-08T16:00:00.000Z';

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    caseId: 'case-triage', projectId: 'project-triage', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'fixture' }, capabilityId: 'cap-triage', taskId: null, title: '保存设置', hypothesis: '保存后出现成功状态', persona: { personaId: 'persona-new', name: '新用户', behaviorPolicy: ['只使用可见控件'] }, goal: '保存设置', knownInformation: {}, preconditions: [],
    oracle: { expectedOutcome: ['显示 Saved'], mustObserve: ['Saved'], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['用户能确认保存完成'], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] }, coverageDimensions: [{ dimension: 'capability', value: 'cap-triage' }], riskLevel: 'P1', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now, ...overrides,
  };
}

function packet(runId: string): EvidencePacket {
  return {
    runId, caseId: 'case-triage', targetAppCommit: null, actorModel: 'mock', actorPromptVersion: '1', startedAt: now, completedAt: now,
    actions: [{ actionId: 'action-001', type: 'click', timestampMs: 1, page: '/', target: 'E001', inputField: null, inputLength: null, inputFingerprint: null, outcome: '页面没有反馈', evidence: ['before.png', 'after.png'] }],
    observations: [{ observationId: 'before', pageUrl: 'http://127.0.0.1/', pagePurpose: '设置', visibleStateSummary: '保存按钮', primaryAreas: ['设置'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['before.png'], confidence: 1 }, { observationId: 'after', pageUrl: 'http://127.0.0.1/', pagePurpose: '设置', visibleStateSummary: '仍显示保存按钮', primaryAreas: ['设置'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['after.png'], confidence: 1 }],
    stepVerifications: [{ verificationId: 'verification-001', expectation: '显示 Saved', observed: '没有 Saved', status: 'not_confirmed', evidenceRefs: ['after.png'], confidence: 1 }],
    stepEvidence: [{ stepIndex: 1, beforeObservationId: 'before', afterObservationId: 'after', beforeScreenshotPath: 'before.png', afterScreenshotPath: 'after.png', decisionId: 'decision-001', verificationId: 'verification-001', actionStatus: 'executed', taskState: null }],
    screenshots: ['before.png', 'after.png'], tracePath: 'trace.zip', evidenceCompleteness: { complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] }, consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://127.0.0.1/', visibleTextSummary: '仍显示保存按钮' },
    versions: { targetAppGitSha: null, productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: '0.5.0-alpha.1', actorModel: 'mock', judgeModel: 'mock', actorPromptVersion: '1', judgePromptVersion: '1', toolSchemaVersion: '1', timestamp: now },
  };
}

function semanticFailure(runId: string, confidence: number, refs = ['after.png']): EvalCaseResult {
  return {
    runId, caseId: 'case-triage', verdict: 'inconclusive', failureSource: 'unknown', severity: null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: [] },
    semantic: { verdict: 'fail', taskCompletion: 'failed', summary: '点击保存后页面没有反馈', whatWorked: ['保存按钮可点击'], whatFailed: ['点击后页面没有反馈'], whyItMatters: ['用户无法确认保存是否成功'], confirmedFacts: ['点击已经执行'], hypotheses: [], unknowns: ['尚未定位代码原因'], evidenceRefs: refs, confidence },
    evidencePacketPath: `runs/${runId}/evidence-packet.json`, createdAt: now,
  };
}

async function output(prefix: string): Promise<string> { return mkdtemp(join(tmpdir(), prefix)); }

describe('Finding triage gates', () => {
  it('keeps a 0.60 semantic failure as candidate only', async () => {
    const outputDir = await output('evalpilot-finding-low-');
    const outcome = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result: semanticFailure('run-low', 0.6), packet: packet('run-low'), createdAt: now });
    expect(outcome).toMatchObject({ result: { verdict: 'inconclusive', failureSource: 'unknown' }, finding: { status: 'candidate' }, badcase: null });
    expect(await listBadcases(outputDir)).toHaveLength(0);
  });

  it('keeps 0.95 confidence with one evidence type as candidate only', async () => {
    const outputDir = await output('evalpilot-finding-one-type-');
    const outcome = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result: semanticFailure('run-one-type', 0.95, ['before.png', 'after.png']), packet: packet('run-one-type'), createdAt: now });
    expect(outcome.finding).toMatchObject({ status: 'candidate', independentEvidenceTypes: ['screenshot'] });
    expect(outcome.badcase).toBeNull();
  });

  it('confirms high-confidence semantic failure only with two independent evidence types', async () => {
    const outputDir = await output('evalpilot-finding-two-types-'); const evidence = packet('run-two-types'); evidence.networkEvidence = ['POST /api/save 500']; evidence.consoleEvidence = ['SaveError'];
    const outcome = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result: semanticFailure('run-two-types', 0.95, ['POST /api/save 500', 'SaveError']), packet: evidence, createdAt: now });
    expect(outcome).toMatchObject({ result: { verdict: 'fail', failureSource: 'product' }, finding: { status: 'confirmed_product_failure', independentEvidenceTypes: ['network', 'console'] }, badcase: { runId: 'run-two-types' } });
  });

  it('confirms deterministic hard failure with complete evidence and creates Badcase', async () => {
    const outputDir = await output('evalpilot-finding-hard-'); const result = semanticFailure('run-hard', 0.2);
    result.verdict = 'fail'; result.failureSource = 'product'; result.severity = 'P1'; result.deterministic = { checks: [{ assertionId: 'assert-saved', verdict: 'fail', summary: 'Saved 不可见', evidenceRefs: ['after.png'] }], hardFailure: true, severity: 'P1', evidenceRefs: ['after.png'] };
    const outcome = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result, packet: packet('run-hard'), createdAt: now });
    expect(outcome).toMatchObject({ finding: { status: 'confirmed_product_failure', deterministicSupport: true }, badcase: { runId: 'run-hard' } });
  });

  it('keeps cases requiring human review out of automatic product failure', async () => {
    const outputDir = await output('evalpilot-finding-review-'); const evidence = packet('run-review'); evidence.networkEvidence = ['POST /api/save 500']; evidence.consoleEvidence = ['SaveError'];
    const outcome = await triageEvalCaseFinding({ outputDir, evalCase: evalCase({ needsHumanReview: true }), result: semanticFailure('run-review', 0.99, ['POST /api/save 500', 'SaveError']), packet: evidence, createdAt: now });
    expect(outcome).toMatchObject({ result: { verdict: 'inconclusive' }, finding: { status: 'needs_human_review' }, badcase: null });
  });

  it('confirms the same stable observed failure after two independent complete runs', async () => {
    const outputDir = await output('evalpilot-finding-repeat-');
    await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result: semanticFailure('run-repeat-1', 0.6), packet: packet('run-repeat-1'), createdAt: now });
    const second = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result: semanticFailure('run-repeat-2', 0.6), packet: packet('run-repeat-2'), createdAt: '2026-08-08T16:05:00.000Z' });
    expect(second).toMatchObject({ result: { verdict: 'fail', failureSource: 'product' }, finding: { status: 'confirmed_product_failure' }, badcase: { runId: 'run-repeat-2' } });
  });

  it('stores provider errors as evaluator failures without a candidate product finding', async () => {
    const outputDir = await output('evalpilot-finding-provider-'); const result = semanticFailure('run-provider', 0); result.failureSource = 'evaluator'; result.semantic.verdict = 'inconclusive';
    const outcome = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result, packet: packet('run-provider'), createdAt: now });
    expect(outcome).toMatchObject({ finding: { status: 'evaluator_failure' }, badcase: null });
    expect((await listFindings(outputDir)).filter((item) => item.status === 'candidate')).toHaveLength(0);
  });

  it('creates a Badcase only after explicit human confirmation', async () => {
    const outputDir = await output('evalpilot-finding-confirm-'); await saveEvalCase(outputDir, evalCase());
    const candidate = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result: semanticFailure('run-confirm', 0.6), packet: packet('run-confirm'), createdAt: now });
    const confirmed = await confirmProductFailure(outputDir, candidate.finding!.findingId, '2026-08-08T16:10:00.000Z');
    expect(confirmed).toMatchObject({ finding: { status: 'confirmed_product_failure' }, badcase: { runId: 'run-confirm' } });
    await expect(confirmProductFailure(outputDir, candidate.finding!.findingId)).resolves.toMatchObject({ badcase: { badcaseId: 'badcase-run-confirm' } });
  });

  it('dismisses a candidate without creating Badcase', async () => {
    const outputDir = await output('evalpilot-finding-dismiss-');
    const candidate = await triageEvalCaseFinding({ outputDir, evalCase: evalCase(), result: semanticFailure('run-dismiss', 0.6), packet: packet('run-dismiss'), createdAt: now });
    await expect(dismissFinding(outputDir, candidate.finding!.findingId)).resolves.toMatchObject({ status: 'dismissed' });
    expect(await listBadcases(outputDir)).toHaveLength(0);
  });
});
