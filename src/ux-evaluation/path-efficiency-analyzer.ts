import type { JourneyComparison } from '../../types.js';

export function analyzePathEfficiency(comparison: JourneyComparison): {
  efficient: boolean;
  ratio: number;
  reasons: string[];
} {
  const base = Math.max(1, comparison.shortestReasonableActionCount);
  const ratio = comparison.actualActionCount / base;
  const reasons: string[] = [];
  if (comparison.extraActionCount > 0) reasons.push(`比最短合理路径多 ${comparison.extraActionCount} 个动作`);
  if (comparison.backtrackCount > 0) reasons.push(`出现 ${comparison.backtrackCount} 次回退`);
  if (comparison.repeatedInputCount > 0) reasons.push(`出现 ${comparison.repeatedInputCount} 次重复输入`);
  if (comparison.deadEndCount > 0) reasons.push(`遇到 ${comparison.deadEndCount} 个死路`);
  return { efficient: ratio <= 1.25 && reasons.length === 0, ratio, reasons };
}
