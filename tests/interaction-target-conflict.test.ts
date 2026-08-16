import { describe, expect, it } from 'vitest';
import type { AgentDecision, AiTestAgentRun, EvalCase, EvalCaseResult, EvidencePacket, PageObservation } from '../types.js';
import { analyzeBlindExperience } from '../src/ux-evaluation/blind-experience-analyzer.js';
import { detectDeterministicExecutionFrictions } from '../src/ux-evaluation/friction-detector.js';

const now = '2026-08-16T00:00:00.000Z';
const pointerFailure = `locator.click: Timeout 30000ms exceeded.\n` +
  `- <button id="group-variant-wishlist-sp_0014" aria-label="Added to wishlist: Corydoras aeneus">…</button> intercepts pointer events`;

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

function observation(id: string, text: string, controls: ReturnType<typeof element>[]): PageObservation {
  return {
    observationId: id,
    pageUrl: 'http://127.0.0.1:3000/species',
    pagePurpose: 'Species Guide',
    visibleStateSummary: text,
    primaryAreas: ['Species variant chooser'],
    visibleProblems: [],
    interactableElements: controls,
    formFields: [],
    evidenceRefs: [`${id}.png`],
    confidence: 1,
  };
}

const decisions: AgentDecision[] = [
  {
    decisionId: 'd1',
    intentSummary: '选择标准款',
    action: 'click',
    targetElementId: 'E003',
    value: null,
    expectedResult: '标准款被选中',
    confidence: 0.9,
  },
  {
    decisionId: 'd2',
    intentSummary: '使用明确 CTA 继续',
    action: 'click',
    targetElementId: 'E007',
    value: null,
    expectedResult: 'variant 被选中',
    confidence: 0.85,
  },
];

function packet(recovered = true, failureSignal = pointerFailure): EvidencePacket {
  const controls = [
    element('E003', '标准款'),
    element('E004', 'Added to wishlist: Corydoras aeneus'),
    element('E007', 'Select this variant'),
  ];
  const observations = [
    observation('o1b', 'Variant chooser 标准款 Select this variant', controls),
    observation('o1a', 'Variant chooser 标准款 Select this variant', controls),
    observation('o2b', 'Variant chooser 标准款 Select this variant', controls),
    observation('o2a', recovered ? 'Variant chooser 标准款 Selected' : 'Variant chooser 标准款 Select this variant', controls),
  ];
  const firstTaskState = {
    state: 'failed' as const,
    progressSignals: [],
    completionSignals: [],
    failureSignals: [failureSignal],
    loadingSignals: [],
    networkActivity: 'idle' as const,
    elapsedMs: 30_000,
    lastProgressAtMs: null,
    confidence: 1,
    evidenceRefs: ['task-state-observations.jsonl#step-001-poll-001'],
  };
  const secondTaskState = {
    state: 'progressing' as const,
    progressSignals: ['Selected became visible'],
    completionSignals: [],
    failureSignals: [],
    loadingSignals: [],
    networkActivity: 'idle' as const,
    elapsedMs: 100,
    lastProgressAtMs: 100,
    confidence: 1,
    evidenceRefs: ['task-state-observations.jsonl#step-002-poll-001'],
  };
  return {
    runId: 'run-target-conflict',
    caseId: 'case-target-conflict',
    targetAppCommit: null,
    actorModel: 'mock',
    actorPromptVersion: 'test',
    startedAt: now,
    completedAt: now,
    actions: [],
    observations,
    stepVerifications: [
      { verificationId: 'v1', expectation: 'variant selected', observed: failureSignal, status: 'not_confirmed', evidenceRefs: ['v1.json'], confidence: 1 },
      { verificationId: 'v2', expectation: 'variant selected', observed: recovered ? 'Selected visible' : 'No progress', status: recovered ? 'confirmed' : 'not_confirmed', evidenceRefs: ['v2.json'], confidence: 1 },
    ],
    stepEvidence: [
      {
        stepIndex: 1,
        beforeObservationId: 'o1b',
        afterObservationId: 'o1a',
        beforeScreenshotPath: 'screenshots/step-001-before.png',
        afterScreenshotPath: 'screenshots/step-001-after.png',
        decisionId: 'd1',
        verificationId: 'v1',
        actionStatus: 'failed',
        taskState: firstTaskState,
        taskWait: null,
      },
      ...(recovered ? [{
        stepIndex: 2,
        beforeObservationId: 'o2b',
        afterObservationId: 'o2a',
        beforeScreenshotPath: 'screenshots/step-002-before.png',
        afterScreenshotPath: 'screenshots/step-002-after.png',
        decisionId: 'd2',
        verificationId: 'v2',
        actionStatus: 'executed' as const,
        taskState: secondTaskState,
        taskWait: null,
      }] : []),
    ],
    screenshots: ['screenshots/step-001-before.png', 'screenshots/step-001-after.png'],
    tracePath: 'trace.zip',
    evidenceCompleteness: {
      complete: true,
      hasInitialObservation: true,
      hasFinalObservation: true,
      hasBeforeAfterScreenshots: true,
      hasStepVerifications: true,
      hasTrace: true,
      missing: [],
    },
    consoleEvidence: [],
    networkEvidence: [],
    finalState: { url: 'http://127.0.0.1:3000/species', visibleTextSummary: recovered ? 'Selected' : 'Select this variant' },
    versions: {
      targetAppGitSha: null,
      productModelVersion: 1,
      evalSetVersion: 1,
      caseVersion: 1,
      evalPilotVersion: 'test',
      actorModel: 'mock',
      judgeModel: 'mock',
      actorPromptVersion: 'test',
      judgePromptVersion: 'test',
      toolSchemaVersion: 'test',
      timestamp: now,
    },
  } as EvidencePacket;
}

