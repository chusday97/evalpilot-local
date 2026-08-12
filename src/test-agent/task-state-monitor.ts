import type { AgentActionResult, AgentDecision, StepVerification, TaskStateObservation } from '../../types.js';
import type { AdaptiveWaitResult } from './adaptive-wait.js';
import { compareTaskStateSignals, type TaskStateSignalSnapshot } from './task-state-signals.js';

interface ObserveTaskStateInput {
  before: TaskStateSignalSnapshot;
  after: TaskStateSignalSnapshot;
  decision: AgentDecision;
  actionResult: AgentActionResult;
  waitResult: AdaptiveWaitResult;
  elapsedMs: number;
  networkActivity: 'idle' | 'active' | 'unknown';
  networkResponses: number;
  coreNetworkFailures: string[];
  consoleErrors: string[];
  evidenceRefs: string[];
}

export function observeTaskState(input: ObserveTaskStateInput): TaskStateObservation {
  const signalDelta = compareTaskStateSignals(input.before, input.after);
  const progressSignals = [...signalDelta.progressSignals];
  const completionSignals = [...signalDelta.completionSignals];
  const failureSignals = [...signalDelta.failureSignals];
  if (input.networkResponses > 0) progressSignals.push('操作后仍有网络响应返回');
  failureSignals.push(...input.coreNetworkFailures.map((failure) => `核心请求失败：${failure}`));
  failureSignals.push(...input.consoleErrors.map((failure) => `页面未捕获错误：${failure}`));
  if (input.decision.action === 'finish') completionSignals.push('Agent 明确结束任务');
  if (input.actionResult.status === 'failed') failureSignals.push(input.actionResult.summary);

  let state: TaskStateObservation['state'];
  let confidence: number;
  if (input.actionResult.status === 'blocked_by_safety') {
    state = 'blocked'; confidence = 1;
  } else if (failureSignals.length > 0) {
    state = 'failed'; confidence = 0.95;
  } else if (completionSignals.length > 0) {
    state = 'completed'; confidence = 0.88;
  } else if (progressSignals.length > 0) {
    state = 'progressing'; confidence = 0.8;
  } else if (signalDelta.loadingSignals.length > 0 || input.networkActivity === 'active') {
    state = 'pending'; confidence = 0.78;
  } else if (input.waitResult.signal === 'timeout') {
    state = 'stalled'; confidence = 0.72;
  } else {
    state = 'interacting'; confidence = 0.68;
  }
  const uniqueProgress = [...new Set(progressSignals)];
  return {
    state,
    progressSignals: uniqueProgress,
    completionSignals: [...new Set(completionSignals)],
    failureSignals: [...new Set(failureSignals)],
    loadingSignals: signalDelta.loadingSignals,
    networkActivity: input.networkActivity,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
    lastProgressAtMs: uniqueProgress.length > 0 ? Math.max(0, Math.round(input.elapsedMs)) : null,
    confidence,
    evidenceRefs: [...new Set(input.evidenceRefs)],
  };
}

export function gateVerificationByTaskState(verification: StepVerification, taskState: TaskStateObservation): StepVerification {
  const evidenceRefs = [...new Set([...verification.evidenceRefs, ...taskState.evidenceRefs])];
  if (taskState.state !== 'pending' && taskState.state !== 'progressing') {
    return { ...verification, evidenceRefs };
  }
  const label = taskState.state === 'pending' ? '任务仍在等待结果' : '任务仍在持续产生进展';
  return {
    ...verification,
    status: 'inconclusive',
    observed: `${label}，当前证据不足以判定成功或失败。${verification.observed ? ` ${verification.observed}` : ''}`,
    evidenceRefs,
    confidence: Math.min(verification.confidence, taskState.confidence),
  };
}
