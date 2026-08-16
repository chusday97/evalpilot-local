import type {
  AgentDecision,
  CompletionDefinition,
  EvidencePacket,
  FrictionEvent,
  InteractionAction,
  SimulatedUserMetrics,
  UxIssueType,
} from '../../types.js';
import { frictionEventSchema } from '../schemas/ux-evaluation.js';
import { parsePointerInterceptionDetails } from './pre-failure-signals.js';
import { repeatedInputActionIds } from './repeated-input-detector.js';

export interface FrictionInput {
  featureId: string;
  personaId: string;
  actions: InteractionAction[];
  metrics: SimulatedUserMetrics;
  completion: CompletionDefinition;
}

export interface DeterministicExecutionFrictionInput {
  featureId: string;
  personaId: string;
  packet: EvidencePacket;
  decisions: AgentDecision[];
}

function severityFor(input: FrictionInput, type: UxIssueType): FrictionEvent['severity'] {
  if (type === 'journey_breakpoint') return 'P1';
  if (type === 'interaction_feedback_issue' && input.completion.userGoal.complete === true) return 'P3';
  return 'P2';
}

function event(
  input: FrictionInput,
  index: number,
  type: UxIssueType,
  observedBehavior: string,
  possibleUserReason: string,
  action?: InteractionAction,
): FrictionEvent {
  return frictionEventSchema.parse({
    frictionId: `friction-${input.featureId}-${index + 1}`,
    type,
    featureId: input.featureId,
    page: action?.page ?? input.actions.at(-1)?.page ?? '/',
    step: action?.actionId ?? input.actions.at(-1)?.actionId ?? 'unknown',
    persona: input.personaId,
    observedBehavior,
    possibleUserReason: `推测：${possibleUserReason}`,
    evidence: action?.evidence ?? input.actions.flatMap((item) => item.evidence),
    severity: severityFor(input, type),
    confidence: action?.evidence.length ? 'high' : input.actions.some((item) => item.evidence.length) ? 'medium' : 'low',
  });
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

export function detectDeterministicExecutionFrictions(input: DeterministicExecutionFrictionInput): FrictionEvent[] {
  const observations = new Map(input.packet.observations.map((observation) => [observation.observationId, observation]));
  const verifications = new Map(input.packet.stepVerifications.map((verification) => [verification.verificationId, verification]));
  const decisions = new Map(input.decisions.filter((decision) => decision.decisionId).map((decision) => [decision.decisionId!, decision]));
  const events: FrictionEvent[] = [];

  for (const step of input.packet.stepEvidence) {
    if (step.actionStatus !== 'failed') continue;
    const verification = verifications.get(step.verificationId);
    const details = uniqueStrings([
      ...(step.taskState?.failureSignals ?? []),
      verification?.observed,
    ]);
    const pointerDetail = details.map(parsePointerInterceptionDetails).find((detail) => detail !== null) ?? null;
    if (!pointerDetail) continue;

    const decision = decisions.get(step.decisionId) ?? input.decisions[step.stepIndex - 1];
    const before = observations.get(step.beforeObservationId);
    const targetElementId = decision?.targetElementId ?? null;
    const targetElement = targetElementId
      ? (before?.interactableElements ?? []).find((element) => element.elementId === targetElementId)
      : undefined;
    const targetLabel = targetElement?.label || targetElement?.text || targetElementId || 'unknown';
    const interceptorLabel = pointerDetail.label || pointerDetail.id || '另一个可交互控件';
    const recoveredLater = input.packet.stepEvidence.some((candidate) => (
      candidate.stepIndex > step.stepIndex && candidate.actionStatus === 'executed'
    ));
    const evidence = uniqueStrings([
      step.beforeScreenshotPath,
      step.afterScreenshotPath,
      ...(step.taskState?.evidenceRefs ?? []),
      ...(verification?.evidenceRefs ?? []),
    ]);

    events.push(frictionEventSchema.parse({
      frictionId: `friction-${input.featureId}-target-conflict-${step.stepIndex}`,
      type: 'usability_issue',
      featureId: input.featureId,
      page: before?.pageUrl ?? '/',
      step: input.packet.actions[step.stepIndex - 1]?.actionId ?? step.decisionId,
      persona: input.personaId,
      observedBehavior: `交互目标冲突：可点击目标「${targetLabel}」的操作被「${interceptorLabel}」拦截，默认点击无法稳定命中预期目标。`,
      possibleUserReason: '推测：主要目标与次级控件的点击热区发生覆盖或竞争，导致同一区域存在互相抢占的交互目标。',
      evidence,
      severity: recoveredLater ? 'P3' : 'P2',
      confidence: evidence.length > 0 ? 'high' : 'medium',
    }));
  }

  return events;
}

export function detectFrictions(input: FrictionInput): FrictionEvent[] {
  const events: FrictionEvent[] = [];
  const repeated = new Set(repeatedInputActionIds(input.actions));
  for (const action of input.actions) {
    if (repeated.has(action.actionId)) {
      events.push(event(input, events.length, 'repeated_input_issue', `字段 ${action.inputField ?? 'unknown'} 被重复输入`, '系统未复用已经提供的信息', action));
    }
    if (action.type === 'click' && /no_feedback|dead_click/.test(action.outcome)) {
      events.push(event(
        input,
        events.length,
        'interaction_feedback_issue',
        input.completion.userGoal.complete === true
          ? '任务最终完成，但该次点击当下没有产生可观察反馈'
          : '点击后没有可观察反馈',
        '用户可能无法判断该次操作是否生效，并通过额外操作来确认',
        action,
      ));
    }
    if (action.type === 'hesitation') {
      events.push(event(input, events.length, 'path_efficiency_issue', '用户停留并无法确定下一操作', '当前页面的主操作或下一步不够明确', action));
    }
    if (/dead_end/.test(action.outcome)) {
      events.push(event(input, events.length, 'journey_breakpoint', '用户进入没有出口的页面', '当前路径缺少恢复或返回入口', action));
    }
  }
  if (input.metrics.backtrackCount > 0 && !events.some((item) => item.type === 'path_efficiency_issue')) {
    events.push(event(input, events.length, 'path_efficiency_issue', `出现 ${input.metrics.backtrackCount} 次回退`, '入口命名或页面层级可能与用户目标不一致'));
  }
  if (input.completion.userGoal.complete === true && input.completion.followUp.complete === false) {
    events.push(event(input, events.length, 'journey_breakpoint', '用户目标结果已出现，但没有证据证明可保存、修改、继续或结束', '结果页可能缺少清晰的后续行动'));
  }
  if (input.metrics.abandoned && input.completion.userGoal.complete !== true) {
    events.push(event(input, events.length, 'abandonment_risk', `模拟用户放弃：${input.metrics.abandonmentReason ?? '原因未记录'}`, '操作成本或失败次数超过 Persona 的行为限制'));
  }
  return events;
}
