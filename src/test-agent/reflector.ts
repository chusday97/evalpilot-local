import type { AgentActionResult, AgentDecision, EvalCase, ReflectionDecision, StepVerification } from '../../types.js';
import { reflectionDecisionSchema } from './schemas.js';

export function reflectOnStep(input: { evalCase: EvalCase; decision: AgentDecision; result: AgentActionResult; verification: StepVerification; failedAttempts: number }): ReflectionDecision {
  if (input.result.status === 'blocked_by_safety') return reflectionDecisionSchema.parse({ nextStep: 'abandon', summary: '安全边界阻止继续自动操作。', confidence: 1 });
  if (input.decision.action === 'finish') return reflectionDecisionSchema.parse({ nextStep: 'finish', summary: 'Actor 已基于可见证据完成任务。', confidence: input.verification.confidence });
  if (input.decision.action === 'abandon') return reflectionDecisionSchema.parse({ nextStep: 'abandon', summary: 'Persona 选择放弃当前路径。', confidence: input.decision.confidence });
  const patience = Math.max(1, input.evalCase.persona.behaviorPolicy.length);
  if (input.verification.status === 'not_confirmed' && input.failedAttempts >= patience) return reflectionDecisionSchema.parse({ nextStep: 'abandon', summary: '连续尝试没有得到确认，已达到当前 Persona 的耐心边界。', confidence: 0.9 });
  if (input.verification.status === 'not_confirmed') return reflectionDecisionSchema.parse({ nextStep: 'seek_another_path', summary: '当前动作未产生预期结果，下轮重新观察并寻找其他路径。', confidence: 0.8 });
  return reflectionDecisionSchema.parse({ nextStep: 'continue', summary: '当前动作获得可见反馈，继续根据新页面决策。', confidence: 0.85 });
}
