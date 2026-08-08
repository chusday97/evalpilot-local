import type { EvalPersonaRef } from '../../types.js';

export interface ResolvedPersonaPolicy {
  knowledgeLevel: 'low' | 'medium' | 'high';
  patienceTurns: number;
  retryTolerance: number;
  privacySensitivity: 'low' | 'medium' | 'high';
  exitConditions: string[];
}

export function resolvePersonaPolicy(persona: EvalPersonaRef): ResolvedPersonaPolicy {
  return {
    knowledgeLevel: persona.knowledgeLevel ?? 'medium',
    patienceTurns: persona.patienceTurns ?? 3,
    retryTolerance: persona.retryTolerance ?? 1,
    privacySensitivity: persona.privacySensitivity ?? 'medium',
    exitConditions: persona.exitConditions?.length ? persona.exitConditions : ['证据不足时退出'],
  };
}

export function defaultPersonaRef(personaId: string, name: string, behaviorPolicy: string[], overrides: Partial<ResolvedPersonaPolicy> = {}): EvalPersonaRef {
  return {
    personaId,
    name,
    knowledgeLevel: overrides.knowledgeLevel ?? 'medium',
    patienceTurns: overrides.patienceTurns ?? 3,
    retryTolerance: overrides.retryTolerance ?? 1,
    privacySensitivity: overrides.privacySensitivity ?? 'medium',
    behaviorPolicy,
    exitConditions: overrides.exitConditions ?? ['证据不足时退出'],
  };
}
