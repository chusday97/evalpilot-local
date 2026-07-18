import type { InteractionAction } from '../../types.js';

export function gradeRecovery(actions: InteractionAction[]): { score: 0 | 1 | 2; evidence: string[]; reason: string } {
  const errors = actions.filter((action) => action.type === 'error');
  if (errors.length === 0) return { score: 2, evidence: [], reason: '本轮未触发需要恢复的错误。' };
  const attempts = actions.filter((action) => action.type === 'retry' || action.type === 'backtrack');
  const recovered = actions.some((action) => /recovered/.test(action.outcome));
  if (recovered) return { score: 2, evidence: actions.flatMap((action) => action.evidence), reason: '错误后存在恢复动作且恢复成功。' };
  if (attempts.length > 0) return { score: 1, evidence: attempts.flatMap((action) => action.evidence), reason: '存在恢复尝试，但没有成功证据。' };
  return { score: 0, evidence: errors.flatMap((action) => action.evidence), reason: '错误后没有恢复动作。' };
}
