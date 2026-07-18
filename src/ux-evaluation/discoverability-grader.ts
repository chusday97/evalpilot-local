import type { InteractionAction } from '../../types.js';
import { analyzeEntryDiscovery } from './entry-discovery-analyzer.js';

export function gradeDiscoverability(actions: InteractionAction[]): { score: 0 | 1 | 2; evidence: string[]; reason: string } {
  const result = analyzeEntryDiscovery(actions);
  if (!result.found) return { score: 0, evidence: result.evidence, reason: '没有证据证明用户找到功能入口。' };
  if (result.attempts > 3) return { score: 1, evidence: result.evidence, reason: `找到入口前尝试了 ${result.attempts} 次。` };
  return { score: 2, evidence: result.evidence, reason: '用户在少量尝试内找到入口。' };
}
