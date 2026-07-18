import type { CompletionDefinition, InteractionAction } from '../../types.js';

export function analyzeNextAction(completion: CompletionDefinition, actions: InteractionAction[]): {
  clear: boolean;
  evidence: string[];
  recommendation: string | null;
} {
  const evidence = completion.followUp.evidence.length
    ? completion.followUp.evidence
    : actions.filter((action) => /save|modify|export|continue|finish|保存|修改|导出|继续|完成/.test(`${action.target ?? ''} ${action.outcome}`)).flatMap((action) => action.evidence);
  const clear = completion.followUp.complete === true && evidence.length > 0;
  return {
    clear,
    evidence,
    recommendation: clear ? null : '在结果附近提供可理解的保存、修改、继续或明确结束入口，并记录可观察反馈。',
  };
}
