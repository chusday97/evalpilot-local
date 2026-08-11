type Item = Record<string, any>;

export interface EvaluationResultSummary {
  headline: string;
  reasons: string[];
  unknowns: string[];
  counts: { passed: number; confirmedProblems: number; unfinished: number; candidates: number };
}

function uniqueCaseCount(items: Item[]): number {
  return new Set(items.map((item) => item.caseId).filter(Boolean)).size;
}

export function presentEvaluationResult(input: {
  session: Item;
  runs: Item[];
  findings: Item[];
  badcases: Item[];
}): EvaluationResultSummary {
  const { session, runs, findings, badcases } = input;
  const confirmedFindings = findings.filter((item) => item.status === 'confirmed_product_failure');
  const confirmedCaseIds = new Set([...confirmedFindings, ...badcases].map((item) => item.caseId).filter(Boolean));
  const candidateFindings = findings.filter((item) => item.status === 'candidate' || item.status === 'needs_human_review');
  const evaluatorItems = [
    ...runs.filter((item) => item.failureSource === 'evaluator'),
    ...findings.filter((item) => item.status === 'evaluator_failure'),
  ];
  const runCaseIds = new Set(runs.map((item) => item.caseId));
  const unrunCaseIds = (session.selectedCaseIds ?? []).filter((caseId: string) => !runCaseIds.has(caseId));
  const unfinished = new Set([...unrunCaseIds, ...evaluatorItems.map((item) => item.caseId).filter(Boolean)]).size;
  const passed = uniqueCaseCount(runs.filter((item) => item.verdict === 'pass'));
  const pending = session.status === 'queued' || session.status === 'running';

  let headline: string;
  if (pending) headline = '产品任务仍在生成中，EvalPilot 正在继续观察。';
  else if (confirmedCaseIds.size > 0) headline = `已确认 ${confirmedCaseIds.size} 个产品问题，需要处理后复测。`;
  else if (unfinished > 0 || session.status === 'failed') headline = `这次没有确认产品 Bug，但有 ${Math.max(unfinished, 1)} 个任务没有测完。`;
  else if (candidateFindings.length > 0) headline = `这次没有确认产品 Bug，但有 ${candidateFindings.length} 个可疑现象还不能判断。`;
  else headline = '这次没有确认产品 Bug，所选任务已经测完。';

  const reasons: string[] = [];
  if (passed > 0) reasons.push(`${passed} 个任务有完成证据。`);
  if (confirmedCaseIds.size > 0) reasons.push(`${confirmedCaseIds.size} 个任务已有确认的产品失败证据。`);
  if (candidateFindings.length > 0) reasons.push(`${candidateFindings.length} 个可疑现象仍在等待补证或人工确认。`);
  if (unfinished > 0) reasons.push(`${unfinished} 个任务没有形成可判断的完整运行结果。`);
  if (pending) reasons.push('页面仍在处理任务，当前结果不是最终结论。');
  if (!reasons.length) reasons.push('本次所选任务均有结果，且没有形成已确认的产品失败。');

  const unknowns: string[] = [];
  if (evaluatorItems.length > 0) unknowns.push(`有 ${uniqueCaseCount(evaluatorItems)} 个任务是评测器没有完成，不能据此判断产品好坏。`);
  if (unrunCaseIds.length > 0) unknowns.push(`有 ${new Set(unrunCaseIds).size} 个已选任务尚未真实运行。`);
  if (candidateFindings.length > 0) unknowns.push('可疑现象还不是产品 Bug，确认前不会进入修复或回归。');
  if (pending) unknowns.push('任务完成前，无法判断最终结果和用户是否能完成目标。');
  if (!unknowns.length) unknowns.push('本结论只覆盖这次选择并真实运行的任务，不代表整个产品已被完整验证。');

  return {
    headline,
    reasons,
    unknowns,
    counts: { passed, confirmedProblems: confirmedCaseIds.size, unfinished, candidates: candidateFindings.length },
  };
}

export function runResultLabel(run: Item): string {
  if (run.verdict === 'pass') return '任务已完成';
  if (run.verdict === 'fail' && run.failureSource === 'product') return '已确认产品问题';
  if (run.failureSource === 'evaluator') return '评测器没有完成这一步';
  return '还不能判断';
}

export function taskStateLabel(state: string | null | undefined): string | null {
  const labels: Record<string, string> = {
    pending: '产品仍在处理中',
    progressing: '产品仍在处理中',
    stalled: '产品长时间没有继续变化',
    completed: '产品已完成处理',
    failed: '产品明确显示处理失败',
    blocked: '页面阻止了这一步',
  };
  return state ? labels[state] ?? '页面状态还不能判断' : null;
}

export function actionLabel(type: string): string {
  return ({ click: '点击页面控件', fill: '填写表单', navigation: '进入下一页面', scroll: '查看页面后续内容', wait: '等待页面完成处理', finish: '结束本次任务', abandon: '停止本次任务' } as Record<string, string>)[type] ?? '执行页面操作';
}
