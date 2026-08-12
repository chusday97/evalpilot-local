import type { EvaluationNextAction } from '../../types.js';

export interface NextActionPresentation {
  eyebrow: string;
  whatHappened: string;
  why: string;
  now: string;
  doNot: string | null;
  tone: 'good' | 'warn' | 'danger';
}

const targetCount = (action: EvaluationNextAction): number => action.targetCaseIds.length;
const confirmedFixTypes = new Set<EvaluationNextAction['type']>(['create_fix_task', 'retest_fix', 'add_to_regression']);

export function presentNextAction(action: EvaluationNextAction): NextActionPresentation {
  const count = targetCount(action);
  if (action.type === 'wait_and_resume') {
    return {
      eyebrow: '系统还在处理',
      whatHappened: `${count || 1} 个任务仍处于等待或处理中，本轮判断还没有结束。`,
      why: action.explanation,
      now: action.title,
      doNot: '不要因为等待时间长就把它当成产品失败，也不要生成代码修复任务。',
      tone: 'warn',
    };
  }
  if (action.type === 'provide_human_input') {
    return {
      eyebrow: '评测被前置条件挡住',
      whatHappened: `${count || 1} 个任务还没有形成可用于判断产品失败的完整运行证据。`,
      why: action.explanation,
      now: action.title,
      doNot: '当前不要生成代码修复任务；先补齐上面的前置条件或业务判断。',
      tone: 'warn',
    };
  }
  if (action.type === 'rerun_case') {
    return {
      eyebrow: '这次是评测器问题',
      whatHappened: `${count || 1} 个任务没有形成可靠的产品结论。`,
      why: action.explanation,
      now: action.title,
      doNot: '不要把这次结果当成产品 Bug，也不要据此生成修复任务。',
      tone: 'warn',
    };
  }
  if (action.type === 'run_remaining_cases') {
    return {
      eyebrow: '还有任务没真正运行',
      whatHappened: `${count || 1} 个已选择任务还没有完成真实浏览器运行。`,
      why: action.explanation,
      now: action.title,
      doNot: '不要把“没有发现问题”理解成整体通过，也不要在没有失败证据时修代码。',
      tone: 'warn',
    };
  }
  if (action.type === 'review_candidate_finding' || action.type === 'confirm_product_failure') {
    return {
      eyebrow: '发现了可疑现象，但还需确认',
      whatHappened: `${action.targetFindingIds.length || 1} 个发现还没有达到可直接修复的证据标准。`,
      why: action.explanation,
      now: action.title,
      doNot: '确认之前不要创建代码修复任务，也不要把它加入产品回归集。',
      tone: 'warn',
    };
  }
  if (confirmedFixTypes.has(action.type)) {
    return {
      eyebrow: '已确认产品问题',
      whatHappened: `${count || 1} 个任务已经形成产品失败或修复后的闭环证据。`,
      why: action.explanation,
      now: action.title,
      doNot: null,
      tone: 'danger',
    };
  }
  return {
    eyebrow: '当前没有需要处理的动作',
    whatHappened: '现有证据没有形成需要你立即处理的产品问题。',
    why: action.explanation,
    now: action.title,
    doNot: '不要为了“做点什么”而创建没有证据支持的修复任务。',
    tone: 'good',
  };
}
