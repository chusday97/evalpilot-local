import { describe, expect, it } from 'vitest';
import type { AiTestAgentRun, EvalCaseResult, UxIssueType } from '../types.js';
import {
  summarizeConnectedModelCalibration,
  type ConnectedModelCalibrationResult,
  type ConnectedModelCalibrationRow,
} from '../src/ux-evaluation/connected-model-calibration.js';
import { summarizeConnectedModelCalibrationVariance } from '../src/ux-evaluation/connected-model-variance.js';

const provider = { providerId: 'openai', model: 'fixture-model', remote: true };

function row(input: {
  probeId: 'clean-one-click' | 'no-feedback-retry' | 'objective-dead-end';
  expectedTypes: UxIssueType[];
  predictedTypes: UxIssueType[];
  observedVerdict: EvalCaseResult['verdict'];
  actorActions?: string[];
  failureSource?: AiTestAgentRun['failureSource'];
}): ConnectedModelCalibrationRow {
  return {
    probeId: input.probeId,
    purpose: input.probeId,
    expectedTypes: input.expectedTypes,
    predictedTypes: input.predictedTypes,
    observedVerdict: input.observedVerdict,
    actorActions: input.actorActions ?? [],
    agentStatus: input.failureSource === 'evaluator' ? 'inconclusive' : 'completed',
    failureSource: input.failureSource ?? null,
    runId: `run-${input.probeId}`,
  };
}

function result(index: number, rows: ConnectedModelCalibrationRow[], model = 'fixture-model'): ConnectedModelCalibrationResult {
  return {
    schemaVersion: 1,
    analysisMode: 'connected_model_behavior_sensitivity',
    provider: { ...provider, model },
    generatedAt: `2026-08-16T0${index}:00:00.000Z`,
    metrics: summarizeConnectedModelCalibration(rows),
    rows,
    methodology: [],
    claimBoundary: [],
  };
}

function clean(predictedTypes: UxIssueType[] = [], observedVerdict: EvalCaseResult['verdict'] = 'pass', actions: string[] = ['click', 'finish']) {
  return row({ probeId: 'clean-one-click', expectedTypes: [], predictedTypes, observedVerdict, actorActions: actions });
}

function feedback(predictedTypes: UxIssueType[] = ['interaction_feedback_issue'], observedVerdict: EvalCaseResult['verdict'] = 'pass') {
  return row({ probeId: 'no-feedback-retry', expectedTypes: ['interaction_feedback_issue'], predictedTypes, observedVerdict, actorActions: ['click', 'click', 'finish'] });
}

function deadEnd(predictedTypes: UxIssueType[] = ['journey_breakpoint', 'abandonment_risk']) {
  return row({ probeId: 'objective-dead-end', expectedTypes: ['journey_breakpoint', 'abandonment_risk'], predictedTypes, observedVerdict: 'inconclusive', actorActions: ['click', 'abandon'] });
}

describe('connected-model calibration variance', () => {
  it('summarizes metric ranges and per-probe signal/verdict stability without inventing thresholds', () => {
    const first = result(1, [clean(), feedback(), deadEnd()]);
    const second = result(2, [
      clean(['path_efficiency_issue'], 'inconclusive', ['wait', 'click', 'finish']),
      feedback([], 'inconclusive'),
      deadEnd(['journey_breakpoint']),
    ]);
    const third = result(3, [
      clean(),
      feedback(['interaction_feedback_issue', 'abandonment_risk']),
      deadEnd(),
    ]);

    const summary = summarizeConnectedModelCalibrationVariance([first, second, third]);
    expect(summary).toEqual(expect.objectContaining({
      analysisMode: 'connected_model_behavior_variance',
      runCount: 3,
      providerFailureCount: 0,
      probeExecutionCount: 9,
      providerFailureRate: 0,
    }));
    expect(summary.metricDistributions.signalPreservationRecall.values).toHaveLength(3);
    expect(summary.metricDistributions.signalPreservationRecall.min).toBeLessThan(summary.metricDistributions.signalPreservationRecall.max);
    expect(summary.varianceNote).toContain('No pass/fail threshold');

    const byId = new Map(summary.probeStability.map((probe) => [probe.probeId, probe]));
    expect(byId.get('clean-one-click')).toEqual(expect.objectContaining({
      expectedVerdict: 'pass',
      verdictMatchCount: 2,
      verdictMatchRate: 2 / 3,
      exactSignalMatchCount: 2,
      exactSignalMatchRate: 2 / 3,
    }));
    expect(byId.get('clean-one-click')?.extraSignalPresence).toEqual([
      expect.objectContaining({ type: 'path_efficiency_issue', presentCount: 1, rate: 1 / 3 }),
    ]);
    expect(byId.get('no-feedback-retry')?.expectedSignalPresence).toEqual([
      expect.objectContaining({ type: 'interaction_feedback_issue', presentCount: 2, rate: 2 / 3 }),
    ]);
    expect(byId.get('no-feedback-retry')?.extraSignalPresence).toEqual([
      expect.objectContaining({ type: 'abandonment_risk', presentCount: 1, rate: 1 / 3 }),
    ]);
    expect(byId.get('objective-dead-end')?.expectedSignalPresence).toEqual([
      expect.objectContaining({ type: 'abandonment_risk', presentCount: 2, rate: 2 / 3 }),
      expect.objectContaining({ type: 'journey_breakpoint', presentCount: 3, rate: 1 }),
    ]);
    expect(byId.get('clean-one-click')?.actionSequences[0]).toEqual(expect.objectContaining({ sequence: 'click → finish', count: 2, rate: 2 / 3 }));
  });

  it('keeps provider failures visible instead of treating them as ordinary model variance', () => {
    const failedClean = row({
      probeId: 'clean-one-click',
      expectedTypes: [],
      predictedTypes: [],
      observedVerdict: 'inconclusive',
      failureSource: 'evaluator',
    });
    const summary = summarizeConnectedModelCalibrationVariance([
      result(1, [failedClean, feedback(), deadEnd()]),
    ]);

    expect(summary.runCount).toBe(1);
    expect(summary.providerFailureCount).toBe(1);
    expect(summary.providerFailureRate).toBeCloseTo(1 / 3);
    expect(summary.varianceNote).toContain('cannot estimate model variance');
    const cleanProbe = summary.probeStability.find((probe) => probe.probeId === 'clean-one-click');
    expect(cleanProbe).toEqual(expect.objectContaining({
      providerFailureCount: 1,
      providerFailureRate: 1,
      exactSignalMatchCount: 0,
      verdictMatchCount: 0,
    }));
  });

  it('refuses to pool different models into one variance aggregate', () => {
    const rows = [clean(), feedback(), deadEnd()];
    expect(() => summarizeConnectedModelCalibrationVariance([
      result(1, rows, 'model-a'),
      result(2, rows, 'model-b'),
    ])).toThrow('same providerId and model');
  });
});
