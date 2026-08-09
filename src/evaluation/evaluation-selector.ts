import type { EvalCase, EvalSetSelection, EvalSetType, EvaluationDepth, ProductModel } from '../../types.js';

const riskRank = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
const typeRank: Record<EvalSetType, number> = { regression: 0, baseline: 1, challenge: 2, exploratory: 3 };

export function selectEvaluationCases(input: { model: ProductModel; cases: EvalCase[]; depth: EvaluationDepth; capabilityIds: string[]; challengeBudget?: number }): EvalSetSelection {
  const requested = new Set(input.capabilityIds);
  const defaultCapabilities = input.depth === 'full'
    ? input.model.capabilities
    : input.model.capabilities.filter((item) => item.importance === 'critical' || item.importance === 'high');
  const selectedCapabilities = requested.size ? requested : new Set(defaultCapabilities.map((item) => item.capabilityId));
  const scoped = input.cases.filter((item) => item.status !== 'retired' && selectedCapabilities.has(item.capabilityId));
  const regressions = scoped.filter((item) => item.setType === 'regression');
  let selected: EvalCase[];

  if (input.depth === 'quick') {
    const criticalIds = new Set(input.model.capabilities.filter((item) => item.importance === 'critical').map((item) => item.capabilityId));
    const baseline = scoped
      .filter((item) => item.setType === 'baseline' && criticalIds.has(item.capabilityId))
      .sort((left, right) => riskRank[left.riskLevel] - riskRank[right.riskLevel] || left.caseId.localeCompare(right.caseId))[0]
      ?? scoped.filter((item) => item.setType === 'baseline').sort((left, right) => riskRank[left.riskLevel] - riskRank[right.riskLevel] || left.caseId.localeCompare(right.caseId))[0];
    selected = [...regressions, ...(baseline ? [baseline] : [])];
  } else if (input.depth === 'core') {
    const primaryIds = new Set(input.model.capabilities.filter((item) => item.importance === 'critical' || item.importance === 'high').map((item) => item.capabilityId));
    const baselines = scoped.filter((item) => item.setType === 'baseline' && primaryIds.has(item.capabilityId));
    const challenges = scoped
      .filter((item) => item.setType === 'challenge')
      .sort((left, right) => riskRank[left.riskLevel] - riskRank[right.riskLevel] || left.caseId.localeCompare(right.caseId))
      .slice(0, input.challengeBudget ?? 3);
    selected = [...regressions, ...baselines, ...challenges];
  } else {
    selected = scoped;
  }

  selected = [...new Map(selected.map((item) => [item.caseId, item])).values()]
    .sort((left, right) => typeRank[left.setType] - typeRank[right.setType] || riskRank[left.riskLevel] - riskRank[right.riskLevel] || left.caseId.localeCompare(right.caseId));
  const counts: Record<EvalSetType, number> = { baseline: 0, regression: 0, challenge: 0, exploratory: 0 };
  for (const evalCase of selected) counts[evalCase.setType] += 1;
  return {
    depth: input.depth,
    selectedCapabilityIds: [...selectedCapabilities],
    cases: selected,
    counts,
    reason: input.depth === 'quick'
      ? '运行一个最关键基础任务，并复查相关历史失败。'
      : input.depth === 'core'
        ? '运行关键基础任务、全部相关回归和少量加强检查。'
        : '运行所选功能的全部基础、回归、加强和探索案例。',
  };
}
