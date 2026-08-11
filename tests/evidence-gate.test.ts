import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { DeterministicJudgeResult, EvalCase, EvidencePacket, ProductModel, SemanticJudgeResult } from '../types.js';
import { classifyEvalFailure } from '../src/badcase/classifier.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { mergeJudgeVerdicts } from '../src/judge/verdict-merger.js';
import { calculateEvidenceCompleteness, saveAgentEvidence } from '../src/test-agent/evidence-packet.js';
import { runAdaptiveCase } from '../src/evaluation/adaptive-evaluation-service.js';
import { evidencePacketSchema } from '../src/test-agent/schemas.js';

const now = '2026-08-08T14:00:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-evidence', projectId: 'project-evidence', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'evidence fixture' }, capabilityId: 'cap-evidence', taskId: null,
    title: '保存结果', hypothesis: '完成后显示 Saved', persona: { personaId: 'persona-new', name: '新用户', behaviorPolicy: ['只使用可见控件'] }, goal: '保存结果', knownInformation: {}, preconditions: [],
    oracle: { expectedOutcome: ['显示 Saved'], mustObserve: ['Saved'], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['用户能确认保存'], deterministicAssertions: [], inconclusiveWhen: ['证据不完整'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-evidence' }], riskLevel: 'P1', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function completePacket(): EvidencePacket {
  const packet: EvidencePacket = {
    runId: 'run-evidence', caseId: 'case-evidence', targetAppCommit: null, actorModel: 'mock', actorPromptVersion: '1', startedAt: now, completedAt: now,
    actions: [{ actionId: 'agent-action-001', type: 'click', timestampMs: 1, page: '/', target: 'E001', inputField: null, inputLength: null, inputFingerprint: null, outcome: '保存完成', evidence: ['step-001-before.png', 'step-001-after.png'] }],
    observations: [
      { observationId: 'observation-001-before', pageUrl: 'http://127.0.0.1/', pagePurpose: 'Save', visibleStateSummary: 'Save', primaryAreas: ['Save'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['step-001-before.png'], confidence: 1 },
      { observationId: 'observation-001-after', pageUrl: 'http://127.0.0.1/', pagePurpose: 'Saved', visibleStateSummary: 'Saved', primaryAreas: ['Saved'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['step-001-after.png'], confidence: 1 },
    ],
    stepVerifications: [{ verificationId: 'verification-001', expectation: '显示 Saved', observed: 'Saved', status: 'confirmed', evidenceRefs: ['step-001-after.png'], confidence: 1 }],
    stepEvidence: [{ stepIndex: 1, beforeObservationId: 'observation-001-before', afterObservationId: 'observation-001-after', beforeScreenshotPath: 'step-001-before.png', afterScreenshotPath: 'step-001-after.png', decisionId: 'decision-001', verificationId: 'verification-001', actionStatus: 'executed', taskState: null, taskWait: null }],
    screenshots: ['step-001-before.png', 'step-001-after.png'], tracePath: 'trace.zip', evidenceCompleteness: { complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] },
    consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://127.0.0.1/', visibleTextSummary: 'Saved' },
    versions: { targetAppGitSha: null, productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: '0.5.0-alpha.1', actorModel: 'mock', judgeModel: 'mock', actorPromptVersion: '1', judgePromptVersion: '1', toolSchemaVersion: '1', timestamp: now },
  };
  return packet;
}

const deterministic: DeterministicJudgeResult = { checks: [], hardFailure: false, severity: null, evidenceRefs: [] };
const semantic: SemanticJudgeResult = { verdict: 'pass', taskCompletion: 'complete', summary: '保存完成。', whatWorked: ['Saved 可见'], whatFailed: [], whyItMatters: [], confirmedFacts: ['Saved 可见'], hypotheses: [], unknowns: [], evidenceRefs: ['step-001-after.png'], confidence: 0.95 };

function verdict(packet: EvidencePacket) {
  return mergeJudgeVerdicts({ evalCase: evalCase(), packet, deterministic, semantic, semanticEvaluatorFailed: false, createdAt: now });
}

describe('Evidence completeness gate', () => {
  it('makes a missing before screenshot evaluator inconclusive', () => {
    const packet = completePacket(); packet.screenshots = ['step-001-after.png'];
    expect(verdict(packet)).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator', semantic: { confirmedFacts: [], confidence: 0 } });
  });

  it('makes a missing after screenshot evaluator inconclusive', () => {
    const packet = completePacket(); packet.screenshots = ['step-001-before.png'];
    expect(verdict(packet)).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator' });
  });

  it('rejects fewer verifications than executed actions', () => {
    const packet = completePacket(); packet.stepVerifications = [];
    expect(calculateEvidenceCompleteness(packet)).toMatchObject({ complete: false, hasStepVerifications: false });
    expect(verdict(packet)).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator' });
  });

  it('allows the Judge to continue only for a complete packet', () => {
    expect(calculateEvidenceCompleteness(completePacket())).toEqual({ complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] });
    expect(verdict(completePacket())).toMatchObject({ verdict: 'pass', failureSource: null });
  });

  it('persists a readable packet with missing Trace and never classifies it as a Product Badcase', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-evidence-missing-trace-'));
    const packet = completePacket(); packet.tracePath = null; packet.evidenceCompleteness = calculateEvidenceCompleteness(packet);
    const path = await saveAgentEvidence(outputDir, packet, [{ decisionId: 'decision-001', intentSummary: '保存', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Saved', confidence: 1 }]);
    const persisted = JSON.parse(await readFile(path, 'utf8')) as EvidencePacket;
    const result = verdict(persisted);
    expect(persisted.evidenceCompleteness).toMatchObject({ complete: false, hasTrace: false, missing: [expect.stringContaining('Trace')] });
    expect(result).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator' });
    expect(classifyEvalFailure(evalCase(), result).kind).toBe('evaluator');
  });

  it('reads a legacy packet as incomplete without rewriting or promoting it', () => {
    const current = completePacket();
    const { stepEvidence: _stepEvidence, evidenceCompleteness: _completeness, ...legacy } = current;
    const legacyPacket = evidencePacketSchema.parse({
      ...legacy,
      observations: legacy.observations.map(({ observationId: _id, ...observation }) => observation),
      stepVerifications: legacy.stepVerifications.map(({ verificationId: _id, ...verification }) => verification),
    });
    expect(legacyPacket.evidenceCompleteness).toMatchObject({ complete: false, hasBeforeAfterScreenshots: false, hasStepVerifications: false });
    expect(verdict(legacyPacket)).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator' });
  });

  it('reads pre-monitor StepEvidence without inventing a historical task state', () => {
    const current = completePacket();
    const withoutTaskState = { ...current, stepEvidence: current.stepEvidence.map(({ taskState: _taskState, ...step }) => step) };
    const compatible = evidencePacketSchema.parse(withoutTaskState);
    expect(compatible.stepEvidence[0]?.taskState).toBeNull();
  });

  it('reads pre-Phase-3 StepEvidence without inventing a wait policy or Persona cost', () => {
    const current = completePacket();
    const withoutTaskWait = { ...current, stepEvidence: current.stepEvidence.map(({ taskWait: _taskWait, ...step }) => step) };
    const compatible = evidencePacketSchema.parse(withoutTaskWait);
    expect(compatible.stepEvidence[0]?.taskWait).toBeNull();
  });
});

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('Evidence gate browser capture', () => {
  it('keeps the run readable when Trace stop fails and links finish to a final screenshot', async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(); const page = await context.newPage();
    await page.setContent('<main><h1>Saved</h1></main>');
    const tracing = context.tracing as typeof context.tracing & { stop: typeof context.tracing.stop };
    tracing.stop = async () => { throw new Error('fixture trace write failed'); };
    const provider = new MockAiProvider((request) => request.task === 'semantic_judge'
      ? { verdict: 'fail', taskCompletion: 'failed', summary: '产品似乎失败', whatWorked: [], whatFailed: ['无法保存'], whyItMatters: ['用户卡住'], confirmedFacts: ['模型声称失败'], hypotheses: [], unknowns: [], evidenceRefs: ['step-001-after.png'], confidence: 0.99 }
      : { intentSummary: '已完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Saved', confidence: 1 });
    const model: ProductModel = { projectId: 'project-evidence', version: 1, generatedAt: now, productName: 'Evidence', productType: 'Web', targetUsers: [], capabilities: [{ capabilityId: 'cap-evidence', name: '保存', description: '保存结果', routes: ['/'], entryPoints: ['/'], userGoals: ['保存'], supportedTasks: [], importance: 'critical', evidenceStatus: 'declared', evidence: [], needsHumanReview: false }], userTasks: [], businessRules: [], knownRisks: [], unknowns: [], evidence: [] };
    const outcome = await runAdaptiveCase({ page, provider, outputDir: await mkdtemp(join(tmpdir(), 'evalpilot-trace-failure-')), evalCase: evalCase(), productModel: model, existingCases: [evalCase()], startingUrl: page.url(), evalSetVersion: 1, now: () => new Date(now) });
    const packet = JSON.parse(await readFile(outcome.agentRun.evidencePacketPath, 'utf8')) as EvidencePacket;
    expect(outcome.agentRun).toMatchObject({ status: 'inconclusive', failureSource: 'evaluator' });
    expect(outcome.result).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator' });
    expect(outcome.badcase).toBeNull();
    expect(packet.stepEvidence[0]?.afterScreenshotPath).toMatch(/step-001-after\.png$/);
    expect(packet.evidenceCompleteness).toMatchObject({ complete: false, hasTrace: false });
    await browser.close();
  });
});
