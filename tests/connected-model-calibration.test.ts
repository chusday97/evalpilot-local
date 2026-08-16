import { describe, expect, it } from 'vitest';
import type { ConnectedModelCalibrationRow } from '../src/ux-evaluation/connected-model-calibration.js';
import { connectedModelCalibrationProbes, summarizeConnectedModelCalibration } from '../src/ux-evaluation/connected-model-calibration.js';

function row(overrides: Partial<ConnectedModelCalibrationRow> & Pick<ConnectedModelCalibrationRow, 'probeId' | 'expectedTypes' | 'predictedTypes'>): ConnectedModelCalibrationRow {
  return {
    purpose: overrides.probeId,
    actorActions: [],
    agentStatus: 'completed',
    failureSource: null,
    runId: `run-${overrides.probeId}`,
    ...overrides,
  };
}

describe('connected-model behavior calibration', () => {
  it('keeps a deliberately small sensitivity corpus with clean, feedback, and dead-end probes', () => {
    expect(connectedModelCalibrationProbes.map((probe) => probe.probeId)).toEqual([
      'clean-one-click',
      'no-feedback-retry',
      'objective-dead-end',
    ]);
    expect(connectedModelCalibrationProbes[0]?.expectedTypes).toEqual([]);
    expect(connectedModelCalibrationProbes[1]?.expectedTypes).toEqual(['interaction_feedback_issue']);
    expect(connectedModelCalibrationProbes[2]?.expectedTypes).toEqual(['journey_breakpoint', 'abandonment_risk']);
  });

  it('separates preserved signals from clean actor-induced drift', () => {
    const metrics = summarizeConnectedModelCalibration([
      row({ probeId: 'clean', expectedTypes: [], predictedTypes: ['path_efficiency_issue'] }),
      row({ probeId: 'feedback', expectedTypes: ['interaction_feedback_issue'], predictedTypes: ['interaction_feedback_issue'] }),
      row({ probeId: 'dead-end', expectedTypes: ['journey_breakpoint', 'abandonment_risk'], predictedTypes: ['journey_breakpoint'] }),
    ]);

    expect(metrics.precisionAgainstProbeGroundTruth).toBeCloseTo(2 / 3);
    expect(metrics.signalPreservationRecall).toBeCloseTo(2 / 3);
    expect(metrics.exactSignalMatchRate).toBeCloseTo(1 / 3);
    expect(metrics.cleanActorDriftRate).toBe(1);
    expect(metrics.extraSignalCount).toBe(1);
    expect(metrics.missingSignalCount).toBe(1);
  });

  it('counts evaluator/provider failures independently from UX detector metrics', () => {
    const metrics = summarizeConnectedModelCalibration([
      row({ probeId: 'clean', expectedTypes: [], predictedTypes: [], agentStatus: 'inconclusive', failureSource: 'evaluator' }),
      row({ probeId: 'dead-end', expectedTypes: ['journey_breakpoint'], predictedTypes: ['journey_breakpoint'] }),
    ]);

    expect(metrics.providerFailureCount).toBe(1);
    expect(metrics.precisionAgainstProbeGroundTruth).toBe(1);
    expect(metrics.signalPreservationRecall).toBe(1);
    expect(metrics.cleanActorDriftRate).toBe(0);
  });
});
