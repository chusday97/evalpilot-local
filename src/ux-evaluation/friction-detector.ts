import type { CompletionDefinition, FrictionEvent, InteractionAction, SimulatedUserMetrics, UxIssueType } from '../../types.js';
import { frictionEventSchema } from '../schemas/ux-evaluation.js';
import { repeatedInputActionIds } from './repeated-input-detector.js';

export interface FrictionInput {
  featureId: string;
  personaId: string;
  actions: InteractionAction[];
  metrics: SimulatedUserMetrics;
  completion: CompletionDefinition;
}

function severityFor(input: FrictionInput, type: UxIssueType): FrictionEvent['severity'] {
  if (type === 'journey_breakpoint') return 'P1';
  // A task that eventually succeeds can still contain a real feedback problem, but it is
  // non-blocking by definition. Keep it visible without inflating it to a product failure.
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
  // null means “not evaluated”, not “missing”. Only emit a closure problem when evidence
  // positively establishes that the follow-up loop is incomplete.
  if (input.completion.userGoal.complete === true && input.completion.followUp.complete === false) {
    events.push(event(input, events.length, 'journey_breakpoint', '用户目标结果已出现，但没有证据证明可保存、修改、继续或结束', '结果页可能缺少清晰的后续行动'));
  }
  if (input.metrics.abandoned) {
    events.push(event(input, events.length, 'abandonment_risk', `模拟用户放弃：${input.metrics.abandonmentReason ?? '原因未记录'}`, '操作成本或失败次数超过 Persona 的行为限制'));
  }
  return events;
}
