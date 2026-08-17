import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, EvidencePacket } from '../types.js';
import { runDeterministicJudge } from '../src/judge/deterministic-judge.js';

const now = '2026-08-17T06:13:27.705Z';
const smoke3QuickCheckOnlyText = [
  'Quick check',
  'Recommendations are ready',
  'Check complete',
  'High Risk',
  'Gasping / Rapid Breathing',
  'Conclusion: Significant risk detected. Prioritize oxygenation, filtration, and water parameters.',
  'Do these steps now',
  'Increase aeration or surface disturbance immediately',
  'Check if filter is running normally',
  'Stop feeding for 12-24 hours',
].join(' ');
const run10DailyResultUnsavedText = [
  'Daily Aquarium Check',
  'Act now',
  'Do this first',
  '立刻增加打氧或水面扰动',
  '保存今天记录',
].join(' ');
const run10DailySavedText = [
  run10DailyResultUnsavedText,
  '更新今天记录',
  '已保存今天的检查记录。',
].join(' ');

function dailyCase(): EvalCase {
  return {
    caseId: 'blind-daily-check-risk',
    projectId: 'aquaguide-blind-experience',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'Connected AquaGuide Daily Check Oracle regression' },
    capabilityId: 'cap-daily-check',
    taskId: 'task-daily-check-risk',
    title: '完成每日检查并查看风险结果',
    hypothesis: 'Blind user can complete the Daily Check and see the risk/action result.',
    persona: { personaId: 'persona-blind-new-user', name: '首次使用 AquaGuide 的普通用户', behaviorPolicy: ['只依据可见界面行动'] },
    goal: '完成每日检查并查看系统给出的风险和下一步动作',
    knownInformation: {},
    preconditions: [],
    oracle: {
      expectedOutcome: ['Daily Check result is visible and the high-risk daily record is saved'],
      mustObserve: [],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: ['用户真实完成 Daily Check'],
      deterministicAssertions: [
        { assertionId: 'blind-daily-risk', type: 'text_visible', target: 'Act now', expected: true, negated: false },
        { assertionId: 'blind-daily-action', type: 'text_visible', target: 'Do this first', expected: true, negated: false },
        { assertionId: 'blind-daily-recorded-high-risk', type: 'text_visible', target: '已保存今天的检查记录。', expected: true, negated: false },
      ],
      inconclusiveWhen: ['没有足够可见证据确认成功或产品失败'],
    },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-daily-check' }],
    riskLevel: 'P1',
    generationReason: 'Connected AquaGuide Daily Check Oracle regression',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function dailyPacket(visibleText: string): EvidencePacket {
  return {
    runId: 'run-connected-daily-oracle-regression',
    caseId: 'blind-daily-check-risk',
    targetAppCommit: '2add55a54402afc18b642b572d8ee8351ab72c53',
    actorModel: 'deepseek-v4-flash',
    actorPromptVersion: '1.0.0',
    startedAt: now,
    completedAt: now,
    actions: [{ actionId: 'agent-action-001', type: 'navigation', timestampMs: 1, page: '/aquarium', target: null, inputField: null, inputLength: null, inputFingerprint: null, outcome: 'Daily Check state captured', evidence: ['screenshots/step-001-before.png', 'screenshots/step-001-after.png'] }],
    observations: [
      { observationId: 'observation-001-before', pageUrl: 'http://127.0.0.1:3000/aquarium', pagePurpose: 'Daily Check', visibleStateSummary: 'Daily Aquarium Check in progress', primaryAreas: ['Daily Check'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['screenshots/step-001-before.png'], confidence: 1 },
      { observationId: 'observation-001-after', pageUrl: 'http://127.0.0.1:3000/aquarium', pagePurpose: 'Daily Check Result', visibleStateSummary: visibleText, primaryAreas: ['Daily Check Result'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['screenshots/step-001-after.png'], confidence: 1 },
    ],
    stepVerifications: [{ verificationId: 'verification-001', expectation: 'Daily Check state is visible', observed: visibleText, status: 'confirmed', evidenceRefs: ['screenshots/step-001-after.png'], confidence: 1 }],
    stepEvidence: [{ stepIndex: 1, beforeObservationId: 'observation-001-before', afterObservationId: 'observation-001-after', beforeScreenshotPath: 'screenshots/step-001-before.png', afterScreenshotPath: 'screenshots/step-001-after.png', decisionId: 'decision-001', verificationId: 'verification-001', actionStatus: 'executed', taskState: null, taskWait: null }],
    screenshots: ['screenshots/step-001-before.png', 'screenshots/step-001-after.png'],
    tracePath: 'trace.zip',
    evidenceCompleteness: { complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] },
    consoleEvidence: [],
    networkEvidence: [],
    finalState: { url: 'http://127.0.0.1:3000/aquarium', visibleTextSummary: visibleText },
    versions: { targetAppGitSha: '2add55a54402afc18b642b572d8ee8351ab72c53', productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: '0.6.0-alpha.0', actorModel: 'deepseek-v4-flash', judgeModel: 'deepseek-v4-flash', actorPromptVersion: '1.0.0', judgePromptVersion: '1.0.0', toolSchemaVersion: '1.0.0', timestamp: now },
  };
}

describe('connected AquaGuide Daily Check Oracle regression', () => {
  it('keeps the benchmark locale fixed while using pinned stable product-state markers', async () => {
    const source = await readFile(resolve('scripts/run-connected-aquaguide-blind-smoke.ts'), 'utf8');

    expect(source).toContain("const benchmarkBrowserLocale = 'en-US';");
    expect(source).toContain("const benchmarkAppLocale = 'en';");
    expect(source).toContain('browser.newContext({ locale: benchmarkBrowserLocale })');
    expect(source).toContain("window.localStorage.setItem('aquaguide_locale', locale)");
    expect(source).toContain('benchmarkLocale: benchmarkBrowserLocale');
    expect(source).toContain('applicationLocale: benchmarkAppLocale');

    const targets = [...source.matchAll(/target:\s*'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(targets).toContain('Freshwater');
    expect(targets).toContain('Act now');
    expect(targets).toContain('Do this first');
    expect(targets).toContain('已保存今天的检查记录。');
    expect(targets).not.toContain('High Risk');
    expect(targets).not.toContain('Increase aeration or surface disturbance immediately');
    expect(targets).not.toContain('Re-check Recommended');
    expect(targets).not.toContain('Checked Today');
  });

  it('rejects the retained Smoke #3 Quick Check-only result as a completed Daily Check', () => {
    const deterministic = runDeterministicJudge(dailyCase(), dailyPacket(smoke3QuickCheckOnlyText));
    expect(deterministic.hardFailure).toBe(true);
    expect(deterministic.severity).toBe('P1');
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['fail', 'fail', 'fail']);
  });

  it('rejects a real Daily Check result that has not been saved yet', () => {
    const deterministic = runDeterministicJudge(dailyCase(), dailyPacket(run10DailyResultUnsavedText));
    expect(deterministic.hardFailure).toBe(true);
    expect(deterministic.severity).toBe('P1');
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['pass', 'pass', 'fail']);
  });

  it('passes the Run #10 saved high-risk Daily Check evidence', () => {
    const deterministic = runDeterministicJudge(dailyCase(), dailyPacket(run10DailySavedText));
    expect(deterministic.hardFailure).toBe(false);
    expect(deterministic.severity).toBeNull();
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['pass', 'pass', 'pass']);
  });
});
