import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, EvidencePacket, SemanticJudgeResult } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runDeterministicJudge } from '../src/judge/deterministic-judge.js';
import { judgeEvalCase } from '../src/judge/hybrid-judge.js';
import { mergeJudgeVerdicts } from '../src/judge/verdict-merger.js';

const now = '2026-08-01T10:00:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-result', projectId: 'project-fixture', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'judge fixture' }, capabilityId: 'cap-create', taskId: null,
    title: '显示结果', hypothesis: '提交后显示完成结果', persona: { personaId: 'persona-new', name: '新用户', behaviorPolicy: ['一次失败后寻找其他路径'] }, goal: '获得完成结果', knownInformation: {}, preconditions: [],
    oracle: { expectedOutcome: ['显示 Created'], mustObserve: ['Created'], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['用户能确认完成'], deterministicAssertions: [{ assertionId: 'assert-created', type: 'text_visible', target: 'Created', expected: true, negated: false }, { assertionId: 'assert-error', type: 'text_absent', target: 'Error', expected: true, negated: false }], inconclusiveWhen: ['页面证据缺失'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-create' }], riskLevel: 'P1', generationReason: 'judge fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function packet(text = 'Created. Your project is ready.'): EvidencePacket {
  return {
    runId: 'run-judge', caseId: 'case-result', targetAppCommit: null, actorModel: 'mock', actorPromptVersion: '1.0.0', startedAt: now, completedAt: now,
    actions: [{ actionId: 'agent-action-001', type: 'navigation', timestampMs: 1, page: '/result', target: null, inputField: null, inputLength: null, inputFingerprint: null, outcome: text, evidence: ['screenshots/step-001-before.png', 'screenshots/step-001-after.png'] }],
    observations: [{ observationId: 'observation-001-before', pageUrl: 'http://127.0.0.1/result', pagePurpose: 'Result', visibleStateSummary: '提交中', primaryAreas: ['Result'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['screenshots/step-001-before.png'], confidence: 1 }, { observationId: 'observation-001-after', pageUrl: 'http://127.0.0.1/result', pagePurpose: 'Result', visibleStateSummary: text, primaryAreas: ['Result'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['screenshots/step-001-after.png'], confidence: 1 }],
    stepVerifications: [{ verificationId: 'verification-001', expectation: '显示 Created', observed: text, status: text.includes('Created') ? 'confirmed' : 'not_confirmed', evidenceRefs: ['screenshots/step-001-after.png'], confidence: 1 }],
    stepEvidence: [{ stepIndex: 1, beforeObservationId: 'observation-001-before', afterObservationId: 'observation-001-after', beforeScreenshotPath: 'screenshots/step-001-before.png', afterScreenshotPath: 'screenshots/step-001-after.png', decisionId: 'decision-001', verificationId: 'verification-001', actionStatus: 'executed', taskState: null, taskWait: null }],
    screenshots: ['screenshots/step-001-before.png', 'screenshots/step-001-after.png'], tracePath: 'trace.zip', evidenceCompleteness: { complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] }, consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://127.0.0.1/result', visibleTextSummary: text },
    versions: { targetAppGitSha: null, productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: '0.5.0-alpha.1', actorModel: 'mock', judgeModel: 'mock', actorPromptVersion: '1.0.0', judgePromptVersion: '1.0.0', toolSchemaVersion: '1.0.0', timestamp: now },
  };
}

function semantic(verdict: SemanticJudgeResult['verdict']): SemanticJudgeResult {
  return {
    verdict, taskCompletion: verdict === 'pass' ? 'complete' : verdict === 'fail' ? 'failed' : 'unknown', summary: verdict === 'pass' ? '用户目标有直接证据。' : '用户目标没有完成。', whatWorked: verdict === 'pass' ? ['结果可见'] : [], whatFailed: verdict === 'fail' ? ['结果不可见'] : [], whyItMatters: verdict === 'fail' ? ['用户无法确认完成'] : [], confirmedFacts: verdict === 'pass' ? ['Created 可见'] : [], hypotheses: verdict === 'fail' ? [{ hypothesis: '结果区域未渲染', confidence: 0.5, supportingEvidence: ['页面无结果'], contradictingEvidence: [], howToVerify: ['检查结果状态'] }] : [], unknowns: verdict === 'inconclusive' ? ['证据不足'] : [], evidenceRefs: ['screenshots/final.png'], confidence: verdict === 'inconclusive' ? 0 : 0.95,
  };
}

describe('Hybrid Judge', () => {
  it('passes only when deterministic and semantic evidence both pass', () => {
    const deterministic = runDeterministicJudge(evalCase(), packet());
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['pass', 'pass']);
    expect(mergeJudgeVerdicts({ evalCase: evalCase(), packet: packet(), deterministic, semantic: semantic('pass'), semanticEvaluatorFailed: false, createdAt: now })).toMatchObject({ verdict: 'pass', failureSource: null, severity: null });
  });

  it('uses direct evidence for product failure and keeps hypotheses separate', () => {
    const failedPacket = packet('Error: result unavailable');
    const deterministic = runDeterministicJudge(evalCase(), failedPacket);
    const result = mergeJudgeVerdicts({ evalCase: evalCase(), packet: failedPacket, deterministic, semantic: semantic('fail'), semanticEvaluatorFailed: false, createdAt: now });
    expect(result).toMatchObject({ verdict: 'fail', failureSource: 'product', severity: 'P1', semantic: { confirmedFacts: [], hypotheses: [{ hypothesis: '结果区域未渲染' }] } });
  });

  it('judges visible text from the full linked final observation beyond the compact summary', () => {
    const longPacket = packet(`${'x'.repeat(1_500)}Created`);
    longPacket.finalState.visibleTextSummary = 'x'.repeat(1_000);
    const deterministic = runDeterministicJudge(evalCase(), longPacket);
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['pass', 'pass']);
  });

  it('does not pass from stale compact text when the linked final observation lacks the target', () => {
    const finalPacket = packet('Saved page without the target token');
    finalPacket.observations[0]!.visibleStateSummary = 'Draft page contained Created';
    finalPacket.finalState.visibleTextSummary = 'Stale compact summary contained Created';
    const deterministic = runDeterministicJudge(evalCase(), finalPacket);
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['fail', 'pass']);
  });

  it('judges text_absent against the full linked final observation beyond the compact summary', () => {
    const longPacket = packet(`Created ${'y'.repeat(1_500)} Error`);
    longPacket.finalState.visibleTextSummary = `Created ${'y'.repeat(900)}`;
    const deterministic = runDeterministicJudge(evalCase(), longPacket);
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['pass', 'fail']);
  });

  it('prevents pass when evidence is incomplete', () => {
    const incomplete = { ...packet(), stepVerifications: [] };
    const deterministic = runDeterministicJudge(evalCase(), incomplete);
    expect(mergeJudgeVerdicts({ evalCase: evalCase(), packet: incomplete, deterministic, semantic: semantic('pass'), semanticEvaluatorFailed: false, createdAt: now })).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator' });
  });

  it('keeps malformed semantic output as evaluator failure and persists all judge artifacts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-hybrid-'));
    const provider = new MockAiProvider(() => ({ malformed: true }), 0);
    const result = await judgeEvalCase({ outputDir, evalCase: evalCase(), packet: packet(), provider, createdAt: now });
    expect(result).toMatchObject({ verdict: 'inconclusive', failureSource: 'evaluator', severity: null });
    await expect(readFile(resolve(outputDir, 'runs', 'run-judge', 'deterministic-judge.json'), 'utf8')).resolves.toContain('assert-created');
    await expect(readFile(resolve(outputDir, 'runs', 'run-judge', 'semantic-judge.json'), 'utf8')).resolves.toContain('语义评测器未能产生可信结论');
    await expect(readFile(resolve(outputDir, 'runs', 'run-judge', 'result.json'), 'utf8')).resolves.toContain('"failureSource": "evaluator"');
  });
});
