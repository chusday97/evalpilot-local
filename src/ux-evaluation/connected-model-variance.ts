import type { EvalCaseResult, UxIssueType } from '../../types.js';
import {
  connectedModelCalibrationProbes,
  type ConnectedModelCalibrationMetrics,
  type ConnectedModelCalibrationResult,
  type ConnectedModelCalibrationRow,
} from './connected-model-calibration.js';

export interface ConnectedModelMetricDistribution {
  values: number[];
  mean: number;
  min: number;
  max: number;
}

export interface ConnectedModelRunSummary {
  runIndex: number;
  generatedAt: string;
  metrics: ConnectedModelCalibrationMetrics;
}

export interface ConnectedModelSignalFrequency {
  type: UxIssueType;
  presentCount: number;
  rate: number;
}

export interface ConnectedModelActionSequenceFrequency {
  sequence: string;
  count: number;
  rate: number;
}

export interface ConnectedModelProbeStability {
  probeId: string;
  runCount: number;
  expectedTypes: UxIssueType[];
  expectedVerdict: EvalCaseResult['verdict'];
  expectedSignalPresence: ConnectedModelSignalFrequency[];
  extraSignalPresence: ConnectedModelSignalFrequency[];
  exactSignalMatchCount: number;
  exactSignalMatchRate: number;
  verdictCounts: Record<EvalCaseResult['verdict'], number>;
  verdictMatchCount: number;
  verdictMatchRate: number;
  providerFailureCount: number;
  providerFailureRate: number;
  actionSequences: ConnectedModelActionSequenceFrequency[];
}

export interface ConnectedModelCalibrationVarianceResult {
  schemaVersion: 1;
  analysisMode: 'connected_model_behavior_variance';
  provider: ConnectedModelCalibrationResult['provider'];
  generatedAt: string;
  runCount: number;
  runSummaries: ConnectedModelRunSummary[];
  metricDistributions: {
    precisionAgainstProbeGroundTruth: ConnectedModelMetricDistribution;
    signalPreservationRecall: ConnectedModelMetricDistribution;
    exactSignalMatchRate: ConnectedModelMetricDistribution;
    cleanActorDriftRate: ConnectedModelMetricDistribution;
  };
  providerFailureCount: number;
  probeExecutionCount: number;
  providerFailureRate: number;
  probeStability: ConnectedModelProbeStability[];
  varianceNote: string;
  claimBoundary: string[];
}

