import type { GroundedField, SafeInputValue } from '../../types.js';
import type { FieldInputConstraints } from './field-input-constraints.js';

const sensitivePattern = /password|passcode|credential|secret|token|credit|card|cvv|ssn|密码|密钥|令牌|信用卡|身份证/i;
const secretLikeValuePattern = /(?:sk-[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const noConstraints: FieldInputConstraints = { min: null, max: null, minLength: null, maxLength: null, step: null, pattern: null };

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function satisfiesConstraints(field: GroundedField, value: string, constraints: FieldInputConstraints): boolean {
  if (constraints.minLength !== null && value.length < constraints.minLength) return false;
  if (constraints.maxLength !== null && value.length > constraints.maxLength) return false;
  if (field.inputType !== 'number') return true;
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  if (constraints.min !== null && number < constraints.min) return false;
  if (constraints.max !== null && number > constraints.max) return false;
  if (constraints.step !== null && constraints.step > 0) {
    const base = constraints.min ?? 0;
    const steps = (number - base) / constraints.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-8) return false;
  }
  return true;
}

function safeActorProposal(field: GroundedField, proposedValue: string | null | undefined, pageUrl: string, constraints: FieldInputConstraints): string | null {
  const proposed = proposedValue?.trim();
  if (!proposed || proposed.length > 500 || secretLikeValuePattern.test(proposed)) return null;
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(pageUrl).hostname);
  if (field.inputType === 'email') {
    if (!local || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed)) return null;
  }
  return satisfiesConstraints(field, proposed, constraints) ? proposed : null;
}

function syntheticNumber(constraints: FieldInputConstraints): string {
  let value = constraints.min ?? (constraints.step !== null && constraints.step > 0 ? constraints.step : 1);
  if (constraints.step !== null && constraints.step > 0) {
    const base = constraints.min ?? 0;
    const steps = Math.max(0, Math.ceil((value - base) / constraints.step));
    value = base + steps * constraints.step;
  }
  if (constraints.max !== null) value = Math.min(value, constraints.max);
  if (constraints.min !== null) value = Math.max(value, constraints.min);
  return String(value);
}

function fitText(value: string, constraints: FieldInputConstraints): string {
  let result = value;
  if (constraints.maxLength !== null) result = result.slice(0, constraints.maxLength);
  if (constraints.minLength !== null && result.length < constraints.minLength) result = `${result}${'x'.repeat(constraints.minLength - result.length)}`;
  return result;
}

export function generateSafeInput(field: GroundedField, knownInformation: Record<string, unknown>, pageUrl: string, proposedValue?: string | null, rawConstraints: FieldInputConstraints = noConstraints): SafeInputValue {
  const constraints = rawConstraints;
  const description = [field.fieldName, field.label, field.placeholder, field.inputType].filter(Boolean).join(' ');
  if (field.risk !== 'safe' || sensitivePattern.test(description)) {
    return { status: 'blocked_by_safety', value: null, origin: null, reason: '该字段可能包含凭证、支付或敏感信息。' };
  }
  const fieldTokens = [field.fieldName, field.label, field.placeholder].filter((item): item is string => Boolean(item)).map(normalized);
  for (const [key, rawValue] of Object.entries(knownInformation)) {
    if (rawValue === null || rawValue === undefined || typeof rawValue === 'object') continue;
    const normalizedKey = normalized(key);
    const fixtureValue = String(rawValue);
    if (fieldTokens.some((token) => token.includes(normalizedKey) || normalizedKey.includes(token)) && satisfiesConstraints(field, fixtureValue, constraints)) {
      return { status: 'ready', value: fixtureValue, origin: 'known_fixture', reason: `使用案例提供的 ${key}。` };
    }
  }

  const actorValue = safeActorProposal(field, proposedValue, pageUrl, constraints);
  if (actorValue !== null) {
    return { status: 'ready', value: actorValue, origin: 'synthetic_generated', reason: '保留 Actor 针对当前任务提出且通过本地安全与字段约束检查的测试值。' };
  }

  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(pageUrl).hostname);
  if (field.inputType === 'email' && !local) return { status: 'blocked_by_safety', value: null, origin: null, reason: '非本地页面不自动填写邮箱。' };
  const base = field.inputType === 'email'
    ? 'evalpilot@example.invalid'
    : field.inputType === 'number'
      ? syntheticNumber(constraints)
      : /search|query|搜索/i.test(description)
        ? 'EvalPilot test'
        : 'EvalPilot demo';
  const value = field.inputType === 'number' ? base : fitText(base, constraints);
  return { status: 'ready', value, origin: 'synthetic_generated', reason: proposedValue?.trim() ? 'Actor 或案例值未通过本地字段约束检查，已生成符合基础 HTML 约束的安全测试值。' : '根据基础 HTML 约束生成不包含真实个人信息的测试值。' };
}
