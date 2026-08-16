import { describe, expect, it } from 'vitest';
import type { ConnectedModelCalibrationRow } from '../src/ux-evaluation/connected-model-calibration.js';
import {
  buildConnectedModelProbeSuiteIdentity,
  connectedModelCalibrationProbes,
  connectedModelProbeSuiteIdentity,
  summarizeConnectedModelCalibration,
} from '../src/ux-evaluation/connected-model-calibration.js';

function row(overrides: Partial<ConnectedModelCalibrationRow> & Pick<ConnectedModelCalibrationRow, 'probeId' | 'expectedTypes' | 'predictedTypes'>): ConnectedModelCalibrationRow {
  return {
    purpose: overrides.probeId,
    expectedVerdict: 'inconclusive',
    observedVerdict: 'inconclusive',
    actorActions: [],
    agentStatus: 'completed',
    failureSource: null,
    runId: `run-${overrides.probeId}`,
    ...overrides,
  };
}

describe('connected-model behavior calibration', () => {
  it('keeps a deliberately small fingerprinted sensitivity corpus with clean, feedback, and dead-end probes', () => {
    expect(connectedModelCalibrationProbes.map((probe) => probe.probeId)).toEqual([
      'clean-one-click',
      'no-feedback-retry',
      'objective-dead-end',
    ]);
    expect(connectedModelCalibrationProbes[0]?.expectedTypes).toEqual([]);
    expect(connectedModelCalibrationProbes[1]?.expectedTypes).toEqual(['interaction_feedback_issue']);
    expect(connectedModelCalibrationProbes[2]?.expectedTypes).toEqual(['journey_breakpoint', 'abandonment_risk']);
    expect(connectedModelProbeSuiteIdentity).toEqual(expect.objectContaining({ version: 1 }));
    expect(connectedModelProbeSuiteIdentity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(connectedModelProbeSuiteIdentity.probeIds).toEqual(connectedModelCalibrationProbes.map((probe) => probe.probeId));
  });

  it('changes the suite fingerprint when the controlled probe contract changes', () => {
    const changed = connectedModelCalibrationProbes.map((probe) => probe.probeId === 'clean-one-click'
      ? { ...probe, html: `${probe.html}<p>changed fixture</p>` }
      : { ...probe });
    expect(buildConnectedModelProbeSuiteIdentity(changed).fingerprint).not.toBe(connectedModelProbeSuiteIdentity.fingerprint);
  });

  it('separates preserved signals from clean actor-induced drift', () => {
    const metrics = summarizeConnectedModelCalibration([
      row({ probeId: 'clean', expectedTypes: [], predictedTypes: ['path_efficiency_issue'], expectedVerdict: 'pass', observedVerdict: 'inconclusive' }),
      row({ probeId: 'feedback', expectedTypes: ['interaction_feedback_issue'], predictedTypes: ['interaction_feedback_issue'], expectedVerdict: 'pass', observedVerdict: 'pass' }),
      row({ probeId: 'dead-end', expectedTypes: ['journey_breakpoint', 'abandonment_risk'], predictedTypes: ['journey_breakpoint'], expectedVerdict: 'inconclusive', observedVerdict: 'inconclusive' }),
    ]);

    expect(metrics.precisionAgainstProbeGroundTruth).toBeCloseTo(2 / 3);
    expect(metrics.signalPreservationRecall).toBeCloseTo(2 / 3);
    expect(metrics.exactSignalMatchRate).toBeCloseTo(1 / 3);
    expect(metrics.cleanActorDriftRate).toBe(1);
    expect(metrics.extraSignalCount).toBe(1);
    expect(metrics.missingSignalCount).toBe(1);
    expect(metrics.eligibleProbeExecutionCount).toBe(3);
  });

  it('excludes evaluator/provider failures from UX detector denominators while keeping availability visible', () => {
    const metrics = summarizeConnectedModelCalibration([
      row({
        probeId: 'failed-dead-end',
        expectedTypes: ['journey_breakpoint'],
        predictedTypes: [],
        expectedVerdict: 'inconclusive',
        observedVerdict: 'inconclusive',
        agentStatus: 'inconclusive',
        failureSource: 'evaluator',
      }),
      row({
        probeId: 'feedback',
        expectedTypes: ['interaction_feedback_issue'],
        predictedTypes: ['interaction_feedback_issue'],
        expectedVerdict: 'pass',
        observedVerdict: 'pass',
      }),
    ]);

    expect(metrics.providerFailureCount).toBe(1);
    expect(metrics.eligibleProbeExecutionCount).toBe(1);
    expect(metrics.precisionAgainstProbeGroundTruth).toBe(1);
    expect(metrics.signalPreservationRecall).toBe(1);
    expect(metrics.exactSignalMatchRate).toBe(1);
    expect(metrics.cleanActorDriftRate).toBe(0);
    expect(metrics.fn).toBe(0);
  });
});
