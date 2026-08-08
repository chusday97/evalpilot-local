import type { EvalCase, EvalCaseResult, FailureClassification } from '../../types.js';

export function classifyEvalFailure(evalCase: EvalCase, result: EvalCaseResult): FailureClassification {
  if (result.verdict === 'pass') return { kind: 'none', category: null, reason: '案例通过，不创建 Badcase。' };
  if (result.failureSource === 'evaluator') return { kind: 'evaluator', category: 'evaluator', reason: '评测器或模型没有产生可信结论。' };
  if (result.verdict === 'inconclusive' || result.failureSource === 'unknown' || result.failureSource === null) return { kind: 'unknown', category: null, reason: '证据不足以区分产品失败和评测失败。' };
  const joined = [result.semantic.summary, ...result.semantic.whatFailed, ...result.semantic.confirmedFacts].join(' ');
  const category = /duplicate|double submit|重复提交|重复数据/i.test(joined) ? 'data'
    : /network|api|request failed|failed request|response 5\d\d|接口|请求失败|接口失败/i.test(joined) ? 'api'
      : /ai output|generated answer|irrelevant|模型输出|生成回答|回答无关/i.test(joined) ? 'ai_output'
    : /navigate|route|link|导航|路由|返回/i.test(joined) ? 'navigation'
      : /click|button|feedback|交互|按钮|反馈/i.test(joined) ? 'interaction'
        : /state|persist|refresh|状态|保存|刷新/i.test(joined) ? 'state'
          : /slow|timeout|performance|超时|性能/i.test(joined) ? 'performance'
            : evalCase.oracle.semanticRubric.length ? 'ux' : 'functional';
  return { kind: 'product', category, reason: 'Hybrid Judge 已用直接证据确认产品失败。' };
}
