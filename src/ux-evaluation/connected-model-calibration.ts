import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { AiProvider } from '../ai/provider.js';
import type { AiTestAgentRun, EvalCase, EvalCaseResult, EvidencePacket, UxIssueType } from '../../types.js';
import { runAiTestAgent } from '../test-agent/agent-runner.js';
import { analyzeBlindExperience } from './blind-experience-analyzer.js';

const calibratedTypes = new Set<UxIssueType>([
  'repeated_input_issue',
  'interaction_feedback_issue',
  'path_efficiency_issue',
  'journey_breakpoint',
  'abandonment_risk',
]);

export interface ConnectedModelCalibrationProbe {
  probeId: string;
  purpose: string;
  html: string;
  expectedTypes: UxIssueType[];
  expectedVerdict: EvalCaseResult['verdict'];
}

export interface ConnectedModelCalibrationRow {
  probeId: string;
  purpose: string;
  expectedTypes: UxIssueType[];
  predictedTypes: UxIssueType[];
  observedVerdict: EvalCaseResult['verdict'];
  actorActions: string[];
  agentStatus: AiTestAgentRun['status'];
  failureSource: AiTestAgentRun['failureSource'];
  runId: string;
}

export interface ConnectedModelCalibrationMetrics {
  precisionAgainstProbeGroundTruth: number;
  signalPreservationRecall: number;
  exactSignalMatchRate: number;
  cleanActorDriftRate: number;
  extraSignalCount: number;
  missingSignalCount: number;
  providerFailureCount: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface ConnectedModelCalibrationResult {
  schemaVersion: 1;
  analysisMode: 'connected_model_behavior_sensitivity';
  provider: { providerId: string; model: string; remote: boolean };
  generatedAt: string;
  metrics: ConnectedModelCalibrationMetrics;
  rows: ConnectedModelCalibrationRow[];
  methodology: string[];
  claimBoundary: string[];
}

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

function evalCase(probe: ConnectedModelCalibrationProbe, now: string): EvalCase {
  return {
    caseId: `connected-model-${probe.probeId}`,
    projectId: 'connected-model-calibration',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'connected-model behavior sensitivity probe' },
    capabilityId: `cap-${probe.probeId}`,
    taskId: `task-${probe.probeId}`,
    title: probe.probeId,
    hypothesis: probe.purpose,
    persona: {
      personaId: 'persona-connected-model-calibration',
      name: 'New user',
      knowledgeLevel: 'low',
      patienceTurns: 6,
      retryTolerance: 2,
      privacySensitivity: 'medium',
      behaviorPolicy: ['Only use the visible interface and the stated goal.'],
      exitConditions: ['Stop when the goal is complete or no safe next action exists.'],
    },
    goal: 'Reach the Done state using the visible interface.',
    knownInformation: {},
    preconditions: ['Fixture is open'],
    oracle: {
      expectedOutcome: ['Done'],
      mustObserve: ['Done'],
      mustNotObserve: ['Fatal error'],
      businessRules: [],
      semanticRubric: ['Goal completion is visibly proven.'],
      deterministicAssertions: [{ assertionId: 'done-visible', type: 'text_visible', target: 'Done', expected: true, negated: false }],
      inconclusiveWhen: ['Visible evidence does not prove completion.'],
    },
    coverageDimensions: [{ dimension: 'capability', value: `cap-${probe.probeId}` }],
    riskLevel: 'P2',
    generationReason: 'Connected-model behavior sensitivity probe',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function independentProbeResult(item: EvalCase, runId: string, verdict: EvalCaseResult['verdict'], now: string): EvalCaseResult {
  const complete = verdict === 'pass';
  return {
    runId,
    caseId: item.caseId,
    verdict,
    failureSource: null,
    severity: null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['probe-observed-state'] },
    semantic: {
      verdict,
      taskCompletion: complete ? 'complete' : 'unknown',
      summary: complete ? 'Done is visibly present after the connected-model run.' : 'Done is not visibly proven after the connected-model run.',
      whatWorked: [],
      whatFailed: [],
      whyItMatters: [],
      confirmedFacts: complete ? ['Done is visibly present.'] : ['Done is not visibly present.'],
      hypotheses: [],
      unknowns: complete ? [] : ['Whether the actor could recover with a different action sequence.'],
      evidenceRefs: ['probe-observed-state'],
      confidence: 1,
    },
    evidencePacketPath: 'probe-observed-state',
    createdAt: now,
  };
}

function calibrated(values: UxIssueType[]): UxIssueType[] {
  return [...new Set(values.filter((value) => calibratedTypes.has(value)))];
}

export function summarizeConnectedModelCalibration(rows: ConnectedModelCalibrationRow[]): ConnectedModelCalibrationMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let exact = 0;
  let clean = 0;
  let cleanWithSignal = 0;
  let providerFailureCount = 0;

