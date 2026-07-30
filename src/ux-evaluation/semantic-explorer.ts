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

function stablePageText(value: string): string {
  return value
    .toLowerCase()
    .replace(/(?:\d+\s*[:：]\s*)+\d+/g, '#')
    .replace(/((?:倒计时|比分|score|库存|剩余)[^\n]{0,24}?)\d+(?:\s*[-/]\s*\d+)?/gi, '$1#')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasObservablePageChange(
  beforeUrl: string,
  afterUrl: string,
  beforeText: string,
  afterText: string,
): boolean {
  return beforeUrl !== afterUrl || stablePageText(beforeText) !== stablePageText(afterText);
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

export interface RuntimeConditionEvidence {
  pageReached: boolean;
  visibleTargetCount: number;
  observableFeedback: boolean;
}

export function evaluateEvidenceConditions(
  visibleText: string,
  conditions: string[],
  evidence: RuntimeConditionEvidence,
): {
  satisfied: string[];
  missing: string[];
  complete: boolean;
} {
  const visible = evaluateVisibleConditions(visibleText, conditions);
  const visibleSet = new Set(visible.satisfied);
  const satisfied = conditions.filter((condition) => {
    if (visibleSet.has(condition)) return true;
    if (/入口页面.*(?:Chromium|浏览器).*(?:到达|访问)|entry page.*(?:reach|load)/i.test(condition)) {
      return evidence.pageReached;
    }
    if (/主要内容.*核心操作.*可见|main content.*(?:action|control).*visible/i.test(condition)) {
      return visibleText.trim().length > 0 && evidence.visibleTargetCount > 0;
    }
    if (/执行后页面.*(?:结果|下一步)|after.*action.*(?:result|next step)/i.test(condition)) {
      return evidence.observableFeedback;
    }
    return false;
  });
  const satisfiedSet = new Set(satisfied);
  const missing = conditions.filter((condition) => !satisfiedSet.has(condition));
  return { satisfied, missing, complete: conditions.length > 0 && missing.length === 0 };
}
