import type { AiProvider } from '../ai/provider.js';
import type { AgentDecision, EvalCase, PageObservation, StepVerification } from '../../types.js';
import { actorPromptV1 } from '../prompts/actor.v1.js';
import { agentDecisionSchema } from './schemas.js';

export async function chooseAgentAction(input: {
  provider: AiProvider;
  evalCase: EvalCase;
  observation: PageObservation;
  history: AgentDecision[];
  verifications: StepVerification[];
  screenshotDataUrl: string | null;
  allowRemoteModel: boolean;
  allowScreenshot: boolean;
}): Promise<AgentDecision> {
  const prompt = actorPromptV1.build(input);
  return input.provider.generateStructured({
    requestId: `actor-${input.history.length + 1}`,
    task: 'actor',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    schemaName: 'agent_decision',
    imageDataUrls: input.screenshotDataUrl ? [input.screenshotDataUrl] : [],
    privacy: { allowRemoteModel: input.allowRemoteModel, allowScreenshot: input.allowScreenshot, visibleTextOnly: true, redactionApplied: true },
    metadata: { caseId: input.evalCase.caseId, promptVersion: actorPromptV1.version },
  }, agentDecisionSchema);
}
