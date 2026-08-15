import { describe, expect, it } from 'vitest';
import type {
  AgentDecision,
  AiTestAgentRun,
  EvalCase,
  EvalCaseResult,
  EvidencePacket,
  PageObservation,
} from '../types.js';
import { analyzeBlindExperience } from '../src/ux-evaluation/blind-experience-analyzer.js';
import { buildBlindActorCase } from '../src/ux-evaluation/blind-experience-service.js';

const now = '2026-08-15T10:00:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-blind',
    projectId: 'project-blind',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'fixture' },
    capabilityId: 'cap-onboarding',
    taskId: 'task-create',
    title: 'Create a usable tank',
    hypothesis: 'A new user can find the setup flow',
    persona: {
      personaId: 'persona-new-user',
      name: 'New user',
      knowledgeLevel: 'low',
      patienceTurns: 3,
      retryTolerance: 1,
      privacySensitivity: 'medium',
      behaviorPolicy: ['只依据当前可见界面行动'],
      exitConditions: ['连续尝试没有进展时退出'],
    },
    goal: 'Create a usable freshwater tank',
    knownInformation: { lengthCm: 60, widthCm: 30, heightCm: 30 },
    preconditions: ['App is open'],
    oracle: {
      expectedOutcome: ['SECRET_SUCCESS_60x30x30'],
      mustObserve: ['SECRET_FRESHWATER'],
      mustNotObserve: ['SECRET_MODAL_OPEN'],
      businessRules: ['SECRET_BUSINESS_RULE'],
      semanticRubric: ['SECRET_RUBRIC'],
      deterministicAssertions: [
        { assertionId: 'assert-secret', type: 'text_visible', target: 'SECRET_SUCCESS_60x30x30', expected: true, negated: false },
      ],
      inconclusiveWhen: ['SECRET_INCONCLUSIVE'],
    },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-onboarding' }],
    riskLevel: 'P1',
    generationReason: 'fixture',
    version: 1,
    stats: {
      passCount: 0,
      failCount: 0,
      inconclusiveCount: 0,
      latestResult: null,
      latestRunId: null,
      uniqueCoverageContribution: 1,
      lastExecutedAt: null,
    },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function element(elementId: string, label: string) {
  return {
    elementId,
    role: 'button',
    tagName: 'button',
    label,
    text: label,
    placeholder: null,
    disabled: false,
    risk: 'safe' as const,
    locatorHint: 'grounded-index:0',
  };
}

function observation(id: string, url: string, text: string, label: string): PageObservation {
  return {
    observationId: id,
    pageUrl: url,
    pagePurpose: 'Fixture',
    visibleStateSummary: text,
    primaryAreas: ['Fixture'],
    visibleProblems: [],
    interactableElements: [element('E001', label)],
    formFields: [],
    evidenceRefs: [`${id}.png`],
    confidence: 1,
  };
}

function packet(decisions: AgentDecision[]): EvidencePacket {
  const home = 'http://127.0.0.1:3000/home';
  const settings = 'http://127.0.0.1:3000/settings';
  const observations = [
    observation('o1b', home, 'Home Settings Create tank', 'Settings'),
    observation('o1a', settings, 'Settings Profile Back', 'Back'),
    observation('o2b', settings, 'Settings Profile Back', 'Back'),
    observation('o2a', home, 'Home Settings Create tank', 'Create tank'),
    observation('o3b', home, 'Home Settings Create tank', 'Create tank'),
    observation('o3a', home, 'Home Settings Create tank', 'Create tank'),
  ];
  return {
    runId: 'run-blind',
    caseId: 'case-blind',
    targetAppCommit: null,
    actorModel: 'mock',
    actorPromptVersion: '1.2.0',
    startedAt: now,
    completedAt: now,
    actions: [],
    observations,
    stepVerifications: [
      { verificationId: 'v1', expectation: 'open settings', observed: 'settings opened', status: 'confirmed', evidenceRefs: ['o1a.png'], confidence: 1 },
      { verificationId: 'v2', expectation: 'go back', observed: 'home restored', status: 'confirmed', evidenceRefs: ['o2a.png'], confidence: 1 },
      { verificationId: 'v3', expectation: 'stop', observed: 'actor stopped', status: 'inconclusive', evidenceRefs: ['o3a.png'], confidence: 1 },
    ],
    stepEvidence: [
      { stepIndex: 1, beforeObservationId: 'o1b', afterObservationId: 'o1a', beforeScreenshotPath: 'o1b.png', afterScreenshotPath: 'o1a.png', decisionId: 'd1', verificationId: 'v1', actionStatus: 'executed', taskState: null, taskWait: null },
      { stepIndex: 2, beforeObservationId: 'o2b', afterObservationId: 'o2a', beforeScreenshotPath: 'o2b.png', afterScreenshotPath: 'o2a.png', decisionId: 'd2', verificationId: 'v2', actionStatus: 'executed', taskState: null, taskWait: null },
      { stepIndex: 3, beforeObservationId: 'o3b', afterObservationId: 'o3a', beforeScreenshotPath: 'o3b.png', afterScreenshotPath: 'o3a.png', decisionId: 'd3', verificationId: 'v3', actionStatus: 'executed', taskState: null, taskWait: null },
    ],
    screenshots: observations.map((item) => item.evidenceRefs[0]!),
    tracePath: 'trace.zip',
    evidenceCompleteness: { complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] },
    consoleEvidence: [],
    networkEvidence: [],
    finalState: { url: home, visibleTextSummary: 'Home Settings Create tank' },
    versions: {
      targetAppGitSha: null,
      productModelVersion: 1,
      evalSetVersion: 1,
      caseVersion: 1,
      evalPilotVersion: 'test',
      actorModel: 'mock',
      judgeModel: 'mock',
      actorPromptVersion: '1.2.0',
      judgePromptVersion: 'test',
      toolSchemaVersion: '1.3.0',
      timestamp: now,
    },
  };
}

