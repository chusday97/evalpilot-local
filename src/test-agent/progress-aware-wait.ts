import type { Page } from 'playwright';
import type { AgentActionResult, AgentDecision, OperationType, TaskStateObservation, TaskWaitEvidence, WaitPolicy } from '../../types.js';
import { observeTaskState } from './task-state-monitor.js';
import { captureTaskStateSignals, type TaskStateSignalSnapshot } from './task-state-signals.js';

interface RuntimeSignalSnapshot {
  activeRequests: number;
  responseCount: number;
  coreNetworkFailures: string[];
  consoleErrors: string[];
}

interface ProgressAwareWaitInput {
  page: Page;
  before: TaskStateSignalSnapshot;
  decision: AgentDecision;
  actionResult: AgentActionResult;
  operationType: OperationType;
  policy: WaitPolicy;
  stepIndex: number;
  readRuntimeSignals: () => RuntimeSignalSnapshot;
}

export interface ProgressAwareWaitResult {
  summary: string;
  finalSignals: TaskStateSignalSnapshot;
  taskState: TaskStateObservation;
  taskWait: TaskWaitEvidence;
}

const policies: Record<OperationType, WaitPolicy> = {
  navigation: { initialObservationMs: 250, pollIntervalMs: 1_000, softTimeoutMs: 3_000, hardTimeoutMs: 8_000, progressExtensionMs: 2_500, maxProgressExtensions: 2 },
  form_submit: { initialObservationMs: 250, pollIntervalMs: 1_000, softTimeoutMs: 5_000, hardTimeoutMs: 15_000, progressExtensionMs: 5_000, maxProgressExtensions: 2 },
  ai_generation: { initialObservationMs: 250, pollIntervalMs: 1_000, softTimeoutMs: 10_000, hardTimeoutMs: 60_000, progressExtensionMs: 10_000, maxProgressExtensions: 5 },
  file_processing: { initialObservationMs: 250, pollIntervalMs: 1_000, softTimeoutMs: 15_000, hardTimeoutMs: 90_000, progressExtensionMs: 15_000, maxProgressExtensions: 5 },
  unknown_async: { initialObservationMs: 250, pollIntervalMs: 1_000, softTimeoutMs: 8_000, hardTimeoutMs: 30_000, progressExtensionMs: 8_000, maxProgressExtensions: 3 },
  synchronous: { initialObservationMs: 1, pollIntervalMs: 250, softTimeoutMs: 250, hardTimeoutMs: 1_000, progressExtensionMs: 0, maxProgressExtensions: 0 },
};

export function waitPolicyFor(operationType: OperationType, override: Partial<WaitPolicy> = {}, hardTimeoutOverride?: number): WaitPolicy {
  const merged = { ...policies[operationType], ...override };
  const hardTimeoutMs = hardTimeoutOverride === undefined ? merged.hardTimeoutMs : Math.max(1, Math.min(merged.hardTimeoutMs, hardTimeoutOverride));
  return {
    ...merged,
    initialObservationMs: Math.min(merged.initialObservationMs, hardTimeoutMs),
    pollIntervalMs: Math.min(merged.pollIntervalMs, hardTimeoutMs),
    softTimeoutMs: Math.min(merged.softTimeoutMs, hardTimeoutMs),
    hardTimeoutMs,
  };
}

function stoppedObservation(last: TaskStateObservation, elapsedMs: number, evidenceRef: string): TaskStateObservation {
  return {
    ...last,
    state: 'stalled',
    completionSignals: [],
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    confidence: 0.85,
    evidenceRefs: [evidenceRef],
  };
}

function waitEvidence(input: Omit<TaskWaitEvidence, 'consumedPersonaAttempt'>): TaskWaitEvidence {
  return { ...input, consumedPersonaAttempt: false };
}

