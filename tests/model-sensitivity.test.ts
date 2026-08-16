import { describe, expect, it } from 'vitest';
import { summarizeModelSensitivity } from '../src/ux-evaluation/model-sensitivity.js';

describe('connected-model sensitivity summary', () => {
  it('separates signal preservation, extra signals, clean drift, and provider failures', () => {
    const summary = summarizeModelSensitivity([
      {
        fixtureId: 'clean',
        expectedSignals: [],
        predictedSignals: [],
        actorActions: ['click', 'finish'],
        runStatus: 'completed',
        verdict: 'pass',
        failureSource: null,
        providerFailure: null,
      },
      {
        fixtureId: 'no-feedback',
        expectedSignals: ['interaction_feedback_issue'],
        predictedSignals: ['path_efficiency_issue', 'interaction_feedback_issue', 'interaction_feedback_issue'],
        actorActions: ['click', 'wait', 'click', 'finish'],
        runStatus: 'completed',
        verdict: 'pass',
        failureSource: null,
        providerFailure: null,
      },
      {
        fixtureId: 'dead-end',
        expectedSignals: ['journey_breakpoint', 'abandonment_risk'],
        predictedSignals: [],
        actorActions: [],
        runStatus: null,
        verdict: null,
        failureSource: 'evaluator',
        providerFailure: 'provider timeout',
      },
    ]);

    expect(summary).toEqual(expect.objectContaining({
      scenarioCount: 3,
      eligibleScenarioCount: 2,
      providerFailureCount: 1,
      expectedSignalCount: 1,
      preservedSignalCount: 1,
      missingSignalCount: 0,
      extraSignalCount: 1,
      signalPreservationRate: 1,
      cleanScenarioCount: 1,
      cleanScenarioWithDriftCount: 0,
      cleanDriftRate: 0,
    }));
    expect(summary.rows.find((row) => row.fixtureId === 'no-feedback')).toEqual(expect.objectContaining({
      preservedSignals: ['interaction_feedback_issue'],
      missingSignals: [],
      extraSignals: ['path_efficiency_issue'],
      cleanDrift: false,
    }));
    expect(summary.rows.find((row) => row.fixtureId === 'dead-end')?.expectedSignals).toEqual(['abandonment_risk', 'journey_breakpoint']);
  });

  it('marks a clean fixture with model-induced detector output as drift', () => {
    const summary = summarizeModelSensitivity([
      {
        fixtureId: 'clean-drift',
        expectedSignals: [],
        predictedSignals: ['path_efficiency_issue'],
        actorActions: ['wait', 'click', 'finish'],
        runStatus: 'completed',
        verdict: 'pass',
        failureSource: null,
        providerFailure: null,
      },
    ]);

    expect(summary.cleanDriftRate).toBe(1);
    expect(summary.extraSignalCount).toBe(1);
    expect(summary.rows[0]).toEqual(expect.objectContaining({
      cleanDrift: true,
      extraSignals: ['path_efficiency_issue'],
    }));
  });
});