function distribution(values: number[]): ConnectedModelMetricDistribution {
  if (!values.length) throw new Error('Connected-model variance requires at least one metric value.');
  return {
    values: [...values],
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function sameSignals(expected: UxIssueType[], predicted: UxIssueType[]): boolean {
  const expectedSet = new Set(expected);
  const predictedSet = new Set(predicted);
  return expectedSet.size === predictedSet.size && [...expectedSet].every((value) => predictedSet.has(value));
}

function frequency(types: UxIssueType[], rows: ConnectedModelCalibrationRow[]): ConnectedModelSignalFrequency[] {
  return [...new Set(types)]
    .sort((left, right) => left.localeCompare(right))
    .map((type) => {
      const presentCount = rows.filter((row) => row.predictedTypes.includes(type)).length;
      return { type, presentCount, rate: rows.length ? presentCount / rows.length : 0 };
    });
}

function actionSequenceFrequencies(rows: ConnectedModelCalibrationRow[]): ConnectedModelActionSequenceFrequency[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const sequence = row.actorActions.length ? row.actorActions.join(' → ') : '(no actions)';
    counts.set(sequence, (counts.get(sequence) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sequence, count]) => ({ sequence, count, rate: rows.length ? count / rows.length : 0 }))
    .sort((left, right) => right.count - left.count || left.sequence.localeCompare(right.sequence));
}

function probeStability(results: ConnectedModelCalibrationResult[]): ConnectedModelProbeStability[] {
  return connectedModelCalibrationProbes.map((probe) => {
    const rows = results.flatMap((result) => result.rows.filter((row) => row.probeId === probe.probeId));
    if (rows.length !== results.length) {
      throw new Error(`Connected-model variance is missing probe ${probe.probeId} in one or more runs.`);
    }
    const expectedSet = new Set(probe.expectedTypes);
    const extraTypes = rows.flatMap((row) => row.predictedTypes.filter((type) => !expectedSet.has(type)));
    const exactSignalMatchCount = rows.filter((row) => row.failureSource !== 'evaluator' && sameSignals(probe.expectedTypes, row.predictedTypes)).length;
    const verdictCounts: Record<EvalCaseResult['verdict'], number> = { pass: 0, fail: 0, inconclusive: 0 };
    for (const row of rows) verdictCounts[row.observedVerdict] += 1;
    const verdictMatchCount = rows.filter((row) => row.failureSource !== 'evaluator' && row.observedVerdict === probe.expectedVerdict).length;
    const providerFailureCount = rows.filter((row) => row.failureSource === 'evaluator').length;
    return {
      probeId: probe.probeId,
      runCount: rows.length,
      expectedTypes: [...probe.expectedTypes],
      expectedVerdict: probe.expectedVerdict,
      expectedSignalPresence: frequency(probe.expectedTypes, rows),
      extraSignalPresence: frequency(extraTypes, rows),
      exactSignalMatchCount,
      exactSignalMatchRate: exactSignalMatchCount / rows.length,
      verdictCounts,
      verdictMatchCount,
      verdictMatchRate: verdictMatchCount / rows.length,
      providerFailureCount,
      providerFailureRate: providerFailureCount / rows.length,
      actionSequences: actionSequenceFrequencies(rows),
    };
  });
}

export function summarizeConnectedModelCalibrationVariance(
  results: ConnectedModelCalibrationResult[],
): ConnectedModelCalibrationVarianceResult {
  if (!results.length) throw new Error('Connected-model variance requires at least one completed calibration run.');
  const provider = results[0]!.provider;
  for (const result of results) {
    if (result.provider.providerId !== provider.providerId || result.provider.model !== provider.model) {
      throw new Error('Connected-model variance can only aggregate runs from the same providerId and model.');
    }
  }

  const providerFailureCount = results.reduce((sum, result) => sum + result.metrics.providerFailureCount, 0);
  const probeExecutionCount = results.reduce((sum, result) => sum + result.rows.length, 0);
  const runCount = results.length;
  return {
    schemaVersion: 1,
    analysisMode: 'connected_model_behavior_variance',
    provider: { ...provider },
    generatedAt: new Date().toISOString(),
    runCount,
    runSummaries: results.map((result, index) => ({ runIndex: index + 1, generatedAt: result.generatedAt, metrics: result.metrics })),
    metricDistributions: {
      precisionAgainstProbeGroundTruth: distribution(results.map((result) => result.metrics.precisionAgainstProbeGroundTruth)),
      signalPreservationRecall: distribution(results.map((result) => result.metrics.signalPreservationRecall)),
      exactSignalMatchRate: distribution(results.map((result) => result.metrics.exactSignalMatchRate)),
      cleanActorDriftRate: distribution(results.map((result) => result.metrics.cleanActorDriftRate)),
    },
    providerFailureCount,
    probeExecutionCount,
    providerFailureRate: probeExecutionCount ? providerFailureCount / probeExecutionCount : 0,
    probeStability: probeStability(results),
    varianceNote: runCount === 1
      ? 'Only one run is present. This artifact records a baseline sample but cannot estimate model variance.'
      : `Variance summary across ${runCount} independent runs of the same provider/model. No pass/fail threshold is inferred from this sample.`,
    claimBoundary: [
      'Variance describes repeated connected-model behavior on controlled probes, not human usability variance.',
      'Runs from different provider/model identities are intentionally not pooled into one aggregate.',
      'Signal frequencies and ranges are descriptive; this layer does not define acceptance thresholds.',
      'Raw per-run artifacts remain the primary evidence and should be retained alongside this aggregate.',
    ],
  };
}
