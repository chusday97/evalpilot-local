import { describe, expect, it } from 'vitest';
import type { AiTestAgentRun, EvalCaseResult, UxIssueType } from '../types.js';
import {
  connectedModelProbeSuiteIdentity,
  summarizeConnectedModelCalibration,
  type ConnectedModelCalibrationResult,
  type ConnectedModelCalibrationRow,
} from '../src/ux-evaluation/connected-model-calibration.js';
import { summarizeConnectedModelCalibrationVariance } from '../src/ux-evaluation/connected-model-variance.js';

const provider = { providerId: 'openai', model: 'fixture-model', remote: true };
const executionConfig = { maxSteps: 6, allowScreenshotToProvider: false };

function row(input: {
  probeId: 'clean-one-click' | 'no-feedback-retry' | 'objective-dead-end';
  expectedTypes: UxIssueType[];
  expectedVerdict: EvalCaseResult['verdict'];
  predictedTypes: UxIssueType[];
  observedVerdict: EvalCaseResult['verdict'];
  actorActions?: string[];
  failureSource?: AiTestAgentRun['failureSource'];
}): ConnectedModelCalibrationRow {
  return {
    probeId: input.probeId,
    purpose: input.probeId,
    expectedTypes: input.expectedTypes,
    expectedVerdict: input.expectedVerdict,
    predictedTypes: input.predictedTypes,
    observedVerdict: input.observedVerdict,
    actorActions: input.actorActions ?? [],
    agentStatus: input.failureSource === 'evaluator' ? 'inconclusive' : 'completed',
    failureSource: input.failureSource ?? null,
    runId: `run-${input.probeId}`,
  };
}

function result(
  index: number,
  rows: ConnectedModelCalibrationRow[],
  overrides: Partial<Pick<ConnectedModelCalibrationResult, 'provider' | 'probeSuite' | 'executionConfig'>> = {},
): ConnectedModelCalibrationResult {
  return {
    schemaVersion: 1,
    analysisMode: 'connected_model_behavior_sensitivity',
    provider: overrides.provider ?? { ...provider },
    probeSuite: overrides.probeSuite ?? { ...connectedModelProbeSuiteIdentity, probeIds: [...connectedModelProbeSuiteIdentity.probeIds] },
    executionConfig: overrides.executionConfig ?? { ...executionConfig },
    generatedAt: `2026-08-16T0${index}:00:00.000Z`,
    metrics: summarizeConnectedModelCalibration(rows),
    rows,
    methodology: [],
    claimBoundary: [],
  };
}

function clean(predictedTypes: UxIssueType[] = [], observedVerdict: EvalCaseResult['verdict'] = 'pass', actions: string[] = ['click', 'finish'], failureSource?: AiTestAgentRun['failureSource']) {
  return row({ probeId: 'clean-one-click', expectedTypes: [], expectedVerdict: 'pass', predictedTypes, observedVerdict, actorActions: actions, failureSource });
}

function feedback(predictedTypes: UxIssueType[] = ['interaction_feedback_issue'], observedVerdict: EvalCaseResult['verdict'] = 'pass') {
  return row({ probeId: 'no-feedback-retry', expectedTypes: ['interaction_feedback_issue'], expectedVerdict: 'pass', predictedTypes, observedVerdict, actorActions: ['click', 'click', 'finish'] });
}

function deadEnd(predictedTypes: UxIssueType[] = ['journey_breakpoint', 'abandonment_risk']) {
  return row({ probeId: 'objective-dead-end', expectedTypes: ['journey_breakpoint', 'abandonment_risk'], expectedVerdict: 'inconclusive', predictedTypes, observedVerdict: 'inconclusive', actorActions: ['click', 'abandon'] });
}

