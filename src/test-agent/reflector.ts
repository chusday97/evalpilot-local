import type { AgentActionResult, AgentDecision, EvalCase, ReflectionDecision, StepVerification } from '../../types.js';
import { resolvePersonaPolicy } from '../eval-set/persona-policy.js';
import { reflectionDecisionSchema } from './schemas.js';

export function reflectOnStep(input: { evalCase: EvalCase; decision: AgentDecision; result: AgentActionResult; verification: StepVerification; failedAttempts: number; retryAttempts?: number }): ReflectionDecision {
  const policy = resolvePersonaPolicy(input.evalCase.persona);
  const retryAttempts = input.retryAttempts ?? 0;
  if (input.result.status === 'blocked_by_safety') return reflectionDecisionSchema.parse({ nextStep: 'abandon', summary: '安全边界阻止继续自动操作。', confidence: 1 });
  if (input.decision.action === 'finish' && input.verification.status === 'confirmed') return reflectionDecisionSchema.parse({ nextStep: 'finish', summary: 'Actor 已基于可见证据完成任务。', confidence: input.verification.confidence });
  if (input.decision.action === 'abandon') return reflectionDecisionSchema.parse({ nextStep: 'abandon', summary: 'Persona 选择放弃当前路径。', confidence: input.decision.confidence });
  if (input.verification.status !== 'confirmed' && input.failedAttempts >= policy.patienceTurns) return reflectionDecisionSchema.parse({ nextStep: 'abandon', summary: `连续尝试没有得到确认，已达到当前 Persona 的 ${policy.patienceTurns} 步耐心边界。`, confidence: 0.9 });
  if (input.verification.status === 'not_confirmed' && retryAttempts <= policy.retryTolerance) return reflectionDecisionSchema.parse({ nextStep: 'retry', summary: `当前动作未产生预期结果，Persona 仍允许重试（上限 ${policy.retryTolerance} 次）。`, confidence: 0.85 });
  if (input.verification.status !== 'confirmed') return reflectionDecisionSchema.parse({ nextStep: 'seek_another_path', summary: '当前证据不足，已停止重复操作并寻找其他安全路径。', confidence: 0.8 });
  return reflectionDecisionSchema.parse({ nextStep: 'continue', summary: '当前动作获得可见反馈，继续根据新页面决策。', confidence: 0.85 });
}
