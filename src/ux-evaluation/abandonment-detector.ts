import type { AbandonmentPolicy, InteractionAction } from '../../types.js';

export interface AbandonmentInput {
  actions: InteractionAction[];
  failedAttempts: number;
  clarificationTurns: number;
  idleTimeMs: number;
  policy: AbandonmentPolicy;
}

export function analyzeAbandonment(input: AbandonmentInput): { abandoned: boolean; reason: string | null; step: string | null } {
  const step = input.actions.at(-1)?.actionId ?? null;
  if (input.failedAttempts >= input.policy.maxFailedAttempts) {
    return { abandoned: true, reason: `失败尝试达到上限 ${input.policy.maxFailedAttempts}`, step };
  }
  if (input.clarificationTurns >= input.policy.maxClarificationTurns) {
    return { abandoned: true, reason: `追问次数达到上限 ${input.policy.maxClarificationTurns}`, step };
  }
  if (input.idleTimeMs >= input.policy.maxIdleTimeMs) {
    return { abandoned: true, reason: `无动作时间达到上限 ${input.policy.maxIdleTimeMs}ms`, step };
  }
  if (input.actions.length >= input.policy.maxTotalActions) {
    return { abandoned: true, reason: `总操作数达到上限 ${input.policy.maxTotalActions}`, step };
  }
  return { abandoned: false, reason: null, step: null };
}
