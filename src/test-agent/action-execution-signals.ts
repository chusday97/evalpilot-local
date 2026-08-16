export type ActionExecutionSignalCause = 'pointer_interception' | 'action_execution_failure';

export interface ObservedPreFailureSignal {
  type: 'action_execution_failure';
  action: string;
  targetElementId: string | null;
  cause: ActionExecutionSignalCause;
  summary: string;
  evidenceRefs: string[];
}

interface ActionResultLike {
  status: string;
  action: string;
  targetElementId: string | null;
  summary: string;
  evidenceRefs: string[];
}

function classifyCause(summary: string): ActionExecutionSignalCause {
  return /intercepts pointer events/i.test(summary)
    ? 'pointer_interception'
    : 'action_execution_failure';
}

export function collectObservedPreFailureSignals(actionResults: readonly ActionResultLike[]): ObservedPreFailureSignal[] {
  return actionResults
    .filter((result) => result.status === 'failed')
    .map((result) => ({
      type: 'action_execution_failure' as const,
      action: result.action,
      targetElementId: result.targetElementId,
      cause: classifyCause(result.summary),
      summary: result.summary,
      evidenceRefs: [...result.evidenceRefs],
    }));
}
