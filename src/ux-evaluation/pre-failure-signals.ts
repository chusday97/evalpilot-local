type ActionStatus = 'executed' | 'blocked_by_safety' | 'failed';

type SignalDecision = {
  decisionId?: string;
  action: string;
  targetElementId: string | null;
};

type SignalActionResult = {
  summary: string;
  evidenceRefs: string[];
};

type SignalTaskState = {
  failureSignals: string[];
  evidenceRefs: string[];
} | null;

type SignalStepEvidence = {
  stepIndex: number;
  beforeObservationId: string;
  beforeScreenshotPath: string;
  afterScreenshotPath: string;
  decisionId: string;
  verificationId: string;
  actionStatus: ActionStatus;
  taskState: SignalTaskState;
};

type SignalElement = {
  elementId: string;
  label: string;
  text: string | null;
};

type SignalObservation = {
  observationId: string;
  interactableElements: SignalElement[];
  formFields: SignalElement[];
};

type SignalVerification = {
  verificationId: string;
  observed: string;
  evidenceRefs: string[];
};

export interface PreFailureSignalSource {
  agentRun: {
    decisions: SignalDecision[];
    actionResults: SignalActionResult[];
  };
  evidencePacket: {
    observations: SignalObservation[];
    stepVerifications: SignalVerification[];
    stepEvidence: SignalStepEvidence[];
  };
}

export interface ObservedPreFailureSignal {
  type: 'action_execution_failure';
  stepIndex: number;
  action: string;
  targetElementId: string | null;
  targetLabel: string | null;
  cause: 'pointer_interception' | 'action_execution_failure';
  interceptedBy: string | null;
  interceptedByLabel: string | null;
  detail: string;
  evidenceRefs: string[];
}

function boundedDetail(value: string, maxLength = 1_600): string {
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

export function parsePointerInterceptionDetails(value: string): { id: string | null; label: string | null } | null {
  if (!/intercepts pointer events/i.test(value)) return null;
  const relevantLine = value.split('\n').find((line) => /intercepts pointer events/i.test(line)) ?? value;
  const id = relevantLine.match(/\bid=["']([^"']+)["']/i)?.[1] ?? null;
  const label = relevantLine.match(/\baria-label=["']([^"']+)["']/i)?.[1]
    ?? relevantLine.match(/\btitle=["']([^"']+)["']/i)?.[1]
    ?? null;
  return { id, label };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

export function collectObservedPreFailureSignals(input: PreFailureSignalSource): ObservedPreFailureSignal[] {
  const observationById = new Map(input.evidencePacket.observations.map((observation) => [observation.observationId, observation]));
  const verificationById = new Map(input.evidencePacket.stepVerifications.map((verification) => [verification.verificationId, verification]));

  return input.evidencePacket.stepEvidence
    .filter((step) => step.actionStatus === 'failed')
    .map((step) => {
      const decisionIndex = input.agentRun.decisions.findIndex((decision) => decision.decisionId === step.decisionId);
      const decision = decisionIndex >= 0 ? input.agentRun.decisions[decisionIndex] : input.agentRun.decisions[step.stepIndex - 1];
      const actionResult = input.agentRun.actionResults[step.stepIndex - 1];
      const beforeObservation = observationById.get(step.beforeObservationId);
      const targetElementId = decision?.targetElementId ?? null;
      const target = targetElementId
        ? [...(beforeObservation?.interactableElements ?? []), ...(beforeObservation?.formFields ?? [])]
          .find((element) => element.elementId === targetElementId)
        : undefined;
      const verification = verificationById.get(step.verificationId);
      const details = uniqueStrings([
        actionResult?.summary,
        ...(step.taskState?.failureSignals ?? []),
        verification?.observed,
      ]);
      const pointerDetail = details.map(parsePointerInterceptionDetails).find((item) => item !== null) ?? null;
      const detail = details.find((item) => /intercepts pointer events/i.test(item)) ?? details[0] ?? 'Action execution failed before the final task outcome.';
      const evidenceRefs = uniqueStrings([
        ...(actionResult?.evidenceRefs ?? []),
        ...(step.taskState?.evidenceRefs ?? []),
        ...(verification?.evidenceRefs ?? []),
        step.beforeScreenshotPath,
        step.afterScreenshotPath,
      ]);

      return {
        type: 'action_execution_failure' as const,
        stepIndex: step.stepIndex,
        action: decision?.action ?? 'unknown',
        targetElementId,
        targetLabel: target?.label || target?.text || null,
        cause: pointerDetail ? 'pointer_interception' as const : 'action_execution_failure' as const,
        interceptedBy: pointerDetail?.id ?? null,
        interceptedByLabel: pointerDetail?.label ?? null,
        detail: boundedDetail(detail),
        evidenceRefs,
      };
    });
}
