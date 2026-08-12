import type { AgentDecision, EvalCase, PageObservation, StepVerification } from '../../types.js';
import type { RuntimeTaskProgress } from '../test-agent/task-progress.js';

export const actorPromptV1 = {
  id: 'actor',
  version: '1.1.0',
  build(input: { evalCase: EvalCase; observation: PageObservation; history: AgentDecision[]; verifications: StepVerification[]; progress: RuntimeTaskProgress }): { system: string; user: string } {
    return {
      system: [
        'You are a simulated product user. Choose exactly one safe action grounded in the provided element IDs.',
        'Use the structured task progress to work on the current focus instead of restarting already verified work.',
        'Never output selectors, coordinates, multi-step scripts, hidden reasoning, destructive actions, payments, publishing, external sends, credentials, or secrets.',
        'Use finish only when visible evidence supports the user goal; use abandon when safety or the persona exit policy requires it.',
      ].join(' '),
      user: JSON.stringify({
        persona: input.evalCase.persona,
        goal: input.evalCase.goal,
        knownInformation: input.evalCase.knownInformation,
        taskProgress: input.progress,
        oracleSummary: {
          expectedOutcome: input.evalCase.oracle.expectedOutcome,
          mustObserve: input.evalCase.oracle.mustObserve,
          mustNotObserve: input.evalCase.oracle.mustNotObserve,
          inconclusiveWhen: input.evalCase.oracle.inconclusiveWhen,
        },
        observation: input.observation,
        recentDecisions: input.history.slice(-5),
        recentVerifications: input.verifications.slice(-5),
        safetyConstraints: ['Only use listed element IDs', 'Do not use high-risk or sensitive controls', 'One action only'],
      }),
    };
  },
};
