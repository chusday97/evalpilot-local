import { describe, expect, it } from 'vitest';
import type { AgentDecision, EvalCase, EvalCaseResult, EvidencePacket, PageObservation, StepVerification } from '../types.js';
import { analyzeAdaptiveExperience } from '../src/ux-evaluation/adaptive-experience-analyzer.js';

const now = '2026-08-15T08:00:00.000Z';

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

function observation(id: string, url: string, text: string, controls = [element('E001', 'Settings'), element('E002', 'Create tank')]): PageObservation {
  return {
    observationId: id,
    pageUrl: url,
    pagePurpose: 'Fixture',
    visibleStateSummary: text,
    primaryAreas: ['Fixture'],
    visibleProblems: [],
    interactableElements: controls,
    formFields: [],
    evidenceRefs: [`${id}.png`],
    confidence: 1,
  };
}

const evalCase = {
  caseId: 'case-experience',
  projectId: 'project-experience',
  setType: 'baseline',
  status: 'stable',
  origin: { type: 'human', note: 'Experience adapter fixture' },
  capabilityId: 'cap-create-tank',
  taskId: 'task-create-tank',
  title: '创建淡水鱼缸',
  hypothesis: '用户可以创建鱼缸',
  persona: { personaId: 'persona-new-user', name: '正常新用户', behaviorPolicy: ['先观察入口再操作'] },
  goal: '创建一个淡水鱼缸',
  knownInformation: { waterType: 'freshwater' },
  preconditions: ['首页已打开'],
  oracle: {
    expectedOutcome: ['鱼缸已创建'],
    mustObserve: ['Freshwater'],
    mustNotObserve: [],
    businessRules: [],
    semanticRubric: ['用户目标完成'],
    deterministicAssertions: [],
    inconclusiveWhen: ['证据不足'],
  },
  coverageDimensions: [{ dimension: 'capability', value: 'cap-create-tank' }],
  riskLevel: 'P1',
  generationReason: '体验分析回归',
  version: 1,
  stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
  regressionMetadata: null,
  retirementReason: null,
  needsHumanReview: false,
  createdAt: now,
  updatedAt: now,
} as EvalCase;

const home = 'http://127.0.0.1:3000/';
const settings = 'http://127.0.0.1:3000/settings';
const formControls = [
  element('E001', 'Settings'),
  element('E002', 'Create tank'),
  {
    ...element('E003', 'Water type'),
    role: null,
    tagName: 'input',
  },
];

const observations: PageObservation[] = [
  observation('o1-before', home, 'Home Settings Create tank'),
  observation('o1-after', settings, 'Settings page Back'),
  observation('o2-before', settings, 'Settings page Back'),
  observation('o2-after', home, 'Home Settings Create tank'),
  observation('o3-before', home, 'Home Settings Create tank'),
  observation('o3-after', home, 'Home Settings Create tank'),
  observation('o4-before', home, 'Home Settings Create tank Water type', formControls),
  observation('o4-after', home, 'Home Settings Create tank Water type freshwater', formControls),
  observation('o5-before', home, 'Home Settings Create tank Water type freshwater', formControls),
  observation('o5-after', home, 'Home Settings Create tank Water type freshwater', formControls),
];

const decisions: AgentDecision[] = [
  { decisionId: 'd1', intentSummary: '先看看设置是不是入口', action: 'click', targetElementId: 'E001', value: null, expectedResult: '进入相关设置', confidence: 0.55 },
  { decisionId: 'd2', intentSummary: '这里不是创建入口，返回', action: 'back', targetElementId: null, value: null, expectedResult: '回到首页', confidence: 0.7 },
  { decisionId: 'd3', intentSummary: '尝试当前页面的一个操作', action: 'click', targetElementId: 'E002', value: null, expectedResult: '页面给出反馈', confidence: 0.45 },
  { decisionId: 'd4', intentSummary: '填写水体类型', action: 'fill', targetElementId: 'E003', value: 'freshwater', expectedResult: '字段已填写', confidence: 0.9 },
  { decisionId: 'd5', intentSummary: '再次填写相同信息', action: 'fill', targetElementId: 'E003', value: 'freshwater', expectedResult: '字段已填写', confidence: 0.65 },
];

function verification(id: string, status: StepVerification['status'], evidence: string): StepVerification {
  return {
    verificationId: id,
    expectation: '产生预期变化',
    observed: status === 'confirmed' ? '观察到变化' : '没有观察到变化',
    status,
    evidenceRefs: [evidence],
    confidence: 1,
  };
}

const verifications: StepVerification[] = [
  verification('v1', 'confirmed', 'o1-after.png'),
  verification('v2', 'confirmed', 'o2-after.png'),
  verification('v3', 'not_confirmed', 'o3-after.png'),
  verification('v4', 'confirmed', 'o4-after.png'),
  verification('v5', 'confirmed', 'o5-after.png'),
];

