import type { Scenario } from '../../types.js';

export interface ManualRubricReview {
  caseId: string;
  status: 'needs_human_review';
  items: string[];
  note: string;
}

export function buildManualRubricReview(scenario: Scenario): ManualRubricReview {
  return {
    caseId: scenario.caseId,
    status: 'needs_human_review',
    items: scenario.rubric,
    note: 'MVP 不使用同一个生成器为开放式结果自评，请由人基于 Trace、截图和实际输出审核。',
  };
}

