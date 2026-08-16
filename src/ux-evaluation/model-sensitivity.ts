import type { UxIssueType } from '../../types.js';

export interface ModelSensitivityObservation {
  fixtureId: string;
  expectedSignals: UxIssueType[];
  predictedSignals: UxIssueType[];
  actorActions: string[];
  runStatus: string | null;
  verdict: string | null;
  failureSource: string | null;
  providerFailure: string | null;
}

export interface ModelSensitivityRow extends ModelSensitivityObservation {
  missingSignals: UxIssueType[];
  extraSignals: UxIssueType[];
  preservedSignals: UxIssueType[];
  cleanDrift: boolean;
}

export interface ModelSensitivitySummary {
  schemaVersion: 1;
  analysisMode: 'connected_model_sensitivity';
  scenarioCount: number;
  eligibleScenarioCount: number;
  providerFailureCount: number;
  expectedSignalCount: number;
  preservedSignalCount: number;
  missingSignalCount: number;
  extraSignalCount: number;
  signalPreservationRate: number;
  cleanScenarioCount: number;
  cleanScenarioWithDriftCount: number;
  cleanDriftRate: number;
  rows: ModelSensitivityRow[];
}

function uniqueSignals(values: UxIssueType[]): UxIssueType[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Connected-model sensitivity is deliberately not a UX-accuracy score.
 *
 * It measures how much a remote-model run perturbs an already calibrated browser corpus:
 * - expected detector signals that survive the model-driven run;
 * - extra signals introduced by the model-driven path;
 * - clean fixtures that become noisy;
 * - provider/runtime failures, which are excluded from signal denominators.
 */
export function summarizeModelSensitivity(observations: ModelSensitivityObservation[]): ModelSensitivitySummary {
  const rows = observations.map((observation): ModelSensitivityRow => {
    const expectedSignals = uniqueSignals(observation.expectedSignals);
    const predictedSignals = uniqueSignals(observation.predictedSignals);
    const expected = new Set(expectedSignals);
    const predicted = new Set(predictedSignals);
    const preservedSignals = expectedSignals.filter((signal) => predicted.has(signal));
    const missingSignals = expectedSignals.filter((signal) => !predicted.has(signal));
    const extraSignals = predictedSignals.filter((signal) => !expected.has(signal));
    return {
      ...observation,
      expectedSignals,
      predictedSignals,
      preservedSignals,
      missingSignals,
      extraSignals,
      cleanDrift: !observation.providerFailure && expectedSignals.length === 0 && predictedSignals.length > 0,
    };
  });

  const eligible = rows.filter((row) => !row.providerFailure);
  const expectedSignalCount = eligible.reduce((sum, row) => sum + row.expectedSignals.length, 0);
  const preservedSignalCount = eligible.reduce((sum, row) => sum + row.preservedSignals.length, 0);
  const missingSignalCount = eligible.reduce((sum, row) => sum + row.missingSignals.length, 0);
  const extraSignalCount = eligible.reduce((sum, row) => sum + row.extraSignals.length, 0);
  const cleanRows = eligible.filter((row) => row.expectedSignals.length === 0);
  const cleanScenarioWithDriftCount = cleanRows.filter((row) => row.cleanDrift).length;

  return {
    schemaVersion: 1,
    analysisMode: 'connected_model_sensitivity',
    scenarioCount: rows.length,
    eligibleScenarioCount: eligible.length,
    providerFailureCount: rows.length - eligible.length,
    expectedSignalCount,
    preservedSignalCount,
    missingSignalCount,
    extraSignalCount,
    signalPreservationRate: expectedSignalCount === 0 ? 1 : preservedSignalCount / expectedSignalCount,
    cleanScenarioCount: cleanRows.length,
    cleanScenarioWithDriftCount,
    cleanDriftRate: cleanRows.length === 0 ? 0 : cleanScenarioWithDriftCount / cleanRows.length,
    rows,
  };
}
