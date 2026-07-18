import type { RunResult, Scenario, Severity } from '../../types.js';

export function classifySeverity(result: RunResult, scenario: Scenario): Severity {
  if (result.status === 'blocked') return 'P2';
  if (result.status === 'failed') return scenario.severityIfFailed;
  if (result.consoleErrors.length > 0 || result.networkErrors.length > 0) return 'P2';
  return 'P3';
}

