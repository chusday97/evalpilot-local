import type { BusinessRule, ProductCapability, ProductTask } from '../../types.js';

export const oracleBuilderPromptV1 = {
  id: 'oracle-builder',
  version: '1.0.0',
  build(input: { task: ProductTask; capability: ProductCapability; businessRules: BusinessRule[] }): { system: string; user: string } {
    return {
      system: [
        'Build a specific, evidence-bounded evaluation Oracle for one user task.',
        'Use only supplied success signals and business rules. Do not invent selectors, API paths, UI copy, or hidden state.',
        'Deterministic assertions may use only url_matches, text_visible, text_absent, request_observed, console_error_absent, or state_persisted.',
        'Only create a deterministic assertion when a matching supplied non-semantic success signal supports the same target.',
        'Mark needsHumanReview when any included rule or signal is inferred, unknown, or already marked for review.',
        'Return inconclusive conditions for missing evidence instead of guessing.',
      ].join(' '),
      user: JSON.stringify({
        task: {
          taskId: input.task.taskId,
          name: input.task.name,
          goal: input.task.goal,
          preconditions: input.task.preconditions,
          successConditions: input.task.successConditions,
          successSignals: input.task.successSignals ?? [],
          businessRuleIds: input.task.businessRuleIds ?? [],
          needsHumanReview: input.task.needsHumanReview,
        },
        capability: { capabilityId: input.capability.capabilityId, name: input.capability.name, routes: input.capability.routes, entryPoints: input.capability.entryPoints, needsHumanReview: input.capability.needsHumanReview },
        businessRules: input.businessRules.map(({ ruleId, statement, evidenceStatus, needsHumanReview }) => ({ ruleId, statement, evidenceStatus, needsHumanReview })),
      }),
    };
  },
};
