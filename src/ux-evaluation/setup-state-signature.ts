import { createHash } from 'node:crypto';
import type { DeterministicAssertion, EvalCase } from '../../types.js';

export interface SetupStateSignature {
  schemaVersion: 1;
  taskId: string;
  knownInformationFingerprint: string;
  observableContractFingerprint: string;
  fingerprint: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function sortedStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortedAssertions(values: DeterministicAssertion[]): DeterministicAssertion[] {
  return [...values].sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

/**
 * V1 setup-state equivalence is deliberately exact and conservative.
 *
 * Two baseline cases are considered reusable representations of the same evaluator-managed
 * Setup state only when their task, fixture knowledge and observable state contract hash to
 * the same signature. This is not semantic similarity and does not infer that two different
 * configurations lead to the same business state.
 */
export function buildSetupStateSignature(evalCase: EvalCase): SetupStateSignature {
  if (!evalCase.taskId) throw new Error(`Setup baseline ${evalCase.caseId} has no taskId.`);
  const knownInformationFingerprint = hash(evalCase.knownInformation);
  const observableContract = {
    expectedOutcome: sortedStrings(evalCase.oracle.expectedOutcome),
    mustObserve: sortedStrings(evalCase.oracle.mustObserve),
    mustNotObserve: sortedStrings(evalCase.oracle.mustNotObserve),
    businessRules: sortedStrings(evalCase.oracle.businessRules),
    deterministicAssertions: sortedAssertions(evalCase.oracle.deterministicAssertions),
  };
  const observableContractFingerprint = hash(observableContract);
  return {
    schemaVersion: 1,
    taskId: evalCase.taskId,
    knownInformationFingerprint,
    observableContractFingerprint,
    fingerprint: hash({
      schemaVersion: 1,
      taskId: evalCase.taskId,
      knownInformationFingerprint,
      observableContractFingerprint,
    }),
  };
}
