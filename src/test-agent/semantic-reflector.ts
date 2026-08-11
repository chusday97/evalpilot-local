import type { AiProvider } from '../ai/provider.js';
import type { AgentActionResult, AgentDecision, EvalCase, ReflectionDecision, StepVerification, TaskStateObservation } from '../../types.js';
import { resolvePersonaPolicy } from '../eval-set/persona-policy.js';
import { reflectorPromptV1 } from '../prompts/reflector.v1.js';
import { reflectionDecisionSchema } from './schemas.js';

export async function reflectOnStepSemantically(input: {
  provider: AiProvider;
  evalCase: EvalCase;
  decision: AgentDecision;
  result: AgentActionResult;
  verification: StepVerification;
  taskState?: TaskStateObservation;
  failedAttempts: number;
  retryAttempts: number;
  history: ReflectionDecision[];
  allowRemoteModel: boolean;
}): Promise<ReflectionDecision | null> {
  if (input.taskState?.state === 'pending' || input.taskState?.state === 'progressing') {
    return reflectionDecisionSchema.parse({ nextStep: 'continue', summary: '任务仍在处理，等待过程不消耗 Persona 的失败尝试。', confidence: 1 });
  }
  const policy = resolvePersonaPolicy(input.evalCase.persona);
  const prompt = reflectorPromptV1.build({ ...input, policy });
  try {
    const proposed = await input.provider.generateStructured({
      requestId: `semantic-reflector-${input.decision.decisionId ?? input.history.length + 1}`,
      task: 'semantic_reflector',
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      schemaName: 'reflection_decision',
      imageDataUrls: [],
      privacy: { allowRemoteModel: input.provider.info.remote ? input.allowRemoteModel : true, allowScreenshot: false, visibleTextOnly: true, redactionApplied: true },
      metadata: { caseId: input.evalCase.caseId, promptVersion: reflectorPromptV1.version },
    }, reflectionDecisionSchema);
    if (input.result.status === 'blocked_by_safety' || input.failedAttempts >= policy.patienceTurns) {
      return reflectionDecisionSchema.parse({ nextStep: 'abandon', summary: '已达到安全或 Persona 耐心边界，不能继续自动尝试。', confidence: 1 });
    }
    if (input.decision.action === 'abandon') {
      return reflectionDecisionSchema.parse({ nextStep: 'abandon', summary: 'Persona 已明确退出当前路径。', confidence: input.decision.confidence });
    }
    if (input.decision.action === 'finish' && input.verification.status === 'confirmed') {
      return reflectionDecisionSchema.parse({ nextStep: 'finish', summary: '任务完成动作已有确定性与语义证据确认。', confidence: input.verification.confidence });
    }
    if (proposed.nextStep === 'finish' && input.verification.status !== 'confirmed') {
      return reflectionDecisionSchema.parse({ nextStep: 'seek_another_path', summary: '当前证据尚未确认任务完成，继续寻找其他安全路径。', confidence: 0.9 });
    }
    if (proposed.nextStep === 'retry' && input.retryAttempts > policy.retryTolerance) {
      return reflectionDecisionSchema.parse({ nextStep: 'seek_another_path', summary: '已用完当前 Persona 允许的重试次数，改为寻找其他路径。', confidence: 0.9 });
    }
    return proposed;
  } catch {
    return null;
  }
}
