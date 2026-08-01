import type { DeterministicJudgeResult, EvalCase, EvidencePacket } from '../../types.js';

export const semanticJudgePromptV1 = {
  id: 'semantic-judge',
  version: '1.0.0',
  build(input: { evalCase: EvalCase; packet: EvidencePacket; deterministic: DeterministicJudgeResult }): { system: string; user: string } {
    return {
      system: [
        'Judge the user-visible outcome using only supplied evidence.',
        'Separate confirmed facts, hypotheses, and unknowns. Do not invent root causes or hidden user sentiment.',
        'Return inconclusive when evidence cannot establish the expected outcome.',
      ].join(' '),
      user: JSON.stringify({
        case: { title: input.evalCase.title, goal: input.evalCase.goal, persona: input.evalCase.persona, oracle: input.evalCase.oracle },
        journey: input.packet.actions,
        observations: input.packet.observations.map((item) => ({ url: item.pageUrl, summary: item.visibleStateSummary, problems: item.visibleProblems, evidenceRefs: item.evidenceRefs })),
        verifications: input.packet.stepVerifications,
        finalState: input.packet.finalState,
        deterministic: input.deterministic,
      }),
    };
  },
};