export async function waitForProgressAwareOutcome(input: ProgressAwareWaitInput): Promise<ProgressAwareWaitResult> {
  const startedAt = performance.now();
  const observations: TaskStateObservation[] = [];
  let previousSignals = input.before;
  let previousRuntime = input.readRuntimeSignals();
  let extensionsUsed = 0;
  let deadlineMs = input.policy.softTimeoutMs;
  let lastProgressAtMs: number | null = null;
  let pollIndex = 0;
  const noWait = input.operationType === 'synchronous' || input.decision.action === 'finish' || input.decision.action === 'abandon' || input.actionResult.status !== 'executed';
  const canSettleAfterProgress = !noWait && input.operationType !== 'ai_generation' && input.operationType !== 'file_processing';
  const settleWindowMs = Math.min(1_000, Math.max(250, input.policy.pollIntervalMs));

  while (true) {
    const elapsedBeforeWait = performance.now() - startedAt;
    if (!noWait) {
      const nextDelay = pollIndex === 0 ? input.policy.initialObservationMs : input.policy.pollIntervalMs;
      const remaining = Math.max(0, Math.min(deadlineMs, input.policy.hardTimeoutMs) - elapsedBeforeWait);
      if (remaining > 0) await input.page.waitForTimeout(Math.min(nextDelay, remaining));
    }
    const elapsedMs = performance.now() - startedAt;
    const currentSignals = await captureTaskStateSignals(input.page, input.decision);
    const currentRuntime = input.readRuntimeSignals();
    pollIndex += 1;
    const evidenceRef = `task-state-observations.jsonl#step-${String(input.stepIndex).padStart(3, '0')}-poll-${String(pollIndex).padStart(3, '0')}`;
    let observation = observeTaskState({
      before: previousSignals,
      after: currentSignals,
      decision: input.decision,
      actionResult: input.actionResult,
      waitResult: { signal: noWait ? 'not_needed' : 'network_idle', summary: '' },
      elapsedMs,
      networkActivity: currentRuntime.activeRequests > 0 ? 'active' : 'idle',
      networkResponses: Math.max(0, currentRuntime.responseCount - previousRuntime.responseCount),
      coreNetworkFailures: currentRuntime.coreNetworkFailures,
      consoleErrors: currentRuntime.consoleErrors,
      evidenceRefs: [evidenceRef],
    });
    if (observation.state === 'progressing') lastProgressAtMs = observation.elapsedMs;
    observation = { ...observation, lastProgressAtMs };
    observations.push(observation);

    if (observation.state === 'completed' || observation.state === 'failed' || observation.state === 'blocked' || noWait) {
      const finalReason = observation.state === 'completed' ? 'completed' : observation.state === 'failed' ? 'failed' : observation.state === 'blocked' ? 'blocked' : 'not_needed';
      const completionSummary = observation.completionSignals.some((signal) => signal.includes('预期结果线索'))
        ? '等待期间出现了预期文字，任务已完成。'
        : '任务状态已确认完成。';
      return {
        summary: finalReason === 'not_needed' ? '同步或结束动作不需要异步等待。' : finalReason === 'completed' ? completionSummary : `任务状态已变为 ${observation.state}。`,
        finalSignals: currentSignals,
        taskState: observation,
        taskWait: waitEvidence({ operationType: input.operationType, policy: input.policy, observations, extensionsUsed, finalReason }),
      };
    }

    // Once a short/ordinary async interaction has produced visible progress, do not keep
    // burning the entire extended soft-timeout after the page has become quiet again. This
    // is deliberately not a success verdict: it only hands control back to the Actor for a
    // fresh observation. Long-running AI/file operations keep their existing wait semantics.
    const settledAfterProgress = canSettleAfterProgress
      && lastProgressAtMs !== null
      && observation.state === 'interacting'
      && observation.networkActivity === 'idle'
      && observation.loadingSignals.length === 0
      && elapsedMs - lastProgressAtMs >= settleWindowMs;
    if (settledAfterProgress) {
      return {
        summary: '页面在产生可见进展后已经稳定，结束当前等待并重新观察。',
        finalSignals: currentSignals,
        taskState: observation,
        taskWait: waitEvidence({ operationType: input.operationType, policy: input.policy, observations, extensionsUsed, finalReason: 'settled_after_progress' }),
      };
    }

    if (observation.state === 'progressing'
      && extensionsUsed < input.policy.maxProgressExtensions
      && elapsedMs + input.policy.progressExtensionMs > deadlineMs) {
      deadlineMs = Math.min(input.policy.hardTimeoutMs, deadlineMs + input.policy.progressExtensionMs);
      extensionsUsed += 1;
    }

    const hardTimedOut = elapsedMs >= input.policy.hardTimeoutMs;
    const softTimedOut = elapsedMs >= deadlineMs;
    if (hardTimedOut || softTimedOut) {
      const stalled = stoppedObservation(observation, elapsedMs, evidenceRef);
      observations[observations.length - 1] = stalled;
      const finalReason = hardTimedOut ? 'hard_timeout' : 'soft_timeout';
      return {
        summary: hardTimedOut ? '任务达到硬等待上限且仍未完成。' : '任务在软等待窗口内没有继续产生可确认进展。',
        finalSignals: currentSignals,
        taskState: stalled,
        taskWait: waitEvidence({ operationType: input.operationType, policy: input.policy, observations, extensionsUsed, finalReason }),
      };
    }
    previousSignals = currentSignals;
    previousRuntime = currentRuntime;
  }
}

export function consumesPersonaAttempt(taskState: TaskStateObservation, verificationStatus: 'confirmed' | 'not_confirmed' | 'inconclusive'): boolean {
  return taskState.state === 'failed' || (taskState.state === 'stalled' && verificationStatus === 'not_confirmed');
}
