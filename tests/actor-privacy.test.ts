import { describe, expect, it } from 'vitest';
import type { AgentDecision, EvalCase, PageObservation, StepVerification } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { chooseAgentAction } from '../src/test-agent/actor.js';

const now = '2026-08-12T07:00:00.000Z';

const evalCase: EvalCase = {
  caseId: 'case-privacy',
  projectId: 'project-privacy',
  setType: 'baseline',
  status: 'stable',
  origin: { type: 'human', note: 'Actor privacy fixture' },
  capabilityId: 'cap-privacy',
  taskId: 'task-privacy',
  title: '验证远程 Actor 截图隐私',
  hypothesis: '关闭截图授权时 Actor 仍可仅基于 DOM 文本决策',
  persona: { personaId: 'persona-test', name: '测试用户', behaviorPolicy: ['只执行安全操作'] },
  goal: '完成安全任务',
  knownInformation: {},
  preconditions: ['页面已打开'],
  oracle: {
    expectedOutcome: ['ORACLE_SECRET_EXPECTED'],
    mustObserve: ['ORACLE_SECRET_MUST_OBSERVE'],
    mustNotObserve: ['ORACLE_SECRET_MUST_NOT_OBSERVE'],
    businessRules: [],
    semanticRubric: ['用户可完成安全任务'],
    deterministicAssertions: [],
    inconclusiveWhen: ['ORACLE_SECRET_INCONCLUSIVE'],
  },
  coverageDimensions: [{ dimension: 'capability', value: 'cap-privacy' }],
  riskLevel: 'P1',
  generationReason: '隐私契约回归',
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

const observation: PageObservation = {
  observationId: 'observation-1',
  pageUrl: 'http://127.0.0.1:3000/',
  pagePurpose: '测试页',
  visibleStateSummary: '测试页面',
  primaryAreas: [],
  visibleProblems: [],
  interactableElements: [],
  formFields: [],
  evidenceRefs: ['local-before.png'],
  confidence: 1,
};

const progress = {
  currentFocus: 'trigger_or_continue_task' as const,
  currentFocusLabel: '继续任务',
  completedVerifiedSteps: 0,
  remainingExpectedSignals: ['ORACLE_SECRET_PROGRESS_SIGNAL'],
  remainingActionBudget: 8,
  currentActionBudget: 8,
  hardActionBudget: 20,
  failedAttempts: 0,
};

function providerReturning(action: AgentDecision['action'] = 'abandon'): MockAiProvider {
  return new MockAiProvider(() => ({
    intentSummary: '基于可见页面继续',
    action,
    targetElementId: null,
    value: null,
    expectedResult: '基于当前页面判断下一步',
    confidence: 1,
  }));
}

describe('Actor privacy and knowledge boundary', () => {
  it('keeps local screenshot evidence out of a remote Actor request when screenshot consent is off', async () => {
    const provider = providerReturning();

    await chooseAgentAction({
      provider,
      evalCase,
      observation,
      history: [],
      verifications: [],
      progress,
      screenshotDataUrl: 'data:image/png;base64,local-only-evidence',
      allowRemoteModel: true,
      allowScreenshot: false,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.imageDataUrls).toEqual([]);
    expect(provider.requests[0]?.privacy).toMatchObject({ allowRemoteModel: true, allowScreenshot: false, visibleTextOnly: true });
  });

  it('attaches the screenshot only when the caller explicitly allows it', async () => {
    const provider = providerReturning();
    const screenshot = 'data:image/png;base64,explicitly-allowed';

    await chooseAgentAction({
      provider,
      evalCase,
      observation,
      history: [],
      verifications: [],
      progress,
      screenshotDataUrl: screenshot,
      allowRemoteModel: true,
      allowScreenshot: true,
    });

    expect(provider.requests[0]?.imageDataUrls).toEqual([screenshot]);
    expect(provider.requests[0]?.privacy.allowScreenshot).toBe(true);
  });

  it('does not serialize evaluator Oracle answers or remaining expected signals into the Actor prompt', async () => {
    const provider = providerReturning();

    await chooseAgentAction({
      provider,
      evalCase,
      observation,
      history: [],
      verifications: [],
      progress,
      screenshotDataUrl: null,
      allowRemoteModel: true,
      allowScreenshot: false,
    });

    const prompt = provider.requests[0]?.userPrompt ?? '';
    expect(prompt).toContain(evalCase.goal);
    expect(prompt).toContain(evalCase.persona.name);
    expect(prompt).not.toContain('oracleSummary');
    expect(prompt).not.toContain('ORACLE_SECRET_EXPECTED');
    expect(prompt).not.toContain('ORACLE_SECRET_MUST_OBSERVE');
    expect(prompt).not.toContain('ORACLE_SECRET_MUST_NOT_OBSERVE');
    expect(prompt).not.toContain('ORACLE_SECRET_INCONCLUSIVE');
    expect(prompt).not.toContain('ORACLE_SECRET_PROGRESS_SIGNAL');
    expect(prompt).not.toContain('remainingExpectedSignals');
  });

  it('can disable hidden Oracle auto-finish for a blind UX run', async () => {
    const provider = providerReturning('abandon');
    const visibleOracleCase: EvalCase = {
      ...evalCase,
      oracle: {
        ...evalCase.oracle,
        deterministicAssertions: [{
          assertionId: 'assertion-visible-result',
          type: 'text_visible',
          target: 'VISIBLE_RESULT',
          expected: true,
          negated: false,
        }],
      },
    };
    const visibleResultObservation: PageObservation = {
      ...observation,
      visibleStateSummary: 'VISIBLE_RESULT',
    };
    const history: AgentDecision[] = [{
      decisionId: 'decision-001',
      intentSummary: '先执行一步',
      action: 'wait',
      targetElementId: null,
      value: null,
      expectedResult: '页面出现变化',
      confidence: 1,
    }];
    const verifications: StepVerification[] = [{
      verificationId: 'verification-001',
      expectation: '页面出现变化',
      observed: '已出现可见变化',
      status: 'confirmed',
      evidenceRefs: ['after.png'],
      confidence: 1,
    }];

    const decision = await chooseAgentAction({
      provider,
      evalCase: visibleOracleCase,
      observation: visibleResultObservation,
      history,
      verifications,
      progress: { ...progress, completedVerifiedSteps: 1 },
      screenshotDataUrl: null,
      allowRemoteModel: true,
      allowScreenshot: false,
      allowOracleAutoFinish: false,
    });

    expect(provider.requests).toHaveLength(1);
    expect(decision.action).toBe('abandon');
  });
});
