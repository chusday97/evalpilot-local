import { createHash } from 'node:crypto';
import type { EvalCaseResult, UxIssueType, WaitPolicy } from '../../types.js';

export interface ConnectedModelCalibrationProbe {
  probeId: string;
  purpose: string;
  html: string;
  expectedTypes: UxIssueType[];
  expectedVerdict: EvalCaseResult['verdict'];
}

export interface ConnectedModelProbeSuiteIdentity {
  version: 2;
  fingerprint: string;
  probeIds: string[];
}

export const connectedModelCalibratedTypes: UxIssueType[] = [
  'repeated_input_issue',
  'interaction_feedback_issue',
  'path_efficiency_issue',
  'journey_breakpoint',
  'abandonment_risk',
];

export const connectedModelProbeWaitPolicy: WaitPolicy = {
  initialObservationMs: 25,
  pollIntervalMs: 50,
  softTimeoutMs: 150,
  hardTimeoutMs: 350,
  progressExtensionMs: 100,
  maxProgressExtensions: 1,
};

/**
 * Runtime semantics are part of the controlled experiment, not an implementation detail.
 * Changing task/exploration mode or the Actor knowledge boundary can alter behavior even when
 * the HTML fixtures are identical, so these values must participate in the suite fingerprint.
 */
export const connectedModelProbeRuntimeContract = {
  actorMode: 'exploration' as const,
  actorKnowledgeBoundary: 'blind_actor_case_v1' as const,
  oracleAutoFinish: 'disabled' as const,
};

export const connectedModelProbeActorContract = {
  persona: {
    personaId: 'persona-connected-model-calibration',
    name: 'New user',
    knowledgeLevel: 'low' as const,
    patienceTurns: 6,
    retryTolerance: 2,
    privacySensitivity: 'medium' as const,
    behaviorPolicy: ['Only use the visible interface and the stated goal.'],
    exitConditions: ['Stop when the goal is complete or no safe next action exists.'],
  },
  goal: 'Reach the Done state using the visible interface.',
  oracle: {
    expectedOutcome: ['Done'],
    mustObserve: ['Done'],
    mustNotObserve: ['Fatal error'],
    businessRules: [] as string[],
    semanticRubric: ['Goal completion is visibly proven.'],
    deterministicAssertions: [{ assertionId: 'done-visible', type: 'text_visible' as const, target: 'Done', expected: true, negated: false }],
    inconclusiveWhen: ['Visible evidence does not prove completion.'],
  },
};

export const connectedModelCalibrationProbes: ConnectedModelCalibrationProbe[] = [
  {
    probeId: 'clean-one-click',
    purpose: 'Measure whether the model invents hesitation/backtracking/retries on a trivial clean path.',
    html: '<main><h1>Start</h1><p>Press Continue to finish.</p><button onclick="document.querySelector(\'main\').innerHTML=\'<h1>Done</h1><p>Saved.</p>\'">Continue</button></main>',
    expectedTypes: [],
    expectedVerdict: 'pass',
  },
  {
    probeId: 'no-feedback-retry',
    purpose: 'Measure whether the interaction-feedback signal survives natural model behavior.',
    html: '<main><h1>Start</h1><p>Press Continue to finish.</p><button onclick="window.__n=(window.__n||0)+1;if(window.__n>1)document.querySelector(\'main\').innerHTML=\'<h1>Done</h1><p>Saved.</p>\'">Continue</button></main>',
    expectedTypes: ['interaction_feedback_issue'],
    expectedVerdict: 'pass',
  },
  {
    probeId: 'objective-dead-end',
    purpose: 'Measure whether an objective dead end remains detectable when the actor is a real connected model.',
    html: '<main><h1>Home</h1><p>The requested item may be in Archive.</p><button onclick="document.querySelector(\'main\').innerHTML=\'<h1>Archive</h1><p>No actions available.</p>\'">Archive</button></main>',
    expectedTypes: ['journey_breakpoint', 'abandonment_risk'],
    expectedVerdict: 'inconclusive',
  },
];

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

export function buildConnectedModelProbeSuiteIdentity(
  probes: ConnectedModelCalibrationProbe[] = connectedModelCalibrationProbes,
): ConnectedModelProbeSuiteIdentity {
  const contract = {
    version: 2,
    calibratedTypes: [...connectedModelCalibratedTypes].sort((left, right) => left.localeCompare(right)),
    runtimeContract: connectedModelProbeRuntimeContract,
    actorContract: connectedModelProbeActorContract,
    waitPolicy: connectedModelProbeWaitPolicy,
    probes,
  };
  return {
    version: 2,
    fingerprint: createHash('sha256').update(stableJson(contract)).digest('hex'),
    probeIds: probes.map((probe) => probe.probeId),
  };
}

/**
 * Artifact compatibility is tied to the complete controlled probe contract rather than a label.
 * Changing probe HTML, ground truth, Actor contract, Blind runtime semantics, calibrated detector
 * classes, or the fixed wait policy changes this fingerprint and prevents accidental pooling.
 */
export const connectedModelProbeSuiteIdentity = buildConnectedModelProbeSuiteIdentity();
