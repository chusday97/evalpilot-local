import { describe, expect, it } from 'vitest';
import type { EvalCase, PageObservation, StepVerification, TaskStateObservation } from '../types.js';
import { initialActionBudget, maybeExtendActionBudget, pageStateFingerprint, repeatedStateCount, runtimeTaskProgress } from '../src/test-agent/task-progress.js';

const now = '2026-08-12T06:00:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-progress', projectId: 'project-progress', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'progress fixture' }, capabilityId: 'cap-progress', taskId: null,
    title: 'Create item', hypothesis: 'user completes task', persona: { personaId: 'user', name: 'User', behaviorPolicy: ['safe'] }, goal: 'Create an item', knownInformation: {}, preconditions: [],
    oracle: { expectedOutcome: ['Created'], mustObserve: ['Created'], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [], inconclusiveWhen: [] }, coverageDimensions: [], riskLevel: 'P1', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function observation(overrides: Partial<PageObservation> = {}): PageObservation {
  return {
    observationId: 'observation-1', pageUrl: 'http://127.0.0.1:3000/create', pagePurpose: 'Create', visibleStateSummary: 'Create an item', primaryAreas: ['Create'], visibleProblems: [],
    interactableElements: [{ elementId: 'E001', role: null, tagName: 'input', label: 'Name', text: null, placeholder: 'Name', disabled: false, risk: 'safe', locatorHint: 'grounded-index:0' }],
    formFields: [{ elementId: 'E001', role: null, tagName: 'input', label: 'Name', text: null, placeholder: 'Name', disabled: false, risk: 'safe', locatorHint: 'grounded-index:0', fieldName: 'name', inputType: 'text', required: true, currentValuePresent: false, options: [] }],
    evidenceRefs: [], confidence: 1, ...overrides,
  };
}

function verification(status: StepVerification['status']): StepVerification {
  return { verificationId: 'verification-1', status, expected: 'Created', observed: status, evidenceRefs: [], confidence: 1 };
}

function taskState(state: TaskStateObservation['state']): TaskStateObservation {
  return { state, progressSignals: [], completionSignals: [], failureSignals: [], loadingSignals: [], networkActivity: 'idle', elapsedMs: 10, lastProgressAtMs: state === 'progressing' ? 10 : null, confidence: 1, evidenceRefs: [] };
}

describe('progress-driven action budget', () => {
  it('starts production runs at 8 actions with a hard cap of 20', () => {
    expect(initialActionBudget()).toEqual({ current: 8, hard: 20, extensions: 0 });
  });

  it('keeps an explicit test maxSteps fixed for deterministic fixtures', () => {
    expect(initialActionBudget(5)).toEqual({ current: 5, hard: 5, extensions: 0 });
  });

  it('extends near the current limit only when there is verified progress', () => {
    const next = maybeExtendActionBudget({ budget: initialActionBudget(), stepIndex: 7, taskState: taskState('interacting'), verification: verification('confirmed') });
    expect(next).toEqual({ current: 11, hard: 20, extensions: 1 });
  });

  it('does not extend a stagnant run just because the budget is almost exhausted', () => {
    const next = maybeExtendActionBudget({ budget: initialActionBudget(), stepIndex: 7, taskState: taskState('interacting'), verification: verification('inconclusive') });
    expect(next).toEqual({ current: 8, hard: 20, extensions: 0 });
  });

  it('never extends past the hard cap', () => {
    const next = maybeExtendActionBudget({ budget: { current: 20, hard: 20, extensions: 4 }, stepIndex: 20, taskState: taskState('progressing'), verification: verification('confirmed') });
    expect(next).toEqual({ current: 20, hard: 20, extensions: 4 });
  });
});

describe('structured runtime task progress', () => {
  it('focuses on empty required safe fields first', () => {
    const progress = runtimeTaskProgress({ evalCase: evalCase(), observation: observation(), verifications: [], budget: initialActionBudget(), currentStep: 0, failedAttempts: 0 });
    expect(progress.currentFocus).toBe('complete_required_inputs');
    expect(progress.remainingExpectedSignals).toEqual(['Created']);
  });

  it('moves to task execution after required inputs are present', () => {
    const filled = observation({ formFields: [{ ...observation().formFields[0]!, currentValuePresent: true }] });
    const progress = runtimeTaskProgress({ evalCase: evalCase(), observation: filled, verifications: [], budget: initialActionBudget(), currentStep: 2, failedAttempts: 0 });
    expect(progress.currentFocus).toBe('trigger_or_continue_task');
  });

  it('moves to completion verification when expected evidence is visible', () => {
    const done = observation({ visibleStateSummary: 'Created', formFields: [{ ...observation().formFields[0]!, currentValuePresent: true }] });
    const progress = runtimeTaskProgress({ evalCase: evalCase(), observation: done, verifications: [verification('confirmed')], budget: initialActionBudget(), currentStep: 3, failedAttempts: 0 });
    expect(progress.currentFocus).toBe('verify_completion');
    expect(progress.remainingExpectedSignals).toEqual([]);
    expect(progress.completedVerifiedSteps).toBe(1);
  });
});

describe('agent loop fingerprint', () => {
  it('changes when a form field becomes populated even if visible page text stays unchanged', () => {
    const empty = observation();
    const filled = observation({ formFields: [{ ...observation().formFields[0]!, currentValuePresent: true }] });
    expect(pageStateFingerprint(empty)).not.toBe(pageStateFingerprint(filled));
  });

  it('counts only consecutive repeated action-state signatures', () => {
    expect(repeatedStateCount(['same', 'same'], 'same')).toBe(3);
    expect(repeatedStateCount(['same', 'other'], 'same')).toBe(1);
  });
});