describe('connected-model calibration variance', () => {
  it('summarizes only runs with the same model, suite fingerprint, and execution config', () => {
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
      eligibleProbeExecutionCount: 9,
      providerFailureRate: 0,
      probeSuite: connectedModelProbeSuiteIdentity,
      executionConfig,
    }));
    expect(summary.metricDistributions.signalPreservationRecall.values).toHaveLength(3);
    expect(summary.metricDistributions.signalPreservationRecall.min).toBeLessThan(summary.metricDistributions.signalPreservationRecall.max);
    expect(summary.varianceNote).toContain('same provider/model, probe suite, and execution config');

    const byId = new Map(summary.probeStability.map((probe) => [probe.probeId, probe]));
    expect(byId.get('clean-one-click')).toEqual(expect.objectContaining({
      expectedVerdict: 'pass',
      eligibleRunCount: 3,
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

  it('keeps provider failures visible while removing them from behavior denominators', () => {
    const failedClean = clean([], 'inconclusive', [], 'evaluator');
    const summary = summarizeConnectedModelCalibrationVariance([
      result(1, [failedClean, feedback(), deadEnd()]),
    ]);

    expect(summary.runCount).toBe(1);
    expect(summary.providerFailureCount).toBe(1);
    expect(summary.probeExecutionCount).toBe(3);
    expect(summary.eligibleProbeExecutionCount).toBe(2);
    expect(summary.providerFailureRate).toBeCloseTo(1 / 3);
    expect(summary.varianceNote).toContain('cannot estimate model variance');
    const cleanProbe = summary.probeStability.find((probe) => probe.probeId === 'clean-one-click');
    expect(cleanProbe).toEqual(expect.objectContaining({
      runCount: 1,
      eligibleRunCount: 0,
      providerFailureCount: 1,
      providerFailureRate: 1,
      exactSignalMatchCount: 0,
      exactSignalMatchRate: 0,
      verdictMatchCount: 0,
      verdictMatchRate: 0,
      expectedSignalPresence: [],
      extraSignalPresence: [],
      actionSequences: [],
    }));
  });

  it('uses only successful model-behavior samples for per-probe rates across repeated runs', () => {
    const failedClean = clean([], 'inconclusive', [], 'evaluator');
    const summary = summarizeConnectedModelCalibrationVariance([
      result(1, [failedClean, feedback(), deadEnd()]),
      result(2, [clean(), feedback(), deadEnd()]),
    ]);

    const cleanProbe = summary.probeStability.find((probe) => probe.probeId === 'clean-one-click');
    expect(cleanProbe).toEqual(expect.objectContaining({
      runCount: 2,
      eligibleRunCount: 1,
      providerFailureCount: 1,
      providerFailureRate: 0.5,
      exactSignalMatchCount: 1,
      exactSignalMatchRate: 1,
      verdictMatchCount: 1,
      verdictMatchRate: 1,
    }));
    expect(cleanProbe?.actionSequences).toEqual([
      expect.objectContaining({ sequence: 'click → finish', count: 1, rate: 1 }),
    ]);
  });

  it('refuses to pool different models into one variance aggregate', () => {
    const rows = [clean(), feedback(), deadEnd()];
    expect(() => summarizeConnectedModelCalibrationVariance([
      result(1, rows, { provider: { ...provider, model: 'model-a' } }),
      result(2, rows, { provider: { ...provider, model: 'model-b' } }),
    ])).toThrow('same providerId and model');
  });

  it('refuses to pool different probe-suite fingerprints', () => {
    const rows = [clean(), feedback(), deadEnd()];
    expect(() => summarizeConnectedModelCalibrationVariance([
      result(1, rows),
      result(2, rows, { probeSuite: { ...connectedModelProbeSuiteIdentity, fingerprint: '0'.repeat(64), probeIds: [...connectedModelProbeSuiteIdentity.probeIds] } }),
    ])).toThrow('same probe-suite fingerprint');
  });

  it('refuses to pool different execution configs', () => {
    const rows = [clean(), feedback(), deadEnd()];
    expect(() => summarizeConnectedModelCalibrationVariance([
      result(1, rows),
      result(2, rows, { executionConfig: { ...executionConfig, maxSteps: 8 } }),
    ])).toThrow('same execution config');
  });

  it('rejects inconsistent embedded ground truth even when metadata claims the same suite', () => {
    const firstRows = [clean(), feedback(), deadEnd()];
    const secondRows = [
      clean(),
      row({ probeId: 'no-feedback-retry', expectedTypes: ['abandonment_risk'], expectedVerdict: 'pass', predictedTypes: ['abandonment_risk'], observedVerdict: 'pass' }),
      deadEnd(),
    ];
    expect(() => summarizeConnectedModelCalibrationVariance([
      result(1, firstRows),
      result(2, secondRows),
    ])).toThrow('inconsistent ground truth');
  });
});