function taskState(state: 'interacting' | 'progressing' = 'interacting', progressSignals: string[] = []) {
  return {
    state,
    progressSignals,
    completionSignals: [],
    failureSignals: [],
    loadingSignals: [],
    networkActivity: 'idle' as const,
    elapsedMs: 0,
    lastProgressAtMs: progressSignals.length ? 0 : null,
    confidence: 1,
    evidenceRefs: [],
  };
}

const packet = {
  runId: 'run-experience',
  caseId: evalCase.caseId,
  actions: [],
  observations,
  stepVerifications: verifications,
  stepEvidence: [
    { stepIndex: 1, beforeObservationId: 'o1-before', afterObservationId: 'o1-after', beforeScreenshotPath: 'o1-before.png', afterScreenshotPath: 'o1-after.png', decisionId: 'd1', verificationId: 'v1', actionStatus: 'executed', taskState: taskState('progressing', ['route changed']), taskWait: null },
    { stepIndex: 2, beforeObservationId: 'o2-before', afterObservationId: 'o2-after', beforeScreenshotPath: 'o2-before.png', afterScreenshotPath: 'o2-after.png', decisionId: 'd2', verificationId: 'v2', actionStatus: 'executed', taskState: taskState('progressing', ['route changed']), taskWait: null },
    { stepIndex: 3, beforeObservationId: 'o3-before', afterObservationId: 'o3-after', beforeScreenshotPath: 'o3-before.png', afterScreenshotPath: 'o3-after.png', decisionId: 'd3', verificationId: 'v3', actionStatus: 'executed', taskState: taskState(), taskWait: null },
    { stepIndex: 4, beforeObservationId: 'o4-before', afterObservationId: 'o4-after', beforeScreenshotPath: 'o4-before.png', afterScreenshotPath: 'o4-after.png', decisionId: 'd4', verificationId: 'v4', actionStatus: 'executed', taskState: taskState('progressing', ['field changed']), taskWait: null },
    { stepIndex: 5, beforeObservationId: 'o5-before', afterObservationId: 'o5-after', beforeScreenshotPath: 'o5-before.png', afterScreenshotPath: 'o5-after.png', decisionId: 'd5', verificationId: 'v5', actionStatus: 'executed', taskState: taskState(), taskWait: null },
  ],
} as unknown as EvidencePacket;

function result(verdict: EvalCaseResult['verdict'], failureSource: EvalCaseResult['failureSource']): EvalCaseResult {
  return {
    runId: packet.runId,
    caseId: evalCase.caseId,
    verdict,
    failureSource,
    severity: verdict === 'fail' ? 'P1' : null,
    deterministic: { checks: [], hardFailure: verdict === 'fail', severity: verdict === 'fail' ? 'P1' : null, evidenceRefs: ['final.png'] },
    semantic: {
      verdict,
      taskCompletion: verdict === 'pass' ? 'complete' : verdict === 'fail' ? 'failed' : 'unknown',
      summary: verdict === 'pass' ? '用户目标已完成' : '产品功能失败',
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

describe('adaptive experience analyzer', () => {
  it('turns a functional PASS into evidence-backed non-blocking UX findings', () => {
    const analysis = analyzeAdaptiveExperience({ evalCase, result: result('pass', null), packet, decisions });

    expect(analysis.analysisStatus).toBe('evaluated');
    expect(analysis.routeSequence).toEqual([home, settings, home]);
    expect(analysis.routeBacktrackCount).toBe(1);
    expect(analysis.metrics.backtrackCount).toBe(1);
    expect(analysis.metrics.repeatedInputCount).toBe(1);
    expect(analysis.timingPolicy).toBe('captured_but_not_used_for_friction');
    expect(analysis.frictions.map((item) => item.type)).toEqual(expect.arrayContaining([
      'interaction_feedback_issue',
      'repeated_input_issue',
      'path_efficiency_issue',
    ]));
    expect(analysis.frictions.some((item) => item.type === 'journey_breakpoint')).toBe(false);
    expect(analysis.findings.every((item) => item.functionalTaskPassed)).toBe(true);
    expect(analysis.findings.every((item) => item.recommendation.length > 0)).toBe(true);
    expect(analysis.actions.filter((item) => item.type === 'input').every((item) => item.inputFingerprint && !item.inputFingerprint.includes('freshwater'))).toBe(true);
  });

  it('suppresses UX findings when the same evidence belongs to a confirmed product failure', () => {
    const analysis = analyzeAdaptiveExperience({ evalCase, result: result('fail', 'product'), packet, decisions });

    expect(analysis.analysisStatus).toBe('suppressed_functional_failure');
    expect(analysis.frictions).toEqual([]);
    expect(analysis.findings).toEqual([]);
    expect(analysis.authenticityNotice.join(' ')).toContain('Bug');
  });
});
