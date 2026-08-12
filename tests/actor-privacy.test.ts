import { describe, expect, it } from 'vitest';
import type { EvalCase, PageObservation } from '../types.js';
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
    expectedOutcome: ['完成'],
    mustObserve: ['完成'],
    mustNotObserve: [],
    businessRules: [],
    semanticRubric: ['用户可完成安全任务'],
    deterministicAssertions: [],
    inconclusiveWhen: ['证据不足'],
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
  remainingExpectedSignals: ['完成'],
  remainingActionBudget: 8,
  currentActionBudget: 8,
  hardActionBudget: 20,
  failedAttempts: 0,
};

describe('Actor screenshot privacy', () => {
  it('keeps local screenshot evidence out of a remote Actor request when screenshot consent is off', async () => {
    const provider = new MockAiProvider(() => ({
      intentSummary: '基于 DOM 继续',
      action: 'abandon',
      targetElementId: null,
      value: null,
      expectedResult: '停止',
      confidence: 1,
    }));

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
    const provider = new MockAiProvider(() => ({
      intentSummary: '结合截图继续',
      action: 'abandon',
      targetElementId: null,
      value: null,
      expectedResult: '停止',
      confidence: 1,
    }));
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
});
