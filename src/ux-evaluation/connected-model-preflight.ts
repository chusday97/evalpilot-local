import type { ConnectedModelCalibrationExecutionConfig } from './connected-model-calibration.js';
import { connectedModelCalibrationProbes, connectedModelProbeSuiteIdentity } from './connected-model-probe-suite.js';

export interface ConnectedModelProviderStatus {
  provider: string | null;
  displayName: string | null;
  configured: boolean;
  source: string | null;
  protocol: string | null;
  apiHost: string | null;
  model: string | null;
  connectedAt: string | null;
}

export interface ConnectedModelCalibrationPreflight {
  schemaVersion: 1;
  analysisMode: 'connected_model_behavior_preflight';
  status: 'ready' | 'blocked';
  canRun: boolean;
  remoteCallsMade: false;
  provider: {
    configured: boolean;
    providerId: string | null;
    displayName: string | null;
    model: string | null;
    protocol: string | null;
    apiHost: string | null;
    source: string | null;
  };
  probeSuite: typeof connectedModelProbeSuiteIdentity;
  executionConfig: ConnectedModelCalibrationExecutionConfig;
  workload: {
    runs: number;
    probesPerRun: number;
    probeExecutions: number;
    maxActorDecisionRequests: number;
    additionalSemanticVerificationRequests: 'variable';
    note: string;
  };
  artifactPlan: {
    outputRoot: string;
    sessionDirectoryPattern: string;
    rawRunArtifactPattern: string;
    aggregateArtifact: string;
    singleRunCompatibilityArtifact: string;
  };
  reasons: string[];
  claimBoundary: string[];
}

export function buildConnectedModelCalibrationPreflight(input: {
  connection: ConnectedModelProviderStatus;
  outputRoot: string;
  runCount: number;
  maxSteps: number;
  allowScreenshotToProvider: boolean;
}): ConnectedModelCalibrationPreflight {
  const providerReady = input.connection.configured && Boolean(input.connection.provider) && Boolean(input.connection.model);
  const probeCount = connectedModelCalibrationProbes.length;
  const reasons = providerReady
    ? [
        `Remote provider metadata is configured: ${input.connection.provider} / ${input.connection.model}.`,
        'Preflight does not validate billing, quota, runtime reachability, or per-request authorization.',
      ]
    : [
        'No configured remote provider metadata is available. Connect a provider before executing calibration.',
        'No remote model call was made by this preflight.',
      ];

  return {
    schemaVersion: 1,
    analysisMode: 'connected_model_behavior_preflight',
    status: providerReady ? 'ready' : 'blocked',
    canRun: providerReady,
    remoteCallsMade: false,
    provider: {
      configured: input.connection.configured,
      providerId: input.connection.provider,
      displayName: input.connection.displayName,
      model: input.connection.model,
      protocol: input.connection.protocol,
      apiHost: input.connection.apiHost,
      source: input.connection.source,
    },
    probeSuite: {
      ...connectedModelProbeSuiteIdentity,
      probeIds: [...connectedModelProbeSuiteIdentity.probeIds],
    },
    executionConfig: {
      maxSteps: input.maxSteps,
      allowScreenshotToProvider: input.allowScreenshotToProvider,
    },
    workload: {
      runs: input.runCount,
      probesPerRun: probeCount,
      probeExecutions: input.runCount * probeCount,
      maxActorDecisionRequests: input.runCount * probeCount * input.maxSteps,
      additionalSemanticVerificationRequests: 'variable',
      note: 'Actor decision requests have a deterministic upper bound from runs × probes × maxSteps. Semantic verification can add remote requests depending on the actual action path, so total provider requests and cost are not claimed here.',
    },
    artifactPlan: {
      outputRoot: input.outputRoot,
      sessionDirectoryPattern: 'connected-model-<ISO timestamp>/',
      rawRunArtifactPattern: 'runs/run-<NNN>/connected-model-calibration.json',
      aggregateArtifact: 'connected-model-variance.json',
      singleRunCompatibilityArtifact: 'connected-model-calibration.json (only when --runs 1)',
    },
    reasons,
    claimBoundary: [
      'Preflight is local planning only and makes zero remote provider calls.',
      'Configured metadata does not prove the provider will accept a paid/runtime request.',
      'The Actor request upper bound is not a total-request or cost estimate because semantic verification is path-dependent.',
      'Screenshots remain disabled unless explicitly enabled for the real run.',
    ],
  };
}
