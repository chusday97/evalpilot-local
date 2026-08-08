import type { AgentActionResult, AgentDecision, EvalCase, ReflectionDecision, StepVerification } from '../../types.js';
import type { ResolvedPersonaPolicy } from '../eval-set/persona-policy.js';

export const reflectorPromptV1 = {
  id: 'semantic-reflector',
  version: '1.0.0',
  build(input: {
    evalCase: EvalCase;
    decision: AgentDecision;
    result: AgentActionResult;
    verification: StepVerification;
    policy: ResolvedPersonaPolicy;
    failedAttempts: number;
    retryAttempts: number;
    history: ReflectionDecision[];
  }): { system: string; user: string } {
    return {
      system: [
        'Choose the simulated user next-step strategy from the allowed enum.',
        'Respect the supplied persona patience, retry, privacy, exit, and safety limits.',
        'Do not claim task completion unless the verification is confirmed.',
        'Return abandon when continuing would exceed a fixed bound or require unsafe information.',
      ].join(' '),
      user: JSON.stringify({
        goal: input.evalCase.goal,
        persona: { ...input.evalCase.persona, ...input.policy },
        decision: input.decision,
        actionResult: input.result,
        verification: input.verification,
        failedAttempts: input.failedAttempts,
        retryAttempts: input.retryAttempts,
        recentReflections: input.history.slice(-5),
      }),
    };
  },
};
