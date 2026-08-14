import type { AiProvider } from '../ai/provider.js';
import type { AgentDecision, EvalCase, PageObservation, StepVerification } from '../../types.js';
import { actorPromptV1 } from '../prompts/actor.v1.js';
import { agentDecisionSchema } from './schemas.js';
import type { RuntimeTaskProgress } from './task-progress.js';

function immediateOracleSatisfied(evalCase: EvalCase, observation: PageObservation): boolean {
  const assertions = evalCase.oracle.deterministicAssertions;
  if (assertions.length === 0) return false;
  const text = observation.visibleStateSummary.toLowerCase();
  return assertions.every((assertion) => {
    if (assertion.type === 'url_matches') {
      const matched = observation.pageUrl.includes(assertion.target);
      return matched !== assertion.negated;
    }
    if (assertion.type === 'text_visible' || assertion.type === 'text_absent') {
      const present = text.includes(assertion.target.toLowerCase());
      const expectedPresent = assertion.type === 'text_visible' ? !assertion.negated : assertion.negated;
      return present === expectedPresent;
    }
    // Request/console/persistence assertions require Evidence Packet state that the Actor
    // does not own. Never auto-finish a task when those assertions are present.
    return false;
  });
}

export async function chooseAgentAction(input: {
  provider: AiProvider;
  evalCase: EvalCase;
  observation: PageObservation;
  history: AgentDecision[];
  verifications: StepVerification[];
  progress: RuntimeTaskProgress;
  screenshotDataUrl: string | null;
  allowRemoteModel: boolean;
  allowScreenshot: boolean;
}): Promise<AgentDecision> {
  if (immediateOracleSatisfied(input.evalCase, input.observation)) {
    return agentDecisionSchema.parse({
      intentSummary: '当前页面已经满足全部可即时验证的确定性成功条件。',
      action: 'finish',
      targetElementId: null,
      value: null,
      expectedResult: input.evalCase.oracle.deterministicAssertions.map((assertion) => assertion.target).join('；'),
      confidence: 1,
    });
  }

  const prompt = actorPromptV1.build(input);
  return input.provider.generateStructured({
    requestId: `actor-${input.history.length + 1}`,
    task: 'actor',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    schemaName: 'agent_decision',
    imageDataUrls: input.allowScreenshot && input.screenshotDataUrl ? [input.screenshotDataUrl] : [],
    privacy: { allowRemoteModel: input.allowRemoteModel, allowScreenshot: input.allowScreenshot, visibleTextOnly: true, redactionApplied: true },
    metadata: { caseId: input.evalCase.caseId, promptVersion: actorPromptV1.version },
  }, agentDecisionSchema);
}
