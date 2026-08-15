import type { AgentDecision, EvalCase, OperationType, PageObservation } from '../../types.js';

const includesAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));

export function classifyOperation(input: { decision: AgentDecision; observation: PageObservation; evalCase: EvalCase }): OperationType {
  const { decision, observation } = input;
  const target = observation.interactableElements.find((element) => element.elementId === decision.targetElementId);
  const field = observation.formFields.find((element) => element.elementId === decision.targetElementId);
  if (decision.action === 'fill' && field?.inputType === 'file') return 'file_processing';
  if (['fill', 'select', 'scroll', 'finish', 'abandon'].includes(decision.action)) return 'synchronous';

  // Operation type must be grounded in the action the Agent is taking, not in unrelated
  // copy elsewhere on the page. A product-wide label such as "AI assistant" must not make
  // an ordinary settings click inherit the 60s AI-generation wait policy.
  const actionContext = [
    target?.label,
    target?.text,
    target?.role,
    target?.tagName,
    field?.inputType,
    decision.intentSummary,
    decision.expectedResult,
  ].filter((value): value is string => Boolean(value)).join(' ').toLocaleLowerCase();
  const decisionContext = `${decision.intentSummary} ${decision.expectedResult}`.toLocaleLowerCase();
  const targetContext = `${target?.label ?? ''} ${target?.text ?? ''}`.trim().toLocaleLowerCase();

  if (decision.action === 'back'
    || target?.tagName === 'a'
    || target?.role === 'link'
    || includesAny(actionContext, ['navigate', 'open page', 'go to', '进入页面', '打开页面', '跳转', '返回'])) return 'navigation';

  if (field?.inputType === 'file'
    || includesAny(actionContext, ['upload', 'import file', 'process file', '上传', '导入文件', '处理文件', '解析文件'])) return 'file_processing';

  if (includesAny(actionContext, ['generate', 'generating', 'stream', 'streaming', 'ai ', 'assistant', 'chat', 'summarize', 'transcribe', '生成', '流式', '智能', '助手', '对话', '总结', '转写'])) return 'ai_generation';

  // Creation/recording words are often used on entry-point buttons ("Create or configure",
  // "Record existing ...") that merely open a local form. Treat them as a submit only when
  // the Agent's own intent/expectation says it is committing state. Strong submit labels such
  // as Save/Submit/Confirm remain sufficient on their own.
  const decisionCommits = includesAny(decisionContext, ['submit', 'save', 'create', 'update', 'confirm', 'send', 'sign in', 'log in', '提交', '保存', '创建', '更新', '确认', '发送', '登录']);
  const targetStronglyCommits = includesAny(targetContext, ['save', 'submit', 'confirm', 'send', '保存', '提交', '确认', '发送']);
  if (decision.action === 'click' && (decisionCommits || targetStronglyCommits)) return 'form_submit';

  // A plain button is a synchronous UI control unless the action semantics above prove that
  // it starts navigation, upload/processing, generation, or a persisted form submission.
  // Treating every otherwise-unknown button as async made simple radio/choice interactions
  // burn the 8s unknown_async soft timeout even when the DOM updated immediately.
  if (decision.action === 'click' && target?.tagName === 'button') return 'synchronous';

  if (decision.action === 'wait' || decision.action === 'retry') return 'unknown_async';
  if (decision.action === 'click') return 'unknown_async';
  return 'synchronous';
}
