import { describe, expect, it } from 'vitest';
import type { EvalCaseResult, UxIssueType } from '../types.js';
import {
  summarizeConnectedModelCalibration,
  type ConnectedModelCalibrationResult,
  type ConnectedModelCalibrationRow,
} from '../src/ux-evaluation/connected-model-calibration.js';
import { connectedModelProbeSuiteIdentity } from '../src/ux-evaluation/connected-model-probe-suite.js';
import { summarizeConnectedModelCalibrationVariance } from '../src/ux-evaluation/connected-model-variance.js';

const provider = { providerId: 'deepseek', model: 'deepseek-v4-flash', remote: true };
const executionConfig = { maxSteps: 6, allowScreenshotToProvider: false };
const deadEndExpectedTypes: UxIssueType[] = ['journey_breakpoint', 'abandonment_risk'];

function row(input: {
  probeId: 'clean-one-click' | 'no-feedback-retry' | 'objective-dead-end';
  expectedTypes: UxIssueType[];
  expectedVerdict: EvalCaseResult['verdict'];
  predictedTypes: UxIssueType[];
  observedVerdict: EvalCaseResult['verdict'];
  actorActions: string[];
  runIndex: number;
}): ConnectedModelCalibrationRow {
  return {
    probeId: input.probeId,
    purpose: `Observed variance regression for ${input.probeId}`,
    expectedTypes: input.expectedTypes,
    expectedVerdict: input.expectedVerdict,
    predictedTypes: input.predictedTypes,
    observedVerdict: input.observedVerdict,
    actorActions: input.actorActions,
    agentStatus: input.observedVerdict === 'inconclusive' ? 'abandoned' : 'completed',
    failureSource: null,
    providerFailure: null,
    runId: `observed-variance-run-${input.runIndex}-${input.probeId}`,
  };
}

function calibrationRun(runIndex: number, deadEndBacktracks: boolean): ConnectedModelCalibrationResult {
  const rows: ConnectedModelCalibrationRow[] = [
    row({
      probeId: 'clean-one-click',
      expectedTypes: [],
      expectedVerdict: 'pass',
      predictedTypes: [],
      observedVerdict: 'pass',
      actorActions: ['click', 'finish'],
      runIndex,
    }),
    row({
      probeId: 'no-feedback-retry',
      expectedTypes: ['interaction_feedback_issue'],
      expectedVerdict: 'pass',
      predictedTypes: ['interaction_feedback_issue'],
      observedVerdict: 'pass',
      actorActions: ['click', 'click', 'finish'],
      runIndex,
    }),
    row({
      probeId: 'objective-dead-end',
      expectedTypes: deadEndExpectedTypes,
      expectedVerdict: 'inconclusive',
      predictedTypes: deadEndBacktracks
        ? [...deadEndExpectedTypes, 'path_efficiency_issue']
        : [...deadEndExpectedTypes],
      observedVerdict: 'inconclusive',
      actorActions: deadEndBacktracks ? ['click', 'back', 'abandon'] : ['click', 'abandon'],
      runIndex,
    }),
  ];

  return {
    schemaVersion: 1,
    analysisMode: 'connected_model_behavior_sensitivity',
    provider,
    probeSuite: { ...connectedModelProbeSuiteIdentity, probeIds: [...connectedModelProbeSuiteIdentity.probeIds] },
    executionConfig,
    generatedAt: `2026-08-16T0${runIndex}:00:00.000Z`,
    metrics: summarizeConnectedModelCalibration(rows),
    rows,
    methodology: [],
    claimBoundary: [],
  };
}

describe('observed connected-model variance regression', () => {
  it('keeps the real dead-end backtrack overlap visible without reclassifying it as provider or evaluator failure', () => {
    // This fixture mirrors the first real DeepSeek 3-run cohort observed on 2026-08-16:
    // two objective-dead-end runs used click → abandon, while one tried
    // click → back → abandon and therefore also produced path_efficiency_issue.
    // The regression intentionally preserves the variance; it does not suppress the extra signal.
    const summary = summarizeConnectedModelCalibrationVariance([
      calibrationRun(1, false),
      calibrationRun(2, true),
      calibrationRun(3, false),
    ]);

    expect(summary).toEqual(expect.objectContaining({
      runCount: 3,
      providerFailureCount: 0,
      evaluatorFailureCount: 0,
      probeExecutionCount: 9,
      eligibleProbeExecutionCount: 9,
      providerFailureRate: 0,
      evaluatorFailureRate: 0,
    }));

    const deadEnd = summary.probeStability.find((probe) => probe.probeId === 'objective-dead-end');
    expect(deadEnd).toEqual(expect.objectContaining({
      runCount: 3,
      eligibleRunCount: 3,
      exactSignalMatchCount: 2,
      exactSignalMatchRate: 2 / 3,
      verdictMatchCount: 3,
      verdictMatchRate: 1,
      providerFailureCount: 0,
      evaluatorFailureCount: 0,
    }));
    expect(deadEnd?.expectedSignalPresence).toEqual([
      { type: 'abandonment_risk', presentCount: 3, rate: 1 },
      { type: 'journey_breakpoint', presentCount: 3, rate: 1 },
    ]);
    expect(deadEnd?.extraSignalPresence).toEqual([
      { type: 'path_efficiency_issue', presentCount: 1, rate: 1 / 3 },
    ]);
    expect(deadEnd?.actionSequences).toEqual([
      { sequence: 'click → abandon', count: 2, rate: 2 / 3 },
      { sequence: 'click → back → abandon', count: 1, rate: 1 / 3 },
    ]);
  });
});
