import type { EvalCaseResult, UxIssueType } from '../../types.js';
import type {
  ConnectedModelCalibrationExecutionConfig,
  ConnectedModelCalibrationMetrics,
  ConnectedModelCalibrationResult,
  ConnectedModelCalibrationRow,
} from './connected-model-calibration.js';
import type { ConnectedModelProbeSuiteIdentity } from './connected-model-probe-suite.js';

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
  probeSuite: ConnectedModelProbeSuiteIdentity;
  executionConfig: ConnectedModelCalibrationExecutionConfig;
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

function sameTypeList(left: UxIssueType[], right: UxIssueType[]): boolean {
  return sameSignals(left, right);
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
  const probeIds = results[0]!.probeSuite.probeIds;
  return probeIds.map((probeId) => {
    const rows = results.flatMap((result) => result.rows.filter((row) => row.probeId === probeId));
    if (rows.length !== results.length) {
      throw new Error(`Connected-model variance is missing probe ${probeId} in one or more runs.`);
    }
    const reference = rows[0]!;
    for (const row of rows) {
      if (!sameTypeList(row.expectedTypes, reference.expectedTypes) || row.expectedVerdict !== reference.expectedVerdict) {
        throw new Error(`Connected-model variance found inconsistent ground truth for probe ${probeId}.`);
      }
    }
    const expectedSet = new Set(reference.expectedTypes);
    const extraTypes = rows.flatMap((row) => row.predictedTypes.filter((type) => !expectedSet.has(type)));
    const exactSignalMatchCount = rows.filter((row) => row.failureSource !== 'evaluator' && sameSignals(reference.expectedTypes, row.predictedTypes)).length;
    const verdictCounts: Record<EvalCaseResult['verdict'], number> = { pass: 0, fail: 0, inconclusive: 0 };
    for (const row of rows) verdictCounts[row.observedVerdict] += 1;
    const verdictMatchCount = rows.filter((row) => row.failureSource !== 'evaluator' && row.observedVerdict === reference.expectedVerdict).length;
    const providerFailureCount = rows.filter((row) => row.failureSource === 'evaluator').length;
    return {
      probeId,
      runCount: rows.length,
      expectedTypes: [...reference.expectedTypes],
      expectedVerdict: reference.expectedVerdict,
      expectedSignalPresence: frequency(reference.expectedTypes, rows),
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

function sameExecutionConfig(left: ConnectedModelCalibrationExecutionConfig, right: ConnectedModelCalibrationExecutionConfig): boolean {
  return left.maxSteps === right.maxSteps && left.allowScreenshotToProvider === right.allowScreenshotToProvider;
}

export function summarizeConnectedModelCalibrationVariance(
  results: ConnectedModelCalibrationResult[],
): ConnectedModelCalibrationVarianceResult {
  if (!results.length) throw new Error('Connected-model variance requires at least one completed calibration run.');
  const provider = results[0]!.provider;
  const probeSuite = results[0]!.probeSuite;
  const executionConfig = results[0]!.executionConfig;
  for (const result of results) {
    if (result.provider.providerId !== provider.providerId || result.provider.model !== provider.model) {
      throw new Error('Connected-model variance can only aggregate runs from the same providerId and model.');
    }
    if (result.probeSuite.version !== probeSuite.version || result.probeSuite.fingerprint !== probeSuite.fingerprint) {
      throw new Error('Connected-model variance can only aggregate runs from the same probe-suite fingerprint.');
    }
    if (!sameExecutionConfig(result.executionConfig, executionConfig)) {
      throw new Error('Connected-model variance can only aggregate runs with the same execution config.');
    }
  }

  const providerFailureCount = results.reduce((sum, result) => sum + result.metrics.providerFailureCount, 0);
  const probeExecutionCount = results.reduce((sum, result) => sum + result.rows.length, 0);
  const runCount = results.length;
  return {
    schemaVersion: 1,
    analysisMode: 'connected_model_behavior_variance',
    provider: { ...provider },
    probeSuite: { ...probeSuite, probeIds: [...probeSuite.probeIds] },
    executionConfig: { ...executionConfig },
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
      : `Variance summary across ${runCount} independent runs of the same provider/model, probe suite, and execution config. No pass/fail threshold is inferred from this sample.`,
    claimBoundary: [
      'Variance describes repeated connected-model behavior on controlled probes, not human usability variance.',
      'Runs from different provider/model identities, probe-suite fingerprints, or execution configs are intentionally not pooled.',
      'Signal frequencies and ranges are descriptive; this layer does not define acceptance thresholds.',
      'Raw per-run artifacts remain the primary evidence and should be retained alongside this aggregate.',
    ],
  };
}
