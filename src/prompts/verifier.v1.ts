import type { AgentActionResult, AgentDecision, PageObservation } from '../../types.js';

export const verifierPromptV1 = {
  id: 'semantic-verifier',
  version: '1.0.0',
  build(input: {
    decision: AgentDecision;
    before: PageObservation;
    after: PageObservation;
    actionResult: AgentActionResult;
    networkDelta: string[];
    consoleDelta: string[];
    visualEvidenceIncluded: boolean;
  }): { system: string; user: string } {
    return {
      system: [
        'Verify one user-visible action outcome using only supplied before/after evidence.',
        'Do not infer hidden state, backend success, root cause, or user sentiment.',
        'Return inconclusive when the expected result cannot be established.',
        'Only cite evidence references included in the request.',
      ].join(' '),
      user: JSON.stringify({
        expectation: input.decision.expectedResult,
        action: { action: input.decision.action, targetElementId: input.decision.targetElementId, result: input.actionResult },
        before: { url: input.before.pageUrl, summary: input.before.visibleStateSummary, problems: input.before.visibleProblems, formFields: input.before.formFields, evidenceRefs: input.before.evidenceRefs },
        after: { url: input.after.pageUrl, summary: input.after.visibleStateSummary, problems: input.after.visibleProblems, formFields: input.after.formFields, evidenceRefs: input.after.evidenceRefs },
        networkDelta: input.networkDelta,
        consoleDelta: input.consoleDelta,
        visualEvidenceIncluded: input.visualEvidenceIncluded,
      }),
    };
  },
};