function result(overrides: Partial<EvalCaseResult> = {}): EvalCaseResult {
  return {
    runId: 'run-blind',
    caseId: 'case-blind',
    verdict: 'inconclusive',
    failureSource: null,
    severity: null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['final.png'] },
    semantic: {
      verdict: 'inconclusive',
      taskCompletion: 'unknown',
      summary: 'The objective success contract is not yet proven.',
      whatWorked: [],
      whatFailed: [],
      whyItMatters: [],
      confirmedFacts: [],
      hypotheses: [],
      unknowns: ['Goal completion unknown'],
      evidenceRefs: ['final.png'],
      confidence: 0.5,
    },
    evidencePacketPath: 'evidence-packet.json',
    createdAt: now,
    ...overrides,
  };
}

function run(status: AiTestAgentRun['status'], decisions: AgentDecision[]): Pick<AiTestAgentRun, 'status' | 'decisions'> {
  return { status, decisions };
}

const blindDecisions: AgentDecision[] = [
  { decisionId: 'd1', intentSummary: 'Settings looks relevant', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'settings opens', confidence: 0.6 },
  { decisionId: 'd2', intentSummary: 'Wrong area, return', action: 'back', targetElementId: null, value: null, expectedResult: 'home returns', confidence: 0.7 },
  { decisionId: 'd3', intentSummary: 'Cannot identify a safe next step', action: 'abandon', targetElementId: null, value: null, expectedResult: 'stop', confidence: 0.4 },
];

describe('blind experience evaluation', () => {
  it('scrubs the real Oracle from the Actor-visible case', () => {
    const original = evalCase();
    const actorCase = buildBlindActorCase(original);
    const serialized = JSON.stringify(actorCase.oracle);

    expect(actorCase.caseId).toBe(original.caseId);
    expect(actorCase.goal).toBe(original.goal);
    expect(actorCase.knownInformation).toEqual(original.knownInformation);
    expect(actorCase.oracle.deterministicAssertions).toEqual([]);
    expect(actorCase.oracle.mustObserve).toEqual([]);
    expect(actorCase.oracle.mustNotObserve).toEqual([]);
    expect(serialized).not.toContain('SECRET_');
    expect(JSON.stringify(original.oracle)).toContain('SECRET_SUCCESS_60x30x30');
  });

  it('keeps blind backtrack and pre-completion abandonment as UX evidence even when Judge is inconclusive', () => {
    const analysis = analyzeBlindExperience({
      evalCase: evalCase(),
      result: result(),
      packet: packet(blindDecisions),
      agentRun: run('abandoned', blindDecisions),
    });

    expect(analysis.analysisMode).toBe('blind_experience_run');
    expect(analysis.oracleAutoFinish).toBe('disabled');
    expect(analysis.analysisStatus).toBe('evaluated');
    expect(analysis.routeBacktrackCount).toBe(1);
    expect(analysis.metrics.abandoned).toBe(true);
    expect(analysis.findings.some((item) => item.type === 'path_efficiency_issue')).toBe(true);
    expect(analysis.findings.some((item) => item.type === 'abandonment_risk')).toBe(true);
    expect(analysis.findings.every((item) => item.functionalTaskPassed === false)).toBe(true);
  });

  it('suppresses UX findings when the independent Judge confirms a Product Failure', () => {
    const productFailure = result({
      verdict: 'fail',
      failureSource: 'product',
      severity: 'P1',
      deterministic: { checks: [], hardFailure: true, severity: 'P1', evidenceRefs: ['failure.png'] },
      semantic: {
        ...result().semantic,
        verdict: 'fail',
        taskCompletion: 'failed',
        summary: 'Product failure confirmed',
      },
    });
    const analysis = analyzeBlindExperience({
      evalCase: evalCase(),
      result: productFailure,
      packet: packet(blindDecisions),
      agentRun: run('abandoned', blindDecisions),
    });

    expect(analysis.analysisStatus).toBe('suppressed_functional_failure');
    expect(analysis.frictions).toEqual([]);
    expect(analysis.findings).toEqual([]);
  });

  it('does not convert an evaluator failure into a UX finding', () => {
    const evaluatorFailure = result({ failureSource: 'evaluator' });
    const analysis = analyzeBlindExperience({
      evalCase: evalCase(),
      result: evaluatorFailure,
      packet: packet(blindDecisions),
      agentRun: run('inconclusive', blindDecisions),
    });

    expect(analysis.analysisStatus).toBe('insufficient_evidence');
    expect(analysis.findings).toEqual([]);
  });
});
