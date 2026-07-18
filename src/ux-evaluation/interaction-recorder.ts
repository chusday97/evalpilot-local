import { createHash } from 'node:crypto';
import type { CompletionDefinition, InteractionAction, SimulatedUserMetrics } from '../../types.js';
import { simulatedUserMetricsSchema } from '../schemas/ux-evaluation.js';
import { repeatedInputActionIds } from './repeated-input-detector.js';

export function fingerprintInput(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface MetricsOptions {
  completion: CompletionDefinition;
  requiredActionIds: string[];
  redundantActionIds: string[];
  abandoned: boolean;
  abandonmentReason: string | null;
}

function firstTimestamp(actions: InteractionAction[], predicate: (action: InteractionAction) => boolean): number | null {
  return actions.find(predicate)?.timestampMs ?? null;
}

export function calculateInteractionMetrics(
  actions: InteractionAction[],
  options: MetricsOptions,
): SimulatedUserMetrics {
  const lastTimestamp = actions.at(-1)?.timestampMs ?? 0;
  const taskCompleted = options.completion.userGoal.complete === true;
  const fullLoopCompleted = taskCompleted && options.completion.followUp.complete === true;
  const errorCount = actions.filter((action) => action.type === 'error').length;
  const retryCount = actions.filter((action) => action.type === 'retry').length;
  const evidenceCount = actions.reduce((sum, action) => sum + action.evidence.length, 0);
  return simulatedUserMetricsSchema.parse({
    metricType: 'simulated_user_run',
    timeToFirstActionMs: actions[0]?.timestampMs ?? 0,
    timeToFindEntryMs: firstTimestamp(actions, (action) => action.type === 'click' || action.type === 'navigation'),
    timeToFirstMeaningfulActionMs: firstTimestamp(actions, (action) => action.type === 'input' || action.type === 'click'),
    timeToCompleteMs: taskCompleted ? lastTimestamp : null,
    totalActions: actions.length,
    requiredActions: actions.filter((action) => options.requiredActionIds.includes(action.actionId)).length,
    redundantActions: actions.filter((action) => options.redundantActionIds.includes(action.actionId)).length,
    clickCount: actions.filter((action) => action.type === 'click').length,
    inputCount: actions.filter((action) => action.type === 'input').length,
    pageTransitions: actions.filter((action) => action.type === 'navigation').length,
    backtrackCount: actions.filter((action) => action.type === 'backtrack').length,
    retryCount,
    repeatedInputCount: repeatedInputActionIds(actions).length,
    deadClickCount: actions.filter((action) => action.type === 'click' && /no_feedback|dead_click/.test(action.outcome)).length,
    clarificationCount: actions.filter((action) => /clarification/.test(action.outcome)).length,
    deadEndCount: actions.filter((action) => /dead_end/.test(action.outcome)).length,
    errorCount,
    recoveryAttempts: retryCount + actions.filter((action) => action.type === 'backtrack' && errorCount > 0).length,
    recoverySuccess: errorCount > 0 && actions.some((action) => /recovered/.test(action.outcome)),
    taskCompleted,
    fullLoopCompleted,
    abandoned: options.abandoned,
    abandonmentReason: options.abandonmentReason,
    finalConfidence: evidenceCount >= actions.length && actions.length > 0 ? 'high' : evidenceCount > 0 ? 'medium' : 'low',
  });
}
