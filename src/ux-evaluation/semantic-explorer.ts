const destructivePattern = /删除|清空|支付|付款|发送|发布|公开|覆盖|注销|移除|购买|confirm payment|delete|remove|publish|send/i;

export interface SemanticTarget {
  index: number;
  kind: 'button' | 'link' | 'input' | 'select' | 'textarea';
  label: string;
  disabled: boolean;
}

function tokens(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const result = new Set<string>();
  for (const word of value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) result.add(word);
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function relevance(label: string, goal: string): number {
  const goalTokens = tokens(goal);
  const labelTokens = tokens(label);
  let score = 0;
  for (const token of labelTokens) if (goalTokens.has(token)) score += 1;
  if (/开始|创建|生成|推荐|继续|下一步|start|create|generate|continue/i.test(label)) score += 0.5;
  if (/重试|重新尝试|再试一次|返回|retry|try again|back/i.test(label)) score += 0.75;
  return score;
}

export function semanticTargetKey(target: SemanticTarget): string {
  return `${target.kind}:${target.label}`;
}

export function chooseSemanticTarget(
  targets: SemanticTarget[],
  goal: string,
  visited: Set<string>,
): SemanticTarget | null {
  const candidates = targets
    .filter((target) => !target.disabled && target.label.trim().length > 0)
    .filter((target) => !destructivePattern.test(target.label))
    .filter((target) => !visited.has(semanticTargetKey(target)))
    .map((target) => ({ target, score: relevance(target.label, goal) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.target.index - right.target.index);
  return candidates[0]?.target ?? null;
}

export function evaluateVisibleConditions(visibleText: string, conditions: string[]): {
  satisfied: string[];
  missing: string[];
  complete: boolean;
} {
  const normalizedText = visibleText.replace(/\s+/g, ' ').trim().toLowerCase();
  const satisfied = conditions.filter((condition) => normalizedText.includes(condition.replace(/\s+/g, ' ').trim().toLowerCase()));
  const satisfiedSet = new Set(satisfied);
  const missing = conditions.filter((condition) => !satisfiedSet.has(condition));
  return { satisfied, missing, complete: conditions.length > 0 && missing.length === 0 };
}
