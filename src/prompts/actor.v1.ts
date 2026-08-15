import type { AgentDecision, EvalCase, PageObservation, StepVerification } from '../../types.js';
import type { RuntimeTaskProgress } from '../test-agent/task-progress.js';

function actorVisibleProgress(input: { observation: PageObservation; progress: RuntimeTaskProgress }): Record<string, unknown> {
  const emptyRequiredFields = input.observation.formFields.filter((field) => field.required && !field.currentValuePresent && !field.disabled && field.risk === 'safe');
  return {
    currentFocus: emptyRequiredFields.length ? 'complete_required_inputs' : 'continue_user_goal',
    currentFocusLabel: emptyRequiredFields.length
      ? `先完成 ${emptyRequiredFields.length} 个仍为空的必填安全字段。`
      : '继续根据当前可见页面、用户目标和已经发生的操作选择下一步。',
    completedVerifiedSteps: input.progress.completedVerifiedSteps,
    remainingActionBudget: input.progress.remainingActionBudget,
    currentActionBudget: input.progress.currentActionBudget,
    hardActionBudget: input.progress.hardActionBudget,
    failedAttempts: input.progress.failedAttempts,
  };
}

export const actorPromptV1 = {
  id: 'actor',
  version: '1.3.0',
  build(input: { evalCase: EvalCase; observation: PageObservation; history: AgentDecision[]; verifications: StepVerification[]; progress: RuntimeTaskProgress }): { system: string; user: string } {
    return {
      system: [
        'You are a simulated product user. Choose exactly one safe action grounded in the provided element IDs.',
        'Use only the user goal, persona, known information, visible page state, and evidence from actions you already took.',
        'You are intentionally blind to evaluator oracles, expected answer strings, hidden success assertions, reference paths, and judge-only evidence.',
        'Never output selectors, coordinates, multi-step scripts, hidden reasoning, destructive actions, payments, publishing, external sends, credentials, secrets, or filesystem paths.',
        'For visible file inputs, choose fill and never invent a filesystem path; the runtime will provide an approved synthetic fixture.',
        'Use finish only when visible evidence supports the user goal; use abandon when safety or the persona exit policy requires it.',
      ].join(' '),
      user: JSON.stringify({
        persona: input.evalCase.persona,
        goal: input.evalCase.goal,
        knownInformation: input.evalCase.knownInformation,
        taskProgress: actorVisibleProgress({ observation: input.observation, progress: input.progress }),
        observation: input.observation,
        recentDecisions: input.history.slice(-5),
        recentVerifications: input.verifications.slice(-5),
        safetyConstraints: ['Only use listed element IDs', 'Do not use high-risk or sensitive controls', 'One action only', 'Never choose a local file path'],
      }),
    };
  },
};