function evalCase(): EvalCase {
  return {
    caseId: 'case-target-conflict',
    projectId: 'project-target-conflict',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'Smoke #2 regression' },
    capabilityId: 'cap-record-livestock',
    taskId: 'task-record-livestock',
    title: 'Record livestock',
    hypothesis: 'User can select a species variant',
    persona: {
      personaId: 'persona-new-user',
      name: 'New user',
      knowledgeLevel: 'low',
      patienceTurns: 4,
      retryTolerance: 1,
      privacySensitivity: 'medium',
      behaviorPolicy: ['Only use visible UI'],
      exitConditions: ['Stop when no safe next action exists'],
    },
    goal: 'Record one Corydoras aeneus',
    knownInformation: { scientificName: 'Corydoras aeneus', quantity: 1 },
    preconditions: [],
    oracle: {
      expectedOutcome: ['Livestock recorded'],
      mustObserve: [],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: ['Goal completion is visibly proven'],
      deterministicAssertions: [],
      inconclusiveWhen: ['Evidence is insufficient'],
    },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-record-livestock' }],
    riskLevel: 'P1',
    generationReason: 'Smoke #2 regression',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function result(failureSource: EvalCaseResult['failureSource']): EvalCaseResult {
  return {
    runId: 'run-target-conflict',
    caseId: 'case-target-conflict',
    verdict: failureSource === 'product' ? 'fail' : 'inconclusive',
    failureSource,
    severity: failureSource === 'product' ? 'P1' : null,
    deterministic: { checks: [], hardFailure: failureSource === 'product', severity: failureSource === 'product' ? 'P1' : null, evidenceRefs: ['final.png'] },
    semantic: {
      verdict: failureSource === 'product' ? 'fail' : 'inconclusive',
      taskCompletion: failureSource === 'product' ? 'failed' : 'unknown',
      summary: failureSource === 'product' ? 'Product failed' : 'Terminal evaluator/provider evidence is insufficient',
      whatWorked: [],
      whatFailed: [],
      whyItMatters: [],
      confirmedFacts: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['final.png'],
      confidence: 1,
    },
    evidencePacketPath: 'evidence-packet.json',
    createdAt: now,
  };
}

function run(status: AiTestAgentRun['status']): Pick<AiTestAgentRun, 'status' | 'decisions'> {
  return { status, decisions };
}

describe('interaction target conflict regression', () => {
  it('emits a high-confidence P3 usability finding when a later action recovers', () => {
    const frictions = detectDeterministicExecutionFrictions({
      featureId: 'cap-record-livestock',
      personaId: 'persona-new-user',
      packet: packet(true),
      decisions,
    });

    expect(frictions).toHaveLength(1);
    expect(frictions[0]).toEqual(expect.objectContaining({
      type: 'usability_issue',
      severity: 'P3',
      confidence: 'high',
    }));
    expect(frictions[0]?.observedBehavior).toContain('交互目标冲突');
    expect(frictions[0]?.observedBehavior).toContain('标准款');
    expect(frictions[0]?.observedBehavior).toContain('Corydoras aeneus');
    expect(frictions[0]?.evidence).toEqual(expect.arrayContaining([
      'screenshots/step-001-before.png',
      'task-state-observations.jsonl#step-001-poll-001',
    ]));
  });

  it('uses P2 when the same deterministic conflict has no later recovery', () => {
    const frictions = detectDeterministicExecutionFrictions({
      featureId: 'cap-record-livestock',
      personaId: 'persona-new-user',
      packet: packet(false),
      decisions,
    });

    expect(frictions[0]?.severity).toBe('P2');
  });

  it('does not invent a target conflict from a generic action failure', () => {
    const frictions = detectDeterministicExecutionFrictions({
      featureId: 'cap-record-livestock',
      personaId: 'persona-new-user',
      packet: packet(false, 'locator.click failed for an unknown reason'),
      decisions,
    });

    expect(frictions).toEqual([]);
  });

  it('keeps terminal evaluator failure inconclusive while preserving only the deterministic conflict', () => {
    const analysis = analyzeBlindExperience({
      evalCase: evalCase(),
      result: result('evaluator'),
      packet: packet(true),
      agentRun: run('inconclusive'),
    });

    expect(analysis.analysisStatus).toBe('insufficient_evidence');
    expect(analysis.functionalVerdict).toBe('inconclusive');
    expect(analysis.failureSource).toBe('evaluator');
    expect(analysis.frictions.map((item) => item.type)).toEqual(['usability_issue']);
    expect(analysis.findings.map((item) => item.type)).toEqual(['usability_issue']);
    expect(analysis.findings[0]?.confirmedFacts.join(' ')).toContain('交互目标冲突');
    expect(analysis.findings[0]?.recommendation).toContain('点击热区');
    expect(analysis.findings[0]?.functionalTaskPassed).toBe(false);
    expect(analysis.authenticityNotice.join(' ')).toContain('终局证据仍不足');
  });

  it('still suppresses the deterministic conflict when a Product Failure is independently confirmed', () => {
    const analysis = analyzeBlindExperience({
      evalCase: evalCase(),
      result: result('product'),
      packet: packet(true),
      agentRun: run('inconclusive'),
    });

    expect(analysis.analysisStatus).toBe('suppressed_functional_failure');
    expect(analysis.frictions).toEqual([]);
    expect(analysis.findings).toEqual([]);
  });
});
