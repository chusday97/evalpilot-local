import type { GroundedField, SafeInputValue } from '../../types.js';

const sensitivePattern = /password|passcode|credential|secret|token|credit|card|cvv|ssn|密码|密钥|令牌|信用卡|身份证/i;
const secretLikeValuePattern = /(?:sk-[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function safeActorProposal(field: GroundedField, proposedValue: string | null | undefined, pageUrl: string): string | null {
  const proposed = proposedValue?.trim();
  if (!proposed || proposed.length > 500 || secretLikeValuePattern.test(proposed)) return null;
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(pageUrl).hostname);
  if (field.inputType === 'email') {
    if (!local || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed)) return null;
  }
  if (field.inputType === 'number' && !Number.isFinite(Number(proposed))) return null;
  return proposed;
}

export function generateSafeInput(field: GroundedField, knownInformation: Record<string, unknown>, pageUrl: string, proposedValue?: string | null): SafeInputValue {
  const description = [field.fieldName, field.label, field.placeholder, field.inputType].filter(Boolean).join(' ');
  if (field.risk !== 'safe' || sensitivePattern.test(description)) {
    return { status: 'blocked_by_safety', value: null, origin: null, reason: '该字段可能包含凭证、支付或敏感信息。' };
  }
  const fieldTokens = [field.fieldName, field.label, field.placeholder].filter((item): item is string => Boolean(item)).map(normalized);
  for (const [key, rawValue] of Object.entries(knownInformation)) {
    if (rawValue === null || rawValue === undefined || typeof rawValue === 'object') continue;
    const normalizedKey = normalized(key);
    if (fieldTokens.some((token) => token.includes(normalizedKey) || normalizedKey.includes(token))) {
      return { status: 'ready', value: String(rawValue), origin: 'known_fixture', reason: `使用案例提供的 ${key}。` };
    }
  }

  const actorValue = safeActorProposal(field, proposedValue, pageUrl);
  if (actorValue !== null) {
    return { status: 'ready', value: actorValue, origin: 'synthetic_generated', reason: '保留 Actor 针对当前任务提出且通过本地安全检查的测试值。' };
  }

  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(pageUrl).hostname);
  if (field.inputType === 'email' && !local) return { status: 'blocked_by_safety', value: null, origin: null, reason: '非本地页面不自动填写邮箱。' };
  const value = field.inputType === 'email'
    ? 'evalpilot@example.invalid'
    : field.inputType === 'number'
      ? '1'
      : /search|query|搜索/i.test(description)
        ? 'EvalPilot test'
        : 'EvalPilot demo';
  return { status: 'ready', value, origin: 'synthetic_generated', reason: proposedValue?.trim() ? 'Actor 提议值未通过本地输入检查，已使用不含真实个人信息的安全测试值。' : '生成不包含真实个人信息的测试值。' };
}
