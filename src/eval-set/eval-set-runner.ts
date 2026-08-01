import type { EvalCase, EvalSetSelection, EvalSetType, EvaluationDepth } from '../../types.js';

const riskRank = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
const typeRank: Record<EvalSetType, number> = { regression: 0, baseline: 1, challenge: 2, exploratory: 3 };

export function selectEvalSetCases(input: { cases: EvalCase[]; depth: EvaluationDepth; capabilityIds: string[]; challengeBudget?: number }): EvalSetSelection {
  const selectedIds = new Set(input.capabilityIds);
  const scoped = input.cases.filter((item) => item.status !== 'retired' && (selectedIds.size === 0 || selectedIds.has(item.capabilityId)));
  const challengeBudget = input.challengeBudget ?? 3;
  let selected: EvalCase[];
  if (input.depth === 'quick') {
    selected = scoped.filter((item) => (item.setType === 'baseline' || item.setType === 'regression') && riskRank[item.riskLevel] <= 1);
  } else if (input.depth === 'core') {
    const required = scoped.filter((item) => item.setType === 'regression' || (item.setType === 'baseline' && riskRank[item.riskLevel] <= 2));
    const challenges = scoped.filter((item) => item.setType === 'challenge').sort((left, right) => riskRank[left.riskLevel] - riskRank[right.riskLevel]).slice(0, challengeBudget);
    selected = [...required, ...challenges];
  } else selected = scoped;
  selected = [...new Map(selected.map((item) => [item.caseId, item])).values()].sort((left, right) => typeRank[left.setType] - typeRank[right.setType] || riskRank[left.riskLevel] - riskRank[right.riskLevel] || left.caseId.localeCompare(right.caseId));
  const counts: Record<EvalSetType, number> = { baseline: 0, regression: 0, challenge: 0, exploratory: 0 };
  for (const evalCase of selected) counts[evalCase.setType] += 1;
  return {
    depth: input.depth,
    selectedCapabilityIds: [...selectedIds],
    cases: selected,
    counts,
    reason: input.depth === 'quick' ? '优先守住高风险基础能力和历史失败。' : input.depth === 'core' ? '覆盖关键基础能力、全部相关回归和少量加强检查。' : '运行所选功能的全部长期评测资产。',
  };
}
