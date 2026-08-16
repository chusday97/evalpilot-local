import { describe, expect, it } from 'vitest';
import type { AgentActionResult, AgentDecision, EvalCase, StepVerification, TaskStateObservation } from '../types.js';
import { reflectOnStep } from '../src/test-agent/reflector.js';

const evalCase = {
  persona: {
    personaId: 'persona-finish-regression',
    name: 'Finish regression persona',
    behaviorPolicy: ['只依据可见界面行动'],
  },
} as EvalCase;

const finishDecision: AgentDecision = {
  decisionId: 'decision-finish',
  intentSummary: '当前可见状态已经满足目标，结束交互',
  action: 'finish',
  targetElementId: null,
  value: null,
  expectedResult: '结束当前交互',
  confidence: 0.97,
};

const executedFinish: AgentActionResult = {
  status: 'executed',
  action: 'finish',
  targetElementId: null,
  summary: 'Actor chose finish.',
  evidenceRefs: ['step-finish.png'],
};

const inconclusiveVerification: StepVerification = {
  verificationId: 'verification-finish',
  expectation: '结束当前交互',
  observed: 'finish 本身不改变页面，因此没有新的动作后页面变化可确认。',
  status: 'inconclusive',
  evidenceRefs: ['step-finish.png'],
  confidence: 1,
};

function taskState(state: TaskStateObservation['state']): TaskStateObservation {
  return {
    state,
    progressSignals: [],
    completionSignals: state === 'completed' ? ['Actor 明确结束任务'] : [],
    failureSignals: [],
    loadingSignals: state === 'pending' || state === 'progressing' ? ['任务仍在处理'] : [],
    networkActivity: 'idle',
    elapsedMs: 0,
    lastProgressAtMs: null,
    confidence: 1,
    evidenceRefs: ['step-finish.png'],
  };
}

describe('Actor finish termination boundary', () => {
  it('terminates the Actor loop when finish is chosen even if finish-step verification is inconclusive', () => {
    expect(reflectOnStep({
      evalCase,
      decision: finishDecision,
      result: executedFinish,
      verification: inconclusiveVerification,
      taskState: taskState('completed'),
      failedAttempts: 0,
      retryAttempts: 1,
    })).toMatchObject({
      nextStep: 'finish',
      confidence: 0.97,
    });
  });

  it('does not let finish override a genuinely pending task transition', () => {
    expect(reflectOnStep({
      evalCase,
      decision: finishDecision,
      result: executedFinish,
      verification: inconclusiveVerification,
      taskState: taskState('pending'),
      failedAttempts: 0,
      retryAttempts: 1,
    })).toMatchObject({
      nextStep: 'continue',
    });
  });
});
