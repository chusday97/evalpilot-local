import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, EvidencePacket } from '../types.js';
import { runDeterministicJudge } from '../src/judge/deterministic-judge.js';

const now = '2026-08-16T13:34:50.309Z';
const smoke3DailyText = [
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
const savedHighRiskDailyText = `${smoke3DailyText} Re-check Recommended`;

function dailyCase(): EvalCase {
  return {
    caseId: 'blind-daily-check-risk',
    projectId: 'aquaguide-blind-experience',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'Smoke #3 Oracle locale regression' },
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
        { assertionId: 'blind-daily-risk', type: 'text_visible', target: 'High Risk', expected: true, negated: false },
        { assertionId: 'blind-daily-action', type: 'text_visible', target: 'Increase aeration or surface disturbance immediately', expected: true, negated: false },
        { assertionId: 'blind-daily-recorded-high-risk', type: 'text_visible', target: 'Re-check Recommended', expected: true, negated: false },
      ],
      inconclusiveWhen: ['没有足够可见证据确认成功或产品失败'],
    },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-daily-check' }],
    riskLevel: 'P1',
    generationReason: 'Smoke #3 Oracle locale regression',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function dailyPacket(visibleText = smoke3DailyText): EvidencePacket {
  return {
    runId: 'run-smoke-3-daily-locale-regression',
    caseId: 'blind-daily-check-risk',
    targetAppCommit: '8663b469c50605529367daf1b69ac0cd7cfb0cac',
    actorModel: 'deepseek-v4-flash',
    actorPromptVersion: '1.0.0',
    startedAt: now,
    completedAt: now,
    actions: [{ actionId: 'agent-action-001', type: 'navigation', timestampMs: 1, page: '/aquarium', target: null, inputField: null, inputLength: null, inputFingerprint: null, outcome: 'Daily Check result visible', evidence: ['screenshots/step-001-before.png', 'screenshots/step-001-after.png'] }],
    observations: [
      { observationId: 'observation-001-before', pageUrl: 'http://127.0.0.1:3000/aquarium', pagePurpose: 'Daily Check', visibleStateSummary: 'Quick check in progress', primaryAreas: ['Daily Check'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['screenshots/step-001-before.png'], confidence: 1 },
      { observationId: 'observation-001-after', pageUrl: 'http://127.0.0.1:3000/aquarium', pagePurpose: 'Daily Check Result', visibleStateSummary: visibleText, primaryAreas: ['Daily Check Result'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['screenshots/step-001-after.png'], confidence: 1 },
    ],
    stepVerifications: [{ verificationId: 'verification-001', expectation: 'Daily Check result is visible', observed: visibleText, status: 'confirmed', evidenceRefs: ['screenshots/step-001-after.png'], confidence: 1 }],
    stepEvidence: [{ stepIndex: 1, beforeObservationId: 'observation-001-before', afterObservationId: 'observation-001-after', beforeScreenshotPath: 'screenshots/step-001-before.png', afterScreenshotPath: 'screenshots/step-001-after.png', decisionId: 'decision-001', verificationId: 'verification-001', actionStatus: 'executed', taskState: null, taskWait: null }],
    screenshots: ['screenshots/step-001-before.png', 'screenshots/step-001-after.png'],
    tracePath: 'trace.zip',
    evidenceCompleteness: { complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] },
    consoleEvidence: [],
    networkEvidence: [],
    finalState: { url: 'http://127.0.0.1:3000/aquarium', visibleTextSummary: visibleText },
    versions: { targetAppGitSha: '8663b469c50605529367daf1b69ac0cd7cfb0cac', productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: '0.6.0-alpha.0', actorModel: 'deepseek-v4-flash', judgeModel: 'deepseek-v4-flash', actorPromptVersion: '1.0.0', judgePromptVersion: '1.0.0', toolSchemaVersion: '1.0.0', timestamp: now },
  };
}

describe('connected AquaGuide Oracle locale regression', () => {
  it('pins the benchmark to one explicit English locale contract', async () => {
    const source = await readFile(resolve('scripts/run-connected-aquaguide-blind-smoke.ts'), 'utf8');

    expect(source).toContain("const benchmarkBrowserLocale = 'en-US';");
    expect(source).toContain("const benchmarkAppLocale = 'en';");
    expect(source).toContain('browser.newContext({ locale: benchmarkBrowserLocale })');
    expect(source).toContain("window.localStorage.setItem('aquaguide_locale', locale)");
    expect(source).toContain('benchmarkLocale: benchmarkBrowserLocale');
    expect(source).toContain('applicationLocale: benchmarkAppLocale');

    const targets = [...source.matchAll(/target:\s*'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(targets).toContain('Freshwater');
    expect(targets).toContain('High Risk');
    expect(targets).toContain('Increase aeration or surface disturbance immediately');
    expect(targets).toContain('Re-check Recommended');
    expect(targets).not.toContain('Checked Today');
    expect(targets).not.toContain('Act now');
    expect(targets.some((target) => /[\u3400-\u9fff]/u.test(target))).toBe(false);
  });

  it('rejects the retained Smoke #3 Quick Check-only result as a completed Daily Check', () => {
    const deterministic = runDeterministicJudge(dailyCase(), dailyPacket());
    expect(deterministic.hardFailure).toBe(true);
    expect(deterministic.severity).toBe('P1');
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['pass', 'pass', 'fail']);
  });

  it('passes only when the high-risk Daily Check has a saved-record outcome', () => {
    const deterministic = runDeterministicJudge(dailyCase(), dailyPacket(savedHighRiskDailyText));
    expect(deterministic.hardFailure).toBe(false);
    expect(deterministic.severity).toBeNull();
    expect(deterministic.checks.map((item) => item.verdict)).toEqual(['pass', 'pass', 'pass']);
  });
});
