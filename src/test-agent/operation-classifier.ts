import type { AgentDecision, EvalCase, OperationType, PageObservation } from '../../types.js';

const includesAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));

export function classifyOperation(input: { decision: AgentDecision; observation: PageObservation; evalCase: EvalCase }): OperationType {
  const { decision, observation, evalCase } = input;
  if (['fill', 'select', 'scroll', 'finish', 'abandon'].includes(decision.action)) return 'synchronous';
  const target = observation.interactableElements.find((element) => element.elementId === decision.targetElementId);
  const field = observation.formFields.find((element) => element.elementId === decision.targetElementId);
  const actionContext = [target?.label, target?.text, target?.role, target?.tagName, field?.inputType, decision.intentSummary, decision.expectedResult]
    .filter((value): value is string => Boolean(value)).join(' ').toLocaleLowerCase();
  const context = [
    target?.label, target?.text, target?.role, target?.tagName, field?.inputType,
    decision.intentSummary, decision.expectedResult, observation.visibleStateSummary, ...observation.primaryAreas,
    evalCase.title, evalCase.goal, evalCase.hypothesis, evalCase.capabilityId, evalCase.taskId, evalCase.generationReason,
    ...evalCase.oracle.expectedOutcome, ...evalCase.oracle.mustObserve,
  ].filter((value): value is string => Boolean(value)).join(' ').toLocaleLowerCase();

  if (decision.action === 'back' || target?.tagName === 'a' || target?.role === 'link' || includesAny(actionContext, ['navigate', 'open page', 'go to', '进入页面', '打开页面', '跳转', '返回'])) return 'navigation';
  if (field?.inputType === 'file' || includesAny(context, ['upload', 'import file', 'process file', '上传', '导入文件', '处理文件', '解析文件'])) return 'file_processing';
  if (includesAny(context, ['generate', 'generating', 'ai ', 'assistant', 'chat', 'summarize', 'transcribe', '生成', '智能', '助手', '对话', '总结', '转写'])) return 'ai_generation';
  if (decision.action === 'click' && includesAny(actionContext, ['submit', 'save', 'create', 'update', 'confirm', 'send', 'sign in', 'log in', '提交', '保存', '创建', '更新', '确认', '发送', '登录'])) return 'form_submit';
  if (decision.action === 'wait' || decision.action === 'retry' || decision.action === 'click') return 'unknown_async';
  return 'synchronous';
}