  for (const row of rows) {
    const expected = new Set(calibrated(row.expectedTypes));
    const predicted = new Set(calibrated(row.predictedTypes));
    if (expected.size === 0) {
      clean += 1;
      if (predicted.size > 0) cleanWithSignal += 1;
    }
    if (expected.size === predicted.size && [...expected].every((value) => predicted.has(value))) exact += 1;
    for (const value of predicted) expected.has(value) ? tp += 1 : fp += 1;
    for (const value of expected) if (!predicted.has(value)) fn += 1;
    if (row.failureSource === 'evaluator') providerFailureCount += 1;
  }

  return {
    precisionAgainstProbeGroundTruth: tp + fp === 0 ? 1 : tp / (tp + fp),
    signalPreservationRecall: tp + fn === 0 ? 1 : tp / (tp + fn),
    exactSignalMatchRate: rows.length === 0 ? 1 : exact / rows.length,
    cleanActorDriftRate: clean === 0 ? 0 : cleanWithSignal / clean,
    extraSignalCount: fp,
    missingSignalCount: fn,
    providerFailureCount,
    tp,
    fp,
    fn,
  };
}

export async function runConnectedModelCalibration(input: {
  provider: AiProvider;
  outputDir?: string;
  allowScreenshotToProvider?: boolean;
  maxSteps?: number;
}): Promise<ConnectedModelCalibrationResult> {
  if (!input.provider.info.remote) throw new Error('Connected-model calibration requires a remote configured provider.');
  const generatedAt = new Date().toISOString();
  const outputDir = input.outputDir ?? await mkdtemp(join(tmpdir(), 'evalpilot-connected-model-calibration-'));
  const browser = await chromium.launch({ headless: true });
  const rows: ConnectedModelCalibrationRow[] = [];
  try {
    for (const probe of connectedModelCalibrationProbes) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.setContent(`<!doctype html><html><head><title>${probe.probeId}</title></head><body>${probe.html}</body></html>`);
        const item = evalCase(probe, generatedAt);
        const agentRun = await runAiTestAgent(page, item, input.provider, {
          outputDir: join(outputDir, probe.probeId),
          startingUrl: page.url(),
          maxSteps: input.maxSteps ?? 6,
          allowRemoteModel: true,
          allowScreenshotToProvider: input.allowScreenshotToProvider === true,
          waitPolicy: { initialObservationMs: 25, pollIntervalMs: 50, softTimeoutMs: 150, hardTimeoutMs: 350, progressExtensionMs: 100, maxProgressExtensions: 1 },
        });
        const packet = JSON.parse(await readFile(agentRun.evidencePacketPath, 'utf8')) as EvidencePacket;
        const doneVisible = await page.getByText('Done', { exact: true }).isVisible().catch(() => false);
        const observedVerdict: EvalCaseResult['verdict'] = doneVisible ? 'pass' : 'inconclusive';
        const result = independentProbeResult(item, agentRun.runId, observedVerdict, generatedAt);
        const analysis = analyzeBlindExperience({
          evalCase: item,
          result,
          packet,
          agentRun: agentRun as Pick<AiTestAgentRun, 'status' | 'decisions'>,
        });
        rows.push({
          probeId: probe.probeId,
          purpose: probe.purpose,
          expectedTypes: calibrated(probe.expectedTypes),
          predictedTypes: calibrated(analysis.frictions.map((friction) => friction.type)),
          observedVerdict,
          actorActions: agentRun.decisions.map((decision) => decision.action),
          agentStatus: agentRun.status,
          failureSource: agentRun.failureSource,
          runId: agentRun.runId,
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return {
    schemaVersion: 1,
    analysisMode: 'connected_model_behavior_sensitivity',
    provider: {
      providerId: input.provider.info.providerId,
      model: input.provider.info.model,
      remote: input.provider.info.remote,
    },
    generatedAt,
    metrics: summarizeConnectedModelCalibration(rows),
    rows,
    methodology: [
      'Runs a connected remote model through three controlled Chromium probes with screenshots withheld by default.',
      'Expected friction classes come from independent probe design; the model never receives those labels.',
      'The run verdict is independently derived from the actual final page state (Done visible or not), not from the fixture expectation.',
      'Measures signal preservation and extra detector signals caused by the connected model plus the normal semantic-verification path.',
    ],
    claimBoundary: [
      'This is a connected-model pipeline sensitivity probe, not a human usability study.',
      'Clean-probe findings are treated as possible actor-induced drift and must not be promoted directly to product UX defects.',
      'Metrics from three probes must not be presented as general real-world UX accuracy.',
    ],
  };
}
