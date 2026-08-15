import { describe, expect, it } from 'vitest';
import type { AgentDecision, EvalCase, EvalCaseResult, EvidencePacket, InteractionAction, PageObservation, SimulatedUserMetrics } from '../types.js';
import { analyzeAdaptiveExperience } from '../src/ux-evaluation/adaptive-experience-analyzer.js';
import { detectFrictions } from '../src/ux-evaluation/friction-detector.js';
import { fingerprintInput } from '../src/ux-evaluation/interaction-recorder.js';
import { repeatedInputActionIds } from '../src/ux-evaluation/repeated-input-detector.js';

const now = '2026-08-15T09:00:00.000Z';

function completion(goalComplete: boolean) {
  return {
    technical: { conditions: ['done'], complete: goalComplete, evidence: ['final.png'] },
    interface: { conditions: ['visible'], complete: goalComplete, evidence: ['final.png'] },
    userGoal: { conditions: ['goal'], complete: goalComplete, evidence: ['final.png'] },
    followUp: { conditions: ['next'], complete: null, evidence: [] },
  };
}

function metrics(overrides: Partial<SimulatedUserMetrics> = {}): SimulatedUserMetrics {
  return {
    metricType: 'simulated_user_run',
    timeToFirstActionMs: 0,
    timeToFindEntryMs: 0,
    timeToFirstMeaningfulActionMs: 0,
    timeToCompleteMs: 100,
    totalActions: 1,
    requiredActions: 0,
    redundantActions: 0,
    clickCount: 0,
    inputCount: 0,
    pageTransitions: 0,
    backtrackCount: 0,
    retryCount: 0,
    repeatedInputCount: 0,
    deadClickCount: 0,
    clarificationCount: 0,
    deadEndCount: 0,
    errorCount: 0,
    recoveryAttempts: 0,
    recoverySuccess: false,
    taskCompleted: true,
    fullLoopCompleted: false,
    abandoned: false,
    abandonmentReason: null,
    finalConfidence: 'high',
    ...overrides,
  };
}

describe('adaptive experience false-positive regressions', () => {
  it('does not treat identical values in two different grounded fields as repeated input', () => {
    const sameValue = fingerprintInput('30');
    const actions: InteractionAction[] = [
      { actionId: 'a1', type: 'input', timestampMs: 0, page: '/setup', target: 'input', inputField: 'E003', inputLength: 2, inputFingerprint: sameValue, outcome: 'observable_feedback', evidence: ['a1.png'] },
      { actionId: 'a2', type: 'input', timestampMs: 1, page: '/setup', target: 'input', inputField: 'E004', inputLength: 2, inputFingerprint: sameValue, outcome: 'observable_feedback', evidence: ['a2.png'] },
    ];

    expect(repeatedInputActionIds(actions)).toEqual([]);
  });

  it('does not report abandonment risk after the Judge has already proven the user goal complete', () => {
    const actions: InteractionAction[] = [
      { actionId: 'a1', type: 'abandon', timestampMs: 0, page: '/', target: null, inputField: null, inputLength: null, inputFingerprint: null, outcome: 'no_progress', evidence: ['final.png'] },
    ];
    const frictions = detectFrictions({
      featureId: 'cap-fixture',
      personaId: 'persona-new-user',
      actions,
      metrics: metrics({ abandoned: true, abandonmentReason: 'Actor stopped after the result was already saved' }),
      completion: completion(true),
    });

    expect(frictions.some((item) => item.type === 'abandonment_risk')).toBe(false);
  });

  it('does not infer a backtrack from a normal setup URL round-trip without an explicit back action', () => {
    const home = 'http://127.0.0.1:3000/aquarium';
    const setup = 'http://127.0.0.1:3000/aquarium?action=setup';
    const controls = (label: string): PageObservation['interactableElements'] => [{
      elementId: 'E001', role: 'button', tagName: 'button', label, text: label, placeholder: null,
      disabled: false, risk: 'safe', locatorHint: 'grounded-index:0',
    }];
    const observation = (id: string, url: string, label: string): PageObservation => ({
      observationId: id,
      pageUrl: url,
      pagePurpose: 'Aquarium',
      visibleStateSummary: label,
      primaryAreas: ['Aquarium'],
      visibleProblems: [],
      interactableElements: controls(label),
      formFields: [],
      evidenceRefs: [`${id}.png`],
      confidence: 1,
    });
    const observations = [
      observation('o1b', home, 'Create or configure a tank'),
      observation('o1a', setup, 'Save Settings'),
      observation('o2b', setup, 'Save Settings'),
      observation('o2a', home, 'Freshwater 60x30x30cm'),
    ];
    const decisions: AgentDecision[] = [
      { decisionId: 'd1', intentSummary: 'open setup', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'setup opens', confidence: 1 },
      { decisionId: 'd2', intentSummary: 'save setup', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'setup saves', confidence: 1 },
    ];
    const packet = {
      runId: 'run-round-trip',
      caseId: 'case-round-trip',
      actions: [],
      observations,
      stepVerifications: [
        { verificationId: 'v1', expectation: 'setup opens', observed: 'setup opened', status: 'confirmed', evidenceRefs: ['o1a.png'], confidence: 1 },
        { verificationId: 'v2', expectation: 'setup saves', observed: 'setup saved', status: 'confirmed', evidenceRefs: ['o2a.png'], confidence: 1 },
      ],
      stepEvidence: [
        { stepIndex: 1, beforeObservationId: 'o1b', afterObservationId: 'o1a', beforeScreenshotPath: 'o1b.png', afterScreenshotPath: 'o1a.png', decisionId: 'd1', verificationId: 'v1', actionStatus: 'executed', taskState: null, taskWait: null },
        { stepIndex: 2, beforeObservationId: 'o2b', afterObservationId: 'o2a', beforeScreenshotPath: 'o2b.png', afterScreenshotPath: 'o2a.png', decisionId: 'd2', verificationId: 'v2', actionStatus: 'executed', taskState: null, taskWait: null },
      ],
    } as unknown as EvidencePacket;
    const evalCase = {
      caseId: 'case-round-trip', projectId: 'project-fixture', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'fixture' },
      capabilityId: 'cap-fixture', taskId: 'task-fixture', title: 'Create tank', hypothesis: 'works',
      persona: { personaId: 'persona-new-user', name: 'New user', behaviorPolicy: ['act safely'] },
      goal: 'Create a tank', knownInformation: {}, preconditions: [],
      oracle: { expectedOutcome: ['saved'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: ['complete'], deterministicAssertions: [], inconclusiveWhen: ['missing evidence'] },
      coverageDimensions: [{ dimension: 'capability', value: 'cap-fixture' }], riskLevel: 'P1', generationReason: 'fixture', version: 1,
      stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
      regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
    } as EvalCase;
    const result = {
      runId: 'run-round-trip', caseId: 'case-round-trip', verdict: 'pass', failureSource: null, severity: null,
      deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['final.png'] },
      semantic: { verdict: 'pass', taskCompletion: 'complete', summary: 'complete', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: [], evidenceRefs: ['final.png'], confidence: 1 },
      evidencePacketPath: 'evidence-packet.json', createdAt: now,
    } as EvalCaseResult;

    const analysis = analyzeAdaptiveExperience({ evalCase, result, packet, decisions });
    expect(analysis.routeSequence).toEqual([home, setup, home]);
    expect(analysis.routeBacktrackCount).toBe(0);
    expect(analysis.metrics.backtrackCount).toBe(0);
    expect(analysis.frictions.some((item) => item.type === 'path_efficiency_issue')).toBe(false);
  });
});
