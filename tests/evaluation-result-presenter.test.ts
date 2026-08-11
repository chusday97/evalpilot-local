import { describe, expect, it } from 'vitest';
import { actionLabel, presentEvaluationResult, runResultLabel, taskStateLabel } from '../dashboard/src/evaluation-result-presenter.js';

const session = { status: 'completed', selectedCaseIds: ['case-a', 'case-b'] };

describe('evaluation result presenter', () => {
  it('leads with confirmed product problems instead of raw verdicts', () => {
    const result = presentEvaluationResult({
      session,
      runs: [{ caseId: 'case-a', verdict: 'fail', failureSource: 'product' }],
      findings: [],
      badcases: [{ caseId: 'case-a' }],
    });
    expect(result.headline).toBe('已确认 1 个产品问题，需要处理后复测。');
    expect(result.counts).toEqual({ passed: 0, confirmedProblems: 1, unfinished: 1, candidates: 0 });
  });

  it('does not turn evaluator failure or an unrun task into a product bug', () => {
    const result = presentEvaluationResult({
      session,
      runs: [{ caseId: 'case-a', verdict: 'inconclusive', failureSource: 'evaluator' }],
      findings: [],
      badcases: [],
    });
    expect(result.headline).toBe('这次没有确认产品 Bug，但有 2 个任务没有测完。');
    expect(result.unknowns).toContain('有 1 个任务是评测器没有完成，不能据此判断产品好坏。');
  });

  it('explains pending work and translates technical states', () => {
    expect(presentEvaluationResult({ session: { ...session, status: 'running' }, runs: [], findings: [], badcases: [] }).headline)
      .toBe('产品任务仍在生成中，EvalPilot 正在继续观察。');
    expect(runResultLabel({ verdict: 'inconclusive', failureSource: 'evaluator' })).toBe('评测器没有完成这一步');
    expect(taskStateLabel('stalled')).toBe('产品长时间没有继续变化');
    expect(actionLabel('click')).toBe('点击页面控件');
  });
});
